import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed, payrollAdmin } from "../auth";

// GET ?year=YYYY → { holidays: [{ date, name }] }
// The Philippine holidays from Manage Holidays for that year: the ones dated
// in it, plus recurring ones moved to the same day of that year.
export async function GET(request: Request) {
  const admin = await payrollAdmin();
  if (admin instanceof NextResponse) return admin;
  const year = new URL(request.url).searchParams.get("year") ?? "";
  if (!/^\d{4}$/.test(year)) return NextResponse.json({ error: "Unknown year." }, { status: 400 });
  try {
    const { data, error } = await createAdminClient()
      .from("holidays")
      .select("name, date, is_recurring")
      .eq("country", "PH")
      .order("date");
    if (error) throw error;
    const byDate = new Map<string, string>();
    for (const h of data ?? []) {
      const date = h.date.startsWith(year) ? h.date : h.is_recurring ? year + h.date.slice(4) : null;
      if (date && !byDate.has(date)) byDate.set(date, h.name);
    }
    const holidays = Array.from(byDate, ([date, name]) => ({ date, name })).sort((a, b) =>
      a.date < b.date ? -1 : 1
    );
    return NextResponse.json({ holidays });
  } catch (e) {
    return failed(e);
  }
}
