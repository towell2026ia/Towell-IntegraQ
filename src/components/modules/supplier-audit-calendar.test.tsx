import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupplierAuditCalendar, SupplierAuditDialog } from "./supplier-audit-calendar";
import type { SupplierAuditDirectory } from "@/hooks/use-supplier-audits";
import type { AuditWorkspace } from "@/lib/supplier-audits/model";

vi.mock("./document-preview-viewer", () => ({ DocumentPreviewViewer: () => null }));
function directory(canManage: boolean, administrator = false): SupplierAuditDirectory {
  return { data: { events: [], results: [], files: [], history: [], canManage, administrator,
    suppliers: [{ id: "supplier-real-id", code: "PR00001", name: "Synthetic supplier", active: true, owning_organization_id: null, contact_name: null, contact_email: null, metadata: {}, updated_at: "2026-11-06T12:00:00Z" }],
  } satisfies AuditWorkspace, loading: false, error: "", refresh: vi.fn() };
}
afterEach(() => vi.useRealTimers());
describe("supplier audit calendar navigation", () => {
  it("offers each November day for scheduling without a settings panel", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-06T18:00:00Z"));
    const html = renderToStaticMarkup(createElement(SupplierAuditCalendar, { directory: directory(true), onOpen: vi.fn() }));
    expect(html.match(/aria-label="Programar auditoría el /g)).toHaveLength(30);
    expect(html.match(/aria-pressed=/g)).toHaveLength(12);
    expect(html).not.toMatch(/Configurar inspector|sin titular|Inspector y alcance/);
  });
  it.each([false, true])("reader admin=%s cannot schedule and has no secondary permission configuration", administrator => {
    const html = renderToStaticMarkup(createElement(SupplierAuditCalendar, { directory: directory(false, administrator), onOpen: vi.fn() }));
    expect(html).not.toMatch(/aria-label="Programar auditoría el |Programar auditoría<|Importar histórico|Configurar inspector/);
    expect(html).toContain("Usuarios y acceso");
  });
  it("opens the selected year month and day and includes authorized legacy suppliers without extra checklists", () => {
    const html = renderToStaticMarkup(createElement(SupplierAuditDialog, { directory: directory(true), focus: { year: 2028, month: 2, plannedDate: "2028-02-29" }, onClose: vi.fn() }));
    expect(html).toMatch(/name="plannedDate"[^>]+value="2028-02-29"/);
    expect(html).toMatch(/name="year"[^>]+value="2028"/);
    expect(html).toContain('<option value="2" selected="">Febrero</option>');
    expect(html).toContain('value="supplier-real-id"');
    expect(html).not.toMatch(/confirmar sus relaciones|sin titular/);
  });
});
