import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { shiftLengthError } from "@/lib/shift-length";

export const maxDuration = 60;

interface ParsedRow {
  email: string;
  requestedDate: string;
  requestedStartTime: string;
  requestedEndTime: string;
  requestedLocation: "office" | "online" | null;
  reason: string;
}

function parseCSV(csvText: string): ParsedRow[] {
  const lines = csvText.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const col = (names: string[]) => {
    for (const n of names) {
      const idx = header.indexOf(n);
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const emailIdx = col(["email"]);
  const dateIdx = col(["date", "requested_date", "requested date"]);
  const startIdx = col(["start time", "start_time", "new start"]);
  const endIdx = col(["end time", "end_time", "new end"]);
  const locationIdx = col(["location", "work_location", "work location"]);
  const reasonIdx = col(["reason", "notes"]);

  if (emailIdx === -1 || dateIdx === -1 || startIdx === -1 || endIdx === -1) return [];

  const rows: ParsedRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const ch of lines[i]) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === "," && !inQuotes) { parts.push(current.trim()); current = ""; continue; }
      current += ch;
    }
    parts.push(current.trim());

    const email = parts[emailIdx] || "";
    if (!email || email.toUpperCase().startsWith("OPTIONS")) continue;

    const rawLocation = locationIdx >= 0 ? (parts[locationIdx] || "").toLowerCase() : "";
    let location: "office" | "online" | null = null;
    if (rawLocation === "office") location = "office";
    else if (rawLocation === "online") location = "online";

    rows.push({
      email,
      requestedDate: parts[dateIdx] || "",
      requestedStartTime: parts[startIdx] || "",
      requestedEndTime: parts[endIdx] || "",
      requestedLocation: location,
      reason: reasonIdx >= 0 ? (parts[reasonIdx] || "Bulk import") : "Bulk import",
    });
  }

  return rows;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();

  if (!authUser) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: currentUser } = await supabase
    .from("users")
    .select("role")
    .eq("id", authUser.id)
    .single();

  if (!currentUser || !["hr_admin", "super_admin"].includes(currentUser.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const autoApprove = formData.get("auto_approve") === "true";

  if (!file) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  const csvText = await file.text();
  const rows = parseCSV(csvText);

  if (rows.length === 0) {
    return Response.json(
      { error: "No valid rows found. Ensure CSV has Email, Date, Start Time, and End Time columns." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const results = {
    created: 0,
    skipped: 0,
    duplicates_skipped: 0,
    errors: [] as string[],
  };

  try {
    // Batch lookup all emails
    const allEmails = [...new Set(rows.map((r) => r.email))];
    const { data: users } = await admin
      .from("users")
      .select("id, email")
      .in("email", allEmails);

    const emailToId = new Map<string, string>();
    for (const u of users ?? []) {
      emailToId.set(u.email, u.id);
    }

    // Fetch schedules for original times
    const employeeIds = [...new Set([...emailToId.values()])];
    const { data: schedules } = await admin
      .from("schedules")
      .select("employee_id, day_of_week, start_time, end_time")
      .in("employee_id", employeeIds);

    // Build schedule map: employee_id:day_of_week -> { start, end }
    const schedMap = new Map<string, { start: string; end: string }>();
    for (const s of schedules ?? []) {
      schedMap.set(`${s.employee_id}:${s.day_of_week}`, { start: s.start_time, end: s.end_time });
    }

    const inserts: Record<string, unknown>[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;

      const userId = emailToId.get(row.email);
      if (!userId) {
        results.errors.push(`Row ${rowNum}: ${row.email} not found`);
        results.skipped++;
        continue;
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.requestedDate)) {
        results.errors.push(`Row ${rowNum}: invalid date "${row.requestedDate}" (use YYYY-MM-DD)`);
        results.skipped++;
        continue;
      }

      if (!/^\d{1,2}:\d{2}$/.test(row.requestedStartTime) || !/^\d{1,2}:\d{2}$/.test(row.requestedEndTime)) {
        results.errors.push(`Row ${rowNum}: invalid time format (use HH:MM)`);
        results.skipped++;
        continue;
      }

      const tooLong = shiftLengthError(row.requestedStartTime, row.requestedEndTime);
      if (tooLong) {
        results.errors.push(`Row ${rowNum}: ${tooLong}`);
        results.skipped++;
        continue;
      }

      // Get original schedule for the requested date
      const dateObj = new Date(row.requestedDate + "T00:00:00");
      const dayOfWeek = (dateObj.getDay() + 6) % 7;
      const origSched = schedMap.get(`${userId}:${dayOfWeek}`);

      // Determine adjustment type
      const hasTimeChange = origSched
        ? (row.requestedStartTime !== origSched.start.slice(0, 5) || row.requestedEndTime !== origSched.end.slice(0, 5))
        : true;
      const hasLocationChange = row.requestedLocation !== null;
      const adjustmentType = hasTimeChange && hasLocationChange ? "both"
        : hasLocationChange ? "location" : "time";

      inserts.push({
        employee_id: userId,
        requested_date: row.requestedDate,
        adjustment_type: adjustmentType,
        original_start_time: origSched?.start ?? "09:00",
        original_end_time: origSched?.end ?? "18:00",
        requested_start_time: row.requestedStartTime,
        requested_end_time: row.requestedEndTime,
        requested_work_location: row.requestedLocation,
        reason: row.reason,
        status: autoApprove ? "approved" : "pending",
        reviewed_by: autoApprove ? authUser.id : null,
        reviewed_at: autoApprove ? new Date().toISOString() : null,
      });
    }

    // Skip duplicates: rows that already exist for the same
    // (employee_id, requested_date, requested_start_time, requested_end_time)
    // — including duplicates within this CSV upload itself.
    const candidateEmployeeIds = [
      ...new Set(inserts.map((r) => r.employee_id as string)),
    ];
    const { data: existingAdjustments } = await admin
      .from("schedule_adjustments")
      .select(
        "employee_id, requested_date, requested_start_time, requested_end_time"
      )
      .in("employee_id", candidateEmployeeIds);

    const normalizeTime = (t: string | null | undefined) =>
      (t ?? "").slice(0, 5);
    const seenKeys = new Set(
      (existingAdjustments ?? []).map(
        (r) =>
          `${r.employee_id}|${r.requested_date}|${normalizeTime(r.requested_start_time)}|${normalizeTime(r.requested_end_time)}`
      )
    );

    const dedupedInserts: Record<string, unknown>[] = [];
    for (const ins of inserts) {
      const key = `${ins.employee_id}|${ins.requested_date}|${normalizeTime(ins.requested_start_time as string)}|${normalizeTime(ins.requested_end_time as string)}`;
      if (seenKeys.has(key)) {
        results.duplicates_skipped++;
        continue;
      }
      seenKeys.add(key);
      dedupedInserts.push(ins);
    }

    for (let i = 0; i < dedupedInserts.length; i += 50) {
      const batch = dedupedInserts.slice(i, i + 50);
      const { error } = await admin.from("schedule_adjustments").insert(batch);
      if (error) {
        results.errors.push(`Insert error: ${error.message}`);
      } else {
        results.created += batch.length;
      }
    }
  } catch (err) {
    results.errors.push(`Fatal error: ${err instanceof Error ? err.message : "unknown"}`);
  }

  return Response.json(results);
}
