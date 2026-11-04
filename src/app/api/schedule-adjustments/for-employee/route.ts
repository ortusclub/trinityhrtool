import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasRole } from "@/lib/utils";
import { shiftLengthError } from "@/lib/shift-length";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: caller } = await supabase
    .from("users")
    .select("role")
    .eq("id", authUser.id)
    .single();
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const {
    employee_id,
    requested_date,
    adjustment_type,
    requested_start_time,
    requested_end_time,
    requested_work_location,
    reason,
    queue,
  } = body;

  if (!employee_id || !requested_date || !adjustment_type) {
    return NextResponse.json(
      { error: "employee_id, requested_date, and adjustment_type are required" },
      { status: 400 }
    );
  }

  if (adjustment_type === "time" || adjustment_type === "both") {
    const tooLong = shiftLengthError(requested_start_time, requested_end_time);
    if (tooLong) return NextResponse.json({ error: tooLong }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("users")
    .select("id, manager_id")
    .eq("id", employee_id)
    .single();
  if (!target) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  const isAdmin = hasRole(caller.role, "hr_admin");
  const isSelf = authUser.id === employee_id;
  const isDirectManager = target.manager_id === authUser.id;
  if (!isAdmin && !isSelf && !isDirectManager) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Look up the original schedule for that day-of-week (best-effort)
  const dow = new Date(requested_date + "T00:00:00").getDay();
  const today = new Date().toISOString().slice(0, 10);
  const { data: schedule } = await admin
    .from("schedules")
    .select("start_time, end_time, work_location")
    .eq("employee_id", employee_id)
    .eq("day_of_week", dow)
    .lte("effective_from", today)
    .or(`effective_until.is.null,effective_until.gte.${today}`)
    .maybeSingle();

  const showTime = adjustment_type === "time" || adjustment_type === "both";
  const showLoc = adjustment_type === "location" || adjustment_type === "both";

  const baseRow = {
    employee_id,
    requested_date,
    adjustment_type,
    original_start_time: schedule?.start_time ?? "00:00",
    original_end_time: schedule?.end_time ?? "00:00",
    requested_start_time: showTime ? requested_start_time : schedule?.start_time ?? "00:00",
    requested_end_time: showTime ? requested_end_time : schedule?.end_time ?? "00:00",
    requested_work_location: showLoc ? requested_work_location : null,
    reason: reason ?? "",
  };
  const row = isAdmin && !queue
    ? {
        ...baseRow,
        status: "approved",
        reviewed_by: authUser.id,
        reviewed_at: new Date().toISOString(),
      }
    : baseRow;

  const { error } = await admin.from("schedule_adjustments").insert(row);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, queued: !isAdmin });
}
