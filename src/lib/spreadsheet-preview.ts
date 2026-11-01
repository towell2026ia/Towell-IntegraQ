import type * as XLSX from "xlsx";

export interface SpreadsheetSheet {
  name: string;
  worksheet: XLSX.WorkSheet;
  rowCount: number;
  columnCount: number;
}

export interface SpreadsheetCell {
  text: string;
  rowSpan: number;
  colSpan: number;
  align: "left" | "right";
}

export interface SpreadsheetPage {
  rowNumbers: number[];
  columnLabels: string[];
  columnWidths: number[];
  rows: Array<Array<SpreadsheetCell | null>>;
}

export const SPREADSHEET_PAGE_ROWS = 100;
export const SPREADSHEET_PAGE_COLUMNS = 26;

export function isSpreadsheetFileName(fileName: string): boolean {
  return /\.(xlsx|xlsm|xlsb|xls)$/i.test(fileName);
}

export function describeSpreadsheet(workbook: XLSX.WorkBook, utils: typeof XLSX.utils): SpreadsheetSheet[] {
  return workbook.SheetNames.map(name => {
    const worksheet = workbook.Sheets[name];
    const range = worksheet["!ref"] ? utils.decode_range(worksheet["!ref"]) : null;
    return { name, worksheet, rowCount: range ? range.e.r + 1 : 0, columnCount: range ? range.e.c + 1 : 0 };
  });
}

export function getSpreadsheetPage(
  sheet: SpreadsheetSheet,
  utils: typeof XLSX.utils,
  rowStart: number,
  columnStart: number,
): SpreadsheetPage {
  const endRow = Math.min(sheet.rowCount, rowStart + SPREADSHEET_PAGE_ROWS);
  const endColumn = Math.min(sheet.columnCount, columnStart + SPREADSHEET_PAGE_COLUMNS);
  const rowNumbers = Array.from({ length: Math.max(0, endRow - rowStart) }, (_, index) => rowStart + index + 1);
  const columnLabels = Array.from({ length: Math.max(0, endColumn - columnStart) }, (_, index) => utils.encode_col(columnStart + index));
  const columnWidths = columnLabels.map((_, index) => {
    const column = sheet.worksheet["!cols"]?.[columnStart + index];
    return Math.max(64, Math.min(400, column?.wpx ?? (column?.wch ? column.wch * 8 : 110)));
  });
  const rows: SpreadsheetPage["rows"] = rowNumbers.map((_, rowIndex) =>
    columnLabels.map((_, columnIndex) => {
      const cell = sheet.worksheet[utils.encode_cell({ r: rowStart + rowIndex, c: columnStart + columnIndex })];
      return { text: cell ? (cell.w ?? utils.format_cell(cell)) : "", rowSpan: 1, colSpan: 1, align: cell?.t === "n" || cell?.t === "d" ? "right" : "left" };
    }),
  );

  for (const merge of sheet.worksheet["!merges"] ?? []) {
    const top = Math.max(merge.s.r, rowStart);
    const left = Math.max(merge.s.c, columnStart);
    const bottom = Math.min(merge.e.r, endRow - 1);
    const right = Math.min(merge.e.c, endColumn - 1);
    if (top > bottom || left > right) continue;
    const original = sheet.worksheet[utils.encode_cell(merge.s)];
    rows[top - rowStart][left - columnStart] = {
      text: original ? (original.w ?? utils.format_cell(original)) : "",
      rowSpan: bottom - top + 1,
      colSpan: right - left + 1,
      align: original?.t === "n" || original?.t === "d" ? "right" : "left",
    };
    for (let row = top; row <= bottom; row++) {
      for (let column = left; column <= right; column++) {
        if (row !== top || column !== left) rows[row - rowStart][column - columnStart] = null;
      }
    }
  }
  return { rowNumbers, columnLabels, columnWidths, rows };
}
