import { getCurrentUser } from "@/lib/auth/helpers";
import { createClient } from "@/lib/supabase/server";
import { HOLIDAY_COUNTRY_LABELS } from "@/types/database";
import type { Holiday, HolidayCountry } from "@/types/database";
import { format, parseISO } from "date-fns";

export default async function HolidaysPage() {
  await getCurrentUser();
  const supabase = await createClient();

  const today = new Date().toISOString().split("T")[0];

  const { data: holidays } = await supabase
    .from("holidays")
    .select("*")
    .gte("date", today)
    .order("date", { ascending: true });

  // Group by country
  const grouped: Record<HolidayCountry, Holiday[]> = {
    PH: [],
    XK: [],
    IT: [],
    AE: [],
    US: [],
    KR: [],
  };

  for (const holiday of holidays ?? []) {
    grouped[holiday.country as HolidayCountry]?.push(holiday);
  }

  const countryOrder: HolidayCountry[] = ["PH", "XK", "IT", "AE", "US", "KR"];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-[26px] leading-tight text-gray-900">Public Holidays</h1>
        <p className="text-gray-600">
          Upcoming public holidays across all office locations
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {countryOrder.map((country) => (
          <div
            key={country}
            className="rounded-xl border border-gray-200 bg-white shadow-sm"
          >
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="font-display text-[20px] text-gray-900">
                {HOLIDAY_COUNTRY_LABELS[country]}
              </h2>
              <p className="text-sm text-gray-500">
                {grouped[country].length} upcoming{" "}
                {grouped[country].length === 1 ? "holiday" : "holidays"}
              </p>
            </div>
            <div className="divide-y divide-gray-100">
              {grouped[country].length > 0 ? (
                grouped[country].map((holiday) => (
                  <div
                    key={holiday.id}
                    className="flex items-center justify-between px-6 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {holiday.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {format(parseISO(holiday.date), "EEEE, MMMM d, yyyy")}
                      </p>
                    </div>
                    {holiday.is_recurring && (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
                        Annual
                      </span>
                    )}
                  </div>
                ))
              ) : (
                <p className="px-6 py-4 text-center text-sm text-gray-500">
                  No upcoming holidays
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
