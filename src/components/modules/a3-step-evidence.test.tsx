import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { A3StepEvidence } from "./a3-step-evidence";

// Model the capability already returned by the server for the mounted evidence panel.
const fixture = vi.hoisted(() => ({ access: { enabled: true, write: true }, photo: vi.fn() }));
vi.mock("react", async importOriginal => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react, useState: (initial: unknown) => react.useState(initial === null ? fixture.access : initial) };
});
vi.mock("@/lib/attachment-storage", () => ({ uploadAttachment: vi.fn() }));
vi.mock("@/components/evidence/evidence-manager", () => ({
  EvidenceManager: ({resourceKey, permissions}: {resourceKey:string; permissions:{read:boolean; add:boolean}}) =>
    createElement("span", { "data-resource": resourceKey, "data-read": permissions.read, "data-add": permissions.add }),
}));
vi.mock("@/components/images/photo-attachment-picker", () => ({
  PhotoAttachmentPicker: (props: {label:string; camera?:boolean}) => {
    fixture.photo(props);
    return createElement("input", {type:"file", "aria-label":props.label});
  },
}));

function render(step:number|string, readOnly=false) {
  return renderToStaticMarkup(createElement(A3StepEvidence, { evidenceId:"a3", processId:"qa", step, readOnly }));
}

beforeEach(() => { fixture.photo.mockClear(); fixture.access.write = true; });

it.each(Array.from({length:8}, (_,step)=>step))("renders only the original evidence manager for stage %i", step => {
  for (const readOnly of [false,true]) {
    expect(render(step,readOnly)).toBe(`<section class="print-hidden"><span data-resource="a3_step_${step}" data-read="true" data-add="${!readOnly}"></span></section>`);
  }
  expect(fixture.photo).not.toHaveBeenCalled();
});

it("keeps the camera available for a writable follow-up action", () => {
  expect(render("plan-id")).toContain("a3_plan_plan-id");
  expect(fixture.photo).toHaveBeenCalledWith(expect.objectContaining({camera:true, label:"Fotografías de la acción"}));
});

it("keeps existing action evidence accessible after closure or without write permission", () => {
  expect(render("plan-id",true)).toContain('data-read="true" data-add="false"');
  fixture.access.write = false;
  expect(render("plan-id")).toContain('data-read="true" data-add="false"');
  expect(fixture.photo).not.toHaveBeenCalled();
});
