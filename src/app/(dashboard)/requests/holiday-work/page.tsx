"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { formatDate, getHolidayWorkPolicy, type HolidayWorkPolicy } from "@/lib/utils";
import type {
  Holiday,
  HolidayWorkCompensation,
  HolidayWorkDuration,
} from "@/types/database";

export default function HolidayWorkRequestPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loadingHolidays, setLoadingHolidays] = useState(true);
  // Default to forced CTO until the profile loads, so the choice never
  // flashes for someone who isn't entitled to it.
  const [policy, setPolicy] = useState<HolidayWorkPolicy>({
    kind: "forced_cto",
    reason: "non_ph",
  });

  const [form, setForm] = useState<{
    holiday_id: string;
    holiday_date: string;
    start_time: string;
    end_time: string;
    work_location: string;
    reason: string;
    duration: HolidayWorkDuration;
    compensation: HolidayWorkCompensation;
  }>({
    holiday_id: "",
    holiday_date: "",
    start_time: "09:00",
    end_time: "18:00",
    work_location: "office",
    reason: "",
    duration: "full_day",
    compensation: "holiday_pay",
  });

  useEffect(() => {
    async function loadHolidays() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: userData } = await supabase
        .from("users")
        .select("holiday_country, employment_type")
        .eq("id", user.id)
        .single();

      if (!userData) return;

      setPolicy(
        getHolidayWorkPolicy({
          holiday_country: userData.holiday_country,
          employment_type: userData.employment_type,
        })
      );

      const yearStart = `${new Date().getFullYear()}-01-01`;
      const { data } = await supabase
        .from("holidays")
        .select("*")
        .eq("country", userData.holiday_country)
        .gte("date", yearStart)
        .order("date");

      setHolidays(data ?? []);
      setLoadingHolidays(false);
    }
    loadHolidays();
  }, []);

  const selectedHoliday = holidays.find((h) => h.id === form.holiday_id);

  const handleHolidayChange = (holidayId: string) => {
    const holiday = holidays.find((h) => h.id === holidayId);
    setForm({
      ...form,
      holiday_id: holidayId,
      holiday_date: holiday?.date ?? "",
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      setError("Not authenticated");
      setLoading(false);
      return;
    }

    // Compensation always reflects the current policy:
    //   - forced_cto → 'cto' regardless of form state
    //   - choice     → whatever the user picked
    const compensation: HolidayWorkCompensation =
      policy.kind === "forced_cto" ? "cto" : form.compensation;

    const { error: insertError } = await supabase
      .from("holiday_work_requests")
      .insert({
        employee_id: user.id,
        holiday_id: form.holiday_id,
        holiday_date: form.holiday_date,
        start_time: form.start_time,
        end_time: form.end_time,
        work_location: form.work_location,
        reason: form.reason,
        duration: form.duration,
        compensation,
      });

    if (insertError) {
      if (insertError.message.includes("unique") || insertError.message.includes("duplicate")) {
        setError("You already have a request for this holiday.");
      } else {
        setError(insertError.message);
      }
      setLoading(false);
      return;
    }

    // Notify manager
    try {
      await fetch("/api/notifications/holiday-work-submitted", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          holiday_name: selectedHoliday?.name ?? "",
          holiday_date: form.holiday_date,
          start_time: form.start_time,
          end_time: form.end_time,
          work_location: form.work_location,
          reason: form.reason,
        }),
      });
    } catch {
      // Non-blocking
    }

    router.push("/requests");
    router.refresh();
  };

  const inputClass = "mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href="/requests"
          className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft size={16} />
          Back to Requests
        </Link>
        <h1 className="font-display text-[26px] leading-tight text-gray-900">Work on Holiday</h1>
        <p className="text-gray-600">
          Request to work on a holiday. Your manager will review the request.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-xl border border-gray-200 bg-white p-6"
      >
        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Which holiday do you want to work on?
          </label>
          {loadingHolidays ? (
            <p className="mt-1 text-sm text-gray-500">Loading holidays...</p>
          ) : holidays.length === 0 ? (
            <p className="mt-1 text-sm text-gray-500">No holidays found for your country this year.</p>
          ) : (
            <select
              required
              value={form.holiday_id}
              onChange={(e) => handleHolidayChange(e.target.value)}
              className={inputClass}
            >
              <option value="">Select a holiday...</option>
              {holidays.map((h) => (
                <option key={h.id} value={h.id}>
                  {formatDate(h.date)} — {h.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Duration</label>
          <div className="mt-2 flex gap-4">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="duration"
                value="full_day"
                checked={form.duration === "full_day"}
                onChange={() => setForm({ ...form, duration: "full_day" })}
                className="h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Full Day</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="duration"
                value="half_day"
                checked={form.duration === "half_day"}
                onChange={() => setForm({ ...form, duration: "half_day" })}
                className="h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Half Day</span>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Start time</label>
            <input
              type="time"
              required
              value={form.start_time}
              onChange={(e) => setForm({ ...form, start_time: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">End time</label>
            <input
              type="time"
              required
              value={form.end_time}
              onChange={(e) => setForm({ ...form, end_time: e.target.value })}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Work location</label>
          <div className="mt-2 flex gap-4">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="work_location"
                value="office"
                checked={form.work_location === "office"}
                onChange={(e) => setForm({ ...form, work_location: e.target.value })}
                className="h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Office</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="work_location"
                value="online"
                checked={form.work_location === "online"}
                onChange={(e) => setForm({ ...form, work_location: e.target.value })}
                className="h-4 w-4 border-gray-300 text-green-600 focus:ring-green-500"
              />
              <span className="text-sm text-gray-700">Online</span>
            </label>
          </div>
        </div>

        {policy.kind === "choice" ? (
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Compensation
            </label>
            <p className="text-xs text-gray-500">
              Choose how you&apos;d like to be compensated for working on this
              holiday.
            </p>
            <div className="mt-2 flex gap-4">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="compensation"
                  value="holiday_pay"
                  checked={form.compensation === "holiday_pay"}
                  onChange={() =>
                    setForm({ ...form, compensation: "holiday_pay" })
                  }
                  className="h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Holiday Pay</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="compensation"
                  value="cto"
                  checked={form.compensation === "cto"}
                  onChange={() => setForm({ ...form, compensation: "cto" })}
                  className="h-4 w-4 border-gray-300 text-teal-600 focus:ring-teal-500"
                />
                <span className="text-sm text-gray-700">
                  CTO leave ({form.duration === "half_day" ? "0.5" : "1"} day,
                  credited on approval)
                </span>
              </label>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">
            <p>
              You&apos;ll be credited{" "}
              <span className="font-semibold">
                {form.duration === "half_day" ? "0.5" : "1"} day of CTO leave
              </span>{" "}
              when your manager approves this request.
            </p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Reason for working on this holiday
          </label>
          <textarea
            required
            rows={3}
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            placeholder="e.g. Urgent project deadline, client meeting..."
            className={inputClass}
          />
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={loading || !form.holiday_id}
            className="rounded-lg bg-teal-600 px-6 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {loading ? "Submitting..." : "Submit Request"}
          </button>
          <Link
            href="/requests"
            className="rounded-lg border border-gray-300 px-6 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
