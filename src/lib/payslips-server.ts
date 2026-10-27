import type { SupabaseClient } from "@supabase/supabase-js";
import { readPayslipSettings, type PayslipSettings } from "@/lib/payslips";

/** The saved payslip settings, or the defaults before any are saved. */
export async function loadPayslipSettings(supabase: SupabaseClient): Promise<PayslipSettings> {
  const { data } = await supabase.from("payslip_settings").select("settings").eq("id", 1).maybeSingle();
  return readPayslipSettings(data?.settings);
}
