import { format, parseISO } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { MANILA_TIMEZONE } from "./constants";

export function formatDate(date: string | Date): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, "MMM d, yyyy");
}

export function formatTime(time: string | null | undefined): string {
  if (!time) return "—";
  const [hours, minutes] = time.split(":");
  const h = parseInt(hours);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${minutes} ${ampm}`;
}

export function toManilaTime(date: Date): Date {
  return toZonedTime(date, MANILA_TIMEZONE);
}

/**
 * One-line summary of what a schedule adjustment changes, respecting its type.
 *
 * A *location* adjustment should read as the location swap ("Office → Online"),
 * NOT a time range — the times on a location-only request are just the
 * unchanged schedule. There's no stored "original location", but with only two
 * locations the origin is simply the opposite of the requested one. A *time*
 * (or legacy untyped) adjustment shows the requested time range; *both* shows
 * the time range plus the location swap.
 */
export function formatAdjustmentChange(adj: {
  adjustment_type?: string | null;
  requested_start_time?: string | null;
  requested_end_time?: string | null;
  requested_work_location?: string | null;
}): string {
  const timeRange = `${formatTime(adj.requested_start_time)} – ${formatTime(
    adj.requested_end_time
  )}`;
  const loc = adj.requested_work_location;
  const locSwap = loc
    ? loc === "office"
      ? "Online → Office"
      : "Office → Online"
    : null;

  if (adj.adjustment_type === "location") {
    return locSwap ?? "Location change";
  }
  if (adj.adjustment_type === "both") {
    return locSwap ? `${timeRange} · ${locSwap}` : timeRange;
  }
  // "time" or legacy untyped rows: the time range is the change.
  return timeRange;
}

export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * Casual display name for a user — combines the preferred (or first) name with
 * the last name, e.g. "BB Batongbakal". Use anywhere a name is shown outside a
 * formal table or admin/audit context.
 *
 * Falls back to: preferred/first alone → full_name → email handle → "Unknown".
 */
export function displayName(
  user:
    | {
        preferred_name?: string | null;
        first_name?: string | null;
        last_name?: string | null;
        full_name?: string | null;
        email?: string | null;
      }
    | null
    | undefined
): string {
  if (!user) return "Unknown";
  const front = user.preferred_name || user.first_name;
  if (front && user.last_name) return `${front} ${user.last_name}`;
  return (
    front ||
    user.full_name ||
    user.email?.split("@")[0] ||
    "Unknown"
  );
}

export function hasRole(
  userRole: string,
  requiredRole: string
): boolean {
  // hr_support is a parallel role at employee level — they can view a
  // stripped-down version of any employee's profile (identity + references
  // only), but do NOT inherit manager/HR permissions on the normal hierarchy.
  const hierarchy: Record<string, number> = {
    employee: 0,
    hr_support: 0,
    manager: 1,
    hr_admin: 2,
    super_admin: 3,
  };
  return (hierarchy[userRole] ?? 0) >= (hierarchy[requiredRole] ?? 0);
}

/**
 * Returns true when a shift's working hours overlap the night-differential
 * window (22:00–06:00). Handles:
 *   - shifts that end at midnight (end="00:00" treated as 24:00)
 *   - overnight shifts that wrap past midnight (end <= start)
 *   - non-wrapping shifts where either end > 22:00 or start < 06:00
 * Accepts "HH:MM" or "HH:MM:SS" strings.
 */
export function hasNightDifferentialHours(
  startTime: string | null | undefined,
  endTime: string | null | undefined
): boolean {
  if (!startTime || !endTime) return false;
  const start = startTime.slice(0, 5);
  // Treat midnight-end as end of day so it sorts after 22:00.
  const end = endTime.slice(0, 5) === "00:00" ? "24:00" : endTime.slice(0, 5);
  if (end <= start) return true; // wraps past midnight
  return end > "22:00" || start < "06:00";
}

/**
 * Number of hours of a shift that fall inside the night-differential window
 * (22:00–06:00) — i.e. how many ND hours payroll should pay for this span.
 * Companion to `hasNightDifferentialHours` (which is the boolean "does it
 * touch ND"; this returns the quantity). Handles overnight shifts (end <=
 * start wraps past midnight) and midnight-end. Accepts "HH:MM" or "HH:MM:SS".
 * Returns 0 when a time is missing/unparseable or there's no overlap.
 */
export function nightDifferentialHours(
  startTime: string | null | undefined,
  endTime: string | null | undefined
): number {
  if (!startTime || !endTime) return 0;
  const toMin = (t: string) => {
    const [h, m] = t.slice(0, 5).split(":").map(Number);
    return Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m;
  };
  const s = toMin(startTime);
  let e = toMin(endTime);
  if (s === null || e === null) return 0;
  if (e === s) return 0; // zero-length / placeholder (e.g. 00:00–00:00 rest day)
  if (e < s) e += 24 * 60; // wraps past midnight

  // ND windows laid out on a two-day minute timeline so a shift starting in
  // [00:00,24:00) and ending up to +24h is fully covered:
  //   00:00–06:00 (day 0), 22:00–06:00 (day 0→1), 22:00–24:00 (day 1).
  const windows: [number, number][] = [
    [0, 360],
    [1320, 1800],
    [2760, 3240],
  ];
  let mins = 0;
  for (const [ws, we] of windows) {
    mins += Math.max(0, Math.min(e, we) - Math.max(s, ws));
  }
  return Math.round((mins / 60) * 100) / 100;
}

/**
 * Compensation policy for a holiday-work request, given the requester's
 * profile.
 *
 *   - PH employee  →  choice between holiday pay and CTO.
 *   - Everyone else (non-PH or consultant)  →  CTO is the only option and
 *     the form should not even offer the radio.
 *
 * Tenure is deliberately NOT a condition: holiday pay is available from day
 * one. (A ≥ 1 yr requirement was dropped on 2026-10-02.)
 */
export type HolidayWorkPolicy =
  | { kind: "forced_cto"; reason: "non_ph" | "consultant" }
  | { kind: "choice" };

export function getHolidayWorkPolicy(args: {
  holiday_country: string | null | undefined;
  employment_type: string | null | undefined;
}): HolidayWorkPolicy {
  if (args.holiday_country !== "PH") return { kind: "forced_cto", reason: "non_ph" };
  if (args.employment_type !== "employee")
    return { kind: "forced_cto", reason: "consultant" };

  return { kind: "choice" };
}
