import type { createAdminClient } from "@/lib/supabase/admin";
import { AUTO_POPULATED_BUILT_IN_KEYS } from "@/lib/profile-fields";
import { shiftLengthError } from "@/lib/shift-length";

export type BulkImportPayload = {
  rows: Array<{
    email: string;
    user_id: string;
    user_patch?: Record<string, unknown>;
    custom_field_writes?: Array<{ field_id: string; value: string }>;
    multi_row_writes?: Array<{
      field_id: string;
      row_index: number;
      data: Record<string, string>;
    }>;
  }>;
};

export type FieldValueUpsertPayload = {
  field_id: string;
  employee_id: string;
  value: string;
};

export type MultiRowInsertPayload = {
  field_id: string;
  employee_id: string;
  data: Record<string, string>;
};

export type FieldValueDeletePayload = {
  field_id: string;
  employee_id: string;
};

export type MultiRowUpdatePayload = {
  row_id: string;
  data: Record<string, string>;
};

export type MultiRowDeletePayload = {
  row_id: string;
};

export type HelpArticleChangePayload =
  | { op: "insert"; row: Record<string, unknown> }
  | { op: "update"; id: string; patch: Record<string, unknown> }
  | { op: "delete"; id: string }
  | {
      op: "bulk_update";
      filter: Record<string, unknown>;
      patch: Record<string, unknown>;
    }
  | { op: "bulk_delete"; filter: Record<string, unknown> };

export type ScheduleWeeklyChangePayload = {
  employee_id: string;
  effective_from: string;
  days: Array<{
    day_of_week: number;
    start_time: string;
    end_time: string;
    is_rest_day: boolean;
    work_location: string;
    schedule_id?: string;
  }>;
};

type Admin = ReturnType<typeof createAdminClient>;

export type ApplyResult = {
  ok: boolean;
  error?: string;
  rowsUpdated?: number;
  cellsWritten?: number;
  errors?: string[];
};

export async function applyBulkImport(
  admin: Admin,
  actorId: string,
  payload: BulkImportPayload
): Promise<ApplyResult> {
  const errors: string[] = [];
  let rowsUpdated = 0;
  let cellsWritten = 0;

  // Process one CSV row's worth of writes — user_patch + custom field
  // upserts + multi-row inserts/updates. Stays sequential within a row
  // so a partial in-flight row isn't half-applied; rows themselves are
  // processed in parallel chunks below to stay under Vercel's 60s
  // function ceiling on large imports.
  const processRow = async (r: BulkImportPayload["rows"][number]) => {
    let wrote = false;

    if (r.user_patch && Object.keys(r.user_patch).length > 0) {
      // Strip auto-populated fields (e.g. role, location) — they must be set
      // via User Management / scheduling, not bulk import. Guards against
      // stale pending_changes payloads queued before the bulk-import filter
      // was added, and any other path (e.g. /api/users/[id]/details) that
      // might still slip them through.
      const safePatch: Record<string, unknown> = {};
      const stripped: string[] = [];
      for (const [k, v] of Object.entries(r.user_patch)) {
        if (AUTO_POPULATED_BUILT_IN_KEYS.has(k)) stripped.push(k);
        else safePatch[k] = v;
      }
      if (stripped.length > 0) {
        console.warn(
          `applyBulkImport: stripped auto-populated fields for ${r.email}: ${stripped.join(", ")}`
        );
      }
      if (Object.keys(safePatch).length > 0) {
        const { error } = await admin
          .from("users")
          .update(safePatch)
          .eq("id", r.user_id);
        if (error) {
          errors.push(`${r.email} (user update): ${error.message}`);
        } else {
          cellsWritten += Object.keys(safePatch).length;
          wrote = true;
        }
      }
    }

    for (const w of r.custom_field_writes ?? []) {
      const { error } = await admin.from("profile_field_values").upsert(
        {
          field_id: w.field_id,
          employee_id: r.user_id,
          value: w.value,
          updated_by: actorId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "field_id,employee_id" }
      );
      if (error) {
        errors.push(`${r.email} (custom field): ${error.message}`);
      } else {
        cellsWritten++;
        wrote = true;
      }
    }

    for (const mr of r.multi_row_writes ?? []) {
      const { data: existing } = await admin
        .from("profile_field_value_rows")
        .select("id, data")
        .eq("field_id", mr.field_id)
        .eq("employee_id", r.user_id)
        .eq("row_index", mr.row_index)
        .maybeSingle();
      if (existing) {
        const merged = {
          ...(existing.data as Record<string, string>),
          ...mr.data,
        };
        const { error } = await admin
          .from("profile_field_value_rows")
          .update({
            data: merged,
            updated_by: actorId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
        if (error) {
          errors.push(`${r.email} (multi-row update): ${error.message}`);
        } else {
          cellsWritten += Object.keys(mr.data).length;
          wrote = true;
        }
      } else {
        const { error } = await admin.from("profile_field_value_rows").insert({
          field_id: mr.field_id,
          employee_id: r.user_id,
          row_index: mr.row_index,
          data: mr.data,
          updated_by: actorId,
        });
        if (error) {
          errors.push(`${r.email} (multi-row insert): ${error.message}`);
        } else {
          cellsWritten += Object.keys(mr.data).length;
          wrote = true;
        }
      }
    }

    if (wrote) rowsUpdated++;
  };

  const CONCURRENCY = 10;
  for (let i = 0; i < payload.rows.length; i += CONCURRENCY) {
    const chunk = payload.rows.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(processRow));
  }

  return { ok: errors.length === 0, rowsUpdated, cellsWritten, errors };
}

export async function applyFieldValueUpsert(
  admin: Admin,
  actorId: string,
  p: FieldValueUpsertPayload
): Promise<ApplyResult> {
  const { error } = await admin.from("profile_field_values").upsert(
    {
      field_id: p.field_id,
      employee_id: p.employee_id,
      value: p.value,
      updated_by: actorId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "field_id,employee_id" }
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, cellsWritten: 1 };
}

export async function applyMultiRowInsert(
  admin: Admin,
  actorId: string,
  p: MultiRowInsertPayload
): Promise<ApplyResult> {
  const { data: existing } = await admin
    .from("profile_field_value_rows")
    .select("row_index")
    .eq("field_id", p.field_id)
    .eq("employee_id", p.employee_id)
    .order("row_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextIndex = (existing?.row_index ?? -1) + 1;
  const { error } = await admin.from("profile_field_value_rows").insert({
    field_id: p.field_id,
    employee_id: p.employee_id,
    row_index: nextIndex,
    data: p.data,
    updated_by: actorId,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, cellsWritten: 1 };
}

export async function applyFieldValueDelete(
  admin: Admin,
  _actorId: string,
  p: FieldValueDeletePayload
): Promise<ApplyResult> {
  void _actorId;
  const { error } = await admin
    .from("profile_field_values")
    .delete()
    .eq("field_id", p.field_id)
    .eq("employee_id", p.employee_id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, cellsWritten: 1 };
}

export async function applyMultiRowUpdate(
  admin: Admin,
  actorId: string,
  p: MultiRowUpdatePayload
): Promise<ApplyResult> {
  const { error } = await admin
    .from("profile_field_value_rows")
    .update({
      data: p.data,
      updated_by: actorId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", p.row_id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, cellsWritten: 1 };
}

export async function applyMultiRowDelete(
  admin: Admin,
  _actorId: string,
  p: MultiRowDeletePayload
): Promise<ApplyResult> {
  void _actorId;
  const { error } = await admin
    .from("profile_field_value_rows")
    .delete()
    .eq("id", p.row_id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, cellsWritten: 1 };
}

export async function applyHelpArticleChange(
  admin: Admin,
  _actorId: string,
  p: HelpArticleChangePayload
): Promise<ApplyResult> {
  void _actorId;
  switch (p.op) {
    case "insert": {
      const { error } = await admin.from("help_articles").insert(p.row);
      if (error) return { ok: false, error: error.message };
      return { ok: true, cellsWritten: 1 };
    }
    case "update": {
      const { error } = await admin
        .from("help_articles")
        .update(p.patch)
        .eq("id", p.id);
      if (error) return { ok: false, error: error.message };
      return { ok: true, cellsWritten: 1 };
    }
    case "delete": {
      const { error } = await admin.from("help_articles").delete().eq("id", p.id);
      if (error) return { ok: false, error: error.message };
      return { ok: true, cellsWritten: 1 };
    }
    case "bulk_update": {
      let q = admin.from("help_articles").update(p.patch);
      for (const [k, v] of Object.entries(p.filter)) {
        q = q.eq(k, v as string | number | boolean | null);
      }
      const { error } = await q;
      if (error) return { ok: false, error: error.message };
      return { ok: true, cellsWritten: 1 };
    }
    case "bulk_delete": {
      let q = admin.from("help_articles").delete();
      for (const [k, v] of Object.entries(p.filter)) {
        q = q.eq(k, v as string | number | boolean | null);
      }
      const { error } = await q;
      if (error) return { ok: false, error: error.message };
      return { ok: true, cellsWritten: 1 };
    }
  }
}

export async function applyScheduleWeeklyChange(
  admin: Admin,
  _actorId: string,
  p: ScheduleWeeklyChangePayload
): Promise<ApplyResult> {
  void _actorId;
  let cellsWritten = 0;
  const errors: string[] = [];
  for (const d of p.days) {
    const tooLong = d.is_rest_day ? null : shiftLengthError(d.start_time, d.end_time);
    if (tooLong) {
      errors.push(`Day ${d.day_of_week}: ${tooLong}`);
      continue;
    }
    const row = {
      employee_id: p.employee_id,
      day_of_week: d.day_of_week,
      start_time: d.start_time,
      end_time: d.end_time,
      is_rest_day: d.is_rest_day,
      work_location: d.work_location,
      effective_from: p.effective_from,
    };
    if (d.schedule_id) {
      const { error } = await admin
        .from("schedules")
        .update(row)
        .eq("id", d.schedule_id);
      if (error) errors.push(`Day ${d.day_of_week}: ${error.message}`);
      else cellsWritten++;
    } else {
      const { error } = await admin.from("schedules").insert(row);
      if (error) errors.push(`Day ${d.day_of_week}: ${error.message}`);
      else cellsWritten++;
    }
  }
  if (errors.length > 0) return { ok: false, error: errors.join("; "), errors };
  return { ok: true, cellsWritten };
}
