import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeLeaveBalances } from "@/lib/reports/leave-balances";
import { failed, payrollAdmin } from "../auth";

// GET → { balances: [{ email, allocated, used, remaining, cycleStart }] }
// Each active employee's Annual Leave for the current cycle, from the same
// ledger as their dashboard (approved leave only; pending is not counted).
export async function GET() {
  const admin = await payrollAdmin();
  if (admin instanceof NextResponse) return admin;
  try {
    const rows = await computeLeaveBalances(createAdminClient());
    const balances = rows
      .filter((r) => r.leave_type === "annual" && r.employee_email)
      .map((r) => ({
        email: r.employee_email.trim().toLowerCase(),
        allocated: r.allocated_days,
        used: r.used_days,
        remaining: r.remaining_days,
        cycleStart: r.renewal_start,
      }));
    return NextResponse.json({ balances });
  } catch (e) {
    return failed(e);
  }
}
