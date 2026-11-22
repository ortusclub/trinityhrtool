import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed, payrollAdmin } from "../auth";

// GET → { people: [{ email, country }] }
// Each TrinityHR account's country (User Management), which the Non-PH
// payroll uses for whose holidays apply and whether Kosovo rules do.
export async function GET() {
  const admin = await payrollAdmin();
  if (admin instanceof NextResponse) return admin;
  try {
    const { data, error } = await createAdminClient().from("users").select("email, holiday_country");
    if (error) throw error;
    const people = (data ?? [])
      .filter((u) => u.email && u.holiday_country)
      .map((u) => ({ email: String(u.email).trim().toLowerCase(), country: u.holiday_country }));
    return NextResponse.json({ people });
  } catch (e) {
    return failed(e);
  }
}
