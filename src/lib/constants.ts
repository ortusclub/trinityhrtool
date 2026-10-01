import type { UserRole } from "@/types/database";

export const ROLE_HIERARCHY: Record<UserRole, number> = {
  employee: 0,
  hr_support: 0,
  manager: 1,
  hr_admin: 2,
  super_admin: 3,
};

export const DAYS_OF_WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export const DEFAULT_TOLERANCE_MINUTES = 15;

export const LEAVE_TYPES = {
  anniversary: { label: "Anniversary Leave", universal: true },
  annual: { label: "Annual Leave", universal: true },
  birthday: { label: "Birthday Leave", universal: true },
  cto: { label: "CTO Leave", universal: true },
  trinity: { label: "Trinity Leave", universal: true },
  maternity_paternity: { label: "Maternity/Paternity Leave", universal: false },
  solo_parent: { label: "Solo Parent Leave", universal: false },
  bereavement: { label: "Bereavement Leave", universal: false },
} as const;

export const UNIVERSAL_LEAVE_TYPES = Object.entries(LEAVE_TYPES)
  .filter(([, v]) => v.universal)
  .map(([k]) => k);

export const ACTIVATABLE_LEAVE_TYPES = Object.entries(LEAVE_TYPES)
  .filter(([, v]) => !v.universal)
  .map(([k]) => k);

export const LEAVE_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(LEAVE_TYPES).map(([k, v]) => [k, v.label])
);

export const MANILA_TIMEZONE = "Asia/Manila";

// Single source of truth for selectable work timezones + their display labels.
export const TIMEZONE_OPTIONS: { value: string; label: string; abbrev: string }[] = [
  { value: "Asia/Manila", label: "PHT (Manila)", abbrev: "PHT" },
  { value: "Europe/Berlin", label: "CET (Berlin)", abbrev: "CET" },
  { value: "Asia/Dubai", label: "GST (Dubai)", abbrev: "GST" },
  { value: "Asia/Seoul", label: "KST (Seoul)", abbrev: "KST" },
  { value: "America/New_York", label: "ET (New York)", abbrev: "ET" },
  { value: "America/Chicago", label: "CT (Chicago)", abbrev: "CT" },
  { value: "America/Denver", label: "MT (Denver)", abbrev: "MT" },
  { value: "America/Phoenix", label: "MST (Phoenix)", abbrev: "MST" },
  { value: "America/Los_Angeles", label: "PT (Los Angeles)", abbrev: "PT" },
  { value: "America/Anchorage", label: "AKT (Anchorage)", abbrev: "AKT" },
  { value: "Pacific/Honolulu", label: "HST (Honolulu)", abbrev: "HST" },
];

export const getTzLabel = (tz: string | null | undefined): string =>
  TIMEZONE_OPTIONS.find((t) => t.value === tz)?.label ?? tz ?? "—";

export const getTzAbbrev = (tz: string | null | undefined): string =>
  TIMEZONE_OPTIONS.find((t) => t.value === tz)?.abbrev ?? tz ?? "—";

export const KPI_UNIT_TYPES = {
  percentage: { label: "Percentage", suffix: "%" },
  currency: { label: "Currency", suffix: "" },
  count: { label: "Count", suffix: "" },
  score: { label: "Score", suffix: "" },
  hours: { label: "Hours", suffix: "hrs" },
  custom: { label: "Custom", suffix: "" },
} as const;

export const KPI_PERIOD_TYPES = {
  monthly: { label: "Monthly" },
  quarterly: { label: "Quarterly" },
  yearly: { label: "Yearly" },
} as const;

export const KPI_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  completed: "Completed",
  archived: "Archived",
};
