import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { addMonths, endOfMonth, format, lastDayOfMonth, parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

const MANILA_TZ = "Asia/Manila";

/**
 * Daily cron that auto-grants the "Birthday Leave" credit at the start of
 * each active employee's birth month. Idempotent — if a credit already
 * exists for this employee + leave_type='birthday' + current year, skip.
 *
 * Tenure rule (matches Ortus policy):
 *   - Grant 1 day if the employee's 6-month tenure anniversary falls on or
 *     before the last day of their birth month.
 *   - Otherwise grant 0.5 day. This covers the niche case where the
 *     employee is just shy of 6 months at the start of their birth month
 *     but will cross 6 months before the month ends.
 *
 * Credit expires at the end of the birth month — birthday leave is meant
 * to be used during the birth month itself, not banked.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const now = new Date();
  const todayManila = formatInTimeZone(now, MANILA_TZ, "yyyy-MM-dd");
  const todayMonth = parseInt(formatInTimeZone(now, MANILA_TZ, "MM"), 10);
  const todayDay = parseInt(formatInTimeZone(now, MANILA_TZ, "dd"), 10);
  const todayYear = parseInt(formatInTimeZone(now, MANILA_TZ, "yyyy"), 10);

  // Strict day-1 grant: only fire on the first day of any birth month. If
  // the cron misses day 1 (deploy gap, downtime), no retroactive grant.
  if (todayDay !== 1) {
    return NextResponse.json({ granted: 0, message: "not the first of any month" });
  }

  const { data: users, error: usersErr } = await supabase
    .from("users")
    .select("id, email, full_name, job_title, birthday, hire_date")
    .eq("is_active", true)
    .not("birthday", "is", null)
    .not("hire_date", "is", null);

  if (usersErr) {
    return NextResponse.json({ error: usersErr.message }, { status: 500 });
  }

  // Only employees whose birth month is the current Manila month, excluding
  // interns — they don't receive Birthday Leave. Intern = job title contains
  // the whole word "intern"; word boundary avoids matching e.g.
  // "International". Deliberately NOT employment_type: that column became
  // meaningful on 2026-10-08 (all of Kosovo and Rome plus a few PH staff are
  // now 'consultant'), but consultant status says nothing about leave
  // entitlement either way, so it is the wrong signal for this filter.
  const candidates = (users ?? []).filter((u) => {
    if (/\bintern\b/i.test(u.job_title ?? "")) return false;
    const m = parseInt(u.birthday!.slice(5, 7), 10);
    return m === todayMonth;
  });

  if (candidates.length === 0) {
    return NextResponse.json({ granted: 0, skipped: 0, message: "no birthdays this month" });
  }

  // Skip anyone who already has ANY active birthday credit for this calendar
  // year — admin-issued, backfilled, or a previous auto-grant. Prevents
  // double-granting on top of a manual credit.
  const candidateIds = candidates.map((u) => u.id);
  const yearStart = `${todayYear}-01-01`;
  const yearEnd = `${todayYear}-12-31`;
  const { data: existing } = await supabase
    .from("leave_credits")
    .select("employee_id")
    .eq("leave_type", "birthday")
    .gte("granted_at", yearStart)
    .lte("granted_at", yearEnd)
    .in("employee_id", candidateIds);
  const alreadyGranted = new Set((existing ?? []).map((r) => r.employee_id));

  const lastDayOfBirthMonth = format(
    endOfMonth(new Date(todayYear, todayMonth - 1, 1)),
    "yyyy-MM-dd"
  );

  const rows: Array<{
    employee_id: string;
    leave_type: string;
    days: number;
    granted_at: string;
    expires_at: string;
    source: string;
    notes: string;
  }> = [];

  for (const u of candidates) {
    if (alreadyGranted.has(u.id)) continue;
    const hire = parseISO(u.hire_date!);
    const sixMoMark = addMonths(hire, 6);
    const endOfBirthMonth = lastDayOfMonth(new Date(todayYear, todayMonth - 1, 1));
    const days = sixMoMark <= endOfBirthMonth ? 1 : 0.5;

    rows.push({
      employee_id: u.id,
      leave_type: "birthday",
      days,
      granted_at: todayManila,
      expires_at: lastDayOfBirthMonth,
      source: "auto_birthday",
      notes: `Auto-granted at start of birth month (tenure ${days === 1 ? ">=" : "<"} 6 mo)`,
    });
  }

  if (rows.length === 0) {
    return NextResponse.json({
      granted: 0,
      skipped: candidates.length,
      message: "all birth-month employees already granted for this year",
    });
  }

  const { error: insertErr } = await supabase.from("leave_credits").insert(rows);
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({
    granted: rows.length,
    skipped: candidates.length - rows.length,
    candidates: candidates.length,
    rows: rows.map((r) => ({
      employee_id: r.employee_id,
      days: r.days,
      expires_at: r.expires_at,
    })),
  });
}
