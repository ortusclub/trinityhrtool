"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import type { ScheduleAdjustmentType, WorkLocation } from "@/types/database";
import { shiftLengthError } from "@/lib/shift-length";

export function AdminAdjustmentForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [dates, setDates] = useState<string[]>([""]);
  const [adjustmentType, setAdjustmentType] = useState<ScheduleAdjustmentType>("time");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [requestedLocation, setRequestedLocation] = useState<WorkLocation>("office");
  const [reason, setReason] = useState("");

  const addDate = () => setDates([...dates, ""]);
  const removeDate = (idx: number) =>
    setDates(dates.filter((_, i) => i !== idx));
  const updateDate = (idx: number, value: string) =>
    setDates(dates.map((d, i) => (i === idx ? value : d)));

  const showTimeFields = adjustmentType === "time" || adjustmentType === "both";
  const showLocationField = adjustmentType === "location" || adjustmentType === "both";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validDates = dates.filter((d) => d);
    if (validDates.length === 0) {
      setMessage("Please select at least one date.");
      return;
    }
    if (showTimeFields && (!startTime || !endTime)) {
      setMessage("Please set start and end times.");
      return;
    }
    const tooLong = showTimeFields ? shiftLengthError(startTime, endTime) : null;
    if (tooLong) {
      setMessage(tooLong);
      return;
    }

    setSaving(true);
    setMessage("");
    const supabase = createClient();

    const errorMessages: string[] = [];

    for (const date of validDates) {
      const dateObj = new Date(date);
      const dayOfWeek = (dateObj.getDay() + 6) % 7;

      // Get current schedule for that day
      const { data: schedule } = await supabase
        .from("schedules")
        .select("start_time, end_time")
        .eq("employee_id", userId)
        .eq("day_of_week", dayOfWeek)
        .lte("effective_from", date)
        .or(`effective_until.is.null,effective_until.gte.${date}`)
        .limit(1)
        .maybeSingle();

      const originalStart = schedule?.start_time ?? "09:00";
      const originalEnd = schedule?.end_time ?? "18:00";

      const { error } = await supabase
        .from("schedule_adjustments")
        .insert({
          employee_id: userId,
          requested_date: date,
          adjustment_type: adjustmentType,
          original_start_time: originalStart,
          original_end_time: originalEnd,
          requested_start_time: showTimeFields ? startTime : originalStart,
          requested_end_time: showTimeFields ? endTime : originalEnd,
          requested_work_location: showLocationField ? requestedLocation : null,
          reason: reason || "Admin adjustment",
          status: "approved",
          reviewed_by: (await supabase.auth.getUser()).data.user?.id,
          reviewed_at: new Date().toISOString(),
        });

      if (error) errorMessages.push(`${date}: ${error.message}`);
    }

    if (errorMessages.length > 0) {
      setMessage(
        `Created with ${errorMessages.length} error(s) — ${errorMessages.join("; ")}`
      );
    } else {
      setMessage(
        `Adjustment added for ${validDates.length} date(s) — auto-approved.`
      );
      setDates([""]);
      setAdjustmentType("time");
      setStartTime("");
      setEndTime("");
      setRequestedLocation("office");
      setReason("");
    }

    setSaving(false);
    router.refresh();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-gray-200 bg-white p-6 space-y-4"
    >
      <p className="text-sm text-gray-600">
        Add a one-off schedule change for specific dates. This will be
        auto-approved as an admin override.
      </p>

      {/* What to change */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          What to change
        </label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="admin_adj_type"
              checked={adjustmentType === "time"}
              onChange={() => setAdjustmentType("time")}
              className="h-4 w-4 text-blue-600"
            />
            <span className="text-sm text-gray-700">Time</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="admin_adj_type"
              checked={adjustmentType === "location"}
              onChange={() => setAdjustmentType("location")}
              className="h-4 w-4 text-blue-600"
            />
            <span className="text-sm text-gray-700">Working Location</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="admin_adj_type"
              checked={adjustmentType === "both"}
              onChange={() => setAdjustmentType("both")}
              className="h-4 w-4 text-blue-600"
            />
            <span className="text-sm text-gray-700">Both</span>
          </label>
        </div>
      </div>

      {/* Dates */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Date(s)
        </label>
        <div className="space-y-2">
          {dates.map((date, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                type="date"
                value={date}
                onChange={(e) => updateDate(idx, e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {dates.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeDate(idx)}
                  className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addDate}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
          >
            <Plus size={14} />
            Add another date
          </button>
        </div>
      </div>

      {/* Times */}
      {showTimeFields && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Start time
            </label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              End time
            </label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
      )}

      {/* Location */}
      {showLocationField && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Work location
          </label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="admin_adj_location"
                checked={requestedLocation === "office"}
                onChange={() => setRequestedLocation("office")}
                className="h-4 w-4 text-blue-600"
              />
              <span className="text-sm text-gray-700">Office</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="admin_adj_location"
                checked={requestedLocation === "online"}
                onChange={() => setRequestedLocation("online")}
                className="h-4 w-4 text-blue-600"
              />
              <span className="text-sm text-gray-700">Online</span>
            </label>
          </div>
        </div>
      )}

      {/* Reason */}
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Reason (optional)
        </label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Training day, client meeting..."
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {message && (
        <div
          className={`rounded-lg p-3 text-sm ${
            message.includes("error")
              ? "bg-red-50 text-red-700"
              : "bg-green-50 text-green-700"
          }`}
        >
          {message}
        </div>
      )}

      <button
        type="submit"
        disabled={saving}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? "Saving..." : "Add Adjustment"}
      </button>
    </form>
  );
}
