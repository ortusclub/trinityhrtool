export type UserRole =
  | "employee"
  | "manager"
  | "hr_admin"
  | "super_admin"
  | "hr_support";

export interface EmployeeReference {
  id: string;
  employee_id: string;
  name: string;
  relationship: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}
export type AdjustmentStatus = "pending" | "approved" | "rejected";
export type AttendanceStatus =
  | "on_time"
  | "late_arrival"
  | "early_departure"
  | "late_and_early"
  | "absent"
  | "rest_day"
  | "on_leave"
  | "holiday"
  | "working"
  | "not_started"
  | "no_schedule";
export type FlagType = "late_arrival" | "early_departure" | "absent";
export type WorkLocation = "office" | "online";
export type LeaveType =
  | "anniversary"
  | "annual"
  | "birthday"
  | "cto"
  | "trinity"
  | "maternity_paternity"
  | "solo_parent"
  | "bereavement";
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";
export type HolidayCountry = "PH" | "XK" | "IT" | "AE" | "US" | "KR";
export type EmploymentType = "employee" | "consultant";
export type HolidayWorkCompensation = "holiday_pay" | "cto";
export type HolidayWorkDuration = "full_day" | "half_day";

export const HOLIDAY_COUNTRY_LABELS: Record<HolidayCountry, string> = {
  PH: "Philippines",
  XK: "Kosovo",
  IT: "Italy",
  AE: "Dubai (UAE)",
  US: "United States",
  KR: "South Korea",
};

export type Company =
  | "Ortus Strategy Pte. Ltd."
  | "m-Club Coaching LTD."
  | "Trinity Outsourcing Solutions Inc."
  | "APEX Strategy";

export const COMPANY_OPTIONS: Company[] = [
  "Ortus Strategy Pte. Ltd.",
  "m-Club Coaching LTD.",
  "Trinity Outsourcing Solutions Inc.",
  "APEX Strategy",
];

export type NotificationType =
  | "schedule_adjustment_request"
  | "schedule_adjustment_decision"
  | "attendance_flag"
  | "leave_request"
  | "leave_decision"
  | "holiday_work_request"
  | "holiday_work_decision";

export interface User {
  id: string;
  email: string;
  full_name: string;
  preferred_name: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  role: UserRole;
  manager_id: string | null;
  company: Company | null;
  department: string | null;
  job_title: string | null;
  location: string | null;
  birthday: string | null;
  hire_date: string | null;
  regularization_date: string | null;
  end_date: string | null;
  avatar_url: string | null;
  desktime_employee_id: number | null;
  desktime_url: string | null;
  biometric_id: number | null;
  timezone: string;
  holiday_country: HolidayCountry;
  is_active: boolean;
  overtime_eligible: boolean;
  employment_type: EmploymentType;
  calendar_token: string | null;
  last_active_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OvertimeRequest {
  id: string;
  employee_id: string;
  requested_date: string;
  start_time: string;
  end_time: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewer_notes: string | null;
  created_at: string;
}

export interface OvertimeRequestWithEmployee extends OvertimeRequest {
  employee?: {
    full_name: string;
    email: string;
    preferred_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    manager_id?: string | null;
  };
}

export type DocumentRequestType =
  | "certificate_of_employment"
  | "purpose_of_travel"
  | "leave_certificate"
  | "contract_copy"
  | "other";

export interface DocumentRequest {
  id: string;
  employee_id: string;
  document_type: DocumentRequestType;
  custom_document_name: string | null;
  addressee: string;
  additional_details: string | null;
  event_tag: string | null;
  event_city: string | null;
  event_country: string | null;
  event_date: string | null;
  event_name: string | null;
  leave_start_date: string | null;
  leave_end_date: string | null;
  status: "pending" | "processed" | "cancelled";
  processed_by: string | null;
  processed_at: string | null;
  processor_notes: string | null;
  processor_attachment_url: string | null;
  created_at: string;
}

export interface DocumentRequestWithEmployee extends DocumentRequest {
  employee?: {
    full_name: string;
    email: string;
    preferred_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  };
  processor?: {
    full_name: string;
    email: string;
    preferred_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  } | null;
}

export type ProfileFieldType =
  | "text"
  | "textarea"
  | "date"
  | "number"
  | "url"
  | "multi_row"
  | "select";
export type ProfileFieldVisibility =
  | "everyone"
  | "manager_admin"
  | "admin_only"
  | "hr_only";

export type ProfileFieldSubfieldType =
  | "text"
  | "textarea"
  | "date"
  | "number"
  | "url";

export interface ProfileFieldSubfield {
  key: string;
  label: string;
  type: ProfileFieldSubfieldType;
  /**
   * Per-subfield visibility override. Undefined = inherit the parent
   * field's visibility. Use this to make individual columns within a
   * multi-row field more restrictive (e.g. HR-only recruiter notes
   * inside an otherwise manager-visible References block).
   */
  visibility?: ProfileFieldVisibility;
}

export interface ProfileFieldSection {
  id: string;
  name: string;
  sort_order: number;
  /** Non-null for system-seeded sections like "Identity", "Employment". */
  built_in_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProfileField {
  id: string;
  section_id: string;
  label: string;
  field_type: ProfileFieldType;
  visibility: ProfileFieldVisibility;
  /** If true, hr_support can see values of this field too. */
  visible_to_recruiter: boolean;
  sort_order: number;
  /** Non-null for fields that map to a column on the users table. */
  built_in_key: string | null;
  /** Sub-field schema for multi_row fields. Empty array for scalar types. */
  subfields: ProfileFieldSubfield[];
  /** Option labels for 'select' fields. Empty array for other types. */
  options: string[];
  created_at: string;
  updated_at: string;
}

export interface ProfileFieldValue {
  id: string;
  field_id: string;
  employee_id: string;
  value: string | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

export interface ProfileFieldValueRow {
  id: string;
  field_id: string;
  employee_id: string;
  row_index: number;
  data: Record<string, string>;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

export const PROFILE_FIELD_VISIBILITY_LABELS: Record<ProfileFieldVisibility, string> = {
  everyone: "Everyone",
  manager_admin: "Self + Direct Manager + HR/Admin",
  admin_only: "Self + HR/Admin only",
  hr_only: "HR/Admin only (hidden from employee)",
};

export const PROFILE_FIELD_TYPE_LABELS: Record<ProfileFieldType, string> = {
  text: "Short text",
  textarea: "Long text",
  date: "Date",
  number: "Number",
  url: "URL",
  multi_row: "Multi-row",
  select: "Dropdown",
};

export const DOCUMENT_TYPE_LABELS: Record<DocumentRequestType, string> = {
  certificate_of_employment: "Certificate of Employment",
  purpose_of_travel: "Purpose of Travel Letter",
  leave_certificate: "Leave Certificate",
  contract_copy: "Copy of Contract Agreement",
  other: "Other",
};

export interface Schedule {
  id: string;
  employee_id: string;
  day_of_week: number; // 0=Monday, 6=Sunday
  start_time: string;
  end_time: string;
  is_rest_day: boolean;
  work_location: WorkLocation;
  effective_from: string;
  effective_until: string | null;
  created_at: string;
  updated_at: string;
}

export type ScheduleAdjustmentType = "time" | "location" | "both";

export interface ScheduleAdjustment {
  id: string;
  employee_id: string;
  requested_date: string;
  adjustment_type: ScheduleAdjustmentType;
  original_start_time: string;
  original_end_time: string;
  requested_start_time: string;
  requested_end_time: string;
  requested_work_location: WorkLocation | null;
  reason: string;
  status: AdjustmentStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewer_notes: string | null;
  created_at: string;
}

export interface AttendanceLog {
  id: string;
  employee_id: string;
  date: string;
  desktime_employee_id: number | null;
  clock_in: string | null;
  clock_out: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  status: AttendanceStatus;
  late_minutes: number | null;
  early_departure_minutes: number | null;
  created_at: string;
  raw_response: Record<string, unknown> | null;
}

export interface AttendanceFlag {
  id: string;
  attendance_log_id: string | null;
  employee_id: string;
  flag_type: FlagType;
  flag_date: string;
  deviation_minutes: number;
  scheduled_time: string;
  actual_time: string | null;
  acknowledged: boolean;
  notes: string | null;
  employee_notes: string | null;
  created_at: string;
}

export interface EmailTemplate {
  type: string;
  name: string;
  subject: string;
  body: string;
  variables: string;
  updated_by: string | null;
  updated_at: string;
}

export interface SystemSetting {
  key: string;
  value: string;
  updated_by: string | null;
  updated_at: string;
}

export interface NotificationLog {
  id: string;
  type: NotificationType;
  recipient_email: string;
  subject: string;
  sent_at: string;
  related_id: string | null;
  status: "sent" | "failed";
}

export type LeaveDuration = "full_day" | "half_day";
export type HalfDayPeriod = "am" | "pm";

export interface LeaveRequest {
  id: string;
  employee_id: string;
  leave_type: LeaveType;
  leave_duration: LeaveDuration;
  half_day_period: HalfDayPeriod | null;
  half_day_start_time: string | null;
  half_day_end_time: string | null;
  start_date: string;
  end_date: string;
  reason: string;
  status: LeaveStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewer_notes: string | null;
  created_at: string;
}

export interface Holiday {
  id: string;
  country: HolidayCountry;
  name: string;
  date: string;
  is_recurring: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface HolidayWorkRequest {
  id: string;
  employee_id: string;
  holiday_id: string;
  holiday_date: string;
  start_time: string;
  end_time: string;
  work_location: WorkLocation;
  reason: string;
  duration: HolidayWorkDuration;
  compensation: HolidayWorkCompensation;
  status: LeaveStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewer_notes: string | null;
  created_at: string;
}

export interface CtoGrant {
  id: string;
  employee_id: string;
  days: number;
  granted_at: string;
  granted_by: string | null;
  source: string;
  source_request_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface LeaveCredit {
  id: string;
  employee_id: string;
  leave_type: string;
  days: number;
  granted_at: string;        // YYYY-MM-DD
  expires_at: string | null; // YYYY-MM-DD or null = never expires
  granted_by: string | null;
  source: string;            // 'manual' for admin-issued
  notes: string | null;
  created_at: string;
}

export type IncidentType =
  | "harassment"
  | "safety"
  | "theft"
  | "misconduct"
  | "discrimination"
  | "other";
export type IncidentStatus = "new" | "in_review" | "resolved" | "dismissed";

export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  harassment: "Harassment",
  safety: "Safety",
  theft: "Theft",
  misconduct: "Misconduct",
  discrimination: "Discrimination",
  other: "Other",
};

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  new: "New",
  in_review: "In Review",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

export interface IncidentReport {
  id: string;
  reporter_id: string;
  incident_date: string;
  incident_type: IncidentType;
  location: string | null;
  people_involved_user_ids: string[];
  people_involved_other: string | null;
  summary: string;
  outcome: string | null;
  status: IncidentStatus;
  handled_by: string | null;
  handled_at: string | null;
  handler_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface IncidentReportAttachment {
  id: string;
  report_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string;
  created_at: string;
}

export type FeedbackCategory = "general" | "compliment" | "concern" | "suggestion";
export type FeedbackStatus = "new" | "reviewed" | "archived";

export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  general: "General",
  compliment: "Compliment",
  concern: "Concern",
  suggestion: "Suggestion",
};

export interface AnonymousFeedback {
  id: string;
  category: FeedbackCategory;
  subject: string | null;
  body: string;
  status: FeedbackStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  handler_notes: string | null;
  created_at: string;
}

// ─── Standalone P2P (peer) feedback, moderated by HR ────────────────────────
export type P2PFeedbackStatus = "new" | "forwarded" | "dismissed";

export const P2P_FEEDBACK_STATUS_LABELS: Record<P2PFeedbackStatus, string> = {
  new: "New",
  forwarded: "Forwarded",
  dismissed: "Dismissed",
};

export interface P2PFeedback {
  id: string;
  author_id: string;
  target_department: string;
  target_user_id: string | null;
  subject: string;
  message: string;
  status: P2PFeedbackStatus;
  /** Kept in sync with recipient_user_ids[0] for backward compatibility. */
  recipient_user_id: string | null;
  /** Source of truth: HR can forward to one or more recipients. */
  recipient_user_ids: string[];
  hr_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface P2PFeedbackWithUsers extends P2PFeedback {
  author?: MiniUser | null;
  target?: MiniUser | null;
  recipient?: MiniUser | null;
}

// Extended types with joins
export interface UserWithManager extends User {
  manager?: User | null;
}

export interface ScheduleAdjustmentWithUser extends ScheduleAdjustment {
  employee?: User;
  reviewer?: User | null;
}

export interface AttendanceLogWithUser extends AttendanceLog {
  employee?: User;
}

export interface AttendanceFlagWithUser extends AttendanceFlag {
  employee?: User;
  attendance_log?: AttendanceLog | null;
}

export interface EmployeeLeaveType {
  id: string;
  employee_id: string;
  leave_type: LeaveType;
  activated_by: string | null;
  created_at: string;
}

export type GrantType = "custom" | "hire_date" | "anniversary";

export interface LeavePlan {
  id: string;
  name: string;
  description: string | null;
  grant_type: GrantType;
  renewal_month: number;
  renewal_day: number;
  created_at: string;
}

export interface LeavePlanAllocation {
  id: string;
  plan_id: string;
  leave_type: string;
  days_per_year: number;
}

export interface EmployeeLeavePlan {
  id: string;
  employee_id: string;
  plan_id: string;
  assigned_by: string | null;
  created_at: string;
}

// KPI types
export type KpiUnitType =
  | "percentage"
  | "currency"
  | "count"
  | "score"
  | "hours"
  | "custom";
export type KpiPeriodType = "monthly" | "quarterly" | "yearly";
export type KpiAssignmentStatus = "active" | "completed" | "archived";

export interface KpiDefinition {
  id: string;
  name: string;
  description: string | null;
  unit_type: KpiUnitType;
  unit_label: string | null;
  created_by: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface KpiAssignment {
  id: string;
  kpi_definition_id: string;
  employee_id: string;
  assigned_by: string;
  period_type: KpiPeriodType;
  period_start: string;
  period_end: string;
  target_value: number;
  current_value: number;
  status: KpiAssignmentStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface KpiUpdate {
  id: string;
  kpi_assignment_id: string;
  updated_by: string;
  old_value: number;
  new_value: number;
  notes: string | null;
  created_at: string;
}

export interface KpiAssignmentWithDetails extends KpiAssignment {
  kpi_definition?: KpiDefinition;
  employee?: {
    id: string;
    full_name: string;
    preferred_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    email: string;
  };
  assigned_by_user?: {
    id: string;
    full_name: string;
    preferred_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    email: string;
  };
}

export interface KpiUpdateWithUser extends KpiUpdate {
  updated_by_user?: {
    id: string;
    full_name: string;
    preferred_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    email: string;
  };
}

export type PendingChangeType =
  | "bulk_import"
  | "field_value_upsert"
  | "field_value_delete"
  | "multi_row_insert"
  | "multi_row_update"
  | "multi_row_delete"
  | "schedule_weekly_change";

export type PendingChangeStatus = "pending" | "approved" | "rejected";

export interface PendingChange {
  id: string;
  requested_by: string;
  requested_at: string;
  change_type: PendingChangeType;
  target_employee_id: string | null;
  description: string;
  payload: Record<string, unknown>;
  status: PendingChangeStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_notes: string | null;
  applied_at: string | null;
}

interface MiniUser {
  full_name: string;
  email: string;
  preferred_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

export interface PendingChangeWithRequester extends PendingChange {
  requester?: MiniUser;
  target?: MiniUser | null;
  decider?: MiniUser | null;
}

// ─── Performance ──────────────────────────────────────────────────────────

export type ReviewQuestionRole = "self" | "manager" | "peer";

export interface ReviewQuestion {
  id: string;
  text: string;
  roles: ReviewQuestionRole[];
}

export interface ReviewFormTemplate {
  id: string;
  name: string;
  description: string | null;
  questions: ReviewQuestion[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ReviewCycleStatus = "draft" | "open" | "closed";

export interface ReviewCycle {
  id: string;
  name: string;
  template_id: string | null;
  start_date: string;
  end_date: string;
  self_due: string | null;
  manager_due: string | null;
  peer_due: string | null;
  status: ReviewCycleStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ReviewResponses = Record<
  string,
  { rating: number | null; comment: string }
>;

export type ReviewStatus =
  | "not_started"
  | "self_done"
  | "manager_done"
  | "signed_off";

export interface Review {
  id: string;
  cycle_id: string;
  employee_id: string;
  self_responses: ReviewResponses;
  manager_responses: ReviewResponses;
  self_submitted_at: string | null;
  manager_submitted_at: string | null;
  signed_off_at: string | null;
  manager_reviewer_id: string | null;
  status: ReviewStatus;
  created_at: string;
  updated_at: string;
}

export type PeerFeedbackStatus = "pending" | "completed" | "declined";

export interface PeerFeedbackRequest {
  id: string;
  review_id: string;
  requested_by: string;
  reviewer_id: string;
  status: PeerFeedbackStatus;
  response: ReviewResponses;
  anonymous: boolean;
  created_at: string;
  completed_at: string | null;
}

export interface OneOnOne {
  id: string;
  manager_id: string | null;
  employee_id: string;
  scheduled_date: string;
  agenda: string | null;
  shared_notes: string | null;
  manager_private_notes: string | null;
  employee_private_notes: string | null;
  /** Additional participant user IDs (excluding subject + manager). */
  participants: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type KudosVisibility = "public" | "private";

export interface Kudos {
  id: string;
  recipient_id: string;
  sender_id: string | null;
  message: string;
  visibility: KudosVisibility;
  created_at: string;
}

export interface KudosWithUsers extends Kudos {
  sender?: {
    full_name: string;
    preferred_name: string | null;
    first_name?: string | null;
    last_name?: string | null;
    email: string;
  } | null;
  recipient?: {
    full_name: string;
    preferred_name: string | null;
    first_name?: string | null;
    last_name?: string | null;
    email: string;
  } | null;
}
