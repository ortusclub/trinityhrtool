import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeNightDifferentialSchedules } from "@/lib/reports/night-differential";
import { nightDifferentialHours } from "@/lib/utils";
import { failed, payrollAdmin } from "../auth";

// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD →
//   { people: [{ email, ot: [{ date, hours, ndHours }], scheduledNd }] }
// Approved overtime requests in the cutoff (the Overtime Requests report)
// and night-differential hours of scheduled shifts actually worked (the
// Night Differential (Payroll) report), per employee by work email.
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const r2 = (n: number) => Math.round(n * 100) / 100;

function hoursBetween(start: string, end: string): number {
  const toMin = (t: string) => {
    const [h, m] = t.slice(0, 5).split(":").map(Number);
    return h * 60 + m;
  };
  let mins = toMin(end) - toMin(start);
  if (mins < 0) mins += 24 * 60; // overnight
  return r2(mins / 60);
}

export async function GET(request: Request) {
  const user = await payrollAdmin();
  if (user instanceof NextResponse) return user;
  const q = new URL(request.url).searchParams;
  const from = q.get("from") ?? "", to = q.get("to") ?? "";
  if (!DATE.test(from) || !DATE.test(to)) return NextResponse.json({ error: "Unknown dates." }, { status: 400 });
  try {
    const admin = createAdminClient();
    const [{ data: ot, error }, nd] = await Promise.all([
      admin
        .from("overtime_requests")
        .select("requested_date, start_time, end_time, employee:users!overtime_requests_employee_id_fkey(email)")
        .eq("status", "approved")
        .gte("requested_date", from)
        .lte("requested_date", to)
        .order("requested_date"),
      computeNightDifferentialSchedules(admin, { date_range: { from, to } }),
    ]);
    if (error) throw new Error(error.message);

    type Person = { email: string; ot: { date: string; hours: number; ndHours: number }[]; scheduledNd: number };
    const people = new Map<string, Person>();
    const get = (email: string) => {
      const k = email.trim().toLowerCase();
      if (!people.has(k)) people.set(k, { email: k, ot: [], scheduledNd: 0 });
      return people.get(k)!;
    };
    for (const r of ot ?? []) {
      const emp = (Array.isArray(r.employee) ? r.employee[0] : r.employee) as { email?: string } | null;
      if (!emp?.email) continue;
      get(emp.email).ot.push({
        date: r.requested_date,
        hours: hoursBetween(r.start_time, r.end_time),
        ndHours: nightDifferentialHours(r.start_time, r.end_time),
      });
    }
    for (const r of nd) {
      if (r.employee_email) get(r.employee_email).scheduledNd = r.nd_hours;
    }
    return NextResponse.json({ people: [...people.values()] });
  } catch (e) {
    return failed(e);
  }
}
