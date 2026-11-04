/**
 * A shift longer than this is refused wherever a schedule or schedule
 * adjustment is entered. It catches the common slip of typing 12:00 (noon)
 * for midnight — "3 PM to 12 PM" reads as a 21-hour overnight shift, which
 * then counts 8 night-differential hours a day instead of 2.
 */
export const MAX_SHIFT_HOURS = 16;

/** Hours from start to end, overnight when end is not after start. */
export function shiftHours(start?: string | null, end?: string | null): number | null {
  const m = (t?: string | null) => {
    const x = /^(\d{1,2}):(\d{2})/.exec(String(t ?? ""));
    return x ? +x[1] * 60 + +x[2] : null;
  };
  const a = m(start), b = m(end);
  if (a === null || b === null) return null;
  let mins = b - a;
  if (mins <= 0) mins += 24 * 60;
  return mins / 60;
}

/** An error message when start → end is longer than MAX_SHIFT_HOURS, else null.
 *  00:00 → 00:00 (a rest-day placeholder) is never flagged. */
export function shiftLengthError(start?: string | null, end?: string | null): string | null {
  const s = String(start ?? "").slice(0, 5), e = String(end ?? "").slice(0, 5);
  if (!s || !e || (s === "00:00" && e === "00:00") || (/^0?0:00$/.test(s) && /^0?0:00$/.test(e))) return null;
  const h = shiftHours(s, e);
  if (h === null || h <= MAX_SHIFT_HOURS) return null;
  const hint = /^12:/.test(e) ? " If it ends at midnight, use 00:00 (12:00 AM), not 12:00." : "";
  return `${s}–${e} is a ${Math.round(h * 10) / 10}-hour shift, longer than ${MAX_SHIFT_HOURS} hours.${hint}`;
}
