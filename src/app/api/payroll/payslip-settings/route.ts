import { NextResponse } from "next/server";
import { readPayslipSettings } from "@/lib/payslips";
import { loadPayslipSettings, savePayslipSettings } from "@/lib/payslips-store";
import { failed, payrollAdmin } from "../auth";

export async function GET() {
  const admin = await payrollAdmin();
  if (admin instanceof NextResponse) return admin;
  try {
    return NextResponse.json({ settings: await loadPayslipSettings() });
  } catch (e) {
    return failed(e);
  }
}

export async function PUT(request: Request) {
  const admin = await payrollAdmin();
  if (admin instanceof NextResponse) return admin;
  const settings = readPayslipSettings(await request.json().catch(() => null));
  try {
    await savePayslipSettings(settings);
    return NextResponse.json({ settings });
  } catch (e) {
    return failed(e);
  }
}
