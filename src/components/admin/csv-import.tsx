"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Download, Users } from "lucide-react";

interface ImportResult {
  usersCreated: number;
  usersUpdated: number;
  schedulesCreated: number;
  managersLinked: number;
  errors: string[];
}

const SAMPLE_CSV = `Preferred Name,Given Name(s),Middle Name,Last Name,Email,Role,Company,Employment Type,Department,Job Title,Manager Email,Country,Timezone,Desktime ID,Desktime URL,Birthday,Hire Date,Regularization Date,End Date,Active,Overtime Eligible,M,T,W,TH,F
OPTIONS:,,,,(email),(employee / manager / hr_admin / super_admin),(Ortus Strategy Pte. Ltd. / m-Club Coaching LTD. / Trinity Outsourcing Solutions Inc. / APEX Strategy),(Employee / Consultant),(free text),(free text),(email of manager),(PH / XK / IT / AE / US),(PHT / CET / GST / ET / CT / MT / MST / PT / AKT / HST),(number),(URL),(YYYY-MM-DD),(YYYY-MM-DD),(YYYY-MM-DD),(YYYY-MM-DD),(Yes / No),(Yes / No),(Office / Online - HH:MM - HH:MM / Rest),(same),(same),(same),(same)
Johnny,Juan,Dela,Cruz,juan@ortusclub.com,employee,Ortus Strategy Pte. Ltd.,Employee,Operations,Operations Analyst,maria@ortusclub.com,PH,PHT,12345,https://desktime.com/app/12345,1990-05-15,2024-01-15,2024-07-15,,Yes,Yes,Office - 09:00 - 18:00,Office - 09:00 - 18:00,Office - 09:00 - 18:00,Office - 09:00 - 18:00,Office - 09:00 - 18:00
,Maria,,Santos,maria@ortusclub.com,manager,Trinity Outsourcing Solutions Inc.,Consultant,Operations,Operations Manager,,IT,CET,,,1988-03-20,2023-06-01,2023-12-01,,Yes,No,Online - 10:00 - 19:00,Online - 10:00 - 19:00,Online - 10:00 - 19:00,Online - 10:00 - 19:00,Rest`;

function downloadSample() {
  const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "import-users-sample.csv";
  a.click();
  URL.revokeObjectURL(url);
}

async function importCsv(file: File): Promise<ImportResult> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/admin/import-csv", { method: "POST", body: formData });
  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      response.ok
        ? "Server returned an invalid response. The import may have timed out — try with fewer rows."
        : `Server error (${response.status}): ${text.slice(0, 200)}`
    );
  }

  if (!response.ok) {
    throw new Error(data.error || "Import failed");
  }

  return data as ImportResult;
}

export function CsvImport() {
  const router = useRouter();
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setError("");
    setResult(null);

    try {
      const data = await importCsv(file);
      setResult(data);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
            <Users size={20} />
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900">Import Users</h3>
            <p className="text-sm text-gray-600">
              Upload a CSV to create new users or update existing ones (matched by email).
              Schedule columns (M–F) are optional.
            </p>
            <p className="mt-1 text-xs text-gray-400">
              Columns: Preferred Name, Given Name(s), Middle Name, Last Name, Email, Role, Company, Employment Type, Department, Job Title, Manager Email, Country, Timezone, Desktime ID, Desktime URL, Birthday, Hire Date, Regularization Date, End Date, Active, Overtime Eligible, M, T, W, TH, F. Preferred Name is optional and defaults to Given Name(s). Employment Type is optional and defaults to Employee; a blank cell leaves an existing value untouched. Company must be one of: Ortus Strategy Pte. Ltd., m-Club Coaching LTD., Trinity Outsourcing Solutions Inc., APEX Strategy.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={downloadSample}
            className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 active:scale-95"
          >
            <Download size={14} />
            Sample
          </button>
          <label className={`flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm transition-all active:scale-95 ${importing ? "bg-gray-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"}`}>
            <Upload size={16} />
            {importing ? "Importing..." : "Upload CSV"}
            <input
              type="file"
              accept=".csv"
              onChange={handleImport}
              disabled={importing}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {importing && (
        <div className="mt-4 flex items-center gap-3 text-sm text-gray-600">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          Importing users...
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-4 space-y-2 rounded-lg bg-green-50 p-4">
          <p className="font-medium text-green-800">Import complete</p>
          <div className="grid grid-cols-2 gap-2 text-sm text-green-700 sm:grid-cols-4">
            <div><span className="font-bold">{result.usersCreated}</span> created</div>
            <div><span className="font-bold">{result.usersUpdated}</span> updated</div>
            <div><span className="font-bold">{result.schedulesCreated}</span> schedules</div>
            <div><span className="font-bold">{result.managersLinked}</span> managers linked</div>
          </div>
          {result.errors.length > 0 && (
            <div className="mt-2 space-y-1 text-sm text-red-600">
              <p className="font-medium">Errors:</p>
              {result.errors.map((err, i) => (
                <p key={i}>{err}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
