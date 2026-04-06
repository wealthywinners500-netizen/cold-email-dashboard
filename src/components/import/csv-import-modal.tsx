"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Upload, FileSpreadsheet, AlertCircle } from "lucide-react";
import Papa from "papaparse";
import { toast } from "sonner";

interface CsvImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ParsedRow {
  [key: string]: string;
}

const REQUIRED_FIELDS = ["source", "city", "state"] as const;
const OPTIONAL_FIELDS = [
  "total_scraped",
  "verified_count",
  "cost_per_lead",
  "status",
] as const;
const ALL_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];

export default function CsvImportModal({
  open,
  onOpenChange,
}: CsvImportModalProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const resetState = useCallback(() => {
    setFile(null);
    setParsedData([]);
    setHeaders([]);
    setColumnMap({});
    setImporting(false);
    setProgress(0);
    setError(null);
    setDragOver(false);
  }, []);

  const handleFile = useCallback(
    (f: File) => {
      if (!f.name.endsWith(".csv")) {
        setError("Please upload a .csv file");
        return;
      }
      setError(null);
      setFile(f);

      Papa.parse<ParsedRow>(f, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          if (results.errors.length > 0) {
            setError(
              `CSV parse errors: ${results.errors[0].message}`
            );
            return;
          }
          if (results.data.length === 0) {
            setError("CSV file is empty");
            return;
          }

          const csvHeaders = results.meta.fields || [];
          setHeaders(csvHeaders);
          setParsedData(results.data);

          // Auto-map columns by matching names
          const autoMap: Record<string, string> = {};
          ALL_FIELDS.forEach((field) => {
            const match = csvHeaders.find(
              (h) => h.toLowerCase().replace(/[\s_-]/g, "") === field.toLowerCase().replace(/[\s_-]/g, "")
            );
            if (match) autoMap[field] = match;
          });
          setColumnMap(autoMap);
        },
      });
    },
    []
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) handleFile(droppedFile);
    },
    [handleFile]
  );

  const handleImport = async () => {
    // Validate required mappings
    const missingFields = REQUIRED_FIELDS.filter((f) => !columnMap[f]);
    if (missingFields.length > 0) {
      setError(
        `Missing required column mappings: ${missingFields.join(", ")}`
      );
      return;
    }

    setImporting(true);
    setError(null);
    setProgress(0);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < parsedData.length; i++) {
      const row = parsedData[i];
      const mapped: Record<string, string | number> = {};

      ALL_FIELDS.forEach((field) => {
        const csvCol = columnMap[field];
        if (csvCol && row[csvCol] !== undefined && row[csvCol] !== "") {
          if (
            field === "total_scraped" ||
            field === "verified_count" ||
            field === "cost_per_lead"
          ) {
            mapped[field] = parseFloat(row[csvCol]) || 0;
          } else {
            mapped[field] = row[csvCol];
          }
        }
      });

      // Default status if not mapped
      if (!mapped.status) mapped.status = "pending";

      try {
        const response = await fetch("/api/leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mapped),
        });

        if (response.ok) {
          successCount++;
        } else {
          failCount++;
        }
      } catch {
        failCount++;
      }

      setProgress(Math.round(((i + 1) / parsedData.length) * 100));
    }

    setImporting(false);

    if (failCount === 0) {
      toast.success(`Successfully imported ${successCount} leads`);
      onOpenChange(false);
      resetState();
      router.refresh();
    } else {
      toast.error(
        `Imported ${successCount} leads, ${failCount} failed`
      );
      if (successCount > 0) router.refresh();
    }
  };

  const previewRows = parsedData.slice(0, 5);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) resetState();
        onOpenChange(v);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl bg-gray-800 rounded-lg shadow-lg z-50 p-6 max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-xl font-bold text-white">
              Import Leads from CSV
            </Dialog.Title>
            <Dialog.Close className="text-gray-400 hover:text-white">
              <X className="w-5 h-5" />
            </Dialog.Close>
          </div>

          {/* Drop Zone */}
          {!file && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
                dragOver
                  ? "border-blue-500 bg-blue-900/20"
                  : "border-gray-600 hover:border-gray-500"
              }`}
            >
              <Upload className="w-10 h-10 text-gray-400 mx-auto mb-4" />
              <p className="text-white font-medium mb-1">
                Drop your CSV file here
              </p>
              <p className="text-gray-400 text-sm">
                or click to browse
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </div>
          )}

          {/* File Selected */}
          {file && !importing && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-gray-700 rounded-lg">
                <FileSpreadsheet className="w-5 h-5 text-blue-400" />
                <div className="flex-1">
                  <p className="text-white text-sm font-medium">
                    {file.name}
                  </p>
                  <p className="text-gray-400 text-xs">
                    {parsedData.length} rows found
                  </p>
                </div>
                <button
                  onClick={resetState}
                  className="text-gray-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Column Mapping */}
              <div>
                <h3 className="text-white font-medium mb-3">
                  Map Columns
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {ALL_FIELDS.map((field) => (
                    <div key={field}>
                      <label className="text-xs text-gray-400 block mb-1">
                        {field.replace(/_/g, " ")}
                        {REQUIRED_FIELDS.includes(
                          field as (typeof REQUIRED_FIELDS)[number]
                        ) && (
                          <span className="text-red-400 ml-1">*</span>
                        )}
                      </label>
                      <select
                        value={columnMap[field] || ""}
                        onChange={(e) =>
                          setColumnMap((prev) => ({
                            ...prev,
                            [field]: e.target.value,
                          }))
                        }
                        className="w-full bg-gray-700 border border-gray-600 text-white rounded px-2 py-1.5 text-sm"
                      >
                        <option value="">— Skip —</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Preview Table */}
              {previewRows.length > 0 && (
                <div>
                  <h3 className="text-white font-medium mb-3">
                    Preview (first {previewRows.length} rows)
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-700">
                          {headers.slice(0, 6).map((h) => (
                            <th
                              key={h}
                              className="text-left py-2 px-2 text-gray-400"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, i) => (
                          <tr
                            key={i}
                            className="border-b border-gray-700/50"
                          >
                            {headers.slice(0, 6).map((h) => (
                              <td
                                key={h}
                                className="py-1.5 px-2 text-gray-300 truncate max-w-[120px]"
                              >
                                {row[h] || "—"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Progress */}
          {importing && (
            <div className="space-y-4 py-8">
              <p className="text-white text-center font-medium">
                Importing leads...
              </p>
              <div className="w-full bg-gray-700 rounded-full h-3">
                <div
                  className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-gray-400 text-center text-sm">
                {progress}% complete
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-900/20 border border-red-800 rounded text-red-200 text-sm mt-4">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Actions */}
          {file && !importing && (
            <div className="flex gap-3 pt-4 mt-4 border-t border-gray-700">
              <Dialog.Close asChild>
                <button className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors">
                  Cancel
                </button>
              </Dialog.Close>
              <button
                onClick={handleImport}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
              >
                Import {parsedData.length} Leads
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
