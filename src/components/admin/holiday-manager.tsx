"use client";

import { useMemo, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Upload, Download } from "lucide-react";
import type { Holiday, HolidayCountry } from "@/types/database";
import { HOLIDAY_COUNTRY_LABELS } from "@/types/database";
import { format, parseISO } from "date-fns";
import { HeaderFilter } from "@/components/shared/header-filter";
import { SortButton, type SortDir } from "@/components/shared/sort-button";

const COUNTRIES: HolidayCountry[] = ["PH", "XK", "IT", "AE", "US", "KR"];
const VALID_COUNTRIES = new Set<string>(COUNTRIES);

export function HolidayManager({ holidays }: { holidays: Holiday[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [filterCountry, setFilterCountry] = useState<Set<string>>(new Set());
  const [filterRecurring, setFilterRecurring] = useState<Set<string>>(new Set());
  type SortColumn = "date" | "name" | "country";
  const [sort, setSort] = useState<{ column: SortColumn; dir: SortDir } | null>(
    null
  );
  const toggleSort = (col: SortColumn) =>
    setSort((prev) => {
      if (!prev || prev.column !== col) return { column: col, dir: "asc" };
      if (prev.dir === "asc") return { column: col, dir: "desc" };
      return null;
    });
  const sortDir = (col: SortColumn) => (sort?.column === col ? sort.dir : null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Form state
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [country, setCountry] = useState<HolidayCountry>("PH");
  const [isRecurring, setIsRecurring] = useState(false);

  const filtered = useMemo(() => {
    const result = holidays.filter((h) => {
      if (filterCountry.size > 0 && !filterCountry.has(h.country)) return false;
      if (filterRecurring.size > 0) {
        const tag = h.is_recurring ? "recurring" : "one_off";
        if (!filterRecurring.has(tag)) return false;
      }
      return true;
    });
    if (sort) {
      const key = (h: Holiday): string => {
        switch (sort.column) {
          case "date":
            return h.date;
          case "name":
            return h.name.toLowerCase();
          case "country":
            return (HOLIDAY_COUNTRY_LABELS[h.country] ?? h.country).toLowerCase();
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
  }, [holidays, filterCountry, filterRecurring, sort]);

  const countryOptions = COUNTRIES.map((c) => ({
    value: c,
    label: HOLIDAY_COUNTRY_LABELS[c],
  }));
  const recurringOptions = [
    { value: "recurring", label: "Recurring" },
    { value: "one_off", label: "One-off" },
  ];

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((h) => selected.has(h.id));

  const toggleAll = () => {
    if (allFilteredSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        filtered.forEach((h) => next.delete(h.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        filtered.forEach((h) => next.add(h.id));
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

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase.from("holidays").insert({
      name,
      date,
      country,
      is_recurring: isRecurring,
      created_by: user?.id,
    });

    if (error) {
      setMessage(`Error: ${error.message}`);
    } else {
      setMessage("Holiday added successfully.");
      setName("");
      setDate("");
      setIsRecurring(false);
      setShowForm(false);
      router.refresh();
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this holiday?")) return;
    setDeleting(id);

    const supabase = createClient();
    const { error } = await supabase.from("holidays").delete().eq("id", id);

    if (error) {
      setMessage(`Error: ${error.message}`);
    } else {
      setMessage("Holiday deleted.");
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      router.refresh();
    }
    setDeleting(null);
  };

  const handleBulkDelete = async () => {
    const count = selected.size;
    if (count === 0) return;
    if (!confirm(`Are you sure you want to delete ${count} holiday${count > 1 ? "s" : ""}?`))
      return;

    setBulkDeleting(true);
    setMessage("");

    const supabase = createClient();
    const { error } = await supabase
      .from("holidays")
      .delete()
      .in("id", Array.from(selected));

    if (error) {
      setMessage(`Error: ${error.message}`);
    } else {
      setMessage(`${count} holiday${count > 1 ? "s" : ""} deleted.`);
      setSelected(new Set());
      router.refresh();
    }
    setBulkDeleting(false);
  };

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setMessage("");

    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());

    if (lines.length < 2) {
      setMessage("Error: CSV must have a header row and at least one data row.");
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    // Parse header to find column indexes
    const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const nameIdx = header.findIndex((h) => h === "name" || h === "holiday" || h === "holiday name");
    const dateIdx = header.findIndex((h) => h === "date");
    const countryIdx = header.findIndex((h) => h === "country" || h === "country code");
    const recurringIdx = header.findIndex((h) => h === "recurring" || h === "is_recurring");

    if (nameIdx === -1 || dateIdx === -1 || countryIdx === -1) {
      setMessage(
        "Error: CSV must have columns: name (or holiday), date, country (or country code). Optional: recurring."
      );
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const rows: {
      name: string;
      date: string;
      country: string;
      is_recurring: boolean;
      created_by: string | undefined;
    }[] = [];
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      const hName = cols[nameIdx];
      const hDate = cols[dateIdx];
      const hCountry = cols[countryIdx]?.toUpperCase();
      const hRecurring =
        recurringIdx !== -1
          ? ["true", "yes", "1"].includes(cols[recurringIdx]?.toLowerCase())
          : false;

      if (!hName || !hDate) {
        errors.push(`Row ${i + 1}: missing name or date`);
        continue;
      }

      if (!VALID_COUNTRIES.has(hCountry)) {
        errors.push(
          `Row ${i + 1}: invalid country "${hCountry}" (use ${COUNTRIES.join(", ")})`
        );
        continue;
      }

      // Validate date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(hDate)) {
        errors.push(`Row ${i + 1}: date must be YYYY-MM-DD format`);
        continue;
      }

      rows.push({
        name: hName,
        date: hDate,
        country: hCountry,
        is_recurring: hRecurring,
        created_by: user?.id,
      });
    }

    if (rows.length > 0) {
      const { error } = await supabase.from("holidays").insert(rows);
      if (error) {
        setMessage(`Error inserting holidays: ${error.message}`);
      } else {
        const msg = `${rows.length} holiday${rows.length > 1 ? "s" : ""} imported.`;
        setMessage(
          errors.length > 0
            ? `${msg} ${errors.length} row(s) skipped:\n${errors.join("; ")}`
            : msg
        );
        router.refresh();
      }
    } else {
      setMessage(`No valid rows found. ${errors.join("; ")}`);
    }

    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="space-y-4">
      {message && (
        <div
          className={`rounded-lg p-3 text-sm whitespace-pre-wrap ${message.startsWith("Error") ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}
        >
          {message}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus size={16} />
          Add Holiday
        </button>

        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
          <Upload size={16} />
          {uploading ? "Uploading..." : "Upload CSV"}
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleCsvUpload}
            disabled={uploading}
          />
        </label>

        {selected.size > 0 && (
          <button
            onClick={handleBulkDelete}
            disabled={bulkDeleting}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            <Trash2 size={16} />
            {bulkDeleting
              ? "Deleting..."
              : `Delete ${selected.size} Selected`}
          </button>
        )}
      </div>

      {/* CSV format hint */}
      <p className="text-xs text-gray-400">
        CSV format: <code className="rounded bg-gray-100 px-1">name,date,country,recurring</code>{" "}
        — date as YYYY-MM-DD, country as {COUNTRIES.join("/")}, recurring as true/false (optional).{" "}
        <button
          type="button"
          onClick={() => {
            const csv = [
              "name,date,country,recurring",
              "New Year's Day,2026-01-01,PH,true",
              "Independence Day,2026-06-12,PH,true",
              "Christmas Day,2026-12-25,PH,true",
            ].join("\n");
            const blob = new Blob([csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "holidays-template.csv";
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 underline"
        >
          <Download size={12} />
          Download template
        </button>
      </p>

      {/* Add form */}
      {showForm && (
        <form
          onSubmit={handleAdd}
          className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Holiday Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Independence Day"
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Date
              </label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Country
              </label>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value as HolidayCountry)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {HOLIDAY_COUNTRY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={isRecurring}
                  onChange={(e) => setIsRecurring(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Recurring annually
              </label>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Holiday"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Holiday list */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-600">
                <th className="px-4 py-3 font-medium">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleAll}
                    className="rounded border-gray-300"
                  />
                </th>
                <th className="px-6 py-3 font-medium">
                  <span className="align-middle">Date</span>
                  <SortButton label="Date" active={sortDir("date")} onClick={() => toggleSort("date")} />
                </th>
                <th className="px-6 py-3 font-medium">
                  <span className="align-middle">Holiday</span>
                  <SortButton label="Holiday" active={sortDir("name")} onClick={() => toggleSort("name")} />
                </th>
                <th className="px-6 py-3 font-medium">
                  <span className="align-middle">Country</span>
                  <SortButton label="Country" active={sortDir("country")} onClick={() => toggleSort("country")} />
                  <HeaderFilter label="Country" options={countryOptions} selected={filterCountry} onChange={setFilterCountry} />
                </th>
                <th className="px-6 py-3 font-medium">
                  <span className="align-middle">Recurring</span>
                  <HeaderFilter label="Recurring" options={recurringOptions} selected={filterRecurring} onChange={setFilterRecurring} align="right" />
                </th>
                <th className="px-6 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length > 0 ? (
                filtered.map((holiday) => (
                  <tr key={holiday.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(holiday.id)}
                        onChange={() => toggleOne(holiday.id)}
                        className="rounded border-gray-300"
                      />
                    </td>
                    <td className="px-6 py-3">
                      {format(parseISO(holiday.date), "MMM d, yyyy")}
                    </td>
                    <td className="px-6 py-3 font-medium text-gray-900">
                      {holiday.name}
                    </td>
                    <td className="px-6 py-3">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                        {HOLIDAY_COUNTRY_LABELS[holiday.country as HolidayCountry]}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      {holiday.is_recurring ? (
                        <span className="text-blue-600">Yes</span>
                      ) : (
                        <span className="text-gray-400">No</span>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <button
                        onClick={() => handleDelete(holiday.id)}
                        disabled={deleting === holiday.id}
                        className="rounded p-1 text-red-500 hover:bg-red-50 disabled:opacity-50"
                        title="Delete holiday"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-8 text-center text-gray-500"
                  >
                    No holidays found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
