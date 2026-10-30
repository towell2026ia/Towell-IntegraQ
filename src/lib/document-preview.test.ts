import { describe, expect, it, vi } from "vitest";
import { isPreviewImage, loadPreviewBytes, officeXml, previewIsPdf, previewScale, sheetWindow, wordPageSize } from "./document-preview";
import * as XLSX from "xlsx";

describe("private preview loading", () => {
  it("recognizes a converted PDF independently of the original Word extension", () => {
    expect(previewIsPdf(new TextEncoder().encode("%PDF-1.7").buffer)).toBe(true);
    expect(previewIsPdf(new TextEncoder().encode("PKword").buffer)).toBe(false);
  });
  it("falls back to an authorized original when the converted object is unavailable", async () => {
    const resolve = vi.fn(async (target: string) => "/" + target);
    const request = vi.fn().mockResolvedValueOnce(new Response("", { status: 404 })).mockResolvedValueOnce(new Response("original"));
    const result = await loadPreviewBytes(true, resolve, request);
    expect(result.target).toBe("original");
    expect(new TextDecoder().decode(result.bytes)).toBe("original");
    expect(resolve.mock.calls).toEqual([["preview"], ["original"]]);
    expect(request).toHaveBeenLastCalledWith("/original", { cache: "no-store" });
  });
  it("does not bypass denied access or invent an attachment", async () => {
    const request = vi.fn();
    await expect(loadPreviewBytes(true, async () => null, request)).rejects.toThrow("permisos");
    expect(request).not.toHaveBeenCalled();
  });
  it("requests only the original when conversion has not completed", async () => {
    const resolve = vi.fn(async () => "/original");
    await loadPreviewBytes(false, resolve, vi.fn().mockResolvedValue(new Response("image")));
    expect(resolve.mock.calls).toEqual([["original"]]);
  });
});
describe("orientation, fit and complete worksheet navigation", () => {
  it.each([[1200, 800], [800, 1200]])("fits a %sx%s page inside the viewport", (width, height) => {
    const scale = previewScale(width, height, 700, 500, "page");
    expect(width * scale).toBeLessThanOrEqual(700);
    expect(height * scale).toBeLessThanOrEqual(500);
    expect(previewScale(width, height, 700, 500, "width")).toBeCloseTo(700 / width);
  });
  it("honors Word page dimensions in either orientation", () => {
    expect(wordPageSize('<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>')).toEqual({ width: 1056, minHeight: 816 });
    expect(wordPageSize('<w:pgSz w:w="12240" w:h="15840"/>')).toEqual({ width: 816, minHeight: 1056 });
    expect(wordPageSize("<w:document/>")).toBeUndefined();
  });
  it("reads bounded OOXML page metadata from an in-memory ZIP", async () => {
    const name = new TextEncoder().encode("word/document.xml"), data = new TextEncoder().encode('<w:pgSz w:w="15840" w:h="12240"/>');
    const central = 30 + name.length + data.length, end = central + 46 + name.length;
    const bytes = new ArrayBuffer(end + 22), view = new DataView(bytes), raw = new Uint8Array(bytes);
    view.setUint32(0, 0x04034b50, true); view.setUint16(26, name.length, true);
    raw.set(name, 30); raw.set(data, 30 + name.length);
    view.setUint32(central, 0x02014b50, true); view.setUint32(central + 20, data.length, true); view.setUint32(central + 24, data.length, true);
    view.setUint16(central + 28, name.length, true); raw.set(name, central + 46);
    view.setUint32(end, 0x06054b50, true); view.setUint16(end + 10, 1, true); view.setUint32(end + 16, central, true);
    expect(wordPageSize((await officeXml(bytes, "word/document.xml"))!)).toEqual({ width: 1056, minHeight: 816 });
    view.setUint32(central + 24, 9 * 1024 * 1024, true);
    expect(await officeXml(bytes, "word/document.xml")).toBeUndefined();
    expect(await officeXml(new ArrayBuffer(0), "word/document.xml")).toBeUndefined();
  });
  it("reaches cells beyond the former 250-row and 60-column truncation", () => {
    expect(sheetWindow(250, 60, 510, 120)).toEqual({ s: { r: 250, c: 60 }, e: { r: 499, c: 119 } });
    expect(sheetWindow(500, 120, 510, 120)).toEqual({ s: { r: 500, c: 120 }, e: { r: 510, c: 120 } });
  });
  it("retains merged cells and displayed number formatting without mutating the workbook", () => {
    const sheet = XLSX.utils.aoa_to_sheet([["Title", null], [0.125, "Value"]]);
    sheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
    sheet.A2.z = "0.0%";
    const html = XLSX.utils.sheet_to_html({ ...sheet, "!ref": "A1:B2" }, { header: "", footer: "" });
    expect(html).toContain('colspan="2"');
    expect(html).toContain("12.5%");
    expect(sheet["!ref"]).toBe("A1:B2");
  });
  it("recognizes existing images with generic MIME metadata", () => {
    expect(isPreviewImage("organigrama.PNG", "application/octet-stream")).toBe(true);
    expect(isPreviewImage("archivo.xlsx", "application/octet-stream")).toBe(false);
  });
});
