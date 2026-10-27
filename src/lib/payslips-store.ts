import type { SupabaseClient } from "@supabase/supabase-js";
import { readPayslipSettings, type PayslipSettings } from "@/lib/payslips";
import { formatDate } from "@/lib/utils";
import type { StoredPayslip } from "@/types/database";

// Payslips in the payslips / payslip_releases / payslip_settings tables
// (supabase/migrations/20261027_add_payslips.sql). Callers pass the
// signed-in user's client, so row-level security decides what comes back:
// admins see everything, a member only their own from released batches.
//
// A batch is one period_id: a payroll cutoff ("2026-11-P10") or an uploaded
// Non-Trinity file ("notax-2026-10-23", "xk-2026-10-23").
export const BATCH_ID = /^(\d{4}-\d{2}-P(10|25)|(notax|xk)-\d{4}-\d{2}-\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BatchKind = "trinity" | "notax" | "xk";
export function batchKind(id: string): BatchKind {
  return id.startsWith("notax-") ? "notax" : id.startsWith("xk-") ? "xk" : "trinity";
}

export interface BatchEntry {
  user_id: string;
  name: string;
  email: string;
  net_pay: number;
  currency: string;
}

export interface BatchSummary {
  id: string;
  kind: BatchKind;
  label: string;
  payout_date: string;
  prepared_at: string;
  published_at: string | null;
  count: number;
}

interface Row {
  employee_id: string;
  period_id: string;
  cutoff_start: string;
  cutoff_end: string;
  payout_date: string;
  lines: StoredPayslip["lines"] & { currency?: string; period_label?: string };
  gross_pay: number | string;
  total_deductions: number | string;
  net_pay: number | string;
  remarks: string | null;
  prepared_at: string;
}

/** Cutoffs prepared before uploads existed carry no label or currency. */
function toSlip(r: Row): StoredPayslip {
  const { currency, period_label, ...lines } = r.lines ?? ({} as Row["lines"]);
  return {
    batch_id: r.period_id,
    employee_id: r.employee_id,
    period_label: period_label || `${formatDate(r.cutoff_start)} – ${formatDate(r.cutoff_end)}`,
    payout_date: r.payout_date,
    currency: currency || "PHP",
    lines,
    gross_pay: Number(r.gross_pay),
    total_deductions: Number(r.total_deductions),
    net_pay: Number(r.net_pay),
    remarks: r.remarks,
    prepared_at: r.prepared_at,
  };
}

const ROW = "employee_id, period_id, cutoff_start, cutoff_end, payout_date, lines, gross_pay, total_deductions, net_pay, remarks, prepared_at";

export async function getBatch(db: SupabaseClient, id: string) {
  if (!BATCH_ID.test(id)) return null;
  const [{ data, error }, { data: release, error: relError }] = await Promise.all([
    db
      .from("payslips")
      .select("employee_id, net_pay, prepared_at, lines, employee:users!payslips_employee_id_fkey(email, full_name, preferred_name, first_name, last_name)")
      .eq("period_id", id),
    db.from("payslip_releases").select("published_at").eq("period_id", id).maybeSingle(),
  ]);
  if (error) throw error;
  if (relError) throw relError;
  return { rows: data ?? [], published_at: (release?.published_at as string | null) ?? null };
}

interface ListRow {
  period_id: string;
  payout_date: string;
  cutoff_start: string;
  cutoff_end: string;
  prepared_at: string;
  label: string | null;
}

export async function listBatches(db: SupabaseClient): Promise<BatchSummary[]> {
  // One row per payslip, read a page at a time (the API returns at most
  // 1,000 rows per request).
  const data: ListRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page, error } = await db
      .from("payslips")
      .select("period_id, payout_date, cutoff_start, cutoff_end, prepared_at, label:lines->>period_label")
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    data.push(...((page ?? []) as ListRow[]));
    if (!page || page.length < 1000) break;
  }
  const { data: releases, error: relError } = await db
    .from("payslip_releases")
    .select("period_id, published_at");
  if (relError) throw relError;
  const published = new Map((releases ?? []).map((r) => [r.period_id as string, r.published_at as string | null]));
  const out = new Map<string, BatchSummary>();
  for (const r of data) {
    const b = out.get(r.period_id);
    if (b) {
      b.count++;
      if (r.prepared_at > b.prepared_at) b.prepared_at = r.prepared_at;
      continue;
    }
    out.set(r.period_id, {
      id: r.period_id,
      kind: batchKind(r.period_id),
      label: r.label || `${formatDate(r.cutoff_start)} – ${formatDate(r.cutoff_end)}`,
      payout_date: r.payout_date,
      prepared_at: r.prepared_at,
      published_at: published.get(r.period_id) ?? null,
      count: 1,
    });
  }
  return [...out.values()].sort((a, b) => b.payout_date.localeCompare(a.payout_date));
}

/** Replaces a batch's payslips with `slips`. */
export async function saveBatch(
  db: SupabaseClient,
  batch: { id: string; cutoff_start: string; cutoff_end: string },
  slips: StoredPayslip[],
  preparedBy: string,
): Promise<void> {
  const del = await db.from("payslips").delete().eq("period_id", batch.id);
  if (del.error) throw del.error;
  if (!slips.length) return;
  const ins = await db.from("payslips").insert(
    slips.map((s) => ({
      employee_id: s.employee_id,
      period_id: batch.id,
      cutoff_start: batch.cutoff_start,
      cutoff_end: batch.cutoff_end,
      payout_date: s.payout_date,
      lines: { ...s.lines, currency: s.currency, period_label: s.period_label },
      gross_pay: s.gross_pay,
      total_deductions: s.total_deductions,
      net_pay: s.net_pay,
      remarks: s.remarks,
      prepared_at: s.prepared_at,
      prepared_by: preparedBy,
    })),
  );
  if (ins.error) throw ins.error;
}

export async function deleteBatch(db: SupabaseClient, id: string): Promise<void> {
  const [a, b] = await Promise.all([
    db.from("payslips").delete().eq("period_id", id),
    db.from("payslip_releases").delete().eq("period_id", id),
  ]);
  if (a.error) throw a.error;
  if (b.error) throw b.error;
}

export async function setRelease(db: SupabaseClient, id: string, by: string | null): Promise<string | null> {
  const published_at = by ? new Date().toISOString() : null;
  const { error } = await db
    .from("payslip_releases")
    .upsert({ period_id: id, published_at, published_by: by }, { onConflict: "period_id" });
  if (error) throw error;
  return published_at;
}

export async function getSlip(db: SupabaseClient, batchId: string, userId: string) {
  if (!BATCH_ID.test(batchId) || !UUID.test(userId)) return null;
  const { data } = await db
    .from("payslips")
    .select(ROW)
    .eq("period_id", batchId)
    .eq("employee_id", userId)
    .maybeSingle();
  return data ? toSlip(data as Row) : null;
}

/** A person's own payslips from released batches, newest first. */
export async function releasedSlipsFor(db: SupabaseClient, userId: string): Promise<StoredPayslip[]> {
  const [{ data }, { data: releases }] = await Promise.all([
    db.from("payslips").select(ROW).eq("employee_id", userId).order("payout_date", { ascending: false }),
    db.from("payslip_releases").select("period_id").not("published_at", "is", null),
  ]);
  // RLS already hides drafts from members; admins can read drafts, which
  // don't belong on their own list.
  const released = new Set((releases ?? []).map((r) => r.period_id));
  return ((data ?? []) as Row[]).filter((r) => released.has(r.period_id)).map(toSlip);
}

export async function isReleased(db: SupabaseClient, batchId: string): Promise<boolean> {
  const { data } = await db
    .from("payslip_releases")
    .select("published_at")
    .eq("period_id", batchId)
    .maybeSingle();
  return !!data?.published_at;
}

export async function anyReleased(db: SupabaseClient): Promise<boolean> {
  const { count } = await db
    .from("payslip_releases")
    .select("period_id", { count: "exact", head: true })
    .not("published_at", "is", null);
  return !!count;
}

export async function loadPayslipSettings(db: SupabaseClient): Promise<PayslipSettings> {
  const { data } = await db.from("payslip_settings").select("settings").eq("id", 1).maybeSingle();
  return readPayslipSettings(data?.settings);
}

export async function savePayslipSettings(db: SupabaseClient, settings: PayslipSettings, by: string): Promise<void> {
  const { error } = await db
    .from("payslip_settings")
    .upsert({ id: 1, settings, updated_at: new Date().toISOString(), updated_by: by }, { onConflict: "id" });
  if (error) throw error;
}
