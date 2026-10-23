import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/paginate";

export const maxDuration = 60;

/**
 * Payslips from the Trinity payroll site (payroll-ortus.vercel.app). The
 * payroll site is a static page whose data lives in the HR admin's browser,
 * so — unlike /api/directory — this secret DOES sit in a browser: an HR admin
 * pastes it into the payroll site's settings. It is therefore kept to the
 * least it can do:
 *
 *   - write-only: it saves payslips and returns counts plus the emails the
 *     caller itself sent that matched nobody — nothing is read back;
 *   - payslips only: a matching employee by work email, one row per cutoff,
 *     re-sending a cutoff replaces it;
 *   - CORS answers only the origins in PAYSLIP_IMPORT_ORIGINS.
 *
 * Rotate PAYSLIP_IMPORT_SECRET if the browser holding it is lost.
 *
 *   POST /api/payslips/import
 *   Authorization: Bearer $PAYSLIP_IMPORT_SECRET
 *   { "payslips": [{ email, period_id, cutoff_start, cutoff_end, payout_date,
 *                    lines: { earnings: [{label, amount}], deductions: [...] },
 *                    gross_pay, total_deductions, net_pay, remarks? }] }
 */

const MAX_PAYSLIPS = 1000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function allowedOrigins(): string[] {
  return (process.env.PAYSLIP_IMPORT_ORIGINS ?? "https://payroll-ortus.vercel.app")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins().includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function json(request: Request, body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { ...corsHeaders(request), "Cache-Control": "no-store" },
  });
}

function secretMatches(header: string | null, secret: string): boolean {
  const given = Buffer.from(header ?? "");
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

type Line = { label: string; amount: number };
type Incoming = {
  email: string;
  period_id: string;
  cutoff_start: string;
  cutoff_end: string;
  payout_date: string;
  lines: { earnings: Line[]; deductions: Line[]; [k: string]: unknown };
  gross_pay: number;
  total_deductions: number;
  net_pay: number;
  remarks?: string | null;
};

function isLines(v: unknown): v is Line[] {
  return (
    Array.isArray(v) &&
    v.every(
      (l) =>
        l &&
        typeof l.label === "string" &&
        (l.amount === null || Number.isFinite(l.amount))
    )
  );
}

/** The reason a payslip is unusable, or null when it is fine. */
function problem(p: Partial<Incoming>): string | null {
  if (typeof p.email !== "string" || !p.email.includes("@")) return "missing email";
  if (typeof p.period_id !== "string" || !p.period_id) return "missing period_id";
  for (const k of ["cutoff_start", "cutoff_end", "payout_date"] as const) {
    if (typeof p[k] !== "string" || !DATE.test(p[k] as string)) return `${k} is not YYYY-MM-DD`;
  }
  if (!p.lines || !isLines(p.lines.earnings) || !isLines(p.lines.deductions)) return "lines malformed";
  for (const k of ["gross_pay", "total_deductions", "net_pay"] as const) {
    if (!Number.isFinite(p[k])) return `${k} is not a number`;
  }
  return null;
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  const secret = process.env.PAYSLIP_IMPORT_SECRET;
  if (!secret) {
    return json(request, { error: "PAYSLIP_IMPORT_SECRET is not configured" }, 503);
  }
  if (!secretMatches(request.headers.get("authorization"), secret)) {
    return json(request, { error: "Unauthorized" }, 401);
  }

  const body = await request.json().catch(() => null);
  const incoming: Partial<Incoming>[] = Array.isArray(body?.payslips) ? body.payslips : [];
  if (incoming.length === 0) {
    return json(request, { error: "No payslips in the request" }, 400);
  }
  if (incoming.length > MAX_PAYSLIPS) {
    return json(request, { error: `At most ${MAX_PAYSLIPS} payslips per request` }, 413);
  }

  const invalid: { email: string | null; reason: string }[] = [];
  const valid: Incoming[] = [];
  for (const p of incoming) {
    const reason = problem(p);
    if (reason) invalid.push({ email: typeof p.email === "string" ? p.email : null, reason });
    else valid.push(p as Incoming);
  }

  const admin = createAdminClient();
  type U = { id: string; email: string };
  let users: U[];
  try {
    users = await fetchAllRows<U>((from, to) =>
      admin.from("users").select("id, email").order("email").range(from, to)
    );
  } catch (e) {
    return json(request, { error: e instanceof Error ? e.message : "User lookup failed" }, 500);
  }
  const byEmail = new Map(users.map((u) => [u.email.trim().toLowerCase(), u.id]));

  const unmatched: string[] = [];
  const rows = [];
  for (const p of valid) {
    const id = byEmail.get(p.email.trim().toLowerCase());
    if (!id) {
      unmatched.push(p.email);
      continue;
    }
    rows.push({
      employee_id: id,
      period_id: p.period_id,
      cutoff_start: p.cutoff_start,
      cutoff_end: p.cutoff_end,
      payout_date: p.payout_date,
      lines: p.lines,
      gross_pay: p.gross_pay,
      total_deductions: p.total_deductions,
      net_pay: p.net_pay,
      remarks: p.remarks ?? null,
      sent_at: new Date().toISOString(),
    });
  }

  if (rows.length) {
    const { error } = await admin
      .from("payslips")
      .upsert(rows, { onConflict: "employee_id,period_id" });
    if (error) return json(request, { error: error.message }, 500);
  }

  return json(request, {
    ok: true,
    saved: rows.length,
    unmatched,
    invalid: invalid.slice(0, 50),
  });
}
