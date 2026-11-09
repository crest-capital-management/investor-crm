/** CSV writing and file download helpers, shared by the export route and the import/update dialogs. */

/**
 * Quotes a value for CSV and neutralises spreadsheet formulas: a cell that
 * starts with = + - @ (or a tab/return) would otherwise be run as a formula
 * when the file is opened in Excel, so it gets a leading apostrophe.
 */
export function csvCell(value: string | null | undefined): string {
  let text = value ?? "";
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Turns rows of cells into CSV text (one line per row). */
export function toCsv(rows: Array<Array<string | null | undefined>>): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

/** Saves a Blob as a file in the browser. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Saves rows as a UTF-8 CSV file in the browser. */
export function downloadCsv(rows: Array<Array<string | null | undefined>>, filename: string): void {
  downloadBlob(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" }), filename);
}
