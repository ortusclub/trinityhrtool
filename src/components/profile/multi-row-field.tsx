"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Plus, Save, Trash2, X, Pencil } from "lucide-react";
import type {
  ProfileField,
  ProfileFieldValueRow,
  ProfileFieldSubfield,
} from "@/types/database";

const inputClass =
  "mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

type Draft = Record<string, string>;

function emptyDraft(subfields: ProfileFieldSubfield[]): Draft {
  const d: Draft = {};
  for (const sf of subfields) d[sf.key] = "";
  return d;
}

export function MultiRowFieldEditor({
  field,
  employeeId,
  employeeLabel,
  initialRows,
  canEdit,
  submitMode = "direct",
}: {
  field: ProfileField;
  employeeId: string;
  employeeLabel?: string;
  initialRows: ProfileFieldValueRow[];
  canEdit: boolean;
  /** "queue" = writes are submitted for admin approval. */
  submitMode?: "direct" | "queue";
}) {
  const router = useRouter();
  const [rows, setRows] = useState(
    [...initialRows].sort((a, b) => a.row_index - b.row_index)
  );
  // Dated history (e.g. salary): a date sub-field keyed effective_date makes
  // the list newest-first and tags the entry in force today as Current.
  const effectiveKey = field.subfields.find(
    (sf) => sf.key === "effective_date" && sf.type === "date"
  )?.key;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const displayRows = effectiveKey
    ? [...rows].sort((a, b) =>
        (b.data[effectiveKey] ?? "").localeCompare(a.data[effectiveKey] ?? "")
      )
    : rows;
  const currentRowId = effectiveKey
    ? displayRows.find((r) => r.data[effectiveKey] && r.data[effectiveKey] <= today)?.id
    : undefined;
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft(field.subfields));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const startNew = () => {
    setDraft(emptyDraft(field.subfields));
    setEditingId("new");
    setMessage("");
  };

  const startEdit = (r: ProfileFieldValueRow) => {
    const next = emptyDraft(field.subfields);
    for (const sf of field.subfields) next[sf.key] = r.data[sf.key] ?? "";
    setDraft(next);
    setEditingId(r.id);
    setMessage("");
  };

  const cancel = () => {
    setEditingId(null);
    setMessage("");
  };

  const who = employeeLabel ?? employeeId;

  const submitPending = async (
    change_type: string,
    description: string,
    payload: Record<string, unknown>
  ): Promise<boolean> => {
    const res = await fetch("/api/admin/pending-changes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        change_type,
        target_employee_id: employeeId,
        description,
        payload,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMessage(`Submit failed: ${data.error ?? "unknown"}`);
      return false;
    }
    return true;
  };

  const save = async () => {
    setSaving(true);
    setMessage("");

    const cleanData: Record<string, string> = {};
    for (const sf of field.subfields) {
      const v = (draft[sf.key] ?? "").trim();
      if (v.length > 0) cleanData[sf.key] = v;
    }

    if (Object.keys(cleanData).length === 0) {
      setMessage("Fill in at least one field.");
      setSaving(false);
      return;
    }

    if (submitMode === "queue") {
      const isNew = editingId === "new";
      const ok = await submitPending(
        isNew ? "multi_row_insert" : "multi_row_update",
        isNew
          ? `Add "${field.label}" entry for ${who}`
          : `Update "${field.label}" entry for ${who}`,
        isNew
          ? {
              field_id: field.id,
              employee_id: employeeId,
              data: cleanData,
            }
          : {
              row_id: editingId,
              data: cleanData,
            }
      );
      if (ok) {
        setMessage("Submitted for admin approval.");
        setEditingId(null);
      }
      setSaving(false);
      return;
    }

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (editingId === "new") {
      const nextIndex = rows.length === 0 ? 0 : Math.max(...rows.map((r) => r.row_index)) + 1;
      const { data, error } = await supabase
        .from("profile_field_value_rows")
        .insert({
          field_id: field.id,
          employee_id: employeeId,
          row_index: nextIndex,
          data: cleanData,
          updated_by: user?.id,
          updated_at: new Date().toISOString(),
        })
        .select("*")
        .single();
      if (error) setMessage(`Save failed: ${error.message}`);
      else if (data) {
        setRows((prev) => [...prev, data as ProfileFieldValueRow]);
        setEditingId(null);
      }
    } else if (editingId) {
      const { data, error } = await supabase
        .from("profile_field_value_rows")
        .update({
          data: cleanData,
          updated_by: user?.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editingId)
        .select("*")
        .single();
      if (error) setMessage(`Save failed: ${error.message}`);
      else if (data) {
        setRows((prev) =>
          prev.map((r) => (r.id === editingId ? (data as ProfileFieldValueRow) : r))
        );
        setEditingId(null);
      }
    }
    setSaving(false);
    router.refresh();
  };

  const remove = async (r: ProfileFieldValueRow) => {
    if (!confirm("Delete this row?")) return;

    if (submitMode === "queue") {
      const ok = await submitPending(
        "multi_row_delete",
        `Delete "${field.label}" entry for ${who}`,
        { row_id: r.id }
      );
      if (ok) setMessage("Delete submitted for admin approval.");
      return;
    }

    const supabase = createClient();
    const { error } = await supabase
      .from("profile_field_value_rows")
      .delete()
      .eq("id", r.id);
    if (error) {
      setMessage(`Delete failed: ${error.message}`);
      return;
    }
    setRows((prev) => prev.filter((x) => x.id !== r.id));
    router.refresh();
  };

  return (
    <div className="space-y-3">
      {message && (
        <div className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
          {message}
        </div>
      )}

      {rows.length === 0 && editingId !== "new" && (
        <p className="text-sm text-gray-500">No entries yet.</p>
      )}

      {displayRows.map((r) => (
        <div
          key={r.id}
          className={
            r.id === currentRowId
              ? "rounded-lg border border-green-300 bg-green-50/60 p-3"
              : "rounded-lg border border-gray-200 bg-gray-50 p-3"
          }
        >
          {editingId === r.id ? (
            <RowForm
              subfields={field.subfields}
              draft={draft}
              setDraft={setDraft}
              saving={saving}
              onSave={save}
              onCancel={cancel}
            />
          ) : (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                {r.id === currentRowId && (
                  <span className="mb-1 inline-block rounded bg-green-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-green-800">
                    Current
                  </span>
                )}
                {effectiveKey && (r.data[effectiveKey] ?? "") > today && (
                  <span className="mb-1 inline-block rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                    Upcoming
                  </span>
                )}
                {field.subfields.map((sf) =>
                  r.data[sf.key] ? (
                    <p
                      key={sf.key}
                      className={
                        sf.type === "textarea"
                          ? "text-xs italic text-gray-600"
                          : "text-xs text-gray-700"
                      }
                    >
                      <span className="font-medium text-gray-500">{sf.label}: </span>
                      {sf.type === "url" ? (
                        <a
                          href={r.data[sf.key]}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          {r.data[sf.key]}
                        </a>
                      ) : (
                        r.data[sf.key]
                      )}
                    </p>
                  ) : null
                )}
              </div>
              {canEdit && (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => startEdit(r)}
                    className="rounded p-1 text-gray-500 hover:bg-gray-200"
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(r)}
                    className="rounded p-1 text-red-500 hover:bg-red-50"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {editingId === "new" && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3">
          <RowForm
            subfields={field.subfields}
            draft={draft}
            setDraft={setDraft}
            saving={saving}
            onSave={save}
            onCancel={cancel}
          />
        </div>
      )}

      {canEdit && editingId === null && (
        <button
          type="button"
          onClick={startNew}
          className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          <Plus size={14} /> Add entry
        </button>
      )}
    </div>
  );
}

function RowForm({
  subfields,
  draft,
  setDraft,
  saving,
  onSave,
  onCancel,
}: {
  subfields: ProfileFieldSubfield[];
  draft: Draft;
  setDraft: (d: Draft) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {subfields.map((sf) => (
          <div
            key={sf.key}
            className={sf.type === "textarea" ? "sm:col-span-2" : undefined}
          >
            <label className="block text-xs font-medium text-gray-600">
              {sf.label}
            </label>
            {sf.type === "textarea" ? (
              <textarea
                rows={2}
                value={draft[sf.key] ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, [sf.key]: e.target.value })
                }
                className={inputClass}
              />
            ) : (
              <input
                type={
                  sf.type === "date"
                    ? "date"
                    : sf.type === "number"
                      ? "number"
                      : sf.type === "url"
                        ? "url"
                        : "text"
                }
                value={draft[sf.key] ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, [sf.key]: e.target.value })
                }
                className={inputClass}
              />
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Save size={12} />
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          <X size={12} /> Cancel
        </button>
      </div>
    </div>
  );
}
