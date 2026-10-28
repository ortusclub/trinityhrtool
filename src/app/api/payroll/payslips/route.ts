import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/utils";
import {
  BATCH_ID,
  deleteBatch,
  getBatch,
  listBatches,
  saveBatch,
} from "@/lib/payslips-store";
import type { PayslipLine, StoredPayslip } from "@/types/database";
import { failed, payrollAdmin } from "../auth";

// Admin → Payroll → Payslip.
// GET ?batch=ID  what a batch holds;  GET  every batch.
// PUT            replace a batch (a payroll cutoff, or an uploaded file).
// DELETE ?batch  remove a batch and its payslips.
// Everything runs as the signed-in admin, so row-level security applies.

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const admin = await payrollAdmin();
  if (admin instanceof NextResponse) return admin;
  const id = new URL(request.url).searchParams.get("batch");
  const db = await createClient();
  try {
    if (id === null) return NextResponse.json({ batches: await listBatches(db) });
    if (!BATCH_ID.test(id)) return NextResponse.json({ error: "Unknown batch." }, { status: 400 });
    const batch = await getBatch(db, id);
    const rows = batch?.rows ?? [];
    return NextResponse.json({
      prepared_at: rows.reduce<string | null>((t, r) => (!t || r.prepared_at > t ? r.prepared_at : t), null),
      published_at: batch?.published_at ?? null,
      payslips: rows.map((r) => {
        const emp = (Array.isArray(r.employee) ? r.employee[0] : r.employee) as Parameters<typeof displayName>[0];
        return {
          id: r.employee_id,
          name: displayName(emp),
          email: emp?.email ?? "",
          net_pay: Number(r.net_pay),
          currency: (r.lines as { currency?: string } | null)?.currency || "PHP",
          code: (r.lines as { employee?: { code?: string } } | null)?.employee?.code ?? "",
          // The salary line(s), for splitting pay across bank accounts.
          salary: ((r.lines as { earnings?: { label?: string; amount?: number | null }[] } | null)?.earnings ?? [])
            .filter((l) => /^(gross )?salary\b/i.test(String(l.label ?? "").trim()))
            .reduce((t, l) => t + (Number(l.amount) || 0), 0),
        };
      }),
    });
  } catch (e) {
    return failed(e);
  }
}

// "Abénojar,  Frances" → "abenojar frances"
const nameKey = (v: unknown) =>
  String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z]+/g, " ").trim();

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const text = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function cleanLines(v: unknown): PayslipLine[] | null {
  if (!Array.isArray(v) || v.length > 200) return null;
  const out: PayslipLine[] = [];
  for (const l of v as Record<string, unknown>[]) {
    if (!l || typeof l !== "object" || typeof l.label !== "string") return null;
    const amount = l.amount === null ? null : num(l.amount);
    if (l.amount !== null && amount === null) return null;
    out.push({
      label: text(l.label),
      amount,
      kind: l.kind === "head" || l.kind === "sub" ? l.kind : null,
    });
  }
  return out;
}

export async function PUT(request: Request) {
  const admin = await payrollAdmin();
  if (admin instanceof NextResponse) return admin;

  const body = (await request.json().catch(() => null)) as {
    batch?: { id?: string; label?: string; payout_date?: string; cutoff_start?: string; cutoff_end?: string };
    payslips?: Record<string, unknown>[];
  } | null;
  const b = body?.batch;
  if (
    !b ||
    !BATCH_ID.test(b.id ?? "") ||
    ![b.payout_date, b.cutoff_start, b.cutoff_end].every((d) => DATE.test(d ?? "")) ||
    !text(b.label)
  ) {
    return NextResponse.json({ error: "Unknown batch." }, { status: 400 });
  }
  if (!Array.isArray(body?.payslips) || body!.payslips!.length > 2000) {
    return NextResponse.json({ error: "No payslips sent." }, { status: 400 });
  }

  try {
    const db = await createClient();
    const { data: users, error } = await db
      .from("users")
      .select("id, email, full_name, preferred_name, first_name, last_name");
    if (error) throw error;
    const byEmail = new Map(
      (users ?? []).filter((u) => u.email).map((u) => [String(u.email).trim().toLowerCase(), u]),
    );

    // Without an email, a payslip goes to the one account whose name matches
    // exactly; a name two accounts share matches nobody.
    const byName = new Map<string, (typeof users)[number] | null>();
    for (const u of users ?? []) {
      const names = new Set(
        [u.full_name, `${u.first_name ?? ""} ${u.last_name ?? ""}`, `${u.preferred_name ?? ""} ${u.last_name ?? ""}`]
          .map(nameKey)
          .filter((k) => k.includes(" ")),
      );
      for (const k of names) byName.set(k, byName.has(k) && byName.get(k)?.id !== u.id ? null : u);
    }
    const now = new Date().toISOString();
    const unmatched: string[] = [];
    const invalid: string[] = [];
    const seen = new Set<string>();
    const slips: StoredPayslip[] = [];
    for (const s of body!.payslips!) {
      const email = text(s.email).toLowerCase();
      const name = text(s.name, 120);
      const user = email ? byEmail.get(email) : name ? byName.get(nameKey(name)) ?? undefined : undefined;
      if (!user) {
        unmatched.push(email || name || "(no email)");
        continue;
      }
      const lines = (s.lines ?? {}) as Record<string, unknown>;
      const earnings = cleanLines(lines.earnings);
      const deductions = cleanLines(lines.deductions);
      const gross = num(s.gross_pay), ded = num(s.total_deductions), net = num(s.net_pay);
      const currency = text(s.currency).toUpperCase();
      if (!earnings || !deductions || gross === null || ded === null || net === null ||
          !/^[A-Z]{3}$/.test(currency) || seen.has(user.id)) {
        invalid.push(email || name);
        continue;
      }
      seen.add(user.id);
      const company = (lines.company ?? {}) as Record<string, unknown>;
      const employee = (lines.employee ?? {}) as Record<string, unknown>;
      const info = Array.isArray(lines.info)
        ? (lines.info as Record<string, unknown>[])
            .map((i) => ({ label: text(i?.label, 80), value: text(i?.value) }))
            .filter((i) => i.label && i.value)
            .slice(0, 20)
        : [];
      slips.push({
        batch_id: b.id!,
        employee_id: user.id,
        period_label: text(b.label, 80),
        payout_date: b.payout_date!,
        currency,
        lines: {
          earnings,
          deductions,
          net_taxable: num(lines.net_taxable),
          company: { name: text(company.name), address: text(company.address), tin: text(company.tin, 40) },
          employee: {
            code: text(employee.code, 40),
            position: text(employee.position, 120),
            branch: text(employee.branch, 120),
            personal_no: text(employee.personal_no, 40),
          },
          info,
        },
        gross_pay: gross,
        total_deductions: ded,
        net_pay: net,
        remarks: text(s.remarks, 1000) || null,
        prepared_at: now,
      });
    }

    await saveBatch(db, { id: b.id!, cutoff_start: b.cutoff_start!, cutoff_end: b.cutoff_end! }, slips, admin.id);
    return NextResponse.json({ saved: slips.length, unmatched, invalid });
  } catch (e) {
    return failed(e);
  }
}

export async function DELETE(request: Request) {
  const admin = await payrollAdmin();
  if (admin instanceof NextResponse) return admin;
  const id = new URL(request.url).searchParams.get("batch") ?? "";
  if (!BATCH_ID.test(id)) return NextResponse.json({ error: "Unknown batch." }, { status: 400 });
  try {
    await deleteBatch(await createClient(), id);
    return NextResponse.json({ deleted: id });
  } catch (e) {
    return failed(e);
  }
}
