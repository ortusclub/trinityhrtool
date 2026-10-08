"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil, Save, X, Calendar, Trash2, Plus, KeyRound, Palmtree, Download, UserCog } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { EmployeeLeaveTypesModal } from "./employee-leave-types";
import type { User, UserRole, HolidayCountry, Company, EmploymentType } from "@/types/database";
import { HOLIDAY_COUNTRY_LABELS, COMPANY_OPTIONS } from "@/types/database";
import { displayName } from "@/lib/utils";
import { TIMEZONE_OPTIONS, getTzLabel } from "@/lib/constants";
import { HeaderFilter } from "@/components/shared/header-filter";
import { SortButton, type SortDir } from "@/components/shared/sort-button";

type UserWithActivity = User & { last_sign_in_at: string | null };

function formatRelative(ts: string | null): string {
  if (!ts) return "Never";
  return `${formatDistanceToNow(new Date(ts))} ago`;
}

const COUNTRY_OPTIONS: HolidayCountry[] = ["PH", "XK", "IT", "AE", "US", "KR"];

export function UserManagement({
  users,
  currentUserRole,
}: {
  users: UserWithActivity[];
  currentUserRole: UserRole;
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<User>>({});
  const [search, setSearch] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);

  type SortColumn =
    | "preferred_name"
    | "email"
    | "role"
    | "company"
    | "department"
    | "job_title"
    | "country"
    | "hire_date"
    | "last_sign_in_at"
    | "last_active_at";
  const [sort, setSort] = useState<{ column: SortColumn; dir: SortDir } | null>(
    null
  );
  const toggleSort = (column: SortColumn) =>
    setSort((prev) => {
      if (!prev || prev.column !== column) return { column, dir: "asc" };
      if (prev.dir === "asc") return { column, dir: "desc" };
      return null;
    });

  const [roleFilter, setRoleFilter] = useState<Set<string>>(new Set());
  const [companyFilter, setCompanyFilter] = useState<Set<string>>(new Set());
  const [departmentFilter, setDepartmentFilter] = useState<Set<string>>(new Set());
  const [jobTitleFilter, setJobTitleFilter] = useState<Set<string>>(new Set());
  const [countryFilter, setCountryFilter] = useState<Set<string>>(new Set());
  const [activeFilter, setActiveFilter] = useState<Set<string>>(new Set());

  const departmentOptions = useMemo(() => {
    const s = new Set<string>();
    for (const u of users) if (u.department) s.add(u.department);
    return [...s].sort().map((v) => ({ value: v, label: v }));
  }, [users]);
  const jobTitleOptions = useMemo(() => {
    const s = new Set<string>();
    for (const u of users) if (u.job_title) s.add(u.job_title);
    return [...s].sort().map((v) => ({ value: v, label: v }));
  }, [users]);
  const countryOptions = useMemo(() => {
    const s = new Set<string>();
    for (const u of users) if (u.holiday_country) s.add(u.holiday_country);
    return [...s].sort().map((v) => ({
      value: v,
      label: HOLIDAY_COUNTRY_LABELS[v as HolidayCountry] ?? v,
    }));
  }, [users]);
  const roleFilterOptions = [
    { value: "employee", label: "Employee" },
    { value: "manager", label: "Manager" },
    { value: "hr_admin", label: "HR Admin" },
    { value: "super_admin", label: "Super Admin" },
  ];
  const companyFilterOptions = COMPANY_OPTIONS.map((c) => ({ value: c, label: c }));
  const activeOptions = [
    { value: "active", label: "Active" },
    { value: "inactive", label: "Inactive" },
  ];

  const filteredUsers = useMemo(() => {
    const q = search.toLowerCase();
    const result = users.filter((u) => {
      if (q) {
        const match =
          displayName(u).toLowerCase().includes(q) ||
          (u.full_name?.toLowerCase().includes(q) ?? false) ||
          (u.preferred_name?.toLowerCase().includes(q) ?? false) ||
          (u.first_name?.toLowerCase().includes(q) ?? false) ||
          (u.middle_name?.toLowerCase().includes(q) ?? false) ||
          (u.last_name?.toLowerCase().includes(q) ?? false) ||
          u.email.toLowerCase().includes(q) ||
          (u.company ?? "").toLowerCase().includes(q) ||
          (u.department ?? "").toLowerCase().includes(q) ||
          (u.job_title ?? "").toLowerCase().includes(q);
        if (!match) return false;
      }
      if (roleFilter.size > 0 && !roleFilter.has(u.role)) return false;
      if (companyFilter.size > 0 && !companyFilter.has(u.company ?? "")) return false;
      if (departmentFilter.size > 0 && !departmentFilter.has(u.department ?? "")) return false;
      if (jobTitleFilter.size > 0 && !jobTitleFilter.has(u.job_title ?? "")) return false;
      if (countryFilter.size > 0 && !countryFilter.has(u.holiday_country)) return false;
      if (activeFilter.size > 0) {
        const tag = u.is_active ? "active" : "inactive";
        if (!activeFilter.has(tag)) return false;
      }
      return true;
    });

    if (sort) {
      const key = (u: UserWithActivity): string => {
        switch (sort.column) {
          case "preferred_name":
            return (u.preferred_name ?? u.first_name ?? u.full_name ?? "").toLowerCase();
          case "email":
            return u.email.toLowerCase();
          case "role":
            return u.role;
          case "company":
            return (u.company ?? "").toLowerCase();
          case "department":
            return (u.department ?? "").toLowerCase();
          case "job_title":
            return (u.job_title ?? "").toLowerCase();
          case "country":
            return (HOLIDAY_COUNTRY_LABELS[u.holiday_country] ?? "").toLowerCase();
          case "hire_date":
            return u.hire_date ?? "";
          case "last_sign_in_at":
            return u.last_sign_in_at ?? "";
          case "last_active_at":
            return u.last_active_at ?? "";
        }
      };
      result.sort((a, b) => {
        const ka = key(a);
        const kb = key(b);
        if (ka < kb) return sort.dir === "asc" ? -1 : 1;
        if (ka > kb) return sort.dir === "asc" ? 1 : -1;
        return 0;
      });
    }
    return result;
  }, [
    users,
    search,
    roleFilter,
    companyFilter,
    departmentFilter,
    jobTitleFilter,
    countryFilter,
    activeFilter,
    sort,
  ]);

  const sortDir = (col: SortColumn) =>
    sort?.column === col ? sort.dir : null;

  const startEdit = (user: User) => {
    setEditingId(user.id);
    setEditForm({
      preferred_name: user.preferred_name,
      first_name: user.first_name,
      middle_name: user.middle_name,
      last_name: user.last_name,
      full_name: user.full_name,
      role: user.role,
      company: user.company,
      department: user.department,
      job_title: user.job_title,
      manager_id: user.manager_id,
      desktime_employee_id: user.desktime_employee_id,
      desktime_url: user.desktime_url,
      biometric_id: user.biometric_id,
      holiday_country: user.holiday_country,
      timezone: user.timezone,
      is_active: user.is_active,
      overtime_eligible: user.overtime_eligible,
      birthday: user.birthday,
      hire_date: user.hire_date,
      regularization_date: user.regularization_date,
      end_date: user.end_date,
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const supabase = createClient();

    const fullName = [editForm.first_name, editForm.middle_name, editForm.last_name]
      .filter(Boolean)
      .join(" ");

    await supabase
      .from("users")
      .update({ ...editForm, full_name: fullName })
      .eq("id", editingId);

    setEditingId(null);
    router.refresh();
  };

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [resettingPassword, setResettingPassword] = useState<string | null>(null);
  const [leaveTypesUser, setLeaveTypesUser] = useState<User | null>(null);

  const allFilteredSelected =
    filteredUsers.length > 0 && filteredUsers.every((u) => selected.has(u.id));

  const toggleAll = () => {
    if (allFilteredSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        filteredUsers.forEach((u) => next.delete(u.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        filteredUsers.forEach((u) => next.add(u.id));
        return next;
      });
    }
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteUser = async (user: User) => {
    if (!confirm(`Permanently delete ${displayName(user)}? This will remove all their data (schedules, attendance, flags, etc.) and cannot be undone.`)) {
      return;
    }
    setDeleting(user.id);
    try {
      const res = await fetch("/api/admin/delete-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to delete user");
      } else {
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(user.id);
          return next;
        });
        router.refresh();
      }
    } catch {
      alert("Failed to delete user");
    } finally {
      setDeleting(null);
    }
  };

  const bulkDeleteUsers = async () => {
    const count = selected.size;
    if (count === 0) return;
    if (!confirm(`Permanently delete ${count} user${count > 1 ? "s" : ""}? This will remove all their data and cannot be undone.`))
      return;

    setBulkDeleting(true);
    let failed = 0;
    for (const userId of selected) {
      try {
        const res = await fetch("/api/admin/delete-user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        });
        if (!res.ok) failed++;
      } catch {
        failed++;
      }
    }

    if (failed > 0) {
      alert(`${failed} user(s) could not be deleted.`);
    }
    setSelected(new Set());
    setBulkDeleting(false);
    router.refresh();
  };

  const resetPassword = async (user: User) => {
    if (!confirm(`Send a password reset email to ${displayName(user)}?`)) return;
    setResettingPassword(user.id);
    try {
      const res = await fetch("/api/admin/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to send reset email");
      } else {
        alert(`Password reset email sent to ${user.email}`);
      }
    } catch {
      alert("Failed to send reset email");
    } finally {
      setResettingPassword(null);
    }
  };

  const [downloading, setDownloading] = useState(false);

  const downloadUsers = async () => {
    setDownloading(true);
    const supabase = createClient();

    // Fetch current schedules for all users
    const today = new Date().toISOString().split("T")[0];
    const { data: schedules } = await supabase
      .from("schedules")
      .select("employee_id, day_of_week, start_time, end_time, is_rest_day, work_location")
      .lte("effective_from", today)
      .or(`effective_until.is.null,effective_until.gte.${today}`);

    // Build schedule map: userId -> dayOfWeek -> schedule string
    const scheduleMap = new Map<string, Map<number, string>>();
    for (const s of schedules ?? []) {
      if (!scheduleMap.has(s.employee_id)) scheduleMap.set(s.employee_id, new Map());
      const userMap = scheduleMap.get(s.employee_id)!;
      // Keep most recent if duplicates
      if (!userMap.has(s.day_of_week)) {
        if (s.is_rest_day) {
          userMap.set(s.day_of_week, "Rest");
        } else {
          const loc = s.work_location === "online" ? "Online" : "Office";
          userMap.set(s.day_of_week, `${loc} - ${s.start_time.slice(0, 5)} - ${s.end_time.slice(0, 5)}`);
        }
      }
    }

    const headers = [
      "Preferred Name",
      "Given Name(s)",
      "Middle Name",
      "Last Name",
      "Email",
      "Role",
      "Company",
      "Department",
      "Job Title",
      "Manager Email",
      "Country",
      "Timezone",
      "Desktime ID",
      "Desktime URL",
      "Birthday",
      "Hire Date",
      "Regularization Date",
      "End Date",
      "Active",
      "Overtime Eligible",
      "M",
      "T",
      "W",
      "TH",
      "F",
    ];
    const csvRows = [headers.join(",")];

    for (const u of users) {
      const managerEmail = users.find((m) => m.id === u.manager_id)?.email ?? "";
      const userSchedule = scheduleMap.get(u.id);
      csvRows.push(
        [
          `"${u.preferred_name ?? u.first_name ?? ""}"`,
          `"${u.first_name ?? ""}"`,
          `"${u.middle_name ?? ""}"`,
          `"${u.last_name ?? ""}"`,
          u.email,
          u.role,
          `"${u.company ?? ""}"`,
          `"${u.department ?? ""}"`,
          `"${u.job_title ?? ""}"`,
          managerEmail,
          u.holiday_country,
          getTzLabel(u.timezone || "Asia/Manila").split(" ")[0],
          u.desktime_employee_id ?? "",
          `"${u.desktime_url ?? ""}"`,
          u.birthday ?? "",
          u.hire_date ?? "",
          u.regularization_date ?? "",
          u.end_date ?? "",
          u.is_active ? "Yes" : "No",
          u.overtime_eligible ? "Yes" : "No",
          userSchedule?.get(0) ?? "",
          userSchedule?.get(1) ?? "",
          userSchedule?.get(2) ?? "",
          userSchedule?.get(3) ?? "",
          userSchedule?.get(4) ?? "",
        ].join(",")
      );
    }

    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `users-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setDownloading(false);
  };

  const roleOptions: UserRole[] =
    currentUserRole === "super_admin"
      ? ["employee", "manager", "hr_support", "hr_admin", "super_admin"]
      : ["employee", "manager", "hr_support"];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search by name, email, department, or job title..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          onClick={downloadUsers}
          disabled={downloading}
          className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 active:scale-95 disabled:opacity-50"
        >
          <Download size={16} />
          {downloading ? "Downloading..." : "Download CSV"}
        </button>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-blue-700 active:scale-95"
        >
          <Plus size={16} />
          Add User
        </button>
        {selected.size > 0 && (
          <button
            onClick={bulkDeleteUsers}
            disabled={bulkDeleting}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-red-700 active:scale-95 disabled:opacity-50"
          >
            <Trash2 size={16} />
            {bulkDeleting ? "Deleting..." : `Delete ${selected.size} Selected`}
          </button>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_rgb(229_231_235)]">
              <tr className="text-left">
                <th className="px-3 py-3 font-medium text-gray-600">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleAll}
                    className="rounded border-gray-300"
                  />
                </th>
                <th className="sticky left-0 z-20 min-w-[10rem] bg-white px-4 py-3 font-medium text-gray-600 shadow-[1px_0_0_0_rgb(229_231_235)]">
                  <span className="align-middle">Preferred Name</span>
                  <SortButton label="Preferred Name" active={sortDir("preferred_name")} onClick={() => toggleSort("preferred_name")} />
                </th>
                <th className="px-4 py-3 font-medium text-gray-600">Given Name(s)</th>
                <th className="px-4 py-3 font-medium text-gray-600">Middle Name</th>
                <th className="px-4 py-3 font-medium text-gray-600">Last Name</th>
                <th className="px-4 py-3 font-medium text-gray-600">
                  <span className="align-middle">Email</span>
                  <SortButton label="Email" active={sortDir("email")} onClick={() => toggleSort("email")} />
                </th>
                <th className="px-4 py-3 font-medium text-gray-600">
                  <span className="align-middle">Role</span>
                  <SortButton label="Role" active={sortDir("role")} onClick={() => toggleSort("role")} />
                  <HeaderFilter label="Role" options={roleFilterOptions} selected={roleFilter} onChange={setRoleFilter} />
                </th>
                <th className="px-4 py-3 font-medium text-gray-600">
                  <span className="align-middle">Company</span>
                  <SortButton label="Company" active={sortDir("company")} onClick={() => toggleSort("company")} />
                  <HeaderFilter label="Company" options={companyFilterOptions} selected={companyFilter} onChange={setCompanyFilter} />
                </th>
                <th className="px-4 py-3 font-medium text-gray-600">
                  <span className="align-middle">Department</span>
                  <SortButton label="Department" active={sortDir("department")} onClick={() => toggleSort("department")} />
                  <HeaderFilter label="Department" options={departmentOptions} selected={departmentFilter} onChange={setDepartmentFilter} />
                </th>
                <th className="px-4 py-3 font-medium text-gray-600">
                  <span className="align-middle">Job Title</span>
                  <SortButton label="Job Title" active={sortDir("job_title")} onClick={() => toggleSort("job_title")} />
                  <HeaderFilter label="Job Title" options={jobTitleOptions} selected={jobTitleFilter} onChange={setJobTitleFilter} />
                </th>
                <th className="px-4 py-3 font-medium text-gray-600">Manager</th>
                <th className="px-4 py-3 font-medium text-gray-600">
                  <span className="align-middle">Country</span>
                  <SortButton label="Country" active={sortDir("country")} onClick={() => toggleSort("country")} />
                  <HeaderFilter label="Country" options={countryOptions} selected={countryFilter} onChange={setCountryFilter} />
                </th>
                <th className="px-4 py-3 font-medium text-gray-600">Timezone</th>
                <th className="px-4 py-3 font-medium text-gray-600">DeskTime ID</th>
                <th className="px-4 py-3 font-medium text-gray-600">DeskTime URL</th>
                <th className="px-4 py-3 font-medium text-gray-600">Biometric ID</th>
                <th className="px-4 py-3 font-medium text-gray-600">Birthday</th>
                <th className="px-4 py-3 font-medium text-gray-600">
                  <span className="align-middle">Hire Date</span>
                  <SortButton label="Hire Date" active={sortDir("hire_date")} onClick={() => toggleSort("hire_date")} />
                </th>
                <th className="px-4 py-3 font-medium text-gray-600">Regularization</th>
                <th className="px-4 py-3 font-medium text-gray-600">End Date</th>
                <th className="px-4 py-3 font-medium text-gray-600">
                  <span className="align-middle">Active</span>
                  <HeaderFilter label="Active" options={activeOptions} selected={activeFilter} onChange={setActiveFilter} align="right" />
                </th>
                <th className="px-4 py-3 font-medium text-gray-600">OT Eligible</th>
                <th className="px-4 py-3 font-medium text-gray-600">
                  <span className="align-middle">Last Sign-In</span>
                  <SortButton label="Last Sign-In" active={sortDir("last_sign_in_at")} onClick={() => toggleSort("last_sign_in_at")} />
                </th>
                <th className="px-4 py-3 font-medium text-gray-600">
                  <span className="align-middle">Last Active</span>
                  <SortButton label="Last Active" active={sortDir("last_active_at")} onClick={() => toggleSort("last_active_at")} />
                </th>
                <th className="px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredUsers.map((user) => {
                const isEditing = editingId === user.id;
                return (
                  <tr key={user.id} className="bg-white hover:bg-gray-50">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(user.id)}
                        onChange={() => toggleOne(user.id)}
                        className="rounded border-gray-300"
                      />
                    </td>
                    <td className="sticky left-0 z-10 bg-inherit px-4 py-3 shadow-[1px_0_0_0_rgb(229_231_235)]">
                      {isEditing ? (
                        <input
                          value={editForm.preferred_name ?? ""}
                          onChange={(e) =>
                            setEditForm({ ...editForm, preferred_name: e.target.value })
                          }
                          className="w-full rounded border px-2 py-1 text-sm"
                        />
                      ) : (
                        user.preferred_name || user.first_name || "-"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          value={editForm.first_name ?? ""}
                          onChange={(e) =>
                            setEditForm({ ...editForm, first_name: e.target.value })
                          }
                          className="w-full rounded border px-2 py-1 text-sm"
                        />
                      ) : (
                        user.first_name || "-"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          value={editForm.middle_name ?? ""}
                          onChange={(e) =>
                            setEditForm({ ...editForm, middle_name: e.target.value })
                          }
                          className="w-full rounded border px-2 py-1 text-sm"
                        />
                      ) : (
                        user.middle_name || "-"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          value={editForm.last_name ?? ""}
                          onChange={(e) =>
                            setEditForm({ ...editForm, last_name: e.target.value })
                          }
                          className="w-full rounded border px-2 py-1 text-sm"
                        />
                      ) : (
                        user.last_name || "-"
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{user.email}</td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <select
                          value={editForm.role}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              role: e.target.value as UserRole,
                            })
                          }
                          className="rounded border px-2 py-1 text-sm"
                        >
                          {roleOptions.map((r) => (
                            <option key={r} value={r}>
                              {r.replace("_", " ")}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="capitalize">
                          {user.role.replace("_", " ")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <select
                          value={editForm.company ?? ""}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              company: (e.target.value || null) as Company | null,
                            })
                          }
                          className="rounded border px-2 py-1 text-sm"
                        >
                          <option value="">—</option>
                          {COMPANY_OPTIONS.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      ) : (
                        user.company || "-"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          value={editForm.department ?? ""}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              department: e.target.value || null,
                            })
                          }
                          className="w-full rounded border px-2 py-1 text-sm"
                        />
                      ) : (
                        user.department || "-"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          value={editForm.job_title ?? ""}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              job_title: e.target.value || null,
                            })
                          }
                          className="w-full rounded border px-2 py-1 text-sm"
                        />
                      ) : (
                        user.job_title || "-"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <select
                          value={editForm.manager_id ?? ""}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              manager_id: e.target.value || null,
                            })
                          }
                          className="rounded border px-2 py-1 text-sm"
                        >
                          <option value="">None</option>
                          {users
                            .filter((u) => u.id !== user.id)
                            .map((u) => (
                              <option key={u.id} value={u.id}>
                                {displayName(u)}
                              </option>
                            ))}
                        </select>
                      ) : (
                        (() => {
                          const mgr = users.find((u) => u.id === user.manager_id);
                          return mgr ? displayName(mgr) : "-";
                        })()
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <select
                          value={editForm.holiday_country ?? "PH"}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              holiday_country: e.target.value as HolidayCountry,
                            })
                          }
                          className="rounded border px-2 py-1 text-sm"
                        >
                          {COUNTRY_OPTIONS.map((c) => (
                            <option key={c} value={c}>
                              {HOLIDAY_COUNTRY_LABELS[c]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="inline-block rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                          {HOLIDAY_COUNTRY_LABELS[user.holiday_country] ?? user.holiday_country}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <select
                          value={editForm.timezone ?? "Asia/Manila"}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              timezone: e.target.value,
                            })
                          }
                          className="rounded border px-2 py-1 text-sm"
                        >
                          {TIMEZONE_OPTIONS.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-gray-600">
                          {getTzLabel(user.timezone || "Asia/Manila")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          type="number"
                          value={editForm.desktime_employee_id ?? ""}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              desktime_employee_id: e.target.value
                                ? parseInt(e.target.value)
                                : null,
                            })
                          }
                          className="w-20 rounded border px-2 py-1 text-sm"
                        />
                      ) : (
                        user.desktime_employee_id ?? "-"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          type="url"
                          value={editForm.desktime_url ?? ""}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              desktime_url: e.target.value || null,
                            })
                          }
                          placeholder="https://..."
                          className="w-48 rounded border px-2 py-1 text-sm"
                        />
                      ) : user.desktime_url ? (
                        <a
                          href={user.desktime_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          Open
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          type="number"
                          value={editForm.biometric_id ?? ""}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              biometric_id: e.target.value
                                ? parseInt(e.target.value)
                                : null,
                            })
                          }
                          className="w-24 rounded border px-2 py-1 text-sm"
                        />
                      ) : (
                        user.biometric_id ?? "-"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          type="date"
                          value={editForm.birthday ?? ""}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              birthday: e.target.value || null,
                            })
                          }
                          className="rounded border px-2 py-1 text-sm"
                        />
                      ) : (
                        user.birthday ?? "-"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          type="date"
                          value={editForm.hire_date ?? ""}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              hire_date: e.target.value || null,
                            })
                          }
                          className="rounded border px-2 py-1 text-sm"
                        />
                      ) : (
                        user.hire_date ?? "-"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          type="date"
                          value={editForm.regularization_date ?? ""}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              regularization_date: e.target.value || null,
                            })
                          }
                          className="rounded border px-2 py-1 text-sm"
                        />
                      ) : (
                        user.regularization_date ?? "-"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          type="date"
                          value={editForm.end_date ?? ""}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              end_date: e.target.value || null,
                            })
                          }
                          className="rounded border px-2 py-1 text-sm"
                        />
                      ) : (
                        user.end_date ?? "-"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          type="checkbox"
                          checked={editForm.is_active ?? true}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              is_active: e.target.checked,
                            })
                          }
                        />
                      ) : user.is_active ? (
                        <span className="text-green-600">Yes</span>
                      ) : (
                        <span className="text-red-600">No</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          type="checkbox"
                          checked={editForm.overtime_eligible ?? false}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              overtime_eligible: e.target.checked,
                            })
                          }
                        />
                      ) : user.overtime_eligible ? (
                        <span className="text-green-600">Yes</span>
                      ) : (
                        <span className="text-gray-400">No</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-600" title={user.last_sign_in_at ?? ""}>
                      {formatRelative(user.last_sign_in_at)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-600" title={user.last_active_at ?? ""}>
                      {formatRelative(user.last_active_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {isEditing ? (
                          <>
                            <button
                              onClick={saveEdit}
                              className="rounded p-1 text-green-600 hover:bg-green-50"
                            >
                              <Save size={16} />
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="rounded p-1 text-gray-400 hover:bg-gray-100"
                            >
                              <X size={16} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => startEdit(user)}
                              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                              title="Quick edit on this row"
                            >
                              <Pencil size={16} />
                            </button>
                            <Link
                              href={`/admin/users/${user.id}`}
                              className="rounded p-1 text-purple-500 hover:bg-purple-50 hover:text-purple-700"
                              title="Open full profile"
                            >
                              <UserCog size={16} />
                            </Link>
                            <Link
                              href={`/admin/schedules/${user.id}`}
                              className="rounded p-1 text-blue-500 hover:bg-blue-50 hover:text-blue-700"
                              title="Edit work schedule"
                            >
                              <Calendar size={16} />
                            </Link>
                            <button
                              onClick={() => setLeaveTypesUser(user)}
                              className="rounded p-1 text-green-500 hover:bg-green-50 hover:text-green-700"
                              title="Manage leave types"
                            >
                              <Palmtree size={16} />
                            </button>
                            <button
                              onClick={() => resetPassword(user)}
                              disabled={resettingPassword === user.id}
                              className="rounded p-1 text-amber-500 hover:bg-amber-50 hover:text-amber-700 disabled:opacity-50"
                              title="Send reset password email"
                            >
                              <KeyRound size={16} />
                            </button>
                            <button
                              onClick={() => deleteUser(user)}
                              disabled={deleting === user.id}
                              className="rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                              title="Delete user"
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {leaveTypesUser && (
        <EmployeeLeaveTypesModal
          user={leaveTypesUser}
          onClose={() => setLeaveTypesUser(null)}
        />
      )}

      {showAddModal && (
        <AddUserModal
          users={users}
          roleOptions={roleOptions}
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

interface DaySchedule {
  work_location: "office" | "online";
  start_time: string;
  end_time: string;
  is_rest_day: boolean;
}

const DEFAULT_DAY: DaySchedule = { work_location: "office", start_time: "09:00", end_time: "18:00", is_rest_day: false };

function AddUserModal({
  users,
  roleOptions,
  onClose,
  onSuccess,
}: {
  users: User[];
  roleOptions: UserRole[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    preferred_name: "",
    first_name: "",
    middle_name: "",
    last_name: "",
    email: "",
    role: "employee" as UserRole,
    company: "" as Company | "",
    employment_type: "employee" as EmploymentType,
    department: "",
    job_title: "",
    manager_id: "",
    desktime_employee_id: "",
    desktime_url: "",
    holiday_country: "PH" as HolidayCountry,
    timezone: "Asia/Manila",
    birthday: "",
    hire_date: "",
    regularization_date: "",
    end_date: "",
    is_active: true,
    overtime_eligible: false,
  });
  const [includeSchedule, setIncludeSchedule] = useState(false);
  const [days, setDays] = useState<DaySchedule[]>(
    WEEKDAYS.map(() => ({ ...DEFAULT_DAY }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const updateDay = (idx: number, updates: Partial<DaySchedule>) => {
    setDays((prev) => prev.map((d, i) => (i === idx ? { ...d, ...updates } : d)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    try {
      const schedule = includeSchedule
        ? [
            ...days.map((d, i) => ({
              day_of_week: i,
              start_time: d.is_rest_day ? "00:00" : d.start_time,
              end_time: d.is_rest_day ? "00:00" : d.end_time,
              is_rest_day: d.is_rest_day,
              work_location: d.work_location,
            })),
            { day_of_week: 5, start_time: "00:00", end_time: "00:00", is_rest_day: true, work_location: "office" },
            { day_of_week: 6, start_time: "00:00", end_time: "00:00", is_rest_day: true, work_location: "office" },
          ]
        : null;

      const fullName = [form.first_name, form.middle_name, form.last_name]
        .filter(Boolean)
        .join(" ");

      const res = await fetch("/api/admin/create-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          full_name: fullName,
          manager_id: form.manager_id || null,
          desktime_employee_id: form.desktime_employee_id || null,
          desktime_url: form.desktime_url || null,
          company: form.company || null,
          department: form.department || null,
          job_title: form.job_title || null,
          birthday: form.birthday || null,
          hire_date: form.hire_date || null,
          regularization_date: form.regularization_date || null,
          end_date: form.end_date || null,
          timezone: form.timezone || "Asia/Manila",
          schedule,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to create user");
        return;
      }

      onSuccess();
    } catch {
      setError("Failed to create user");
    } finally {
      setSaving(false);
    }
  };

  const inputClass = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Add New User</h3>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* User details */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Preferred Name</label>
              <input type="text" placeholder="Defaults to given name(s)" value={form.preferred_name} onChange={(e) => setForm({ ...form, preferred_name: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Given Name(s)</label>
              <input type="text" required value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Middle Name</label>
              <input type="text" value={form.middle_name} onChange={(e) => setForm({ ...form, middle_name: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Last Name</label>
              <input type="text" required value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
              <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Role</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })} className={inputClass}>
                {roleOptions.map((r) => (
                  <option key={r} value={r}>{r.replace("_", " ")}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Company</label>
              <select value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value as Company | "" })} className={inputClass}>
                <option value="">—</option>
                {COMPANY_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Employment Type</label>
              <select value={form.employment_type} onChange={(e) => setForm({ ...form, employment_type: e.target.value as EmploymentType })} className={inputClass}>
                <option value="employee">Employee</option>
                <option value="consultant">Consultant</option>
              </select>
              <p className="mt-1 text-xs text-gray-400">Consultants don&apos;t get CTO compensation for holiday work.</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Department</label>
              <input type="text" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Job Title</label>
              <input type="text" value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Manager</label>
              <select value={form.manager_id} onChange={(e) => setForm({ ...form, manager_id: e.target.value })} className={inputClass}>
                <option value="">None</option>
                {users
                  .filter((u) => u.role === "manager" || u.role === "hr_admin" || u.role === "super_admin")
                  .map((u) => (
                    <option key={u.id} value={u.id}>{displayName(u)}</option>
                  ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Country</label>
              <select value={form.holiday_country} onChange={(e) => setForm({ ...form, holiday_country: e.target.value as HolidayCountry })} className={inputClass}>
                {COUNTRY_OPTIONS.map((c) => (
                  <option key={c} value={c}>{HOLIDAY_COUNTRY_LABELS[c]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">DeskTime ID</label>
              <input type="number" value={form.desktime_employee_id} onChange={(e) => setForm({ ...form, desktime_employee_id: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">DeskTime URL</label>
              <input type="url" placeholder="https://..." value={form.desktime_url} onChange={(e) => setForm({ ...form, desktime_url: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Timezone</label>
              <select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} className={inputClass}>
                {TIMEZONE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Birthday</label>
              <input type="date" value={form.birthday} onChange={(e) => setForm({ ...form, birthday: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Hire Date</label>
              <input type="date" value={form.hire_date} onChange={(e) => setForm({ ...form, hire_date: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Regularization Date</label>
              <input type="date" value={form.regularization_date} onChange={(e) => setForm({ ...form, regularization_date: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">End Date</label>
              <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className={inputClass} />
            </div>
          </div>

          {/* Status flags */}
          <div className="flex flex-wrap gap-6 border-t border-gray-200 pt-4">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">Active</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={form.overtime_eligible}
                onChange={(e) => setForm({ ...form, overtime_eligible: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">Overtime Eligible</span>
            </label>
          </div>

          {/* Schedule toggle */}
          <div className="border-t border-gray-200 pt-4">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={includeSchedule}
                onChange={(e) => setIncludeSchedule(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">Set weekly schedule</span>
            </label>
          </div>

          {includeSchedule && (
            <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
              {WEEKDAYS.map((dayName, i) => (
                <div key={dayName} className="flex items-center gap-3">
                  <span className="w-24 text-sm font-medium text-gray-700">{dayName}</span>
                  <label className="flex items-center gap-1.5 text-xs text-gray-500">
                    <input
                      type="checkbox"
                      checked={days[i].is_rest_day}
                      onChange={(e) => updateDay(i, { is_rest_day: e.target.checked })}
                      className="h-3.5 w-3.5 rounded border-gray-300"
                    />
                    Rest
                  </label>
                  {!days[i].is_rest_day && (
                    <>
                      <select
                        value={days[i].work_location}
                        onChange={(e) => updateDay(i, { work_location: e.target.value as "office" | "online" })}
                        className="rounded border border-gray-300 px-2 py-1.5 text-xs"
                      >
                        <option value="office">Office</option>
                        <option value="online">Online</option>
                      </select>
                      <input
                        type="time"
                        value={days[i].start_time}
                        onChange={(e) => updateDay(i, { start_time: e.target.value })}
                        className="rounded border border-gray-300 px-2 py-1.5 text-xs"
                      />
                      <span className="text-xs text-gray-400">to</span>
                      <input
                        type="time"
                        value={days[i].end_time}
                        onChange={(e) => updateDay(i, { end_time: e.target.value })}
                        className="rounded border border-gray-300 px-2 py-1.5 text-xs"
                      />
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 active:scale-95"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-blue-700 active:scale-95 disabled:opacity-50"
            >
              {saving ? "Creating..." : "Create User"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
