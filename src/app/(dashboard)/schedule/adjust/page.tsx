"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { shiftLengthError } from "@/lib/shift-length";

export default function ScheduleAdjustPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    requested_date: "",
    original_start_time: "09:00",
    original_end_time: "18:00",
    requested_start_time: "",
    requested_end_time: "",
    reason: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("Not authenticated");
      setLoading(false);
      return;
    }

    // Fetch the user's schedule for the selected day
    const date = new Date(form.requested_date);
    const dayOfWeek = (date.getDay() + 6) % 7; // Convert Sunday=0 to Monday=0

    const { data: schedule } = await supabase
      .from("schedules")
      .select("*")
      .eq("employee_id", user.id)
      .eq("day_of_week", dayOfWeek)
      .lte("effective_from", form.requested_date)
      .or(
        `effective_until.is.null,effective_until.gte.${form.requested_date}`
      )
      .limit(1)
      .single();

    const originalStart = schedule?.start_time ?? form.original_start_time;
    const originalEnd = schedule?.end_time ?? form.original_end_time;

    const tooLong = shiftLengthError(form.requested_start_time, form.requested_end_time);
    if (tooLong) {
      setError(tooLong);
      setLoading(false);
      return;
    }

    const { error: insertError } = await supabase
      .from("schedule_adjustments")
      .insert({
        employee_id: user.id,
        requested_date: form.requested_date,
        original_start_time: originalStart,
        original_end_time: originalEnd,
        requested_start_time: form.requested_start_time,
        requested_end_time: form.requested_end_time,
        reason: form.reason,
      });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }

    router.push("/adjustments");
    router.refresh();
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-[26px] leading-tight text-gray-900">
          Request Schedule Adjustment
        </h1>
        <p className="text-gray-600">
          Submit a request to adjust your schedule for a specific date.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-xl border border-gray-200 bg-white p-6"
      >
        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Date
          </label>
          <input
            type="date"
            required
            value={form.requested_date}
            onChange={(e) =>
              setForm({ ...form, requested_date: e.target.value })
            }

            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Requested Start Time
            </label>
            <input
              type="time"
              required
              value={form.requested_start_time}
              onChange={(e) =>
                setForm({ ...form, requested_start_time: e.target.value })
              }
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Requested End Time
            </label>
            <input
              type="time"
              required
              value={form.requested_end_time}
              onChange={(e) =>
                setForm({ ...form, requested_end_time: e.target.value })
              }
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Reason
          </label>
          <textarea
            required
            rows={4}
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            placeholder="Please provide a reason for your schedule adjustment..."
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Submitting..." : "Submit Request"}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
