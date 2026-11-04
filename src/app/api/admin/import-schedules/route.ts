import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { shiftLengthError } from "@/lib/shift-length";

export const maxDuration = 60;

function parseScheduleCell(cell: string): { location: string; start: string; end: string } | "rest" | null {
  if (!cell || !cell.trim()) return null;
  if (cell.trim().toLowerCase() === "rest") return "rest";
  const match = cell.trim().match(/^(Online|Office)\s*-\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/i);
  if (!match) return null;
  return { location: match[1].toLowerCase(), start: match[2], end: match[3] };
}

interface ParsedRow {
  email: string;
  days: ({ location: string; start: string; end: string } | "rest" | null)[];
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
  if (emailIdx === -1) return [];

  const mIdx = col(["m", "monday"]);
  const tIdx = col(["t", "tuesday"]);
  const wIdx = col(["w", "wednesday"]);
  const thIdx = col(["th", "thursday"]);
  const fIdx = col(["f", "friday"]);

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
    if (!email) continue;

    const days = [mIdx, tIdx, wIdx, thIdx, fIdx].map(
      (idx) => idx >= 0 ? parseScheduleCell(parts[idx] || "") : null
    );

    const hasAny = days.some((d) => d !== null);
    if (!hasAny) continue;

    rows.push({ email, days });
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
  const effectiveFrom = (formData.get("effective_from") as string) || new Date().toISOString().split("T")[0];

  if (!file) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  const csvText = await file.text();
  const rows = parseCSV(csvText);

  if (rows.length === 0) {
    return Response.json(
      { error: "No valid rows found. Ensure CSV has Email and at least one schedule column (M, T, W, TH, F)." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const results = {
    updated: 0,
    skipped: 0,
    errors: [] as string[],
  };

  try {
    // Batch lookup all emails
    const allEmails = rows.map((r) => r.email);
    const { data: users } = await admin
      .from("users")
      .select("id, email")
      .in("email", allEmails);

    const emailToId = new Map<string, string>();
    for (const u of users ?? []) {
      emailToId.set(u.email, u.id);
    }

    // Build schedule rows and collect user IDs to clear
    const userIds: string[] = [];
    const scheduleInserts: {
      employee_id: string;
      day_of_week: number;
      start_time: string;
      end_time: string;
      is_rest_day: boolean;
      work_location: string;
      effective_from: string;
    }[] = [];

    for (const row of rows) {
      const userId = emailToId.get(row.email);
      if (!userId) {
        results.errors.push(`${row.email}: user not found, skipped`);
        results.skipped++;
        continue;
      }

      const tooLong = row.days
        .map((d) => (d && d !== "rest" ? shiftLengthError(d.start, d.end) : null))
        .find(Boolean);
      if (tooLong) {
        results.errors.push(`${row.email}: ${tooLong} Skipped.`);
        results.skipped++;
        continue;
      }

      userIds.push(userId);

      for (let dayIdx = 0; dayIdx < 5; dayIdx++) {
        const day = row.days[dayIdx];
        const isRest = day === "rest";
        const hasTime = day !== null && day !== "rest";
        scheduleInserts.push({
          employee_id: userId,
          day_of_week: dayIdx,
          start_time: hasTime ? day.start : "00:00",
          end_time: hasTime ? day.end : "00:00",
          is_rest_day: isRest,
          work_location: hasTime ? day.location : "office",
          effective_from: effectiveFrom,
        });
      }

      for (const dayIdx of [5, 6]) {
        scheduleInserts.push({
          employee_id: userId,
          day_of_week: dayIdx,
          start_time: "00:00",
          end_time: "00:00",
          is_rest_day: true,
          work_location: "office",
          effective_from: effectiveFrom,
        });
      }

      results.updated++;
    }

    // Batch delete existing schedules
    if (userIds.length > 0) {
      await admin.from("schedules").delete().in("employee_id", userIds);
    }

    // Batch insert new schedules (100 at a time)
    for (let i = 0; i < scheduleInserts.length; i += 100) {
      const batch = scheduleInserts.slice(i, i + 100);
      const { error } = await admin.from("schedules").insert(batch);
      if (error) {
        results.errors.push(`Schedule insert error: ${error.message}`);
      }
    }
  } catch (err) {
    results.errors.push(`Fatal error: ${err instanceof Error ? err.message : "unknown"}`);
  }

  return Response.json(results);
}
