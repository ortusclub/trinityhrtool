"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Save, Calendar, Clock } from "lucide-react";
import {
  COMPANY_OPTIONS,
  HOLIDAY_COUNTRY_LABELS,
  type Company,
  type EmploymentType,
  type HolidayCountry,
  type User,
  type UserRole,
} from "@/types/database";
import { displayName } from "@/lib/utils";
import { TIMEZONE_OPTIONS } from "@/lib/constants";
import { AvatarUpload } from "@/components/shared/avatar-upload";

const ROLE_OPTIONS: UserRole[] = ["employee", "manager", "hr_support", "hr_admin", "super_admin"];

const COUNTRY_OPTIONS = Object.keys(HOLIDAY_COUNTRY_LABELS) as HolidayCountry[];

const labelClass = "block text-sm font-medium text-gray-700";
const inputClass =
  "mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

export function UserProfileForm({
  user,
  managers,
}: {
  user: User;
  managers: User[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<User>(user);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const update = <K extends keyof User>(key: K, value: User[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    const supabase = createClient();

    const fullName = [form.first_name, form.middle_name, form.last_name]
      .filter(Boolean)
      .join(" ");

    const updateFields = {
      preferred_name: form.preferred_name || form.first_name || null,
      first_name: form.first_name || null,
      middle_name: form.middle_name || null,
      last_name: form.last_name || null,
      full_name: fullName || form.full_name,
      role: form.role,
      manager_id: form.manager_id || null,
      company: form.company || null,
      department: form.department || null,
      job_title: form.job_title || null,
      holiday_country: form.holiday_country,
      timezone: form.timezone || "Asia/Manila",
      desktime_employee_id: form.desktime_employee_id,
      desktime_url: form.desktime_url || null,
      birthday: form.birthday || null,
      hire_date: form.hire_date || null,
      regularization_date: form.regularization_date || null,
      end_date: form.end_date || null,
      is_active: form.is_active,
      overtime_eligible: form.overtime_eligible,
      employment_type: form.employment_type,
    };

    const { error } = await supabase
      .from("users")
      .update(updateFields)
      .eq("id", user.id);

    if (error) {
      setMessage(`Save failed: ${error.message}`);
      setSaving(false);
      return;
    }

    setMessage("Saved.");
    setSaving(false);
    router.refresh();
  };

  return (
    <div className="space-y-6">
      {message && (
        <div
          className={`rounded-lg p-3 text-sm ${
            message.startsWith("Save failed")
              ? "bg-red-50 text-red-700"
              : "bg-green-50 text-green-700"
          }`}
        >
          {message}
        </div>
      )}

      {/* Avatar + quick actions */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex items-center gap-4">
          <AvatarUpload
            userId={user.id}
            currentAvatarUrl={user.avatar_url}
            userName={displayName(user)}
          />
          <div>
            <p className="text-lg font-semibold text-gray-900">
              {displayName(user)}
            </p>
            <p className="text-sm text-gray-600">{user.email}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/admin/schedules/${user.id}`}
            className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Calendar size={14} /> Schedule
          </Link>
          <Link
            href={`/team/${user.id}`}
            className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Clock size={14} /> Public Profile
          </Link>
        </div>
      </div>

      <Section title="Name & Identity">
        <Field label="Preferred Name">
          <input
            type="text"
            value={form.preferred_name ?? ""}
            placeholder="Defaults to given name(s)"
            onChange={(e) => update("preferred_name", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Given Name(s)">
          <input
            type="text"
            value={form.first_name ?? ""}
            onChange={(e) => update("first_name", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Middle Name">
          <input
            type="text"
            value={form.middle_name ?? ""}
            onChange={(e) => update("middle_name", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Last Name">
          <input
            type="text"
            value={form.last_name ?? ""}
            onChange={(e) => update("last_name", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Email" full>
          <input
            type="email"
            value={form.email}
            disabled
            className={`${inputClass} bg-gray-50 text-gray-500`}
          />
          <p className="mt-1 text-xs text-gray-400">
            Email is the user&apos;s login and can&apos;t be changed here.
          </p>
        </Field>
      </Section>

      <Section title="Role & Reporting">
        <Field label="Role">
          <select
            value={form.role}
            onChange={(e) => update("role", e.target.value as UserRole)}
            className={inputClass}
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r.replace("_", " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Manager">
          <select
            value={form.manager_id ?? ""}
            onChange={(e) => update("manager_id", e.target.value || null)}
            className={inputClass}
          >
            <option value="">None</option>
            {managers
              .filter((m) => m.id !== user.id)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {displayName(m)} ({m.email})
                </option>
              ))}
          </select>
        </Field>
        <Field label="Company">
          <select
            value={form.company ?? ""}
            onChange={(e) =>
              update("company", (e.target.value || null) as Company | null)
            }
            className={inputClass}
          >
            <option value="">—</option>
            {COMPANY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Employment Type">
          <select
            value={form.employment_type}
            onChange={(e) =>
              update("employment_type", e.target.value as EmploymentType)
            }
            className={inputClass}
          >
            <option value="employee">Employee</option>
            <option value="consultant">Consultant</option>
          </select>
          <p className="mt-1 text-xs text-gray-400">
            Consultants get CTO for holiday work — holiday pay is for PH employees only.
          </p>
        </Field>
        <Field label="Department">
          <input
            type="text"
            value={form.department ?? ""}
            onChange={(e) => update("department", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Job Title">
          <input
            type="text"
            value={form.job_title ?? ""}
            onChange={(e) => update("job_title", e.target.value)}
            className={inputClass}
          />
        </Field>
      </Section>

      <Section title="Location & Timezone">
        <Field label="Country (for holidays)">
          <select
            value={form.holiday_country}
            onChange={(e) =>
              update("holiday_country", e.target.value as HolidayCountry)
            }
            className={inputClass}
          >
            {COUNTRY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {HOLIDAY_COUNTRY_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Timezone">
          <select
            value={form.timezone || "Asia/Manila"}
            onChange={(e) => update("timezone", e.target.value)}
            className={inputClass}
          >
            {TIMEZONE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Key Dates">
        <Field label="Birthday">
          <input
            type="date"
            value={form.birthday ?? ""}
            onChange={(e) => update("birthday", e.target.value || null)}
            className={inputClass}
          />
        </Field>
        <Field label="Hire Date">
          <input
            type="date"
            value={form.hire_date ?? ""}
            onChange={(e) => update("hire_date", e.target.value || null)}
            className={inputClass}
          />
        </Field>
        <Field label="Regularization Date">
          <input
            type="date"
            value={form.regularization_date ?? ""}
            onChange={(e) =>
              update("regularization_date", e.target.value || null)
            }
            className={inputClass}
          />
          <p className="mt-1 text-xs text-gray-400">
            Set this when an employee becomes regular (post-probation).
          </p>
        </Field>
        <Field label="End Date">
          <input
            type="date"
            value={form.end_date ?? ""}
            onChange={(e) => update("end_date", e.target.value || null)}
            className={inputClass}
          />
        </Field>
      </Section>

      <Section title="DeskTime">
        <Field label="DeskTime Employee ID">
          <input
            type="number"
            value={form.desktime_employee_id ?? ""}
            onChange={(e) =>
              update(
                "desktime_employee_id",
                e.target.value ? parseInt(e.target.value, 10) : null
              )
            }
            className={inputClass}
          />
        </Field>
        <Field label="DeskTime URL">
          <input
            type="url"
            value={form.desktime_url ?? ""}
            onChange={(e) => update("desktime_url", e.target.value)}
            placeholder="https://desktime.com/app/..."
            className={inputClass}
          />
        </Field>
      </Section>

      <Section title="Status & Permissions">
        <Field label="Active">
          <label className="mt-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => update("is_active", e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">
              Account is active (can log in)
            </span>
          </label>
        </Field>
        <Field label="Overtime Eligible">
          <label className="mt-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.overtime_eligible}
              onChange={(e) => update("overtime_eligible", e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">
              May submit overtime requests
            </span>
          </label>
        </Field>
      </Section>

      <div className="sticky bottom-4 flex items-center justify-end gap-3 rounded-xl border border-gray-200 bg-white/95 p-4 shadow-md backdrop-blur">
        <Link
          href="/admin/users"
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </Link>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Save size={14} />
          {saving ? "Saving..." : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <h2 className="mb-4 font-display text-[20px] text-gray-900">{title}</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  children,
  full = false,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <label className={labelClass}>{label}</label>
      {children}
    </div>
  );
}
