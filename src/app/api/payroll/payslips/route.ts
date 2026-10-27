import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/payslips";
import { notSetUp, payrollAdmin } from "../auth";

// Admin → Payroll → Payslip. GET: what TrinityHR holds for a cutoff.
// PUT: replace a cutoff's payslips with the payroll app's current figures.

const ID = /^\d{4}-\d{2}-P(10|25)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const admin = await payrollAdmin();
  if (admin instanceof NextResponse) return admin;
  const period = new URL(request.url).searchParams.get("period") ?? "";
  if (!ID.test(period)) return NextResponse.json({ error: "Unknown cutoff." }, { status: 400 });

  const supabase = await createClient();
  const [{ data: rows, error }, { data: release, error: relError }] = await Promise.all([
    supabase
      .from("payslips")
      .select("id, net_pay, prepared_at, employee:users!payslips_employee_id_fkey(email, full_name)")
      .eq("period_id", period)
      .order("employee_id"),
    supabase.from("payslip_releases").select("published_at").eq("period_id", period).maybeSingle(),
  ]);
  if (isMissingTable(error) || isMissingTable(relError)) return notSetUp();
  if (error || relError) {
    return NextResponse.json({ error: (error ?? relError)!.message }, { status: 500 });
  }

  const payslips = (rows ?? []).map((r) => {
    const emp = (Array.isArray(r.employee) ? r.employee[0] : r.employee) as
      | { email: string; full_name: string | null }
      | null;
    return { id: r.id, email: emp?.email ?? "", name: emp?.full_name ?? "", net_pay: r.net_pay };
  });
  payslips.sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({
    setup: true,
    published_at: release?.published_at ?? null,
    prepared_at: rows?.[0]?.prepared_at ?? null,
    payslips,
  });
}

interface Incoming {
  email?: unknown;
  lines?: unknown;
  gross_pay?: unknown;
  total_deductions?: unknown;
  net_pay?: unknown;
  remarks?: unknown;
}

export async function PUT(request: Request) {
  const admin = await payrollAdmin();
  if (admin instanceof NextResponse) return admin;

  const body = (await request.json().catch(() => null)) as {
    period?: { id?: string; start?: string; end?: string; payout?: string };
    payslips?: Incoming[];
  } | null;
  const p = body?.period;
  if (!p || !ID.test(p.id ?? "") || ![p.start, p.end, p.payout].every((d) => DATE.test(d ?? ""))) {
    return NextResponse.json({ error: "Unknown cutoff." }, { status: 400 });
  }
  if (!Array.isArray(body?.payslips)) {
    return NextResponse.json({ error: "No payslips sent." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: users, error: usersError } = await supabase.from("users").select("id, email");
  if (usersError) return NextResponse.json({ error: usersError.message }, { status: 500 });
  const byEmail = new Map(
    (users ?? []).filter((u) => u.email).map((u) => [String(u.email).trim().toLowerCase(), u.id]),
  );

  const unmatched: string[] = [];
  const seen = new Set<string>();
  const rows = [];
  for (const s of body!.payslips!) {
    const email = typeof s.email === "string" ? s.email.trim().toLowerCase() : "";
    const id = email ? byEmail.get(email) : undefined;
    const nums = [s.gross_pay, s.total_deductions, s.net_pay];
    if (!id || seen.has(id) || !s.lines || typeof s.lines !== "object" || !nums.every(Number.isFinite)) {
      unmatched.push(email || "(no email)");
      continue;
    }
    seen.add(id);
    rows.push({
      employee_id: id,
      period_id: p.id!,
      cutoff_start: p.start!,
      cutoff_end: p.end!,
      payout_date: p.payout!,
      lines: s.lines,
      gross_pay: s.gross_pay as number,
      total_deductions: s.total_deductions as number,
      net_pay: s.net_pay as number,
      remarks: typeof s.remarks === "string" && s.remarks.trim() ? s.remarks.trim() : null,
      prepared_by: admin.id,
    });
  }

  const del = await supabase.from("payslips").delete().eq("period_id", p.id!);
  if (isMissingTable(del.error)) return notSetUp();
  if (del.error) return NextResponse.json({ error: del.error.message }, { status: 500 });
  if (rows.length) {
    const ins = await supabase.from("payslips").insert(rows);
    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
  }
  return NextResponse.json({ saved: rows.length, unmatched });
}
