import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { failed, payrollAdmin } from "../auth";

// The payroll app's data in payroll_state
// (supabase/migrations/20261028_add_payroll_state.sql), read and written by
// src/payroll-app/sync.js so every admin works on the same payroll.
const KEY = /^(employees|settings|holidays|dtr\|[^|]{1,40}\|[^|]{1,100})$/;
const PAGE = 1000;

// Until the migration is run the table is missing; the app then keeps
// working from the browser alone.
function missingTable(e: { code?: string } | null) {
  return e?.code === "PGRST205" || e?.code === "42P01";
}

export async function GET() {
  const admin = await payrollAdmin();
  if (admin instanceof NextResponse) return admin;
  const supabase = await createClient();
  const rows: Record<string, unknown> = {};
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("payroll_state")
      .select("key, value")
      .order("key")
      .range(from, from + PAGE - 1);
    if (missingTable(error)) return NextResponse.json({ disabled: true });
    if (error) return failed(error);
    for (const r of data ?? []) rows[r.key] = r.value;
    if (!data || data.length < PAGE) break;
  }
  return NextResponse.json({ rows });
}

/** { set: {key: value}, remove: [key], seed?: true } — seed never overwrites. */
export async function PUT(request: Request) {
  const admin = await payrollAdmin();
  if (admin instanceof NextResponse) return admin;
  const body = await request.json().catch(() => null);
  const set = body && typeof body.set === "object" && body.set ? body.set : {};
  const remove: unknown[] = Array.isArray(body?.remove) ? body.remove : [];
  const keys = [...Object.keys(set), ...remove.map(String)];
  const bad = keys.find((k) => !KEY.test(k));
  if (bad) return NextResponse.json({ error: `Unknown key ${bad}` }, { status: 400 });

  const supabase = await createClient();
  try {
    const now = new Date().toISOString();
    const upserts = Object.entries(set)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => ({ key, value, updated_at: now, updated_by: admin.id }));
    for (let i = 0; i < upserts.length; i += PAGE) {
      const { error } = await supabase
        .from("payroll_state")
        .upsert(upserts.slice(i, i + PAGE), { onConflict: "key", ignoreDuplicates: body?.seed === true });
      if (error) throw error;
    }
    const gone = remove.map(String);
    for (let i = 0; i < gone.length; i += PAGE) {
      const { error } = await supabase.from("payroll_state").delete().in("key", gone.slice(i, i + PAGE));
      if (error) throw error;
    }
    return NextResponse.json({ saved: upserts.length, removed: gone.length });
  } catch (e) {
    return failed(e);
  }
}
