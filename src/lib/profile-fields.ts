import {
  COMPANY_OPTIONS,
  HOLIDAY_COUNTRY_LABELS,
  type HolidayCountry,
  type ProfileFieldVisibility,
  type User,
} from "@/types/database";

const ROLE_LABELS: Record<string, string> = {
  employee: "Employee",
  manager: "Manager",
  hr_support: "HR Support",
  hr_admin: "HR Admin",
  super_admin: "Super Admin",
};

/**
 * Resolves a built-in profile field key (e.g. "birthday", "manager_id") to
 * a display value pulled from the user record + optional manager context.
 */
export function builtInFieldValue(
  key: string,
  user: User,
  managerName?: string | null
): string | null {
  switch (key) {
    case "full_name":
      return user.full_name || null;
    case "preferred_name":
      return user.preferred_name;
    case "first_name":
      return user.first_name;
    case "middle_name":
      return user.middle_name;
    case "last_name":
      return user.last_name;
    case "email":
      return user.email;
    case "role":
      return ROLE_LABELS[user.role] ?? user.role;
    case "company":
      return user.company;
    case "department":
      return user.department;
    case "job_title":
      return user.job_title;
    case "manager_id":
      return managerName ?? null;
    case "hire_date":
      return user.hire_date;
    case "regularization_date":
      return user.regularization_date;
    case "end_date":
      return user.end_date;
    case "is_active":
      return user.is_active ? "Active" : "Inactive";
    case "overtime_eligible":
      return user.overtime_eligible ? "Yes" : "No";
    case "birthday":
      return user.birthday;
    case "holiday_country":
      return (
        HOLIDAY_COUNTRY_LABELS[user.holiday_country as HolidayCountry] ??
        user.holiday_country
      );
    case "timezone":
      return user.timezone;
    default:
      return null;
  }
}

/**
 * Map of built-in field keys → user-table column + how to parse the raw CSV
 * value. Used by the bulk importer. `null` parsed values mean "skip / invalid".
 */
type ParsedValue = { ok: true; value: unknown } | { ok: false; error: string };
type BuiltInImportSpec = {
  column: string;
  parse: (raw: string) => ParsedValue;
};

const COUNTRY_VALUES = new Set(["PH", "XK", "IT", "AE", "US", "KR"]);
const COMPANY_VALUES = new Set<string>(COMPANY_OPTIONS);
// Accept a few short aliases in CSVs so HR doesn't have to type the legal
// suffix every time. Map normalised (lowercased, trimmed) input → canonical.
const COMPANY_ALIASES: Record<string, string> = {
  "ortus": "Ortus Strategy Pte. Ltd.",
  "ortus strategy": "Ortus Strategy Pte. Ltd.",
  "ortus strategy pte. ltd.": "Ortus Strategy Pte. Ltd.",
  "ortus strategy pte ltd": "Ortus Strategy Pte. Ltd.",
  "m-club": "m-Club Coaching LTD.",
  "mclub": "m-Club Coaching LTD.",
  "m-club coaching": "m-Club Coaching LTD.",
  "m-club coaching ltd.": "m-Club Coaching LTD.",
  "m-club coaching ltd": "m-Club Coaching LTD.",
  "trinity": "Trinity Outsourcing Solutions Inc.",
  "trinity outsourcing": "Trinity Outsourcing Solutions Inc.",
  "trinity outsourcing solutions": "Trinity Outsourcing Solutions Inc.",
  "trinity outsourcing solutions inc.": "Trinity Outsourcing Solutions Inc.",
  "trinity outsourcing solutions inc": "Trinity Outsourcing Solutions Inc.",
  "apex": "APEX Strategy",
  "apex strategy": "APEX Strategy",
};

const text = (raw: string): ParsedValue => ({
  ok: true,
  value: raw.trim().length === 0 ? null : raw.trim(),
});

const date = (raw: string): ParsedValue => {
  const v = raw.trim();
  if (v.length === 0) return { ok: true, value: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v))
    return { ok: false, error: `Expected YYYY-MM-DD, got "${raw}"` };
  return { ok: true, value: v };
};

const boolYesNo = (raw: string): ParsedValue => {
  const v = raw.trim().toLowerCase();
  if (v === "" ) return { ok: true, value: null };
  if (["yes", "true", "1"].includes(v)) return { ok: true, value: true };
  if (["no", "false", "0"].includes(v)) return { ok: true, value: false };
  return { ok: false, error: `Expected Yes/No, got "${raw}"` };
};

const enumIn = (allowed: Set<string>) =>
  (raw: string): ParsedValue => {
    const v = raw.trim();
    if (v.length === 0) return { ok: true, value: null };
    if (!allowed.has(v))
      return {
        ok: false,
        error: `"${raw}" not in [${Array.from(allowed).join(", ")}]`,
      };
    return { ok: true, value: v };
  };

const company = (raw: string): ParsedValue => {
  const v = raw.trim();
  if (v.length === 0) return { ok: true, value: null };
  const canon = COMPANY_ALIASES[v.toLowerCase()] ?? v;
  if (!COMPANY_VALUES.has(canon))
    return {
      ok: false,
      error: `"${raw}" not in [${Array.from(COMPANY_VALUES).join(", ")}]`,
    };
  return { ok: true, value: canon };
};

/**
 * Built-in fields the profile UI renders as auto-populated — value is set
 * elsewhere and the field is shown read-only with the hint below. Single
 * source of truth for: field-manager badge/hint, bulk-import picker filter,
 * bulk-import endpoint rejection, and the apply-time defensive strip.
 */
export const AUTO_POPULATED_BUILT_IN_HINTS: Record<string, string> = {
  role: "Set in User Management. Shown as a role badge on profiles.",
  location:
    "Today's working location (Office / Online / Rest) is derived from the schedule (plus any approved adjustment) and shown at the top of the profile. The legacy free-text users.location field is deprecated.",
  is_active:
    "Set in User Management. Shown as an Active/Inactive status on profiles.",
};

export const AUTO_POPULATED_BUILT_IN_KEYS: ReadonlySet<string> = new Set(
  Object.keys(AUTO_POPULATED_BUILT_IN_HINTS)
);

export const BUILT_IN_IMPORT_SPECS: Record<string, BuiltInImportSpec> = {
  preferred_name: { column: "preferred_name", parse: text },
  first_name: { column: "first_name", parse: text },
  middle_name: { column: "middle_name", parse: text },
  last_name: { column: "last_name", parse: text },
  company: { column: "company", parse: company },
  department: { column: "department", parse: text },
  job_title: { column: "job_title", parse: text },
  timezone: { column: "timezone", parse: text },
  birthday: { column: "birthday", parse: date },
  hire_date: { column: "hire_date", parse: date },
  regularization_date: { column: "regularization_date", parse: date },
  end_date: { column: "end_date", parse: date },
  holiday_country: { column: "holiday_country", parse: enumIn(COUNTRY_VALUES) },
  overtime_eligible: { column: "overtime_eligible", parse: boolYesNo },
};

/**
 * Checks whether a viewer is permitted to see a built-in field value given
 * the field's visibility setting and the viewer's relationship to the
 * subject. Mirrors the RLS rules on profile_field_values for custom fields.
 */
export function canSeeFieldValue(
  visibility: ProfileFieldVisibility,
  options: {
    isOwnProfile: boolean;
    isAdmin: boolean;
    isDirectManager: boolean;
    isRecruiter?: boolean;
    visibleToRecruiter?: boolean;
  }
): boolean {
  if (options.isAdmin) return true;
  if (options.isRecruiter && options.visibleToRecruiter) return true;
  // hr_only excludes the employee themselves; every other level lets
  // the owner see their own field.
  if (options.isOwnProfile) return visibility !== "hr_only";
  if (visibility === "everyone") return true;
  if (visibility === "manager_admin") return options.isDirectManager;
  return false; // admin_only or hr_only — only admins (handled above)
}
