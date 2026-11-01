import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { describeSpreadsheet, getSpreadsheetPage, isSpreadsheetFileName, SPREADSHEET_PAGE_COLUMNS, SPREADSHEET_PAGE_ROWS } from "./spreadsheet-preview";

describe("read-only XLSX preview", () => {
  it("recognizes spreadsheet originals even when a PDF preview exists", () => {
    expect(isSpreadsheetFileName("objetivos.xlsx")).toBe(true);
    expect(isSpreadsheetFileName("indicadores.XLSM")).toBe(true);
    expect(isSpreadsheetFileName("politica.pdf")).toBe(false);
  });
  const workbook = XLSX.utils.book_new();
  const first = XLSX.utils.aoa_to_sheet([["Objetivo", "Avance", null], ["Calidad", 0.25]]);
  first.B2.z = "0%";
  first["!merges"] = [XLSX.utils.decode_range("A1:C1")];
  first["!cols"] = [{ wpx: 180 }];
  first.A101 = { t: "s", v: "Fila 101" };
  first.A102 = { t: "s", v: "Última" };
  first.AB2 = { t: "s", v: "Columna AB" };
  first["!ref"] = "A1:AB102";
  XLSX.utils.book_append_sheet(workbook, first, "Indicadores");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Segunda hoja"]]), "Resumen");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const parsed = XLSX.read(bytes, { type: "array", cellStyles: true });
  const sheets = describeSpreadsheet(parsed, XLSX.utils);

  it("keeps real sheet names, row and column counts from the original workbook", () => {
    expect(sheets.map(sheet => sheet.name)).toEqual(["Indicadores", "Resumen"]);
    expect(sheets[0]).toMatchObject({ rowCount: 102, columnCount: 28 });
  });
  it("renders formatted values and merged cells as spreadsheet cells", () => {
    const page = getSpreadsheetPage(sheets[0], XLSX.utils, 0, 0);
    expect(page.columnLabels).toEqual(Array.from({ length: SPREADSHEET_PAGE_COLUMNS }, (_, index) => XLSX.utils.encode_col(index)));
    expect(page.rowNumbers).toHaveLength(SPREADSHEET_PAGE_ROWS);
    expect(page.rows[0][0]).toMatchObject({ text: "Objetivo", colSpan: 3, rowSpan: 1 });
    expect(page.rows[0][1]).toBeNull();
    expect(page.rows[1][1]).toMatchObject({ text: "25%", align: "right" });
    expect(page.columnWidths[0]).toBe(180);
  });
  it("navigates to later rows, columns, and sheets without a fixed truncation", () => {
    expect(getSpreadsheetPage(sheets[0], XLSX.utils, 100, 0).rows[0][0]?.text).toBe("Fila 101");
    const laterColumns = getSpreadsheetPage(sheets[0], XLSX.utils, 0, 26);
    expect(laterColumns.columnLabels).toEqual(["AA", "AB"]);
    expect(laterColumns.rows[1][1]?.text).toBe("Columna AB");
    expect(getSpreadsheetPage(sheets[1], XLSX.utils, 0, 0).rows[0][0]?.text).toBe("Segunda hoja");
  });
});
