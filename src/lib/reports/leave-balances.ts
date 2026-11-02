import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { getCycleEnd, getRenewalStart, prorateLeave } from "@/lib/leave-proration";
import { buildHolidaySet } from "@/lib/leave-days";
import { buildLeaveLedger, type CreditRow } from "@/lib/leave-ledger";
import { LEAVE_TYPE_LABELS } from "@/lib/constants";
import type { GrantType } from "@/types/database";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type LeaveBalanceRow = {
  employee_id: string;
  employee_name: string;
  employee_email: string;
  department: string;
  leave_type: string;
  leave_type_label: string;
  allocated_days: number;
  used_days: number;
  remaining_days: number;
  renewal_start: string;
  plan_name: string;
};

/**
 * Computes current-cycle leave balances for every active employee × every
 * leave type they have an allocation for. One row per (employee, type).
 *
 * Mirrors the dashboard's per-user logic but at the company level.
 */
export async function computeLeaveBalances(
  admin: SupabaseClient,
  // Payroll's final pay needs people who have already left, too.
  { includeInactive = false }: { includeInactive?: boolean } = {}
): Promise<LeaveBalanceRow[]> {
  const today = new Date().toISOString().slice(0, 10);

  const [
    employees,
    assignments,
    { data: plans },
    { data: allocations },
    leaves,
    leaveCredits,
  ] = await Promise.all([
    // Company-wide reads on growing tables — page past the 1000-row cap
    // (fetchAllRows) or the report silently undercounts. leave_requests is
    // already over 1000 total. Reference tables (plans/allocations) are small
    // and admin-bounded, so a single read is fine.
    fetchAllRows((from, to) => {
      const q = admin
        .from("users")
        .select("id, full_name, email, department, hire_date, holiday_country");
      return (includeInactive ? q : q.eq("is_active", true))
        .order("id")
        .range(from, to);
    }),
    fetchAllRows((from, to) =>
      admin
        .from("employee_leave_plans")
        .select("employee_id, plan_id")
        .order("id")
        .range(from, to)
    ),
    admin
      .from("leave_plans")
      .select("id, name, grant_type, renewal_month, renewal_day"),
    admin
      .from("leave_plan_allocations")
      .select("plan_id, leave_type, days_per_year"),
    fetchAllRows((from, to) =>
      admin
        .from("leave_requests")
        .select("employee_id, leave_type, start_date, end_date, leave_duration")
        .eq("status", "approved")
        .order("id")
        .range(from, to)
    ),
    // ALL credits granted to date, expired ones included. Excluding expired
    // credits here (as this once did) drops a credit that was granted, used,
    // then expired while leaving the leave that consumed it — so a fully-used
    // credit read as a negative balance. buildLeaveLedger keeps them and nets
    // them to zero; see 45301fa, which fixed the same bug on the profile view.
    fetchAllRows((from, to) =>
      admin
        .from("leave_credits")
        .select("employee_id, leave_type, days, granted_at, expires_at, notes, source")
        .lte("granted_at", today)
        .order("id")
        .range(from, to)
    ),
  ]);

  // All public holidays, grouped by country → set of YYYY-MM-DD covering
  // the years relevant to leave balances. Used to subtract holiday weekdays
  // from each employee's "used" count.
  const todayYear = parseInt(today.slice(0, 4));
  const holidayRangeFrom = `${todayYear - 2}-01-01`;
  const holidayRangeTo = `${todayYear + 1}-12-31`;
  const { data: allHolidays } = await admin
    .from("holidays")
    .select("country, date, is_recurring");
  const holidayByCountry = new Map<string, Set<string>>();
  const holidaysByCountryRaw = new Map<string, { date: string; is_recurring: boolean | null }[]>();
  for (const h of allHolidays ?? []) {
    if (!holidaysByCountryRaw.has(h.country)) holidaysByCountryRaw.set(h.country, []);
    holidaysByCountryRaw.get(h.country)!.push({ date: h.date, is_recurring: h.is_recurring });
  }
  for (const [country, rows] of holidaysByCountryRaw) {
    holidayByCountry.set(country, buildHolidaySet(rows, holidayRangeFrom, holidayRangeTo));
  }

  // Keep raw credits per (employee_id, leave_type) in the shape buildLeaveLedger
  // expects, so this report and the profile view compute from identical input.
  const creditsByEmp = new Map<string, Map<string, CreditRow[]>>();
  for (const c of (leaveCredits ?? []) as any[]) {
    if (!creditsByEmp.has(c.employee_id)) creditsByEmp.set(c.employee_id, new Map());
    const byType = creditsByEmp.get(c.employee_id)!;
    if (!byType.has(c.leave_type)) byType.set(c.leave_type, []);
    byType.get(c.leave_type)!.push({
      days: Number(c.days),
      granted_at: c.granted_at,
      expires_at: c.expires_at ?? null,
      notes: c.notes ?? null,
      source: c.source ?? null,
    });
  }

  const planById = new Map<string, any>(
    (plans ?? []).map((p) => [p.id, p])
  );
  const allocsByPlan = new Map<string, any[]>();
  for (const a of allocations ?? []) {
    if (!allocsByPlan.has(a.plan_id)) allocsByPlan.set(a.plan_id, []);
    allocsByPlan.get(a.plan_id)!.push(a);
  }
  const planIdsByEmp = new Map<string, string[]>();
  for (const a of assignments ?? []) {
    if (!planIdsByEmp.has(a.employee_id)) planIdsByEmp.set(a.employee_id, []);
    planIdsByEmp.get(a.employee_id)!.push(a.plan_id);
  }
  const leavesByEmp = new Map<string, any[]>();
  for (const l of leaves ?? []) {
    if (!leavesByEmp.has(l.employee_id)) leavesByEmp.set(l.employee_id, []);
    leavesByEmp.get(l.employee_id)!.push(l);
  }

  const rows: LeaveBalanceRow[] = [];

  for (const emp of employees ?? []) {
    const empPlans = planIdsByEmp.get(emp.id) ?? [];
    const empCredits = creditsByEmp.get(emp.id);
    if (empPlans.length === 0 && !empCredits) continue;

    // One bucket per leave_type, aggregated across all the employee's plans
    type Bucket = {
      allocated: number;
      plans: Set<string>;
      renewalStart: string;
    };
    const buckets = new Map<string, Bucket>();

    for (const planId of empPlans) {
      const plan = planById.get(planId);
      if (!plan) continue;
      const allocs = allocsByPlan.get(planId) ?? [];
      for (const a of allocs) {
        const { renewalStart, month, day } = getRenewalStart(
          plan.grant_type as GrantType,
          plan.renewal_month,
          plan.renewal_day,
          emp.hire_date,
          today
        );
        const prorated = prorateLeave(
          a.days_per_year,
          emp.hire_date,
          renewalStart,
          month,
          day,
          plan.grant_type as GrantType
        );
        const existing = buckets.get(a.leave_type);
        if (existing) {
          existing.allocated += prorated;
          existing.plans.add(plan.name);
          // Use the most recent cycle start across overlapping plans
          if (renewalStart > existing.renewalStart) {
            existing.renewalStart = renewalStart;
          }
        } else {
          buckets.set(a.leave_type, {
            allocated: prorated,
            plans: new Set([plan.name]),
            renewalStart,
          });
        }
      }
    }

    // Make sure a credit-only leave type still gets a row. The credits
    // themselves are applied by buildLeaveLedger below, not netted in here —
    // doing both would double-count them.
    if (empCredits) {
      const yearStart = `${today.slice(0, 4)}-01-01`;
      for (const leaveType of empCredits.keys()) {
        const existing = buckets.get(leaveType);
        if (existing) existing.plans.add("Manual credit");
        else
          buckets.set(leaveType, {
            allocated: 0,
            plans: new Set(["Manual credit"]),
            renewalStart: yearStart,
          });
      }
    }

    const empLeaves = leavesByEmp.get(emp.id) ?? [];
    const empHolidays = holidayByCountry.get(emp.holiday_country) ?? new Set<string>();

    for (const [leaveType, bucket] of buckets) {
      // One ledger, shared with the profile time-off view, so the two can't
      // disagree about the same person. It handles cycle scoping, leaves that
      // straddle a renewal, and expired credits (kept and netted, with only
      // the unused remainder forfeited).
      const ledger = buildLeaveLedger({
        leaveType,
        planBase: bucket.allocated,
        cycleStart: bucket.renewalStart,
        cycleEnd: getCycleEnd(bucket.renewalStart),
        credits: empCredits?.get(leaveType) ?? [],
        leaves: empLeaves.filter((l) => l.leave_type === leaveType),
        holidays: empHolidays,
        today,
      });

      const used = ledger.usedDays;
      // "Allocated" stays the plan entitlement plus credits, so the column
      // still reads as what they were given rather than what is left.
      const allocated =
        Math.round((ledger.available + ledger.usedDays) * 100) / 100;
      // CTO can go negative when an earned grant is revoked after the credit
      // has already been used. Other leave types stay clamped at zero — they
      // never auto-revoke and a negative there would only confuse readers.
      const rawRemaining = ledger.available;
      const remaining =
        leaveType === "cto" ? rawRemaining : Math.max(0, rawRemaining);

      rows.push({
        employee_id: emp.id,
        employee_name: emp.full_name || "",
        employee_email: emp.email || "",
        department: emp.department || "",
        leave_type: leaveType,
        leave_type_label: LEAVE_TYPE_LABELS[leaveType] ?? leaveType,
        allocated_days: allocated,
        used_days: used,
        remaining_days: remaining,
        renewal_start: bucket.renewalStart,
        plan_name: Array.from(bucket.plans).join(", "),
      });
    }
  }

  rows.sort((a, b) => {
    if (a.employee_name !== b.employee_name)
      return a.employee_name.localeCompare(b.employee_name);
    return a.leave_type.localeCompare(b.leave_type);
  });

  return rows;
}
