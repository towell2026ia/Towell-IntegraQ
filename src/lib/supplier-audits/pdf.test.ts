import { describe, expect, it } from "vitest";
import { verifyAuditPdf } from "./pdf";
function pdf() {
 const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << >> /Contents 4 0 R >>", "<< /Length 0 >>\nstream\n\nendstream"];
 let text = "%PDF-1.4\n"; const offsets = [0]; objects.forEach((o, i) => { offsets.push(text.length); text += `${i + 1} 0 obj\n${o}\nendobj\n`; });
 const start = text.length; text += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
 return new TextEncoder().encode(text);
}
describe("supplier audit PDF verification", () => {
 it("reads a real one-page landscape PDF without extracting or changing its contents", async () => expect(await verifyAuditPdf(pdf())).toBe(1));
 it("rejects a renamed non-PDF before uploading", async () => { await expect(verifyAuditPdf(new TextEncoder().encode("<svg>not a PDF</svg>"))).rejects.toThrow(); });
 it("rejects a forged header and EOF that has no actual PDF pages", async () => { await expect(verifyAuditPdf(new TextEncoder().encode("%PDF-1.4\nnot a PDF document\n%%EOF"))).rejects.toThrow(); });
});
