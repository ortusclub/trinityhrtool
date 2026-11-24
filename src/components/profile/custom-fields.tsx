"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Pencil, Save, X } from "lucide-react";
import type {
  ProfileField,
  ProfileFieldSection,
  ProfileFieldValue,
  ProfileFieldValueRow,
} from "@/types/database";
import { MultiRowFieldEditor } from "./multi-row-field";

const inputClass =
  "block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

export function CustomFieldsSection({
  section,
  fields,
  values,
  multiRowValues,
  employeeId,
  employeeLabel,
  canEdit,
  submitMode = "direct",
  isHrAdmin = false,
}: {
  section: ProfileFieldSection;
  fields: ProfileField[];
  values: ProfileFieldValue[];
  multiRowValues: ProfileFieldValueRow[];
  employeeId: string;
  /** Human-readable name for the change description. Falls back to id. */
  employeeLabel?: string;
  canEdit: boolean;
  /** "queue" = writes are submitted for admin approval (hr_support). */
  submitMode?: "direct" | "queue";
  /** HR admins can edit fields marked admin_edit_only; nobody else can. */
  isHrAdmin?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const f of fields) {
      const v = values.find((x) => x.field_id === f.id);
      m[f.id] = v?.value ?? "";
    }
    return m;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState<number | null>(null);

  const scalarFields = fields.filter((f) => f.field_type !== "multi_row");
  const multiRowFields = fields.filter((f) => f.field_type === "multi_row");
  const visibleFields = scalarFields; // scalar fields use the grid + edit toggle
  const locked = (f: ProfileField) => !!f.admin_edit_only && !isHrAdmin;
  const editableScalars = scalarFields.filter((f) => !locked(f));
  if (fields.length === 0) return null;

  const valueFor = (fieldId: string): string | null => {
    const v = values.find((x) => x.field_id === fieldId);
    return v?.value ?? null;
  };

  const handleSave = async () => {
    setBusy(true);
    setError(null);

    // Compute changed fields
    type Change =
      | { kind: "upsert"; field: ProfileField; value: string }
      | { kind: "delete"; field: ProfileField; existingId: string };
    const changes: Change[] = [];
    for (const f of editableScalars) {
      const newValue = (draft[f.id] ?? "").trim();
      const existing = values.find((v) => v.field_id === f.id);
      const currentValue = existing?.value ?? "";
      if (newValue === currentValue) continue;
      if (newValue === "" && existing) {
        changes.push({ kind: "delete", field: f, existingId: existing.id });
      } else if (newValue !== "") {
        changes.push({ kind: "upsert", field: f, value: newValue });
      }
    }

    if (changes.length === 0) {
      setEditing(false);
      setBusy(false);
      return;
    }

    try {
      if (submitMode === "queue") {
        const who = employeeLabel ?? employeeId;
        const ops = changes.map(async (c) => {
          const body =
            c.kind === "upsert"
              ? {
                  change_type: "field_value_upsert",
                  target_employee_id: employeeId,
                  description: `Set "${c.field.label}" for ${who}`,
                  payload: {
                    field_id: c.field.id,
                    employee_id: employeeId,
                    value: c.value,
                  },
                }
              : {
                  change_type: "field_value_delete",
                  target_employee_id: employeeId,
                  description: `Clear "${c.field.label}" for ${who}`,
                  payload: {
                    field_id: c.field.id,
                    employee_id: employeeId,
                  },
                };
          const res = await fetch("/api/admin/pending-changes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error ?? "Submit failed");
          }
        });
        await Promise.all(ops);
        setQueued(changes.length);
        setEditing(false);
      } else {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const ops = changes.map(async (c) => {
          if (c.kind === "delete") {
            await supabase
              .from("profile_field_values")
              .delete()
              .eq("id", c.existingId);
          } else {
            await supabase.from("profile_field_values").upsert(
              {
                field_id: c.field.id,
                employee_id: employeeId,
                value: c.value,
                updated_by: user?.id,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "field_id,employee_id" }
            );
          }
        });
        await Promise.all(ops);
        setEditing(false);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-sm uppercase tracking-wide text-gray-500">
          {section.name}
        </h2>
        {canEdit && !editing && editableScalars.length > 0 && (
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
              }}
              className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <X size={12} />
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="mb-3 text-xs text-red-600">{error}</p>
      )}

      {queued !== null && (
        <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {queued} change{queued === 1 ? "" : "s"} submitted for admin approval.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {visibleFields.map((f) => (
          <div
            key={f.id}
            className={f.field_type === "textarea" ? "sm:col-span-2" : undefined}
          >
            <label className="block text-xs font-medium text-gray-500">
              {f.label}
            </label>
            {editing && !locked(f) ? (
              f.field_type === "textarea" ? (
                <textarea
                  rows={3}
                  value={draft[f.id] ?? ""}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, [f.id]: e.target.value }))
                  }
                  className={`mt-1 ${inputClass}`}
                />
              ) : f.field_type === "select" ? (
                <select
                  value={draft[f.id] ?? ""}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, [f.id]: e.target.value }))
                  }
                  className={`mt-1 ${inputClass}`}
                >
                  <option value="">—</option>
                  {(f.options ?? []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                  {/* If the stored value isn't in the current options list
                      (e.g. legacy free-text value), keep it selectable so it
                      doesn't silently get wiped on save. */}
                  {draft[f.id] &&
                    !(f.options ?? []).includes(draft[f.id]) && (
                      <option value={draft[f.id]}>
                        {draft[f.id]} (legacy)
                      </option>
                    )}
                </select>
              ) : (
                <input
                  type={
                    f.field_type === "date"
                      ? "date"
                      : f.field_type === "number"
                        ? "number"
                        : f.field_type === "url"
                          ? "url"
                          : "text"
                  }
                  value={draft[f.id] ?? ""}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, [f.id]: e.target.value }))
                  }
                  className={`mt-1 ${inputClass}`}
                />
              )
            ) : (
              <p className="mt-1 text-sm text-gray-900">
                {valueFor(f.id) ? (
                  f.field_type === "url" ? (
                    <a
                      href={valueFor(f.id) ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {valueFor(f.id)}
                    </a>
                  ) : (
                    valueFor(f.id)
                  )
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Multi-row fields render with their own add/edit/delete UI per row. */}
      {multiRowFields.map((f) => (
        <div key={f.id} className="mt-6">
          <p className="mb-2 text-xs font-medium text-gray-500">{f.label}</p>
          <MultiRowFieldEditor
            field={f}
            employeeId={employeeId}
            employeeLabel={employeeLabel}
            initialRows={multiRowValues.filter((v) => v.field_id === f.id)}
            canEdit={canEdit && !locked(f)}
            submitMode={submitMode}
          />
        </div>
      ))}
    </div>
  );
}
