/**
 * Parses an uploaded Excel workbook (.xlsx / .xls) into the same
 * { headers, rows } shape the CSV importer already works with, so the
 * column-mapping and validation UI can treat both formats identically.
 * Server-only: exceljs is not bundled for the client.
 */
import ExcelJS from "exceljs";

export type ParsedSpreadsheet = {
  headers: string[];
  rows: string[][];
  /** Every sheet in the workbook, in order, so the user can pick which one to use. */
  sheetNames: string[];
  /** The sheet these rows came from. */
  sheet: string;
};

export function cellValueToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";

  if (value instanceof Date) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  if (typeof value === "object") {
    const obj = value as unknown as Record<string, unknown>;
    if (Array.isArray(obj.richText)) {
      return (obj.richText as Array<{ text?: string }>)
        .map((part) => part.text ?? "")
        .join("")
        .trim();
    }
    if (typeof obj.text === "string") return obj.text.trim();
    if ("result" in obj) return cellValueToString(obj.result as ExcelJS.CellValue);
    return "";
  }

  return String(value).trim();
}

function sheetRows(worksheet: ExcelJS.Worksheet): string[][] {
  const allRows: string[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as ExcelJS.CellValue[];
    const cells: string[] = [];
    for (let col = 1; col < values.length; col += 1) {
      cells.push(cellValueToString(values[col]));
    }
    allRows.push(cells);
  });
  return allRows.filter((row) => row.some((cell) => cell.trim() !== ""));
}

/**
 * Reads one worksheet of an Excel file buffer and returns its header row plus
 * data rows, skipping fully blank rows, along with the names of all sheets.
 * Without `sheetName` it uses the first sheet that has contact rows. A sheet
 * picked by name that is empty returns no rows (so the user can pick another).
 * Throws on unreadable files or workbooks with no contact rows at all.
 */
export async function parseExcelBuffer(
  buffer: Buffer,
  sheetName?: string
): Promise<ParsedSpreadsheet> {
  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new Error(
      "The Excel file could not be read. Please make sure it's a valid .xlsx file."
    );
  }

  if (workbook.worksheets.length === 0) {
    throw new Error("The Excel file does not contain any sheets.");
  }
  const sheetNames = workbook.worksheets.map((sheet) => sheet.name);

  let name: string;
  let nonEmptyRows: string[][];
  if (sheetName !== undefined) {
    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) throw new Error(`The sheet "${sheetName}" was not found in this file.`);
    name = worksheet.name;
    nonEmptyRows = sheetRows(worksheet);
  } else {
    name = sheetNames[0];
    nonEmptyRows = sheetRows(workbook.worksheets[0]);
    if (nonEmptyRows.length < 2) {
      const firstWithData = workbook.worksheets.find((sheet) => sheetRows(sheet).length >= 2);
      if (!firstWithData) throw new Error("The Excel file does not contain any contact rows.");
      name = firstWithData.name;
      nonEmptyRows = sheetRows(firstWithData);
    }
  }

  if (nonEmptyRows.length < 2) {
    return { headers: [], rows: [], sheetNames, sheet: name };
  }

  const [headerRow, ...dataRows] = nonEmptyRows;
  const headers = headerRow.map(
    (header, index) => header || `Column ${index + 1}`
  );

  return { headers, rows: dataRows, sheetNames, sheet: name };
}
