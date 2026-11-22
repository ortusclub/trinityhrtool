import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed, payrollAdmin } from "../auth";

// GET ?year=YYYY[&country=XK,IT,…] → { holidays: [{ date, name, country }] }
// Manage Holidays for that year (Philippines unless countries are named —
// the Non-PH payroll asks for XK, IT, AE, US, KR): the ones dated in it,
// plus recurring ones moved to the same day of that year.
const COUNTRIES = new Set(["PH", "XK", "IT", "AE", "US", "KR"]);
export async function GET(request: Request) {
  const admin = await payrollAdmin();
  if (admin instanceof NextResponse) return admin;
  const year = new URL(request.url).searchParams.get("year") ?? "";
  if (!/^\d{4}$/.test(year)) return NextResponse.json({ error: "Unknown year." }, { status: 400 });
  const asked = (new URL(request.url).searchParams.get("country") ?? "PH").toUpperCase().split(",").filter(Boolean);
  if (!asked.length || asked.some((c) => !COUNTRIES.has(c))) {
    return NextResponse.json({ error: "Unknown country." }, { status: 400 });
  }
  try {
    const { data, error } = await createAdminClient()
      .from("holidays")
      .select("name, date, is_recurring, country")
      .in("country", asked)
      .order("date");
    if (error) throw error;
    const byDate = new Map<string, { date: string; name: string; country: string }>();
    for (const h of data ?? []) {
      const date = h.date.startsWith(year) ? h.date : h.is_recurring ? year + h.date.slice(4) : null;
      const key = h.country + "|" + date;
      if (date && !byDate.has(key)) byDate.set(key, { date, name: h.name, country: h.country });
    }
    const holidays = Array.from(byDate.values()).sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.country < b.country ? -1 : 1
    );
    return NextResponse.json({ holidays });
  } catch (e) {
    return failed(e);
  }
}
