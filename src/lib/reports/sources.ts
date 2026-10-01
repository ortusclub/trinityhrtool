/**
 * Registry of data sources available in the custom report builder.
 *
 * Each source describes:
 * - the Supabase table and select shape
 * - every column you can include (with a value extractor)
 * - filters (status / date range) that narrow the query
 *
 * Both the UI and the export API import from here so they stay in sync.
 */

import { LEAVE_TYPE_LABELS } from "@/lib/constants";
import { nightDifferentialHours } from "@/lib/utils";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type FilterValue = string | { from?: string; to?: string } | undefined;
export type FilterValues = Record<string, FilterValue>;

export type ColumnDef = {
  id: string;
  label: string;
  /** Pulls the export value out of a result row. */
  value: (row: any) => string | number | boolean | null | undefined;
};

export type FilterDef =
  | {
      id: string;
      label: string;
      type: "select";
      options: { value: string; label: string }[];
    }
  | {
      id: string;
      label: string;
      type: "date_range";
    };

export type SourceDef = {
  id: string;
  label: string;
  description: string;
  /** Supabase table to query. */
  table: string;
  /** Full select string including any joins needed for the columns below. */
  select: string;
  /** Default sort. */
  orderBy: { column: string; ascending: boolean };
  columns: ColumnDef[];
  /** Column IDs included by default when the user picks this source. */
  defaultColumns: string[];
  filters: FilterDef[];
  /**
   * Applies a single filter value to a Supabase query builder. Returning a new
   * builder is fine — the caller chains.
   */
  applyFilter: (query: any, filterId: string, value: FilterValue) => any;
};

/* ------------------------------ Helpers ------------------------------- */

function emp(
  row: any
): { full_name?: string; email?: string; department?: string } | null {
  // For joined `employee:users(...)` the result is an object (or array when
  // ambiguous). Normalise either form.
  if (!row?.employee) return null;
  return Array.isArray(row.employee) ? row.employee[0] : row.employee;
}

const employeeColumns: ColumnDef[] = [
  { id: "employee_name", label: "Employee", value: (r) => emp(r)?.full_name ?? "" },
  { id: "employee_email", label: "Employee Email", value: (r) => emp(r)?.email ?? "" },
  { id: "employee_department", label: "Department", value: (r) => emp(r)?.department ?? "" },
];

/**
 * Total hours between a start and end time (e.g. "23:00" → "02:00").
 * Mirrors the OT form: when the end is at or before the start, the shift is
 * treated as wrapping past midnight, so 24h is added. Returns "" when either
 * time is missing or unparseable.
 */
function hoursBetween(start?: string | null, end?: string | null): string {
  if (!start || !end) return "";
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m;
  };
  const s = toMin(start);
  const e = toMin(end);
  if (s === null || e === null) return "";
  let diff = e - s;
  if (diff <= 0) diff += 24 * 60; // overnight wrap
  return (diff / 60).toFixed(2).replace(/\.?0+$/, "");
}

const STATUS_PENDING_APPROVED_REJECTED = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

const STATUS_LEAVE = [
  ...STATUS_PENDING_APPROVED_REJECTED,
  { value: "cancelled", label: "Cancelled" },
];

/* -------------------------- Source definitions ------------------------ */

export const SOURCES: SourceDef[] = [
  // ─────── Users ───────
  {
    id: "users",
    label: "Users",
    description: "Active employees — identity, role, dates, country.",
    table: "users",
    select: "*",
    orderBy: { column: "full_name", ascending: true },
    columns: [
      { id: "full_name", label: "Full Name", value: (r) => r.full_name ?? "" },
      { id: "preferred_name", label: "Preferred Name", value: (r) => r.preferred_name ?? "" },
      { id: "first_name", label: "Given Name(s)", value: (r) => r.first_name ?? "" },
      { id: "middle_name", label: "Middle Name", value: (r) => r.middle_name ?? "" },
      { id: "last_name", label: "Last Name", value: (r) => r.last_name ?? "" },
      { id: "email", label: "Email", value: (r) => r.email ?? "" },
      { id: "role", label: "Role", value: (r) => r.role ?? "" },
      { id: "department", label: "Department", value: (r) => r.department ?? "" },
      { id: "job_title", label: "Job Title", value: (r) => r.job_title ?? "" },
      { id: "holiday_country", label: "Country", value: (r) => r.holiday_country ?? "" },
      { id: "timezone", label: "Timezone", value: (r) => r.timezone ?? "" },
      { id: "birthday", label: "Birthday", value: (r) => r.birthday ?? "" },
      { id: "hire_date", label: "Hire Date", value: (r) => r.hire_date ?? "" },
      { id: "regularization_date", label: "Regularization Date", value: (r) => r.regularization_date ?? "" },
      { id: "end_date", label: "End Date", value: (r) => r.end_date ?? "" },
      { id: "is_active", label: "Active", value: (r) => (r.is_active ? "Yes" : "No") },
      { id: "overtime_eligible", label: "Overtime Eligible", value: (r) => (r.overtime_eligible ? "Yes" : "No") },
    ],
    defaultColumns: [
      "full_name",
      "email",
      "role",
      "department",
      "job_title",
      "hire_date",
      "is_active",
    ],
    filters: [
      {
        id: "is_active",
        label: "Status",
        type: "select",
        options: [
          { value: "any", label: "All" },
          { value: "true", label: "Active only" },
          { value: "false", label: "Inactive only" },
        ],
      },
    ],
    applyFilter: (q, id, v) => {
      if (id === "is_active" && typeof v === "string" && v !== "any") {
        return q.eq("is_active", v === "true");
      }
      return q;
    },
  },

  // ─────── Leave Requests ───────
  {
    id: "leave_requests",
    label: "Leave Requests",
    description: "All leave requests with type, dates, and approval state.",
    table: "leave_requests",
    select:
      "id, leave_type, start_date, end_date, leave_duration, half_day_period, half_day_start_time, half_day_end_time, reason, status, reviewer_notes, created_at, employee:users!leave_requests_employee_id_fkey(full_name, email)",
    orderBy: { column: "created_at", ascending: false },
    columns: [
      ...employeeColumns,
      { id: "leave_type", label: "Leave Type", value: (r) => LEAVE_TYPE_LABELS[r.leave_type] ?? r.leave_type ?? "" },
      { id: "leave_duration", label: "Duration", value: (r) => r.leave_duration ?? "" },
      { id: "half_day_period", label: "Half-day Period", value: (r) => r.half_day_period ?? "" },
      { id: "start_date", label: "Start Date", value: (r) => r.start_date ?? "" },
      { id: "end_date", label: "End Date", value: (r) => r.end_date ?? "" },
      { id: "status", label: "Status", value: (r) => r.status ?? "" },
      { id: "reason", label: "Reason", value: (r) => r.reason ?? "" },
      { id: "reviewer_notes", label: "Reviewer Notes", value: (r) => r.reviewer_notes ?? "" },
      { id: "created_at", label: "Submitted At", value: (r) => r.created_at?.slice(0, 19).replace("T", " ") ?? "" },
    ],
    defaultColumns: ["employee_name", "leave_type", "start_date", "end_date", "status", "reason"],
    filters: [
      {
        id: "status",
        label: "Status",
        type: "select",
        options: [{ value: "any", label: "Any" }, ...STATUS_LEAVE],
      },
      { id: "date_range", label: "Start date range", type: "date_range" },
    ],
    applyFilter: (q, id, v) => {
      if (id === "status" && typeof v === "string" && v !== "any") return q.eq("status", v);
      if (id === "date_range" && v && typeof v === "object") {
        if (v.from) q = q.gte("start_date", v.from);
        if (v.to) q = q.lte("start_date", v.to);
      }
      return q;
    },
  },

  // ─────── Attendance Flags ───────
  {
    id: "attendance_flags",
    label: "Attendance Flags",
    description: "Late arrivals, early departures, and absences.",
    table: "attendance_flags",
    select:
      "id, flag_type, flag_date, deviation_minutes, scheduled_time, actual_time, acknowledged, notes, employee_notes, employee:users!attendance_flags_employee_id_fkey(full_name, email)",
    orderBy: { column: "flag_date", ascending: false },
    columns: [
      ...employeeColumns,
      { id: "flag_date", label: "Date", value: (r) => r.flag_date ?? "" },
      { id: "flag_type", label: "Flag Type", value: (r) => r.flag_type ?? "" },
      { id: "scheduled_time", label: "Scheduled Time", value: (r) => r.scheduled_time ?? "" },
      { id: "actual_time", label: "Actual Time", value: (r) => r.actual_time ?? "" },
      { id: "deviation_minutes", label: "Deviation (min)", value: (r) => r.deviation_minutes ?? "" },
      { id: "acknowledged", label: "Status", value: (r) => (r.acknowledged ? "Acknowledged" : "Pending") },
      { id: "notes", label: "Manager Notes", value: (r) => r.notes ?? "" },
      { id: "employee_notes", label: "Employee Notes", value: (r) => r.employee_notes ?? "" },
    ],
    defaultColumns: ["employee_name", "flag_date", "flag_type", "deviation_minutes", "acknowledged"],
    filters: [
      {
        id: "flag_type",
        label: "Flag Type",
        type: "select",
        options: [
          { value: "any", label: "Any" },
          { value: "late_arrival", label: "Late Arrival" },
          { value: "early_departure", label: "Early Departure" },
          { value: "absent", label: "Absent" },
        ],
      },
      {
        id: "acknowledged",
        label: "Acknowledgement",
        type: "select",
        options: [
          { value: "any", label: "Any" },
          { value: "true", label: "Acknowledged" },
          { value: "false", label: "Pending" },
        ],
      },
      { id: "date_range", label: "Flag date range", type: "date_range" },
    ],
    applyFilter: (q, id, v) => {
      if (id === "flag_type" && typeof v === "string" && v !== "any") return q.eq("flag_type", v);
      if (id === "acknowledged" && typeof v === "string" && v !== "any") {
        return q.eq("acknowledged", v === "true");
      }
      if (id === "date_range" && v && typeof v === "object") {
        if (v.from) q = q.gte("flag_date", v.from);
        if (v.to) q = q.lte("flag_date", v.to);
      }
      return q;
    },
  },

  // ─────── Attendance Logs ───────
  {
    id: "attendance_logs",
    label: "Attendance Logs",
    description: "Daily clock-in / clock-out records.",
    table: "attendance_logs",
    select:
      "id, date, scheduled_start, scheduled_end, clock_in, clock_out, status, late_minutes, early_departure_minutes, employee:users!attendance_logs_employee_id_fkey(full_name, email)",
    orderBy: { column: "date", ascending: false },
    columns: [
      ...employeeColumns,
      { id: "date", label: "Date", value: (r) => r.date ?? "" },
      { id: "scheduled_start", label: "Scheduled Start", value: (r) => r.scheduled_start ?? "" },
      { id: "scheduled_end", label: "Scheduled End", value: (r) => r.scheduled_end ?? "" },
      { id: "clock_in", label: "Clock In", value: (r) => r.clock_in ?? "" },
      { id: "clock_out", label: "Clock Out", value: (r) => r.clock_out ?? "" },
      { id: "status", label: "Status", value: (r) => r.status ?? "" },
      { id: "late_minutes", label: "Late (min)", value: (r) => r.late_minutes ?? "" },
      { id: "early_departure_minutes", label: "Early (min)", value: (r) => r.early_departure_minutes ?? "" },
    ],
    defaultColumns: ["employee_name", "date", "clock_in", "clock_out", "status"],
    filters: [
      { id: "date_range", label: "Date range", type: "date_range" },
    ],
    applyFilter: (q, id, v) => {
      if (id === "date_range" && v && typeof v === "object") {
        if (v.from) q = q.gte("date", v.from);
        if (v.to) q = q.lte("date", v.to);
      }
      return q;
    },
  },

  // ─────── Schedule Adjustments ───────
  {
    id: "schedule_adjustments",
    label: "Schedule Adjustments",
    description: "Time / location changes employees have requested.",
    table: "schedule_adjustments",
    select:
      "id, requested_date, original_start_time, original_end_time, requested_start_time, requested_end_time, requested_work_location, reason, status, reviewer_notes, created_at, employee:users!schedule_adjustments_employee_id_fkey(full_name, email)",
    orderBy: { column: "created_at", ascending: false },
    columns: [
      ...employeeColumns,
      { id: "requested_date", label: "Date", value: (r) => r.requested_date ?? "" },
      { id: "original_start_time", label: "Original Start", value: (r) => r.original_start_time ?? "" },
      { id: "original_end_time", label: "Original End", value: (r) => r.original_end_time ?? "" },
      { id: "requested_start_time", label: "Requested Start", value: (r) => r.requested_start_time ?? "" },
      { id: "requested_end_time", label: "Requested End", value: (r) => r.requested_end_time ?? "" },
      { id: "requested_work_location", label: "Requested Location", value: (r) => r.requested_work_location ?? "" },
      { id: "status", label: "Status", value: (r) => r.status ?? "" },
      { id: "reason", label: "Reason", value: (r) => r.reason ?? "" },
      { id: "reviewer_notes", label: "Reviewer Notes", value: (r) => r.reviewer_notes ?? "" },
      { id: "created_at", label: "Submitted At", value: (r) => r.created_at?.slice(0, 19).replace("T", " ") ?? "" },
    ],
    defaultColumns: ["employee_name", "requested_date", "requested_start_time", "requested_end_time", "status"],
    filters: [
      {
        id: "status",
        label: "Status",
        type: "select",
        options: [{ value: "any", label: "Any" }, ...STATUS_PENDING_APPROVED_REJECTED],
      },
      { id: "date_range", label: "Requested date range", type: "date_range" },
    ],
    applyFilter: (q, id, v) => {
      if (id === "status" && typeof v === "string" && v !== "any") return q.eq("status", v);
      if (id === "date_range" && v && typeof v === "object") {
        if (v.from) q = q.gte("requested_date", v.from);
        if (v.to) q = q.lte("requested_date", v.to);
      }
      return q;
    },
  },

  // ─────── Overtime Requests ───────
  {
    id: "overtime_requests",
    label: "Overtime Requests",
    description: "Overtime hour requests with approval state.",
    table: "overtime_requests",
    select:
      "id, requested_date, start_time, end_time, reason, status, reviewer_notes, created_at, employee:users!overtime_requests_employee_id_fkey(full_name, email)",
    orderBy: { column: "created_at", ascending: false },
    columns: [
      ...employeeColumns,
      { id: "requested_date", label: "Date", value: (r) => r.requested_date ?? "" },
      { id: "start_time", label: "Start", value: (r) => r.start_time ?? "" },
      { id: "end_time", label: "End", value: (r) => r.end_time ?? "" },
      { id: "total_hours", label: "Total Hours", value: (r) => hoursBetween(r.start_time, r.end_time) },
      {
        id: "night_diff_hours",
        label: "Night Diff Hours",
        // Blank (not 0) when the OT doesn't touch 22:00–06:00, so payroll can
        // scan for who actually needs night-differential pay.
        value: (r) => {
          const h = nightDifferentialHours(r.start_time, r.end_time);
          return h > 0 ? h : "";
        },
      },
      { id: "status", label: "Status", value: (r) => r.status ?? "" },
      { id: "reason", label: "Reason", value: (r) => r.reason ?? "" },
      { id: "reviewer_notes", label: "Reviewer Notes", value: (r) => r.reviewer_notes ?? "" },
      { id: "created_at", label: "Submitted At", value: (r) => r.created_at?.slice(0, 19).replace("T", " ") ?? "" },
    ],
    defaultColumns: ["employee_name", "requested_date", "start_time", "end_time", "total_hours", "night_diff_hours", "status"],
    filters: [
      {
        id: "status",
        label: "Status",
        type: "select",
        options: [{ value: "any", label: "Any" }, ...STATUS_PENDING_APPROVED_REJECTED],
      },
      { id: "date_range", label: "Requested date range", type: "date_range" },
    ],
    applyFilter: (q, id, v) => {
      if (id === "status" && typeof v === "string" && v !== "any") return q.eq("status", v);
      if (id === "date_range" && v && typeof v === "object") {
        if (v.from) q = q.gte("requested_date", v.from);
        if (v.to) q = q.lte("requested_date", v.to);
      }
      return q;
    },
  },

  // ─────── Holiday Work Requests ───────
  {
    id: "holiday_work_requests",
    label: "Holiday Work Requests",
    description: "Employees who worked (or asked to work) on a holiday.",
    table: "holiday_work_requests",
    select:
      "id, holiday_date, start_time, end_time, work_location, duration, compensation, reason, status, reviewer_notes, created_at, employee:users!holiday_work_requests_employee_id_fkey(full_name, email), holiday:holidays!holiday_work_requests_holiday_id_fkey(name)",
    orderBy: { column: "created_at", ascending: false },
    columns: [
      ...employeeColumns,
      {
        id: "holiday_name",
        label: "Holiday",
        value: (r) =>
          (Array.isArray(r.holiday) ? r.holiday[0]?.name : r.holiday?.name) ?? "",
      },
      { id: "holiday_date", label: "Date", value: (r) => r.holiday_date ?? "" },
      { id: "start_time", label: "Start", value: (r) => r.start_time ?? "" },
      { id: "end_time", label: "End", value: (r) => r.end_time ?? "" },
      {
        id: "duration",
        label: "Duration",
        value: (r) => (r.duration === "half_day" ? "Half Day" : "Full Day"),
      },
      { id: "work_location", label: "Location", value: (r) => r.work_location ?? "" },
      {
        id: "compensation",
        label: "Compensation",
        value: (r) =>
          r.compensation === "cto" ? "CTO Leave" : "Holiday Pay",
      },
      {
        id: "compensation_days",
        label: "CTO Days Credited",
        // Earned-CTO equivalent for payroll reconciliation: 0 for holiday_pay,
        // 0.5 / 1 for cto depending on duration. Only meaningful when status
        // is approved (a pending/rejected row never grants).
        value: (r) => {
          if (r.compensation !== "cto" || r.status !== "approved") return 0;
          return r.duration === "half_day" ? 0.5 : 1;
        },
      },
      { id: "status", label: "Status", value: (r) => r.status ?? "" },
      { id: "reason", label: "Reason", value: (r) => r.reason ?? "" },
      { id: "reviewer_notes", label: "Reviewer Notes", value: (r) => r.reviewer_notes ?? "" },
      { id: "created_at", label: "Submitted At", value: (r) => r.created_at?.slice(0, 19).replace("T", " ") ?? "" },
    ],
    defaultColumns: [
      "employee_name",
      "holiday_name",
      "holiday_date",
      "duration",
      "compensation",
      "compensation_days",
      "status",
    ],
    filters: [
      {
        id: "status",
        label: "Status",
        type: "select",
        options: [{ value: "any", label: "Any" }, ...STATUS_PENDING_APPROVED_REJECTED],
      },
      {
        id: "compensation",
        label: "Compensation",
        type: "select",
        options: [
          { value: "any", label: "Any" },
          { value: "holiday_pay", label: "Holiday Pay" },
          { value: "cto", label: "CTO Leave" },
        ],
      },
      { id: "date_range", label: "Holiday date range", type: "date_range" },
    ],
    applyFilter: (q, id, v) => {
      if (id === "status" && typeof v === "string" && v !== "any") return q.eq("status", v);
      if (id === "compensation" && typeof v === "string" && v !== "any") return q.eq("compensation", v);
      if (id === "date_range" && v && typeof v === "object") {
        if (v.from) q = q.gte("holiday_date", v.from);
        if (v.to) q = q.lte("holiday_date", v.to);
      }
      return q;
    },
  },

  // ─────── Document Requests ───────
  {
    id: "document_requests",
    label: "Document Requests",
    description: "COE / Travel / Leave certificates and other doc requests.",
    table: "document_requests",
    select:
      "id, document_type, custom_document_name, addressee, additional_details, event_tag, event_city, event_country, event_date, event_name, leave_start_date, leave_end_date, status, processor_notes, processor_attachment_url, created_at, processed_at, employee:users!document_requests_employee_id_fkey(full_name, email), processor:users!document_requests_processed_by_fkey(full_name, email)",
    orderBy: { column: "created_at", ascending: false },
    columns: [
      ...employeeColumns,
      { id: "document_type", label: "Document Type", value: (r) => r.document_type ?? "" },
      { id: "custom_document_name", label: "Custom Document Name", value: (r) => r.custom_document_name ?? "" },
      { id: "addressee", label: "Addressee", value: (r) => r.addressee ?? "" },
      { id: "additional_details", label: "Additional Details", value: (r) => r.additional_details ?? "" },
      { id: "event_name", label: "Event Name", value: (r) => r.event_name ?? "" },
      { id: "event_tag", label: "Event Tag", value: (r) => r.event_tag ?? "" },
      { id: "event_city", label: "Event City", value: (r) => r.event_city ?? "" },
      { id: "event_country", label: "Event Country", value: (r) => r.event_country ?? "" },
      { id: "event_date", label: "Event Date", value: (r) => r.event_date ?? "" },
      { id: "leave_start_date", label: "Leave From", value: (r) => r.leave_start_date ?? "" },
      { id: "leave_end_date", label: "Leave To", value: (r) => r.leave_end_date ?? "" },
      { id: "status", label: "Status", value: (r) => r.status ?? "" },
      {
        id: "processor_name",
        label: "Processed By",
        value: (r) =>
          (Array.isArray(r.processor) ? r.processor[0]?.full_name : r.processor?.full_name) ?? "",
      },
      { id: "processed_at", label: "Processed At", value: (r) => r.processed_at?.slice(0, 19).replace("T", " ") ?? "" },
      { id: "processor_notes", label: "Processor Notes", value: (r) => r.processor_notes ?? "" },
      { id: "processor_attachment_url", label: "Attachment URL", value: (r) => r.processor_attachment_url ?? "" },
      { id: "created_at", label: "Submitted At", value: (r) => r.created_at?.slice(0, 19).replace("T", " ") ?? "" },
    ],
    defaultColumns: ["employee_name", "document_type", "addressee", "status", "created_at"],
    filters: [
      {
        id: "document_type",
        label: "Document Type",
        type: "select",
        options: [
          { value: "any", label: "Any" },
          { value: "certificate_of_employment", label: "Certificate of Employment" },
          { value: "purpose_of_travel", label: "Purpose of Travel" },
          { value: "leave_certificate", label: "Leave Certificate" },
          { value: "contract_copy", label: "Contract Copy" },
          { value: "other", label: "Other" },
        ],
      },
      {
        id: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "any", label: "Any" },
          { value: "pending", label: "Pending" },
          { value: "processed", label: "Processed" },
          { value: "cancelled", label: "Cancelled" },
        ],
      },
      { id: "date_range", label: "Submitted date range", type: "date_range" },
    ],
    applyFilter: (q, id, v) => {
      if (id === "document_type" && typeof v === "string" && v !== "any") return q.eq("document_type", v);
      if (id === "status" && typeof v === "string" && v !== "any") return q.eq("status", v);
      if (id === "date_range" && v && typeof v === "object") {
        if (v.from) q = q.gte("created_at", v.from);
        if (v.to) q = q.lte("created_at", v.to + "T23:59:59");
      }
      return q;
    },
  },

  // ─────── Leave Balances (computed) ───────
  {
    id: "leave_balances",
    label: "Time-off Balances",
    description:
      "Current cycle balance per employee per leave type — allocated, used, and remaining.",
    table: "__computed__",
    select: "",
    orderBy: { column: "employee_name", ascending: true },
    columns: [
      { id: "employee_name", label: "Employee", value: (r) => r.employee_name },
      { id: "employee_email", label: "Email", value: (r) => r.employee_email },
      { id: "department", label: "Department", value: (r) => r.department },
      { id: "leave_type", label: "Leave Type", value: (r) => r.leave_type_label },
      { id: "allocated_days", label: "Allocated", value: (r) => r.allocated_days },
      { id: "used_days", label: "Used", value: (r) => r.used_days },
      { id: "remaining_days", label: "Remaining", value: (r) => r.remaining_days },
      { id: "renewal_start", label: "Cycle Start", value: (r) => r.renewal_start },
      { id: "plan_name", label: "Plan(s)", value: (r) => r.plan_name },
    ],
    defaultColumns: [
      "employee_name",
      "department",
      "leave_type",
      "allocated_days",
      "used_days",
      "remaining_days",
    ],
    filters: [],
    applyFilter: (q) => q,
  },

  // ─────── Night Differential (Payroll) ───────
  {
    id: "night_differential",
    label: "Night Differential (Payroll)",
    description:
      "Per pay period: employees whose scheduled hours overlapped night hours (22:00–06:00), with total scheduled night-differential hours, days, and a per-shift breakdown. Built from each day's snapshotted schedule (survives mid-period schedule changes). Defaults to the current month-to-date; pick a date range for the pay period.",
    table: "__computed__",
    select: "",
    orderBy: { column: "nd_hours", ascending: false },
    columns: [
      { id: "employee_name", label: "Employee", value: (r) => r.employee_name },
      { id: "employee_email", label: "Email", value: (r) => r.employee_email },
      { id: "department", label: "Department", value: (r) => r.department },
      { id: "period", label: "Period", value: (r) => r.period },
      { id: "nd_days", label: "ND Days", value: (r) => r.nd_days },
      { id: "nd_hours", label: "ND Hours", value: (r) => r.nd_hours },
      { id: "nd_detail", label: "ND Breakdown", value: (r) => r.nd_detail },
    ],
    defaultColumns: [
      "employee_name",
      "department",
      "period",
      "nd_days",
      "nd_hours",
      "nd_detail",
    ],
    filters: [{ id: "date_range", label: "Pay period", type: "date_range" }],
    applyFilter: (q) => q,
  },

  // ─────── Holidays ───────
  {
    id: "holidays",
    label: "Holidays",
    description: "Holiday calendar entries.",
    table: "holidays",
    select: "id, name, date, country, is_recurring",
    orderBy: { column: "date", ascending: false },
    columns: [
      { id: "name", label: "Name", value: (r) => r.name ?? "" },
      { id: "date", label: "Date", value: (r) => r.date ?? "" },
      { id: "country", label: "Country", value: (r) => r.country ?? "" },
      { id: "is_recurring", label: "Recurring", value: (r) => (r.is_recurring ? "Yes" : "No") },
    ],
    defaultColumns: ["name", "date", "country", "is_recurring"],
    filters: [
      {
        id: "country",
        label: "Country",
        type: "select",
        options: [
          { value: "any", label: "Any" },
          { value: "PH", label: "Philippines" },
          { value: "XK", label: "Kosovo" },
          { value: "IT", label: "Italy" },
          { value: "AE", label: "UAE" },
          { value: "US", label: "United States" },
          { value: "KR", label: "South Korea" },
        ],
      },
      { id: "date_range", label: "Date range", type: "date_range" },
    ],
    applyFilter: (q, id, v) => {
      if (id === "country" && typeof v === "string" && v !== "any") return q.eq("country", v);
      if (id === "date_range" && v && typeof v === "object") {
        if (v.from) q = q.gte("date", v.from);
        if (v.to) q = q.lte("date", v.to);
      }
      return q;
    },
  },
];

/* ------------------------- Department filter ------------------------- */
// Give every person-scoped source a "Department" filter so any report can be
// scoped to a team. The value is the exact users.department string; the UI
// (ReportBuilder) fills the dropdown options from the live department list, so
// this registry doesn't have to hardcode (or drift from) the departments.
//
// - Query sources that embed the employee (employee:users!…): the embed is
//   inner-joined and pulls `department` so the filter narrows the parent rows.
// - The Users source filters its own `department` column directly.
// - Computed sources (balances, night differential) already carry a
//   `department` field per row and are filtered after computation in the
//   export route — applyFilter is a no-op for them here.
export const DEPARTMENT_FILTER_ID = "department";

const departmentFilterDef: FilterDef = {
  id: DEPARTMENT_FILTER_ID,
  label: "Department",
  type: "select",
  // Placeholder — ReportBuilder swaps in the live department list. "any" stays
  // the first/default option so the filter is a no-op unless a team is chosen.
  options: [{ value: "any", label: "Any department" }],
};

for (const source of SOURCES) {
  const hasEmployeeEmbed = source.select.includes("employee:users!");
  const isUsers = source.table === "users";
  const isComputedWithDept =
    source.table === "__computed__" &&
    source.columns.some((c) => c.id === "department");

  if (!hasEmployeeEmbed && !isUsers && !isComputedWithDept) continue;

  if (hasEmployeeEmbed) {
    // Inner-join the employee embed and pull `department`. The employee is a
    // required FK on every one of these tables, so !inner drops no real rows.
    source.select = source.select.replace(
      /(employee:users![A-Za-z0-9_]+)\(([^)]*)\)/,
      (_m, head: string, cols: string) => `${head}!inner(${cols}, department)`
    );
  }

  source.filters = [...source.filters, departmentFilterDef];

  const prevApply = source.applyFilter;
  source.applyFilter = (q, id, v) => {
    if (id === DEPARTMENT_FILTER_ID && typeof v === "string" && v !== "any") {
      // Computed sources bypass the query builder — their department filter is
      // applied to the computed rows in the export route, not here.
      if (source.table === "__computed__") return q;
      return isUsers ? q.eq("department", v) : q.eq("employee.department", v);
    }
    return prevApply(q, id, v);
  };
}

export function getSource(id: string): SourceDef | undefined {
  return SOURCES.find((s) => s.id === id);
}
