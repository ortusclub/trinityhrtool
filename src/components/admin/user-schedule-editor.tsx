"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { DAYS_OF_WEEK } from "@/lib/constants";
import { shiftLengthError } from "@/lib/shift-length";

interface ScheduleRow {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_rest_day: boolean;
  work_location: string;
  effective_from: string;
}

export function UserScheduleEditor({
  userId,
  schedules,
}: {
  userId: string;
  schedules: ScheduleRow[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  // Build editable state indexed by day_of_week
  const initialState: Record<
    number,
    { id: string; start_time: string; end_time: string; is_rest_day: boolean; work_location: string }
  > = {};

  for (let d = 0; d < 7; d++) {
    const existing = schedules.find((s) => s.day_of_week === d);
    initialState[d] = existing
      ? {
          id: existing.id,
          start_time: existing.start_time.slice(0, 5),
          end_time: existing.end_time.slice(0, 5),
          is_rest_day: existing.is_rest_day,
          work_location: existing.work_location,
        }
      : {
          id: "",
          start_time: "09:00",
          end_time: "18:00",
          is_rest_day: d >= 5,
          work_location: "office",
        };
  }

  const [days, setDays] = useState(initialState);

  const updateDay = (
    dayIdx: number,
    field: string,
    value: string | boolean
  ) => {
    setDays((prev) => ({
      ...prev,
      [dayIdx]: { ...prev[dayIdx], [field]: value },
    }));
  };

  const handleSave = async () => {
    for (let d = 0; d < 7; d++) {
      const tooLong = days[d].is_rest_day ? null : shiftLengthError(days[d].start_time, days[d].end_time);
      if (tooLong) {
        setMessage(`${DAYS_OF_WEEK[d] ?? "Day " + d}: ${tooLong}`);
        return;
      }
    }
    setSaving(true);
    setMessage("");
    const supabase = createClient();
    const today = new Date().toISOString().split("T")[0];

    let errors = 0;

    for (let d = 0; d < 7; d++) {
      const day = days[d];
      const payload = {
        employee_id: userId,
        day_of_week: d,
        start_time: day.start_time,
        end_time: day.end_time,
        is_rest_day: day.is_rest_day,
        work_location: day.work_location,
        effective_from: today,
      };

      if (day.id) {
        // Update existing
        const { error } = await supabase
          .from("schedules")
          .update(payload)
          .eq("id", day.id);
        if (error) {
          console.error(`Day ${d} update error:`, error.message);
          errors++;
        }
      } else {
        // Insert new
        const { error } = await supabase.from("schedules").insert(payload);
        if (error) {
          console.error(`Day ${d} insert error:`, error.message);
          errors++;
        }
      }
    }

    if (errors > 0) {
      setMessage(`Saved with ${errors} error(s). Check console for details.`);
    } else {
      setMessage("Schedule saved successfully.");
    }
    setSaving(false);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left">
              <th className="px-4 py-3 font-medium text-gray-600 w-32">Day</th>
              <th className="px-4 py-3 font-medium text-gray-600 w-28">Working Location</th>
              <th className="px-4 py-3 font-medium text-gray-600 w-32">Start</th>
              <th className="px-4 py-3 font-medium text-gray-600 w-32">End</th>
              <th className="px-4 py-3 font-medium text-gray-600 w-24">Rest Day</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {DAYS_OF_WEEK.map((dayName, idx) => {
              const day = days[idx];
              return (
                <tr
                  key={idx}
                  className={day.is_rest_day ? "bg-gray-50" : "hover:bg-gray-50"}
                >
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {dayName}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={day.work_location}
                      onChange={(e) =>
                        updateDay(idx, "work_location", e.target.value)
                      }
                      disabled={day.is_rest_day}
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100 disabled:text-gray-400"
                    >
                      <option value="office">Office</option>
                      <option value="online">Online</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="time"
                      value={day.start_time}
                      onChange={(e) =>
                        updateDay(idx, "start_time", e.target.value)
                      }
                      disabled={day.is_rest_day}
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100 disabled:text-gray-400"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="time"
                      value={day.end_time}
                      onChange={(e) =>
                        updateDay(idx, "end_time", e.target.value)
                      }
                      disabled={day.is_rest_day}
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100 disabled:text-gray-400"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={day.is_rest_day}
                      onChange={(e) =>
                        updateDay(idx, "is_rest_day", e.target.checked)
                      }
                      className="h-4 w-4 rounded border-gray-300 text-blue-600"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        <Save size={16} />
        {saving ? "Saving..." : "Save Changes"}
      </button>
    </div>
  );
}
