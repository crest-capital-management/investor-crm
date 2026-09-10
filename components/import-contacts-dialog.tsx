"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { importContacts, type ImportContactRow } from "@/app/contacts/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast-provider";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { FileText, Loader2, Upload } from "lucide-react";

type ContactField = keyof ImportContactRow;
type Mapping = Record<number, ContactField | "skip">;
type CsvData = { headers: string[]; rows: string[][] };
type MappedRow = ImportContactRow & { error?: string };

const CONTACT_FIELDS: Array<{ value: ContactField; label: string; required: boolean }> = [
  { value: "name", label: "Name", required: true },
  { value: "phone", label: "Phone", required: true },
  { value: "email", label: "Email", required: false },
  { value: "tag", label: "Tag", required: false },
  { value: "dateSaved", label: "Date Saved", required: true },
];

function parseCsv(text: string): CsvData {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (inQuotes && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (character === "," && !inQuotes) {
      row.push(value.trim());
      value = "";
    } else if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value.trim());
      value = "";
      if (row.some((cell) => cell)) rows.push(row);
      row = [];
    } else {
      value += character;
    }
  }

  if (inQuotes) throw new Error("The CSV contains an unfinished quoted value.");
  row.push(value.trim());
  if (row.some((cell) => cell)) rows.push(row);
  if (rows.length < 2) throw new Error("The CSV file does not contain any contact rows.");

  return {
    headers: rows[0].map((header, index) => header || `Column ${index + 1}`),
    rows: rows.slice(1),
  };
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    date.getUTCFullYear() === Number(value.slice(0, 4)) &&
    date.getUTCMonth() + 1 === Number(value.slice(5, 7)) &&
    date.getUTCDate() === Number(value.slice(8, 10))
  );
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRow(row: ImportContactRow) {
  if (!row.name || !row.phone || !row.dateSaved) return "Name, phone, and date saved are required.";
  if (!/^\d{7,15}$/.test(row.phone)) return "Phone must contain 7-15 digits.";
  if (row.email && !EMAIL_REGEX.test(row.email)) return "Please enter a valid email address.";
  if (!isValidDate(row.dateSaved)) return "Date Saved must use YYYY-MM-DD.";
  return null;
}

function getMappedRows(csv: CsvData, mapping: Mapping): MappedRow[] {
  return csv.rows.map((cells) => {
    const row: ImportContactRow = { name: "", phone: "", email: null, tag: "", dateSaved: "" };
    Object.entries(mapping).forEach(([index, field]) => {
      if (field !== "skip") {
        const val = cells[Number(index)]?.trim() ?? "";
        if (field === "email") {
          row[field] = val || null;
        } else {
          row[field] = val;
        }
      }
    });
    return { ...row, error: validateRow(row) ?? undefined };
  });
}

export function ImportContactsDialog() {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [csv, setCsv] = useState<CsvData | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mappedRows = csv ? getMappedRows(csv, mapping) : [];
  const validRows = mappedRows.filter((row) => !row.error);
  const invalidRows = mappedRows.length - validRows.length;
  const mappedRequiredCount = CONTACT_FIELDS.filter(
    ({ value, required }) => required && Object.values(mapping).includes(value)
  ).length;
  const requiredFieldCount = CONTACT_FIELDS.filter(({ required }) => required).length;
  const canContinue =
    Boolean(csv) &&
    mappedRequiredCount === requiredFieldCount &&
    validRows.length > 0;

  function resetState() {
    setSelectedFile(null);
    setCsv(null);
    setMapping({});
    setError(null);
    setParsing(false);
    setImporting(false);
    setWorkspaceOpen(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function detectInitialMapping(headers: string[]): Mapping {
    const detected: Mapping = {};
    const usedFields = new Set<ContactField>();

    headers.forEach((rawHeader, index) => {
      const normalized = rawHeader.trim().toLowerCase().replace(/[\s_-]+/g, "");
      let matched: ContactField | null = null;

      if (normalized === "name" || normalized === "fullname" || normalized === "contactname") {
        matched = "name";
      } else if (normalized === "phone" || normalized === "phonenumber" || normalized === "mobile") {
        matched = "phone";
      } else if (normalized === "email" || normalized === "emailaddress") {
        matched = "email";
      } else if (normalized === "tag" || normalized === "tags") {
        matched = "tag";
      } else if (normalized === "datesaved" || normalized === "date" || normalized === "saveddate") {
        matched = "dateSaved";
      }

      if (matched && !usedFields.has(matched)) {
        detected[index] = matched;
        usedFields.add(matched);
      }
    });

    return detected;
  }

  async function processFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setSelectedFile(null);
      setCsv(null);
      setError("Please select a CSV file.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setSelectedFile(file);
    setCsv(null);
    setMapping({});
    setError(null);
    setParsing(true);
    try {
      const parsedCsv = parseCsv(await file.text());
      setCsv(parsedCsv);
      setMapping(detectInitialMapping(parsedCsv.headers));
      setWorkspaceOpen(true);
      setOpen(false);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "The CSV file could not be read.");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      setParsing(false);
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) await processFile(file);
  }

  function handleMappingChange(columnIndex: number, field: ContactField | "skip") {
    setMapping((current) => {
      const next = { ...current };
      Object.entries(next).forEach(([index, value]) => {
        if (value === field && Number(index) !== columnIndex) next[Number(index)] = "skip";
      });
      next[columnIndex] = field;
      return next;
    });
  }

  async function handleImport() {
    if (!canContinue) return;
    setError(null);
    setImporting(true);
    const importResult = await importContacts(JSON.stringify(validRows));
    setImporting(false);
    if ("error" in importResult) {
      toast("Failed to import contacts", "error");
      return;
    }
    toast(`${importResult.imported} contacts imported successfully`);
    router.refresh();
    resetState();
  }

  function closeWorkspace() {
    resetState();
    setOpen(false);
  }

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next && !workspaceOpen) resetState();
        }}
      >
        <SheetTrigger render={<Button variant="outline" />}>Import CSV</SheetTrigger>
        <SheetContent side="right" className="flex flex-col gap-0">
          <SheetHeader className="border-b px-6 py-5">
            <SheetTitle className="text-xl">Import Contacts</SheetTitle>
            <SheetDescription className="text-sm">Upload a CSV file to import contacts.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
            <div className="rounded-md bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Expected columns</p>
              <p className="mt-2">Name</p><p>Phone</p><p>Email (Optional)</p><p>Tag</p><p>Date Saved</p>
            </div>
            <div className="space-y-2">
              <input ref={fileInputRef} id="contacts-csv" type="file" accept=".csv" onChange={handleFileChange} className="sr-only" />
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-6 py-8 text-center transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {!selectedFile ? (
                  <>
                    <Upload className="size-8 text-muted-foreground" />
                    <span className="mt-4 rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-muted">Choose a CSV file</span>
                    <span className="mt-2 text-sm text-muted-foreground">or drag and drop your CSV here</span>
                    <span className="mt-1 text-xs text-muted-foreground">CSV files only</span>
                  </>
                ) : (
                  <>
                    <FileText className="size-8 text-muted-foreground" />
                    <span className="mt-3 text-xs text-muted-foreground">Selected file</span>
                    <span className="mt-1 max-w-full truncate text-sm font-medium">{selectedFile.name}</span>
                    <Button type="button" variant="outline" size="sm" className="mt-4" onClick={(event) => { event.stopPropagation(); fileInputRef.current?.click(); }}>Change file</Button>
                  </>
                )}
              </div>
              {parsing && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Reading CSV...</p>}
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          </div>
          <SheetFooter className="border-t bg-muted/20 px-6 py-4 sm:flex-row sm:justify-end">
            <SheetClose render={<Button variant="outline" type="button" onClick={resetState} />}>Cancel</SheetClose>
            <Button type="button" disabled>Continue</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {workspaceOpen && csv && (
        <div className="fixed inset-0 z-[60] flex min-h-screen flex-col overflow-hidden bg-background">
          <header className="flex shrink-0 items-center justify-between border-b px-8 py-5">
            <div>
              <h1 className="text-2xl font-semibold">Import Contacts</h1>
              <p className="mt-1 text-sm text-muted-foreground">Review your CSV and map columns before importing.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={closeWorkspace} disabled={importing}>Cancel</Button>
              <Button onClick={handleImport} disabled={!canContinue || importing}>{importing ? "Importing..." : `Continue (${mappedRequiredCount}/${requiredFieldCount})`}</Button>
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-auto px-8 py-6">
            <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><p className="font-medium">{selectedFile?.name}</p><p className="text-sm text-muted-foreground">Choose a destination for each CSV column.</p></div>
                  <div className="flex gap-2 text-center text-xs">
                    <div className="rounded-md bg-muted/40 px-4 py-2"><p className="font-medium">{csv.rows.length}</p><p className="text-muted-foreground">Total rows</p></div>
                    <div className="rounded-md bg-muted/40 px-4 py-2"><p className="font-medium">{validRows.length}</p><p className="text-muted-foreground">Valid rows</p></div>
                    <div className="rounded-md bg-muted/40 px-4 py-2"><p className="font-medium">{invalidRows}</p><p className="text-muted-foreground">Invalid rows</p></div>
                  </div>
                </div>
                {invalidRows > 0 && <p className="rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">{invalidRows} row{invalidRows === 1 ? "" : "s"} need attention before importing.</p>}
                <div className="overflow-x-auto rounded-lg border">
                  <table className="min-w-max border-collapse text-sm">
                    <thead className="sticky top-0 z-10 bg-muted/95 text-left"><tr className="border-b">
                      {csv.headers.map((header, columnIndex) => (
                        <th key={`${header}-${columnIndex}`} className="min-w-52 border-r px-4 py-3 align-top last:border-r-0">
                          <label className="block text-xs font-medium text-muted-foreground">{header}</label>
                          <select value={mapping[columnIndex] ?? "skip"} onChange={(event) => handleMappingChange(columnIndex, event.target.value as ContactField | "skip")} className="mt-2 h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                            <option value="skip">Skip</option>
                            {CONTACT_FIELDS.map((field) => {
                              const usedByOtherColumn = Object.entries(mapping).some(([index, value]) => Number(index) !== columnIndex && value === field.value);
                              return <option key={field.value} value={field.value} disabled={usedByOtherColumn}>{field.label}{field.required ? " *" : ""}</option>;
                            })}
                          </select>
                        </th>
                      ))}
                      <th className="min-w-64 px-4 py-3 align-top">Validation</th>
                    </tr></thead>
                    <tbody>
                      {csv.rows.slice(0, 50).map((cells, rowIndex) => {
                        const row = mappedRows[rowIndex];
                        return <tr key={rowIndex} className={`border-b last:border-b-0 ${row?.error ? "bg-destructive/5" : ""}`}>
                          {csv.headers.map((header, columnIndex) => <td key={`${header}-${columnIndex}`} title={cells[columnIndex] ?? ""} className="max-w-72 border-r px-4 py-3 align-top last:border-r-0"><span className="block max-w-72 truncate">{cells[columnIndex] || "—"}</span></td>)}
                          <td className="max-w-80 px-4 py-3 align-top"><span className={row?.error ? "text-destructive" : "text-muted-foreground"}>{row?.error ?? "Ready"}</span></td>
                        </tr>;
                      })}
                    </tbody>
                  </table>
                </div>
                {csv.rows.length > 50 && <p className="text-sm text-muted-foreground">Showing the first 50 rows. All {csv.rows.length} rows will be validated and considered for import.</p>}
            </div>
          </main>
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t bg-muted/20 px-8 py-4"><Button variant="outline" onClick={closeWorkspace} disabled={importing}>Cancel</Button><Button onClick={handleImport} disabled={!canContinue || importing}>{importing ? "Importing..." : `Continue (${mappedRequiredCount}/${requiredFieldCount})`}</Button></footer>
        </div>
      )}
    </>
  );
}
