import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isMissingTable, readPayslipSettings } from "@/lib/payslips";
import { notSetUp, payrollAdmin } from "../auth";

export async function GET() {
  const admin = await payrollAdmin();
  if (admin instanceof NextResponse) return admin;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payslip_settings")
    .select("settings")
    .eq("id", 1)
    .maybeSingle();
  if (isMissingTable(error)) return notSetUp();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ setup: true, settings: readPayslipSettings(data?.settings) });
}

export async function PUT(request: Request) {
  const admin = await payrollAdmin();
  if (admin instanceof NextResponse) return admin;
  const settings = readPayslipSettings(await request.json().catch(() => null));
  const supabase = await createClient();
  const { error } = await supabase.from("payslip_settings").upsert(
    { id: 1, settings, updated_at: new Date().toISOString(), updated_by: admin.id },
    { onConflict: "id" },
  );
  if (isMissingTable(error)) return notSetUp();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings });
}
