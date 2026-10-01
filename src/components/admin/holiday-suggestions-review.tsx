"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Check, X, CheckCheck } from "lucide-react";
import { format, parseISO } from "date-fns";
import { HOLIDAY_COUNTRY_LABELS } from "@/types/database";
import type { HolidayCountry } from "@/types/database";

export type HolidaySuggestion = {
  id: string;
  country: string;
  name: string;
  date: string;
  year: number;
};

export function HolidaySuggestionsReview({
  suggestions,
}: {
  suggestions: HolidaySuggestion[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  if (suggestions.length === 0) return null;

  // Group by country, preserving the PH/XK/IT/AE order used elsewhere.
  const order: string[] = ["PH", "XK", "IT", "AE", "US", "KR"];
  const byCountry = new Map<string, HolidaySuggestion[]>();
  for (const s of suggestions) {
    (byCountry.get(s.country) ?? byCountry.set(s.country, []).get(s.country)!).push(s);
  }
  const countries = Array.from(byCountry.keys()).sort(
    (a, b) => order.indexOf(a) - order.indexOf(b)
  );

  const approve = async (items: HolidaySuggestion[], busyKey: string) => {
    setBusy(busyKey);
    setMessage("");
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error: insertErr } = await supabase.from("holidays").insert(
      items.map((s) => ({
        name: s.name,
        date: s.date,
        country: s.country,
        is_recurring: false,
        created_by: user?.id,
      }))
    );
    if (insertErr) {
      setMessage(`Couldn't approve: ${insertErr.message}`);
      setBusy(null);
      return;
    }
    const { error: delErr } = await supabase
      .from("holiday_suggestions")
      .delete()
      .in("id", items.map((s) => s.id));
    if (delErr) {
      setMessage(`Approved, but cleanup failed: ${delErr.message}`);
    }
    setBusy(null);
    router.refresh();
  };

  const dismiss = async (ids: string[], busyKey: string) => {
    setBusy(busyKey);
    setMessage("");
    const supabase = createClient();
    const { error } = await supabase
      .from("holiday_suggestions")
      .delete()
      .in("id", ids);
    if (error) setMessage(`Couldn't dismiss: ${error.message}`);
    setBusy(null);
    router.refresh();
  };

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-6">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="font-display text-[20px] text-amber-900">
          Suggested Holidays — pending review ({suggestions.length})
        </h2>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => approve(suggestions, "approve-all")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          <CheckCheck size={15} />
          {busy === "approve-all" ? "Approving…" : "Approve all"}
        </button>
      </div>
      <p className="mb-4 text-sm text-amber-800">
        Auto-pulled from a public holiday source. These are <strong>not live</strong> and
        don&apos;t affect leave or schedules until approved. Approving adds them as one-off
        (non-recurring) holidays.
      </p>

      {message && (
        <div className="mb-3 rounded-lg bg-white px-3 py-2 text-sm text-red-700">{message}</div>
      )}

      <div className="space-y-4">
        {countries.map((country) => {
          const items = byCountry.get(country)!;
          return (
            <div key={country} className="rounded-lg border border-amber-200 bg-white">
              <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
                <h3 className="text-sm font-semibold text-gray-900">
                  {HOLIDAY_COUNTRY_LABELS[country as HolidayCountry] ?? country}
                  <span className="ml-2 text-xs font-normal text-gray-500">
                    {items.length} suggested
                  </span>
                </h3>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => approve(items, `approve-${country}`)}
                    className="rounded-md border border-emerald-300 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                  >
                    {busy === `approve-${country}` ? "…" : "Approve all"}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => dismiss(items.map((s) => s.id), `dismiss-${country}`)}
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {busy === `dismiss-${country}` ? "…" : "Dismiss all"}
                  </button>
                </div>
              </div>
              <div className="divide-y divide-gray-100">
                {items.map((s) => (
                  <div key={s.id} className="flex items-center justify-between px-4 py-2">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{s.name}</p>
                      <p className="text-xs text-gray-500">
                        {format(parseISO(s.date), "EEEE, MMMM d, yyyy")}
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => approve([s], `approve-one-${s.id}`)}
                        title="Approve"
                        className="rounded-md border border-emerald-300 p-1.5 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => dismiss([s.id], `dismiss-one-${s.id}`)}
                        title="Dismiss"
                        className="rounded-md border border-gray-300 p-1.5 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
