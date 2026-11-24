import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed, payrollAdmin } from "../auth";

type Sub = { key: string; label: string; type?: string };

/** A salary amount as typed ("PHP 45,000.00", "45000") → number, or null. */
function amountOf(v: unknown): number | null {
  const s = String(v ?? "").replace(/[^0-9.\-]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/** A date as stored by a date subfield (YYYY-MM-DD) or typed (M/D/YYYY), or null. */
function dateOf(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const d = new Date(s);
  return s && !Number.isNaN(d.getTime())
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    : null;
}

// GET → { field, salaries: [{ email, entries: [{ amount, currency, effective, updatedAt, selfEdited }] }] }
// Every person's "Current Salary" entries from the Team Directory, the reference
// for payroll rates. selfEdited flags an entry last saved by the employee themself.
export async function GET() {
  const admin = await payrollAdmin();
  if (admin instanceof NextResponse) return admin;
  try {
    const db = createAdminClient();
    const { data: fields, error: fe } = await db
      .from("profile_fields")
      .select("id, label, subfields")
      .ilike("label", "current salary");
    if (fe) throw fe;
    const field = fields?.[0];
    if (!field) return NextResponse.json({ field: null, salaries: [] });
    const subs = (field.subfields ?? []) as Sub[];
    const keyOf = (re: RegExp, type?: string) =>
      subs.find((s) => re.test(s.label))?.key ?? (type ? subs.find((s) => s.type === type)?.key : undefined);
    const kAmount = keyOf(/amount|salary|rate/i);
    const kCurrency = keyOf(/currenc/i);
    const kEffective = keyOf(/effect|date|from|start/i, "date");

    const { data: rows, error: re } = await db
      .from("profile_field_value_rows")
      .select("employee_id, data, updated_by, updated_at")
      .eq("field_id", field.id);
    if (re) throw re;
    const ids = [...new Set((rows ?? []).map((r) => r.employee_id as string))];
    const emails = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data: us, error: ue } = await db.from("users").select("id, email").in("id", ids.slice(i, i + 200));
      if (ue) throw ue;
      (us ?? []).forEach((u) => emails.set(u.id as string, String(u.email ?? "").trim().toLowerCase()));
    }

    const byEmail = new Map<string, { amount: number; currency: string; effective: string | null; updatedAt: string; selfEdited: boolean }[]>();
    for (const r of rows ?? []) {
      const email = emails.get(r.employee_id as string);
      const d = (r.data ?? {}) as Record<string, string>;
      const amount = kAmount ? amountOf(d[kAmount]) : null;
      if (!email || amount === null) continue;
      const list = byEmail.get(email) ?? [];
      list.push({
        amount,
        currency: kCurrency ? String(d[kCurrency] ?? "").trim().toUpperCase() : "",
        effective: kEffective ? dateOf(d[kEffective]) : null,
        updatedAt: r.updated_at as string,
        selfEdited: !!r.updated_by && r.updated_by === r.employee_id,
      });
      byEmail.set(email, list);
    }
    const salaries = [...byEmail.entries()].map(([email, entries]) => ({ email, entries }));
    return NextResponse.json({ field: { label: field.label, hasEffective: !!kEffective }, salaries });
  } catch (e) {
    return failed(e);
  }
}
