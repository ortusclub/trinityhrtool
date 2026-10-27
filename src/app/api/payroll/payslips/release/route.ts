import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/payslips";
import { notSetUp, payrollAdmin } from "../../auth";

// Publish (employees see the cutoff's payslips) or unpublish a cutoff.
export async function POST(request: Request) {
  const admin = await payrollAdmin();
  if (admin instanceof NextResponse) return admin;
  const body = (await request.json().catch(() => null)) as
    | { period_id?: string; published?: boolean }
    | null;
  if (!body || !/^\d{4}-\d{2}-P(10|25)$/.test(body.period_id ?? "") || typeof body.published !== "boolean") {
    return NextResponse.json({ error: "Unknown cutoff." }, { status: 400 });
  }

  const supabase = await createClient();
  const published_at = body.published ? new Date().toISOString() : null;
  const { error } = await supabase.from("payslip_releases").upsert(
    { period_id: body.period_id, published_at, published_by: body.published ? admin.id : null },
    { onConflict: "period_id" },
  );
  if (isMissingTable(error)) return notSetUp();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ published_at });
}
