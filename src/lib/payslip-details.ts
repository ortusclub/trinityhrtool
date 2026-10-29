import { createAdminClient } from "@/lib/supabase/admin";

export type PayslipDetails = {
  /** The employer as Settings & Rules → Company has it now. */
  company?: { name?: string; address?: string; tin?: string };
  account?: string;
  sss?: string;
  philhealth?: string;
  pagibig?: string;
  tin?: string;
};

type PayrollEmployee = {
  id?: string;
  email?: string;
  company?: string;
  sssNo?: string;
  philhealthNo?: string;
  pagibigNo?: string;
  tin?: string;
};

const clean = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "");

/**
 * What a Trinity payslip shows beyond its stored lines: the account the
 * person works on (their company — Ortus, Trinity, APEX …) and their SSS,
 * PhilHealth, Pag-IBIG and TIN numbers, read live from the payroll's
 * employee list (payroll_state "employees", the Employees tab / 201 File),
 * so payslips already published show them too. Matched by work email, then
 * by employee code. Read with the service role: the viewer only ever gets
 * their own row back.
 */
export async function payslipDetails(args: {
  email?: string | null;
  code?: string | null;
  userCompany?: string | null;
}): Promise<PayslipDetails> {
  const email = clean(args.email).toLowerCase();
  const code = clean(args.code);
  let emp: PayrollEmployee | undefined;
  let company: PayslipDetails["company"];
  try {
    const { data: rows } = await createAdminClient()
      .from("payroll_state")
      .select("key, value")
      .in("key", ["employees", "settings"]);
    const value = (k: string) => rows?.find((r) => r.key === k)?.value;
    const list = (Array.isArray(value("employees")) ? value("employees") : []) as PayrollEmployee[];
    const co = ((value("settings") as { company?: Record<string, unknown> } | undefined)?.company ?? {});
    const address = [clean(co.address), clean(co.zip)].filter(Boolean).join(" ");
    if (clean(co.name)) company = { name: clean(co.name), address, tin: clean(co.tin) };
    emp =
      (email ? list.find((e) => clean(e.email).toLowerCase() === email) : undefined) ??
      (code ? list.find((e) => clean(e.id) === code) : undefined);
  } catch {
    emp = undefined;
  }
  const out: PayslipDetails = {
    company,
    account: clean(emp?.company) || clean(args.userCompany) || undefined,
    sss: clean(emp?.sssNo) || undefined,
    philhealth: clean(emp?.philhealthNo) || undefined,
    pagibig: clean(emp?.pagibigNo) || undefined,
    tin: clean(emp?.tin) || undefined,
  };
  return out;
}
