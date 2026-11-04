"use client";

import { useState, useEffect, useCallback } from "react";
import { OddDateWarning } from "@/components/shared/odd-date-warning";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, X, AlertTriangle } from "lucide-react";
import type { ScheduleAdjustmentType, WorkLocation } from "@/types/database";
import { WeeklyScheduleEditor } from "@/components/profile/weekly-schedule-editor";
import { hasNightDifferentialHours } from "@/lib/utils";
import { NightDiffBanner } from "@/components/shared/night-diff-banner";
import { shiftLengthError } from "@/lib/shift-length";

type ScheduleRow = {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_rest_day: boolean;
  work_location: string;
};

interface OfficeWarning {
  date: string;
  officeDays: number;
  threshold: number;
}

export default function ScheduleAdjustmentPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isPermanent, setIsPermanent] = useState(false);

  const [dateMode, setDateMode] = useState<"individual" | "range">("individual");
  const [dates, setDates] = useState<string[]>([""]);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [locationFilter, setLocationFilter] = useState<"all" | "online" | "office">("all");
  const [adjustmentType, setAdjustmentType] = useState<ScheduleAdjustmentType>("time");
  const [requestedStart, setRequestedStart] = useState("");
  const [requestedEnd, setRequestedEnd] = useState("");
  const [requestedLocation, setRequestedLocation] = useState<WorkLocation>("office");
  const [reason, setReason] = useState("");
  const [officeWarnings, setOfficeWarnings] = useState<OfficeWarning[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [currentSchedules, setCurrentSchedules] = useState<ScheduleRow[]>([]);
  const [schedulesLoaded, setSchedulesLoaded] = useState(false);

  useEffect(() => {
    const loadSchedules = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setSchedulesLoaded(true);
        return;
      }
      setUserId(user.id);
      const today = new Date().toISOString().split("T")[0];
      const { data } = await supabase
        .from("schedules")
        .select("id, day_of_week, start_time, end_time, is_rest_day, work_location")
        .eq("employee_id", user.id)
        .lte("effective_from", today)
        .or(`effective_until.is.null,effective_until.gte.${today}`)
        .order("day_of_week", { ascending: true });
      setCurrentSchedules(data ?? []);
      setSchedulesLoaded(true);
    };
    loadSchedules();
  }, []);

  const addDate = () => setDates([...dates, ""]);
  const removeDate = (idx: number) =>
    setDates(dates.filter((_, i) => i !== idx));
  const updateDate = (idx: number, value: string) =>
    setDates(dates.map((d, i) => (i === idx ? value : d)));

  const showTimeFields =
    !isPermanent && (adjustmentType === "time" || adjustmentType === "both");
  const showLocationField =
    !isPermanent && (adjustmentType === "location" || adjustmentType === "both");

  // Expand date range to individual weekday (Mon-Fri) date strings
  function getWeekdaysInRange(start: string, end: string): string[] {
    if (!start || !end) return [];
    const result: string[] = [];
    const [sy, sm, sd] = start.split("-").map(Number);
    const [ey, em, ed] = end.split("-").map(Number);
    const current = new Date(sy, sm - 1, sd);
    const endDate = new Date(ey, em - 1, ed);
    while (current <= endDate) {
      const dow = current.getDay();
      if (dow >= 1 && dow <= 5) {
        result.push(toLocalDateStr(current));
      }
      current.setDate(current.getDate() + 1);
    }
    return result;
  }

  // Get all valid dates based on the current mode
  const validDates = dateMode === "range"
    ? getWeekdaysInRange(rangeStart, rangeEnd)
    : dates.filter((d) => d);

  // The employee's working schedule for a given date's day-of-week (null on rest days)
  function getScheduleForDate(dateStr: string): ScheduleRow | null {
    const jsDay = new Date(dateStr + "T00:00:00").getDay();
    const dow = (jsDay + 6) % 7; // Mon=0
    const s = currentSchedules.find((r) => r.day_of_week === dow);
    return s && !s.is_rest_day ? s : null;
  }
  function getScheduledLocation(dateStr: string): string | null {
    return getScheduleForDate(dateStr)?.work_location ?? null;
  }
  // The day-location filter only makes sense across multiple days; for a single
  // day it's noise (and a stale selection could wrongly hide that day), so it's
  // ignored when there's just one valid date.
  const effectiveLocationFilter = validDates.length > 1 ? locationFilter : "all";
  const filteredDates = effectiveLocationFilter === "all"
    ? validDates
    : validDates.filter((d) => getScheduledLocation(d) === effectiveLocationFilter);

  // Original schedule summary for the day(s) this adjustment will apply to,
  // so the form can show "current → requested".
  const fmtHm = (t: string) => t.slice(0, 5);
  const origLocations = [...new Set(filteredDates.map(getScheduledLocation).filter((x): x is string => !!x))];
  const origTimes = [...new Set(
    filteredDates.map((d) => {
      const s = getScheduleForDate(d);
      return s ? `${fmtHm(s.start_time)} – ${fmtHm(s.end_time)}` : null;
    }).filter((x): x is string => !!x)
  )];
  const origLocationLabel = origLocations.length === 0 ? "—"
    : origLocations.length === 1 ? (origLocations[0] === "office" ? "Office" : "Online")
    : "Varies by day";
  const origTimeLabel = origTimes.length === 0 ? "—"
    : origTimes.length === 1 ? origTimes[0]
    : "Varies by day";

  // Helper: format Date to YYYY-MM-DD in local time (avoids UTC shift)
  function toLocalDateStr(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  // Helper: get Monday of the week for a YYYY-MM-DD string
  function getMondayOf(dateStr: string): string {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dateObj = new Date(y, m - 1, d);
    const day = dateObj.getDay(); // 0=Sun, 1=Mon, ...
    const mondayOffset = day === 0 ? -6 : 1 - day;
    dateObj.setDate(dateObj.getDate() + mondayOffset);
    return toLocalDateStr(dateObj);
  }

  // Helper: add days to a YYYY-MM-DD string
  function addDaysStr(dateStr: string, days: number): string {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dateObj = new Date(y, m - 1, d);
    dateObj.setDate(dateObj.getDate() + days);
    return toLocalDateStr(dateObj);
  }

  // Check office days whenever dates or location selection changes
  const checkOfficeDays = useCallback(async () => {
    // A time-only adjustment doesn't change work location, so it can never
    // reduce office presence — no warning applies.
    if (isPermanent || filteredDates.length === 0 || adjustmentType === "time") {
      setOfficeWarnings([]);
      return;
    }

    // The location this adjustment would set (null = time-only, no location change)
    const effectiveLocation = showLocationField ? requestedLocation : null;

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Get user's role
    const { data: userData } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    const role = userData?.role ?? "employee";
    const isManager = ["manager", "hr_admin", "super_admin"].includes(role);
    const threshold = isManager ? 3 : 2;

    // Get base schedules
    const today = toLocalDateStr(new Date());
    const { data: schedules } = await supabase
      .from("schedules")
      .select("day_of_week, work_location, is_rest_day")
      .eq("employee_id", user.id)
      .lte("effective_from", today)
      .or(`effective_until.is.null,effective_until.gte.${today}`);

    const scheduleByDay = new Map<number, string | null>();
    for (const s of schedules ?? []) {
      scheduleByDay.set(s.day_of_week, s.is_rest_day ? null : s.work_location);
    }

    const warnings: OfficeWarning[] = [];

    // Group dates by week (Monday key) to handle multiple dates in the same week
    const datesByWeek = new Map<string, string[]>();
    for (const date of filteredDates) {
      const weekKey = getMondayOf(date);
      if (!datesByWeek.has(weekKey)) datesByWeek.set(weekKey, []);
      datesByWeek.get(weekKey)!.push(date);
    }

    for (const [weekMonday, weekDates] of datesByWeek) {
      const weekEndStr = addDaysStr(weekMonday, 4);

      // Fetch approved adjustments for this employee in this week. Oldest first
      // so the most recent approved adjustment wins per date.
      const { data: weekAdjs } = await supabase
        .from("schedule_adjustments")
        .select("requested_date, requested_work_location")
        .eq("employee_id", user.id)
        .eq("status", "approved")
        .gte("requested_date", weekMonday)
        .lte("requested_date", weekEndStr)
        .order("created_at", { ascending: true });

      const adjOverrides = new Map<string, string | null>();
      for (const a of weekAdjs ?? []) {
        adjOverrides.set(a.requested_date, a.requested_work_location);
      }

      // Simulate this pending adjustment for each date in the week
      for (const d of weekDates) {
        adjOverrides.set(d, effectiveLocation);
      }

      // Count office days Mon-Fri
      let officeDays = 0;
      for (let i = 0; i < 5; i++) {
        const dayStr = addDaysStr(weekMonday, i);

        const override = adjOverrides.get(dayStr);
        if (override !== undefined) {
          if (override === "office") officeDays++;
          else if (override === null) {
            // Time-only change — use base schedule location
            const baseLocation = scheduleByDay.get(i);
            if (baseLocation === "office") officeDays++;
          }
          // "online" → not office, don't count
        } else {
          // No adjustment — use base schedule
          const baseLocation = scheduleByDay.get(i);
          if (baseLocation === "office") officeDays++;
        }
      }

      if (officeDays < threshold) {
        warnings.push({
          date: weekDates.join(", "),
          officeDays,
          threshold,
        });
      }
    }

    setOfficeWarnings(warnings);
  }, [filteredDates.join(","), adjustmentType, requestedLocation, isPermanent, showLocationField]);

  useEffect(() => {
    const timer = setTimeout(checkOfficeDays, 300);
    return () => clearTimeout(timer);
  }, [checkOfficeDays]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPermanent) return; // weekly editor submits independently
    setLoading(true);
    setError("");

    if (filteredDates.length === 0) {
      setError(locationFilter !== "all"
        ? `No ${locationFilter} days found in your selected dates.`
        : dateMode === "range" ? "Please select a valid date range." : "Please select at least one date.");
      setLoading(false);
      return;
    }

    if (showTimeFields && (!requestedStart || !requestedEnd)) {
      setError("Please set start and end times.");
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("Not authenticated");
      setLoading(false);
      return;
    }

    const tooLong = showTimeFields ? shiftLengthError(requestedStart, requestedEnd) : null;
    if (tooLong) {
      setError(tooLong);
      setLoading(false);
      return;
    }

    for (const date of filteredDates) {
      const dateObj = new Date(date);
      const dayOfWeek = (dateObj.getDay() + 6) % 7;

      const { data: schedule } = await supabase
        .from("schedules")
        .select("start_time, end_time")
        .eq("employee_id", user.id)
        .eq("day_of_week", dayOfWeek)
        .lte("effective_from", date)
        .or(`effective_until.is.null,effective_until.gte.${date}`)
        .limit(1)
        .maybeSingle();

      const originalStart = schedule?.start_time ?? "09:00";
      const originalEnd = schedule?.end_time ?? "18:00";

      const { error: insertError } = await supabase
        .from("schedule_adjustments")
        .insert({
          employee_id: user.id,
          requested_date: date,
          adjustment_type: adjustmentType,
          original_start_time: originalStart,
          original_end_time: originalEnd,
          requested_start_time: showTimeFields ? requestedStart : originalStart,
          requested_end_time: showTimeFields ? requestedEnd : originalEnd,
          requested_work_location: showLocationField ? requestedLocation : null,
          reason,
        });

      if (insertError) {
        setError(insertError.message);
        setLoading(false);
        return;
      }
    }

    try {
      await fetch("/api/notifications/adjustment-submitted", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requested_date: filteredDates.join(", "),
          original_time: "Current schedule",
          requested_time: showTimeFields
            ? `${requestedStart} - ${requestedEnd}`
            : "No time change",
          requested_location: showLocationField ? requestedLocation : null,
          adjustment_type: adjustmentType,
          reason,
        }),
      });
    } catch {
      // Non-blocking
    }

    router.push("/requests");
    router.refresh();
  };

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
        <h1 className="font-display text-[26px] leading-tight text-gray-900">
          Request Schedule Adjustment
        </h1>
        <p className="text-gray-600">
          Request a change to your working hours or location.
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

        {/* Permanent or temporary */}
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="mb-3 text-sm font-medium text-gray-700">
            Is this a permanent change or just for specific dates?
          </p>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="duration_type"
                checked={!isPermanent}
                onChange={() => setIsPermanent(false)}
                className="h-4 w-4 text-blue-600"
              />
              <span className="text-sm text-gray-700">Specific dates</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="duration_type"
                checked={isPermanent}
                onChange={() => setIsPermanent(true)}
                className="h-4 w-4 text-blue-600"
              />
              <span className="text-sm text-gray-700">
                Permanently change my schedule
              </span>
            </label>
          </div>
        </div>

        {/* What are you changing? */}
        {!isPermanent && (
          <div className="rounded-lg border border-gray-200 p-4">
            <p className="mb-3 text-sm font-medium text-gray-700">
              What would you like to change?
            </p>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="adjustment_type"
                  checked={adjustmentType === "time"}
                  onChange={() => setAdjustmentType("time")}
                  className="h-4 w-4 text-blue-600"
                />
                <span className="text-sm text-gray-700">Time</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="adjustment_type"
                  checked={adjustmentType === "location"}
                  onChange={() => setAdjustmentType("location")}
                  className="h-4 w-4 text-blue-600"
                />
                <span className="text-sm text-gray-700">Working Location</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="adjustment_type"
                  checked={adjustmentType === "both"}
                  onChange={() => setAdjustmentType("both")}
                  className="h-4 w-4 text-blue-600"
                />
                <span className="text-sm text-gray-700">Both</span>
              </label>
            </div>
          </div>
        )}

        {/* Date selection (only for temporary) */}
        {!isPermanent && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Which date(s) do you need to adjust?
            </label>
            <div className="mb-3 flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="date_mode"
                  checked={dateMode === "individual"}
                  onChange={() => setDateMode("individual")}
                  className="h-4 w-4 text-blue-600"
                />
                <span className="text-sm text-gray-700">Pick specific dates</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="date_mode"
                  checked={dateMode === "range"}
                  onChange={() => setDateMode("range")}
                  className="h-4 w-4 text-blue-600"
                />
                <span className="text-sm text-gray-700">Date range</span>
              </label>
            </div>

            {dateMode === "individual" ? (
              <div className="space-y-2">
                {dates.map((date, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="date"
                      required
                      value={date}
                      onChange={(e) => updateDate(idx, e.target.value)}
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    {dates.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeDate(idx)}
                        className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
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
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600">From</label>
                    <input
                      type="date"
                      required
                      value={rangeStart}
                      onChange={(e) => setRangeStart(e.target.value)}
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600">To</label>
                    <input
                      type="date"
                      required
                      value={rangeEnd}
                      onChange={(e) => setRangeEnd(e.target.value)}
                      min={rangeStart}
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
                {validDates.length > 0 && (
                  <p className="text-xs text-gray-500">
                    {filteredDates.length} of {validDates.length} weekday{validDates.length !== 1 ? "s" : ""} selected
                    {effectiveLocationFilter !== "all" ? ` (${effectiveLocationFilter} days only)` : ""}
                  </p>
                )}
              </div>
            )}
          <OddDateWarning dates={dateMode === "individual" ? dates : [rangeStart, rangeEnd]} />
          {/* Day-location filter — only relevant when adjusting more than one day */}
          {schedulesLoaded && currentSchedules.length > 0 && validDates.length > 1 && (
            <div className="rounded-lg border border-gray-200 p-4">
              <p className="mb-3 text-sm font-medium text-gray-700">Apply adjustment to which days?</p>
              <div className="flex flex-wrap gap-4">
                {(["all", "online", "office"] as const).map((opt) => (
                  <label key={opt} className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="location_filter"
                      checked={locationFilter === opt}
                      onChange={() => setLocationFilter(opt)}
                      className="h-4 w-4 text-blue-600"
                    />
                    <span className="text-sm text-gray-700">
                      {opt === "all" ? "All days" : opt === "online" ? "Online days only" : "Office days only"}
                    </span>
                  </label>
                ))}
              </div>
              {locationFilter !== "all" && filteredDates.length === 0 && (
                <p className="mt-2 text-xs text-amber-600">No {locationFilter} days found in your selection.</p>
              )}
            </div>
          )}
          </div>
        )}

        {isPermanent && (
          <div className="space-y-4">
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
              <p className="text-sm text-amber-800">
                Edit each day below. Your changes will be submitted to an admin
                for approval and will apply to all future working days once
                approved.
              </p>
            </div>
            {!schedulesLoaded ? (
              <p className="text-sm text-gray-500">Loading your schedule…</p>
            ) : userId ? (
              <WeeklyScheduleEditor
                employeeId={userId}
                schedules={currentSchedules}
                canEdit
                submitMode="queue"
                defaultEditing
                onSubmitted={() => {
                  router.push("/requests");
                  router.refresh();
                }}
              />
            ) : (
              <p className="text-sm text-red-600">Not authenticated.</p>
            )}
          </div>
        )}

        {/* Current → requested summary, scoped to what's being adjusted */}
        {!isPermanent && filteredDates.length > 0 && (showTimeFields || showLocationField) && (
          <div className="space-y-1 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
            <p className="font-medium text-gray-700">
              Your current schedule{filteredDates.length === 1 ? ` on ${filteredDates[0]}` : " for the selected days"}:
            </p>
            {showTimeFields && (
              <p className="text-gray-600">
                Time: <span className="font-medium text-gray-900">{origTimeLabel}</span>
                {" → "}
                <span className="font-medium text-blue-700">
                  {requestedStart && requestedEnd ? `${requestedStart} – ${requestedEnd}` : "—"}
                </span>
              </p>
            )}
            {showLocationField && (
              <p className="text-gray-600">
                Location: <span className="font-medium text-gray-900">{origLocationLabel}</span>
                {" → "}
                <span className="font-medium text-blue-700">
                  {requestedLocation === "office" ? "Office" : "Online"}
                </span>
              </p>
            )}
          </div>
        )}

        {/* Time fields */}
        {showTimeFields && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  What time would you like to start?
                </label>
                <input
                  type="time"
                  required
                  value={requestedStart}
                  onChange={(e) => setRequestedStart(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  What time would you like to finish?
                </label>
                <input
                  type="time"
                  required
                  value={requestedEnd}
                  onChange={(e) => setRequestedEnd(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
            {hasNightDifferentialHours(requestedStart, requestedEnd) && (
              <NightDiffBanner />
            )}
          </div>
        )}

        {/* Location field */}
        {showLocationField && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Where would you like to work?
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="work_location"
                  checked={requestedLocation === "office"}
                  onChange={() => setRequestedLocation("office")}
                  className="h-4 w-4 text-blue-600"
                />
                <span className="text-sm text-gray-700">Office</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="work_location"
                  checked={requestedLocation === "online"}
                  onChange={() => setRequestedLocation("online")}
                  className="h-4 w-4 text-blue-600"
                />
                <span className="text-sm text-gray-700">Online</span>
              </label>
            </div>
          </div>
        )}

        {/* Office days warning */}
        {officeWarnings.length > 0 && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 space-y-2">
            {officeWarnings.map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-red-500 shrink-0" />
                <span className="text-sm text-red-700">
                  This would leave you with only {w.officeDays} office day{w.officeDays !== 1 ? "s" : ""} for the week of {w.date} (minimum {w.threshold} required)
                </span>
              </div>
            ))}
          </div>
        )}

        {!isPermanent && (
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Why do you need this adjustment?
            </label>
            <textarea
              required
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Please explain the reason for your schedule change..."
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        )}

        <div className="flex gap-3">
          {!isPermanent && (
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Submitting..." : "Submit Request"}
            </button>
          )}
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
