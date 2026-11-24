"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Plus, Save, Trash2, X, Pencil, Download, GripVertical, ChevronDown } from "lucide-react";
import {
  PROFILE_FIELD_TYPE_LABELS,
  PROFILE_FIELD_VISIBILITY_LABELS,
  type ProfileField,
  type ProfileFieldSection,
  type ProfileFieldSubfield,
  type ProfileFieldSubfieldType,
  type ProfileFieldType,
  type ProfileFieldVisibility,
} from "@/types/database";
import { displayName } from "@/lib/utils";
import { AUTO_POPULATED_BUILT_IN_HINTS } from "@/lib/profile-fields";

const FIELD_TYPES: ProfileFieldType[] = [
  "text",
  "textarea",
  "date",
  "number",
  "url",
  "select",
  "multi_row",
];
const SUBFIELD_TYPES: ProfileFieldSubfieldType[] = [
  "text",
  "textarea",
  "date",
  "number",
  "url",
];
const VISIBILITIES: ProfileFieldVisibility[] = [
  "everyone",
  "manager_admin",
  "admin_only",
  "hr_only",
];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "field";
}

function uniqueKey(base: string, taken: Set<string>): string {
  let key = base;
  let n = 2;
  while (taken.has(key)) {
    key = `${base}_${n}`;
    n++;
  }
  return key;
}

const inputClass =
  "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function ProfileFieldsManager({
  initialSections,
  initialFields,
  initialValueCounts,
}: {
  initialSections: ProfileFieldSection[];
  initialFields: ProfileField[];
  initialValueCounts: Record<string, number>;
}) {
  const router = useRouter();
  const [sections, setSections] = useState(initialSections);
  const [fields, setFields] = useState(initialFields);
  const [valueCounts, setValueCounts] = useState(initialValueCounts);

  const [newSectionName, setNewSectionName] = useState("");
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingSectionName, setEditingSectionName] = useState("");

  const [addingFieldFor, setAddingFieldFor] = useState<string | null>(null);
  const [draftField, setDraftField] = useState<{
    label: string;
    field_type: ProfileFieldType;
    visibility: ProfileFieldVisibility;
    visible_to_recruiter: boolean;
    subfields: ProfileFieldSubfield[];
    options: string[];
  }>({
    label: "",
    field_type: "text",
    visibility: "manager_admin",
    visible_to_recruiter: false,
    subfields: [],
    options: [],
  });

  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const fieldsBySection = useMemo(() => {
    const m = new Map<string, ProfileField[]>();
    for (const f of fields) {
      if (!m.has(f.section_id)) m.set(f.section_id, []);
      m.get(f.section_id)!.push(f);
    }
    for (const list of m.values()) list.sort((a, b) => a.sort_order - b.sort_order);
    return m;
  }, [fields]);

  const sectionValueCount = (sectionId: string): number => {
    const fs = fieldsBySection.get(sectionId) ?? [];
    return fs.reduce((sum, f) => sum + (valueCounts[f.id] ?? 0), 0);
  };

  // ─── Sections ───

  const addSection = async () => {
    if (!newSectionName.trim()) return;
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("profile_field_sections")
      .insert({
        name: newSectionName.trim(),
        sort_order: sections.length,
      })
      .select("*")
      .single();
    setBusy(false);
    if (error) {
      setMessage(`Add failed: ${error.message}`);
      return;
    }
    if (data) {
      setSections((prev) => [...prev, data]);
      setNewSectionName("");
      router.refresh();
    }
  };

  const saveSection = async (id: string) => {
    if (!editingSectionName.trim()) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("profile_field_sections")
      .update({
        name: editingSectionName.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error) {
      setMessage(`Save failed: ${error.message}`);
      return;
    }
    if (data) {
      setSections((prev) => prev.map((s) => (s.id === id ? data : s)));
      setEditingSectionId(null);
      router.refresh();
    }
  };

  // Drag-and-drop state
  const [draggingSectionId, setDraggingSectionId] = useState<string | null>(null);
  const [draggingFieldId, setDraggingFieldId] = useState<string | null>(null);

  // Accordion state — sections start collapsed
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set()
  );
  const toggleSection = (id: string) =>
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const reorderSections = async (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const sourceIdx = sections.findIndex((s) => s.id === sourceId);
    const targetIdx = sections.findIndex((s) => s.id === targetId);
    if (sourceIdx < 0 || targetIdx < 0) return;
    const next = [...sections];
    const [moved] = next.splice(sourceIdx, 1);
    next.splice(targetIdx, 0, moved);
    const renumbered = next.map((s, i) => ({ ...s, sort_order: i * 10 }));
    setSections(renumbered);
    const supabase = createClient();
    await Promise.all(
      renumbered.map((s) =>
        supabase
          .from("profile_field_sections")
          .update({ sort_order: s.sort_order })
          .eq("id", s.id)
      )
    );
    router.refresh();
  };

  const reorderFields = async (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const source = fields.find((f) => f.id === sourceId);
    const target = fields.find((f) => f.id === targetId);
    if (!source || !target || source.section_id !== target.section_id) return;
    const sectionFields = fields
      .filter((f) => f.section_id === source.section_id)
      .sort((a, b) => a.sort_order - b.sort_order);
    const sourceIdx = sectionFields.findIndex((f) => f.id === sourceId);
    const targetIdx = sectionFields.findIndex((f) => f.id === targetId);
    if (sourceIdx < 0 || targetIdx < 0) return;
    const next = [...sectionFields];
    const [moved] = next.splice(sourceIdx, 1);
    next.splice(targetIdx, 0, moved);
    const renumbered = next.map((f, i) => ({ ...f, sort_order: i * 10 }));
    setFields((prev) =>
      prev.map(
        (f) => renumbered.find((r) => r.id === f.id) ?? f
      )
    );
    const supabase = createClient();
    await Promise.all(
      renumbered.map((f) =>
        supabase
          .from("profile_fields")
          .update({ sort_order: f.sort_order })
          .eq("id", f.id)
      )
    );
    router.refresh();
  };

  const deleteSection = async (s: ProfileFieldSection) => {
    if (s.built_in_key) {
      setMessage(
        `Cannot delete built-in section "${s.name}". You can still add custom fields under it or adjust visibility on the built-in fields.`
      );
      return;
    }
    const count = sectionValueCount(s.id);
    if (count > 0) {
      const ok = await confirmWithExport({
        message: `Data exists for ${count} value${count === 1 ? "" : "s"} in section "${s.name}". Export data before delete?`,
        onExport: () => exportSectionCsv(s),
      });
      if (!ok) return;
    } else if (
      !confirm(`Delete section "${s.name}"? This will also delete its fields.`)
    ) {
      return;
    }
    const supabase = createClient();
    const { error } = await supabase
      .from("profile_field_sections")
      .delete()
      .eq("id", s.id);
    if (error) {
      setMessage(`Delete failed: ${error.message}`);
      return;
    }
    setSections((prev) => prev.filter((x) => x.id !== s.id));
    setFields((prev) => prev.filter((f) => f.section_id !== s.id));
    router.refresh();
  };

  // ─── Fields ───

  const addField = async (sectionId: string) => {
    if (!draftField.label.trim()) return;
    if (draftField.field_type === "multi_row" && draftField.subfields.length === 0) {
      setMessage("Multi-row fields need at least one sub-field.");
      return;
    }
    if (
      draftField.field_type === "select" &&
      draftField.options.filter((o) => o.trim()).length === 0
    ) {
      setMessage("Dropdown fields need at least one option.");
      return;
    }
    const supabase = createClient();
    const existing = fieldsBySection.get(sectionId) ?? [];
    const { data, error } = await supabase
      .from("profile_fields")
      .insert({
        section_id: sectionId,
        label: draftField.label.trim(),
        field_type: draftField.field_type,
        visibility: draftField.visibility,
        visible_to_recruiter: draftField.visible_to_recruiter,
        sort_order: existing.length,
        subfields:
          draftField.field_type === "multi_row" ? draftField.subfields : [],
        options:
          draftField.field_type === "select"
            ? draftField.options.map((o) => o.trim()).filter(Boolean)
            : [],
      })
      .select("*")
      .single();
    if (error) {
      setMessage(`Add failed: ${error.message}`);
      return;
    }
    if (data) {
      setFields((prev) => [...prev, data]);
      setAddingFieldFor(null);
      setDraftField({
        label: "",
        field_type: "text",
        visibility: "manager_admin",
        visible_to_recruiter: false,
        subfields: [],
        options: [],
      });
      router.refresh();
    }
  };

  const saveField = async (id: string, patch: Partial<ProfileField>) => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("profile_fields")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    if (error) {
      setMessage(`Save failed: ${error.message}`);
      return;
    }
    if (data) {
      setFields((prev) => prev.map((f) => (f.id === id ? data : f)));
      setEditingFieldId(null);
      router.refresh();
    }
  };

  const deleteField = async (f: ProfileField) => {
    if (f.built_in_key) {
      setMessage(
        `Cannot delete built-in field "${f.label}". You can change its visibility, but the field itself is system-managed.`
      );
      return;
    }
    const count = valueCounts[f.id] ?? 0;
    if (count > 0) {
      const ok = await confirmWithExport({
        message: `Data existing for ${count} user${count === 1 ? "" : "s"} on "${f.label}", export data before delete?`,
        onExport: () => exportFieldCsv(f),
      });
      if (!ok) return;
    } else if (!confirm(`Delete field "${f.label}"?`)) {
      return;
    }
    const supabase = createClient();
    const { error } = await supabase.from("profile_fields").delete().eq("id", f.id);
    if (error) {
      setMessage(`Delete failed: ${error.message}`);
      return;
    }
    setFields((prev) => prev.filter((x) => x.id !== f.id));
    setValueCounts((prev) => {
      const next = { ...prev };
      delete next[f.id];
      return next;
    });
    router.refresh();
  };

  // ─── CSV exports for pre-delete safety ───

  const fetchValuesForFields = async (
    fieldIds: string[]
  ): Promise<
    { field_id: string; field_label: string; employee_name: string; employee_email: string; value: string }[]
  > => {
    if (fieldIds.length === 0) return [];
    const supabase = createClient();
    const { data } = await supabase
      .from("profile_field_values")
      .select(
        "field_id, value, employee:users!profile_field_values_employee_id_fkey(full_name, preferred_name, first_name, last_name, email)"
      )
      .in("field_id", fieldIds);
    return (data ?? [])
      .map((v) => {
        const empArr = Array.isArray(v.employee) ? v.employee[0] : v.employee;
        const fieldDef = fields.find((f) => f.id === v.field_id);
        return {
          field_id: v.field_id,
          field_label: fieldDef?.label ?? v.field_id,
          employee_name: empArr ? displayName(empArr) : "",
          employee_email: empArr?.email ?? "",
          value: v.value ?? "",
        };
      })
      .filter((r) => r.value.trim().length > 0);
  };

  const downloadCsv = (
    rows: { field_id: string; field_label: string; employee_name: string; employee_email: string; value: string }[],
    filename: string
  ) => {
    const headers = ["Field", "Employee", "Email", "Value"];
    const csv = [
      headers.map(csvEscape).join(","),
      ...rows.map((r) =>
        [r.field_label, r.employee_name, r.employee_email, r.value].map(csvEscape).join(",")
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportFieldCsv = async (f: ProfileField) => {
    const rows = await fetchValuesForFields([f.id]);
    if (rows.length === 0) return;
    const safeLabel = f.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const today = new Date().toISOString().slice(0, 10);
    downloadCsv(rows, `field-${safeLabel}-${today}.csv`);
  };

  const exportSectionCsv = async (s: ProfileFieldSection) => {
    const sectionFieldIds = (fieldsBySection.get(s.id) ?? []).map((f) => f.id);
    const rows = await fetchValuesForFields(sectionFieldIds);
    if (rows.length === 0) return;
    const safe = s.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const today = new Date().toISOString().slice(0, 10);
    downloadCsv(rows, `section-${safe}-${today}.csv`);
  };

  return (
    <div className="space-y-6">
      {message && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          {message}
        </div>
      )}

      {/* Add new section */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-2 text-sm font-medium text-gray-700">New section</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={newSectionName}
            onChange={(e) => setNewSectionName(e.target.value)}
            placeholder='e.g. "Equipment", "Emergency Contact"'
            className={`flex-1 ${inputClass}`}
          />
          <button
            type="button"
            onClick={addSection}
            disabled={busy || !newSectionName.trim()}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus size={14} /> Add section
          </button>
        </div>
      </div>

      {/* Sections list */}
      <div className="space-y-5">
        {sections.map((s) => {
          const sectionFields = fieldsBySection.get(s.id) ?? [];
          const total = sectionValueCount(s.id);
          const isDragging = draggingSectionId === s.id;
          return (
            <div
              key={s.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                setDraggingSectionId(s.id);
              }}
              onDragOver={(e) => {
                if (draggingSectionId && draggingSectionId !== s.id) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (draggingSectionId) {
                  reorderSections(draggingSectionId, s.id);
                  setDraggingSectionId(null);
                }
              }}
              onDragEnd={() => setDraggingSectionId(null)}
              className={`overflow-hidden rounded-xl border-2 bg-white shadow-sm transition-shadow ${
                isDragging
                  ? "border-blue-300 opacity-50"
                  : "border-gray-200 hover:shadow-md"
              }`}
            >
              {/* Section header — distinct blue-tinted band, larger type */}
              <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-blue-50/40 px-4 py-3">
                {editingSectionId === s.id ? (
                  <>
                    <input
                      type="text"
                      value={editingSectionName}
                      onChange={(e) => setEditingSectionName(e.target.value)}
                      className={`flex-1 ${inputClass}`}
                    />
                    <button
                      type="button"
                      onClick={() => saveSection(s.id)}
                      className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                    >
                      <Save size={12} /> Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingSectionId(null)}
                      className="rounded-lg border border-gray-300 p-1.5 text-gray-500 hover:bg-gray-50"
                    >
                      <X size={12} />
                    </button>
                  </>
                ) : (
                  <>
                    <GripVertical
                      size={18}
                      className="shrink-0 cursor-grab text-gray-400 active:cursor-grabbing"
                    />
                    <button
                      type="button"
                      onClick={() => toggleSection(s.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <ChevronDown
                        size={16}
                        className={`shrink-0 text-gray-500 transition-transform ${
                          expandedSections.has(s.id) ? "rotate-180" : ""
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-base font-semibold text-gray-900">
                            {s.name}
                          </p>
                          {s.built_in_key && (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                              Built-in
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500">
                          Section · {sectionFields.length} field{sectionFields.length === 1 ? "" : "s"}
                          {total > 0 ? ` · ${total} saved value${total === 1 ? "" : "s"}` : ""}
                        </p>
                      </div>
                    </button>
                    {!s.built_in_key && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingSectionId(s.id);
                          setEditingSectionName(s.name);
                        }}
                        className="rounded p-1 text-gray-500 hover:bg-gray-100"
                        title="Rename"
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    {total > 0 && (
                      <button
                        type="button"
                        onClick={() => exportSectionCsv(s)}
                        className="rounded p-1 text-gray-500 hover:bg-gray-100"
                        title={`Export all section data (${total} value${total === 1 ? "" : "s"})`}
                      >
                        <Download size={14} />
                      </button>
                    )}
                    {!s.built_in_key && (
                      <button
                        type="button"
                        onClick={() => deleteSection(s)}
                        className="rounded p-1 text-red-500 hover:bg-red-50"
                        title="Delete section"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* Fields — accordion content, indented under the section */}
              {expandedSections.has(s.id) && (
              <div className="divide-y divide-gray-100 border-l-4 border-blue-100 pl-2">
                {sectionFields.map((f) => (
                  <FieldRow
                    key={f.id}
                    field={f}
                    valueCount={valueCounts[f.id] ?? 0}
                    editing={editingFieldId === f.id}
                    dragging={draggingFieldId === f.id}
                    onStartEdit={() => setEditingFieldId(f.id)}
                    onCancelEdit={() => setEditingFieldId(null)}
                    onSave={(patch) => saveField(f.id, patch)}
                    onDelete={() => deleteField(f)}
                    onExport={() => exportFieldCsv(f)}
                    onDragStart={() => setDraggingFieldId(f.id)}
                    onDragEnd={() => setDraggingFieldId(null)}
                    onDropOnto={() => {
                      if (draggingFieldId) {
                        reorderFields(draggingFieldId, f.id);
                        setDraggingFieldId(null);
                      }
                    }}
                    canAcceptDrop={
                      draggingFieldId !== null &&
                      draggingFieldId !== f.id &&
                      fields.find((x) => x.id === draggingFieldId)?.section_id ===
                        f.section_id
                    }
                  />
                ))}

                {addingFieldFor === s.id ? (
                  <div className="space-y-2 bg-blue-50/40 p-3">
                    <input
                      type="text"
                      value={draftField.label}
                      onChange={(e) =>
                        setDraftField({ ...draftField, label: e.target.value })
                      }
                      placeholder="Field label (e.g. Equipment Model)"
                      className={`w-full ${inputClass}`}
                    />
                    <div className="flex flex-wrap gap-2">
                      <select
                        value={draftField.field_type}
                        onChange={(e) =>
                          setDraftField({
                            ...draftField,
                            field_type: e.target.value as ProfileFieldType,
                          })
                        }
                        className={inputClass}
                      >
                        {FIELD_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {PROFILE_FIELD_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                      <select
                        value={draftField.visibility}
                        onChange={(e) =>
                          setDraftField({
                            ...draftField,
                            visibility: e.target.value as ProfileFieldVisibility,
                          })
                        }
                        className={inputClass}
                      >
                        {VISIBILITIES.map((v) => (
                          <option key={v} value={v}>
                            {PROFILE_FIELD_VISIBILITY_LABELS[v]}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1.5 text-xs text-gray-600">
                        <input
                          type="checkbox"
                          checked={draftField.visible_to_recruiter}
                          onChange={(e) =>
                            setDraftField({
                              ...draftField,
                              visible_to_recruiter: e.target.checked,
                            })
                          }
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        Also visible to HR support
                      </label>
                      <button
                        type="button"
                        onClick={() => addField(s.id)}
                        disabled={!draftField.label.trim()}
                        className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        <Save size={12} /> Add field
                      </button>
                      <button
                        type="button"
                        onClick={() => setAddingFieldFor(null)}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                    </div>
                    {draftField.field_type === "multi_row" && (
                      <SubfieldsEditor
                        subfields={draftField.subfields}
                        onChange={(subfields) =>
                          setDraftField({ ...draftField, subfields })
                        }
                      />
                    )}
                    {draftField.field_type === "select" && (
                      <OptionsEditor
                        options={draftField.options}
                        onChange={(options) =>
                          setDraftField({ ...draftField, options })
                        }
                      />
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingFieldFor(s.id)}
                    className="flex w-full items-center gap-1 px-4 py-3 text-left text-sm font-medium text-blue-600 hover:bg-blue-50"
                  >
                    <Plus size={14} /> Add field
                  </button>
                )}
              </div>
              )}
            </div>
          );
        })}
        {sections.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
            No sections yet. Create one above to get started.
          </div>
        )}
      </div>
    </div>
  );
}

/** Window-prompt-based confirm with an optional "Export first" step. */
async function confirmWithExport({
  message,
  onExport,
}: {
  message: string;
  onExport: () => Promise<void> | void;
}): Promise<boolean> {
  const choice = window.prompt(
    `${message}\n\nType:\n  EXPORT — download a CSV first, then we'll ask again\n  DELETE — delete without exporting\n  (blank or anything else) — cancel`
  );
  if (!choice) return false;
  const trimmed = choice.trim().toUpperCase();
  if (trimmed === "EXPORT") {
    await onExport();
    return confirm("Export complete. Proceed with delete?");
  }
  if (trimmed === "DELETE") {
    return confirm("Are you sure? This cannot be undone.");
  }
  return false;
}

function FieldRow({
  field,
  valueCount,
  editing,
  dragging,
  onStartEdit,
  onCancelEdit,
  onSave,
  onDelete,
  onExport,
  onDragStart,
  onDragEnd,
  onDropOnto,
  canAcceptDrop,
}: {
  field: ProfileField;
  valueCount: number;
  editing: boolean;
  dragging: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (patch: Partial<ProfileField>) => void;
  onDelete: () => void;
  onExport: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropOnto: () => void;
  canAcceptDrop: boolean;
}) {
  const [label, setLabel] = useState(field.label);
  const [fieldType, setFieldType] = useState<ProfileFieldType>(field.field_type);
  const [visibility, setVisibility] = useState<ProfileFieldVisibility>(field.visibility);
  const [visibleToRecruiter, setVisibleToRecruiter] = useState(
    field.visible_to_recruiter
  );
  const [subfields, setSubfields] = useState<ProfileFieldSubfield[]>(
    field.subfields ?? []
  );
  const [options, setOptions] = useState<string[]>(field.options ?? []);
  const [adminEditOnly, setAdminEditOnly] = useState(!!field.admin_edit_only);

  const isBuiltIn = !!field.built_in_key;

  if (editing) {
    return (
      <div className="space-y-2 bg-blue-50/40 p-3">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={isBuiltIn}
          className={`w-full ${inputClass} ${isBuiltIn ? "bg-gray-50 text-gray-500" : ""}`}
        />
        {isBuiltIn && (
          <p className="text-[11px] text-gray-500">
            Label and type are fixed for built-in fields — only visibility can change.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <select
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value as ProfileFieldType)}
            disabled={isBuiltIn}
            className={`${inputClass} ${isBuiltIn ? "bg-gray-50 text-gray-500" : ""}`}
          >
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {PROFILE_FIELD_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as ProfileFieldVisibility)}
            className={inputClass}
          >
            {VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {PROFILE_FIELD_VISIBILITY_LABELS[v]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={visibleToRecruiter}
              onChange={(e) => setVisibleToRecruiter(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Also visible to HR support
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={adminEditOnly}
              onChange={(e) => setAdminEditOnly(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Only HR admins can edit
          </label>
          <button
            type="button"
            onClick={() => {
              // Sent only when changed, so saving works before the column exists.
              const lockPatch =
                adminEditOnly !== !!field.admin_edit_only
                  ? { admin_edit_only: adminEditOnly }
                  : {};
              const effectiveType = isBuiltIn ? field.field_type : fieldType;
              const subfieldsPatch =
                effectiveType === "multi_row" ? { subfields } : {};
              const optionsPatch =
                effectiveType === "select"
                  ? { options: options.map((o) => o.trim()).filter(Boolean) }
                  : {};
              if (isBuiltIn) {
                onSave({
                  visibility,
                  visible_to_recruiter: visibleToRecruiter,
                  ...lockPatch,
                  ...subfieldsPatch,
                  ...optionsPatch,
                });
              } else {
                onSave({
                  label: label.trim(),
                  field_type: fieldType,
                  visibility,
                  visible_to_recruiter: visibleToRecruiter,
                  ...lockPatch,
                  ...subfieldsPatch,
                  ...optionsPatch,
                });
              }
            }}
            disabled={
              (!isBuiltIn && !label.trim()) ||
              ((isBuiltIn ? field.field_type : fieldType) === "multi_row" &&
                subfields.length === 0) ||
              ((isBuiltIn ? field.field_type : fieldType) === "select" &&
                options.filter((o) => o.trim()).length === 0)
            }
            className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Save size={12} /> Save
          </button>
          <button
            type="button"
            onClick={onCancelEdit}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
        {(isBuiltIn ? field.field_type : fieldType) === "multi_row" && (
          <SubfieldsEditor subfields={subfields} onChange={setSubfields} />
        )}
        {(isBuiltIn ? field.field_type : fieldType) === "select" && (
          <OptionsEditor options={options} onChange={setOptions} />
        )}
      </div>
    );
  }

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        // Stop the event from bubbling up to the section's drag handler.
        e.stopPropagation();
        onDragStart();
      }}
      onDragOver={(e) => {
        if (canAcceptDrop) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(e) => {
        if (canAcceptDrop) {
          e.preventDefault();
          e.stopPropagation();
          onDropOnto();
        }
      }}
      onDragEnd={onDragEnd}
      className={`flex items-center justify-between gap-3 px-4 py-3 ${
        dragging ? "opacity-50" : ""
      }`}
    >
      <GripVertical
        size={14}
        className="shrink-0 cursor-grab text-gray-400 active:cursor-grabbing"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-gray-900">{field.label}</p>
          {isBuiltIn && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-500">
              Built-in
            </span>
          )}
          {AUTO_POPULATED_BUILT_IN_HINTS[field.built_in_key ?? ""] && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-700">
              Auto-populated
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500">
          {PROFILE_FIELD_TYPE_LABELS[field.field_type]} ·{" "}
          {PROFILE_FIELD_VISIBILITY_LABELS[field.visibility]}
          {field.visible_to_recruiter ? " · + HR support" : ""}
          {field.admin_edit_only ? " · only HR admins can edit" : ""}
          {valueCount > 0 ? ` · ${valueCount} value${valueCount === 1 ? "" : "s"} saved` : ""}
        </p>
        {AUTO_POPULATED_BUILT_IN_HINTS[field.built_in_key ?? ""] && (
          <p className="mt-0.5 text-[11px] text-amber-700">
            {AUTO_POPULATED_BUILT_IN_HINTS[field.built_in_key ?? ""]}
          </p>
        )}
        {field.field_type === "multi_row" && (field.subfields?.length ?? 0) > 0 && (
          <p className="mt-0.5 text-[11px] text-gray-400">
            Sub-fields: {field.subfields.map((s) => s.label).join(", ")}
          </p>
        )}
        {field.field_type === "select" && (field.options?.length ?? 0) > 0 && (
          <p className="mt-0.5 text-[11px] text-gray-400">
            Options: {field.options.join(" / ")}
          </p>
        )}
      </div>
      {(() => {
        const isAutoPopulated = !!AUTO_POPULATED_BUILT_IN_HINTS[field.built_in_key ?? ""];
        return (
          <button
            type="button"
            onClick={onStartEdit}
            className={`rounded p-1 ${
              isAutoPopulated
                ? "text-gray-300 hover:bg-gray-50"
                : "text-gray-500 hover:bg-gray-100"
            }`}
            title={
              isAutoPopulated
                ? "Auto-populated — only visibility can be changed"
                : isBuiltIn
                  ? "Change visibility"
                  : "Edit"
            }
          >
            <Pencil size={14} />
          </button>
        );
      })()}
      {valueCount > 0 && !isBuiltIn && (
        <button
          type="button"
          onClick={onExport}
          className="rounded p-1 text-gray-500 hover:bg-gray-100"
          title={`Export ${valueCount} saved value${valueCount === 1 ? "" : "s"}`}
        >
          <Download size={14} />
        </button>
      )}
      {!isBuiltIn && (
        <button
          type="button"
          onClick={onDelete}
          className="rounded p-1 text-red-500 hover:bg-red-50"
          title="Delete field"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

function SubfieldsEditor({
  subfields,
  onChange,
}: {
  subfields: ProfileFieldSubfield[];
  onChange: (next: ProfileFieldSubfield[]) => void;
}) {
  const addSub = () => {
    const taken = new Set(subfields.map((s) => s.key));
    const key = uniqueKey("new_field", taken);
    onChange([...subfields, { key, label: "", type: "text" }]);
  };

  const removeSub = (i: number) =>
    onChange(subfields.filter((_, idx) => idx !== i));

  const updateSub = (i: number, patch: Partial<ProfileFieldSubfield>) => {
    const next = subfields.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    // When the label changes, regenerate the key if the user hasn't typed one
    // that differs from the auto-derived slug.
    if (patch.label !== undefined) {
      const current = subfields[i];
      const wasAuto = current.key === slugify(current.label || current.key);
      if (wasAuto) {
        const taken = new Set(
          subfields.filter((_, idx) => idx !== i).map((s) => s.key)
        );
        next[i].key = uniqueKey(slugify(patch.label || "field"), taken);
      }
    }
    onChange(next);
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-2">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
        Sub-fields
      </p>
      {subfields.length === 0 && (
        <p className="mb-2 text-xs text-gray-400">
          No sub-fields yet. Add at least one (e.g. Name, Email).
        </p>
      )}
      <div className="space-y-1.5">
        {subfields.map((sf, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              value={sf.label}
              onChange={(e) => updateSub(i, { label: e.target.value })}
              placeholder="Label"
              className={`flex-1 ${inputClass} text-xs`}
            />
            <select
              value={sf.type}
              onChange={(e) =>
                updateSub(i, { type: e.target.value as ProfileFieldSubfieldType })
              }
              className={`${inputClass} text-xs`}
            >
              {SUBFIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PROFILE_FIELD_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <select
              value={sf.visibility ?? ""}
              onChange={(e) =>
                updateSub(i, {
                  visibility:
                    e.target.value === ""
                      ? undefined
                      : (e.target.value as ProfileFieldVisibility),
                })
              }
              title="Visibility — leave blank to inherit the parent field"
              className={`${inputClass} text-xs`}
            >
              <option value="">Inherit visibility</option>
              {VISIBILITIES.map((v) => (
                <option key={v} value={v}>
                  {PROFILE_FIELD_VISIBILITY_LABELS[v]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => removeSub(i)}
              className="rounded p-1 text-red-500 hover:bg-red-50"
              title="Remove sub-field"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addSub}
        className="mt-2 flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
      >
        <Plus size={12} /> Add sub-field
      </button>
    </div>
  );
}

function OptionsEditor({
  options,
  onChange,
}: {
  options: string[];
  onChange: (next: string[]) => void;
}) {
  const addOption = () => onChange([...options, ""]);
  const removeOption = (i: number) =>
    onChange(options.filter((_, idx) => idx !== i));
  const updateOption = (i: number, value: string) =>
    onChange(options.map((o, idx) => (idx === i ? value : o)));

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-2">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
        Options
      </p>
      {options.length === 0 && (
        <p className="mb-2 text-xs text-gray-400">
          No options yet. Add at least one (e.g. Single, Married).
        </p>
      )}
      <div className="space-y-1.5">
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              value={opt}
              onChange={(e) => updateOption(i, e.target.value)}
              placeholder="Option label"
              className={`flex-1 ${inputClass} text-xs`}
            />
            <button
              type="button"
              onClick={() => removeOption(i)}
              className="rounded p-1 text-red-500 hover:bg-red-50"
              title="Remove option"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addOption}
        className="mt-2 flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
      >
        <Plus size={12} /> Add option
      </button>
    </div>
  );
}
