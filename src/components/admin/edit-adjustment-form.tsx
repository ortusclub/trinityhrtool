"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Pencil, Save, X } from "lucide-react";
import type { ScheduleAdjustmentType, WorkLocation } from "@/types/database";
import { shiftLengthError } from "@/lib/shift-length";

interface Props {
  id: string;
  requestedDate: string;
  adjustmentType: ScheduleAdjustmentType;
  requestedStartTime: string;
  requestedEndTime: string;
  requestedWorkLocation: WorkLocation | null;
  reason: string;
}

const inputClass = "w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

export function EditAdjustmentForm(props: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    requested_date: props.requestedDate,
    adjustment_type: props.adjustmentType,
    requested_start_time: props.requestedStartTime,
    requested_end_time: props.requestedEndTime,
    requested_work_location: props.requestedWorkLocation ?? "office",
    reason: props.reason,
  });

  const showTime = form.adjustment_type === "time" || form.adjustment_type === "both";
  const showLoc = form.adjustment_type === "location" || form.adjustment_type === "both";

  const save = async () => {
    const tooLong = showTime ? shiftLengthError(form.requested_start_time, form.requested_end_time) : null;
    if (tooLong) { setError(tooLong); return; }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase.from("schedule_adjustments").update({
      requested_date: form.requested_date,
      adjustment_type: form.adjustment_type,
      requested_start_time: showTime ? form.requested_start_time : null,
      requested_end_time: showTime ? form.requested_end_time : null,
      requested_work_location: showLoc ? form.requested_work_location : null,
      reason: form.reason,
    }).eq("id", props.id);
    setBusy(false);
    if (err) { setError(err.message); return; }
    setOpen(false);
    router.refresh();
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
        <Pencil size={12} /> Edit
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-blue-200 bg-blue-50/30 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-700">Edit request</p>
        <button onClick={() => setOpen(false)} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X size={13} /></button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Date</label>
          <input type="date" value={form.requested_date} onChange={e => setForm(f => ({ ...f, requested_date: e.target.value }))} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Type</label>
          <select value={form.adjustment_type} onChange={e => setForm(f => ({ ...f, adjustment_type: e.target.value as ScheduleAdjustmentType }))} className={inputClass}>
            <option value="time">Time</option>
            <option value="location">Location</option>
            <option value="both">Both</option>
          </select>
        </div>
        {showTime && (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Start time</label>
              <input type="time" value={form.requested_start_time} onChange={e => setForm(f => ({ ...f, requested_start_time: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">End time</label>
              <input type="time" value={form.requested_end_time} onChange={e => setForm(f => ({ ...f, requested_end_time: e.target.value }))} className={inputClass} />
            </div>
          </>
        )}
        {showLoc && (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Location</label>
            <select value={form.requested_work_location} onChange={e => setForm(f => ({ ...f, requested_work_location: e.target.value as WorkLocation }))} className={inputClass}>
              <option value="office">Office</option>
              <option value="online">Online</option>
            </select>
          </div>
        )}
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-gray-600">Reason</label>
          <textarea rows={2} value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} className={inputClass} />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={save} disabled={busy} className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          <Save size={12} />{busy ? "Saving…" : "Save"}
        </button>
        <button onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
      </div>
    </div>
  );
}
