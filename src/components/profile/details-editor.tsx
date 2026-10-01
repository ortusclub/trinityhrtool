"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format, parseISO, differenceInYears } from "date-fns";
import {
  Mail,
  Clock,
  Globe,
  Cake,
  BriefcaseBusiness,
  Building2,
  CalendarX,
  Users,
  Pencil,
  Save,
  X,
} from "lucide-react";
import {
  COMPANY_OPTIONS,
  HOLIDAY_COUNTRY_LABELS,
  type Company,
  type HolidayCountry,
} from "@/types/database";
import { TIMEZONE_OPTIONS, getTzLabel } from "@/lib/constants";

type DetailsUser = {
  id: string;
  email: string;
  timezone: string | null;
  holiday_country: string | null;
  company: string | null;
  birthday: string | null;
  hire_date: string | null;
  end_date: string | null;
};

type Props = {
  user: DetailsUser;
  managerName: string | null;
  managerId: string | null;
  canEdit: boolean;
  submitMode: "direct" | "queue";
  /** Precomputed visibility map: key → can the viewer see this field? */
  visibility: Record<string, boolean>;
  canSeeEndDate: boolean;
};

const COUNTRY_OPTIONS: HolidayCountry[] = ["PH", "XK", "IT", "AE", "US", "KR"];

export function DetailsEditor({
  user,
  managerName,
  managerId,
  canEdit,
  submitMode,
  visibility,
  canSeeEndDate,
}: Props) {
  const canSeeBuiltIn = (k: string) => visibility[k] !== false;
  void submitMode; // UI-side we just hit the API; server decides direct vs queue
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    timezone: user.timezone ?? "",
    holiday_country: user.holiday_country ?? "",
    company: user.company ?? "",
    birthday: user.birthday ?? "",
    hire_date: user.hire_date ?? "",
    end_date: user.end_date ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);

  const handleSave = async () => {
    setBusy(true);
    setError(null);

    const patch: Record<string, string | null> = {};
    for (const k of Object.keys(draft) as (keyof typeof draft)[]) {
      const newVal = draft[k] || null;
      const oldVal = (user[k as keyof DetailsUser] as string | null) ?? null;
      if (newVal !== oldVal) patch[k] = newVal;
    }
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      setBusy(false);
      return;
    }

    const res = await fetch(`/api/users/${user.id}/details`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patch }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Save failed");
      return;
    }
    if (data.queued) {
      setQueued(true);
      setEditing(false);
    } else {
      setEditing(false);
      router.refresh();
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-sm uppercase tracking-wide text-gray-500">
          Details
        </h2>
        {canEdit && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <Pencil size={12} /> Edit
          </button>
        )}
        {editing && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={busy}
              className="flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Save size={12} /> {busy ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
                setDraft({
                  timezone: user.timezone ?? "",
                  holiday_country: user.holiday_country ?? "",
                  company: user.company ?? "",
                  birthday: user.birthday ?? "",
                  hire_date: user.hire_date ?? "",
                  end_date: user.end_date ?? "",
                });
              }}
              className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <X size={12} />
            </button>
          </div>
        )}
      </div>

      {error && <p className="mb-3 text-xs text-red-600">{error}</p>}
      {queued && (
        <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Changes submitted for admin approval.
        </div>
      )}

      <div className="space-y-3">
        {canSeeBuiltIn("email") && (
          <Row icon={<Mail size={16} />} label="Email">
            <span className="text-gray-900">{user.email}</span>
          </Row>
        )}
        {canSeeBuiltIn("timezone") && (
          <Row icon={<Clock size={16} />} label="Timezone">
            {editing ? (
              <select
                value={draft.timezone}
                onChange={(e) =>
                  setDraft({ ...draft, timezone: e.target.value })
                }
                className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
              >
                <option value="">—</option>
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-gray-900">{getTzLabel(user.timezone)}</span>
            )}
          </Row>
        )}
        {canSeeBuiltIn("holiday_country") && (
          <Row icon={<Globe size={16} />} label="Country">
            {editing ? (
              <select
                value={draft.holiday_country}
                onChange={(e) =>
                  setDraft({ ...draft, holiday_country: e.target.value })
                }
                className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
              >
                <option value="">—</option>
                {COUNTRY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {HOLIDAY_COUNTRY_LABELS[c]}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-gray-900">
                {user.holiday_country
                  ? (HOLIDAY_COUNTRY_LABELS[
                      user.holiday_country as HolidayCountry
                    ] ?? user.holiday_country)
                  : "—"}
              </span>
            )}
          </Row>
        )}
        {canSeeBuiltIn("company") && (
          <Row icon={<Building2 size={16} />} label="Company">
            {editing ? (
              <select
                value={draft.company}
                onChange={(e) =>
                  setDraft({ ...draft, company: e.target.value as Company | "" })
                }
                className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
              >
                <option value="">—</option>
                {COMPANY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-gray-900">{user.company ?? "—"}</span>
            )}
          </Row>
        )}
        {canSeeBuiltIn("birthday") && (
          <Row icon={<Cake size={16} />} label="Birthday">
            {editing ? (
              <input
                type="date"
                value={draft.birthday}
                onChange={(e) =>
                  setDraft({ ...draft, birthday: e.target.value })
                }
                className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
              />
            ) : (
              <span className="text-gray-900">
                {user.birthday
                  ? format(parseISO(user.birthday), "MMMM d")
                  : "—"}
              </span>
            )}
          </Row>
        )}
        {canSeeBuiltIn("hire_date") && (
          <Row icon={<BriefcaseBusiness size={16} />} label="Joined">
            {editing ? (
              <input
                type="date"
                value={draft.hire_date}
                onChange={(e) =>
                  setDraft({ ...draft, hire_date: e.target.value })
                }
                className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
              />
            ) : (
              <span className="text-gray-900">
                {user.hire_date ? (
                  <>
                    {format(parseISO(user.hire_date), "MMM d, yyyy")}
                    {(() => {
                      const years = differenceInYears(
                        new Date(),
                        parseISO(user.hire_date!)
                      );
                      return years >= 1
                        ? ` (${years} year${years !== 1 ? "s" : ""})`
                        : "";
                    })()}
                  </>
                ) : (
                  "—"
                )}
              </span>
            )}
          </Row>
        )}
        {canSeeEndDate && canSeeBuiltIn("end_date") && (
          <Row icon={<CalendarX size={16} />} label="Last day">
            {editing ? (
              <input
                type="date"
                value={draft.end_date}
                onChange={(e) =>
                  setDraft({ ...draft, end_date: e.target.value })
                }
                className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
              />
            ) : (
              <span className="text-gray-900">
                {user.end_date
                  ? format(parseISO(user.end_date), "MMM d, yyyy")
                  : "—"}
              </span>
            )}
          </Row>
        )}
        {managerName && canSeeBuiltIn("manager_id") && (
          <Row icon={<Users size={16} />} label="Manager">
            <Link
              href={`/team/${managerId}`}
              className="font-medium text-blue-600 hover:underline"
            >
              {managerName}
            </Link>
          </Row>
        )}
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="shrink-0 text-gray-400">{icon}</span>
      <span className="w-24 shrink-0 text-xs uppercase tracking-wider text-gray-400">
        {label}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}
