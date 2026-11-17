import {describe,it,expect} from "vitest";
import {attachmentPhotoPolicy} from "./attachment-photo-policy";
describe("existing upload policies for photographic inputs",()=>{
 it.each(["customer-claim","supplier-response"] as const)("keeps %s stored bytes within 4 MiB",scope=>expect(attachmentPhotoPolicy(scope).maxStoredBytes).toBe(4*1024*1024));
 it("preserves the existing 50 MiB indicator attachment limit",()=>expect(attachmentPhotoPolicy("indicator-evidence").maxStoredBytes).toBe(50*1024*1024));
 it("uses the approved balanced and fine profiles without changing formats or limits",()=>{const balanced=attachmentPhotoPolicy("customer-claim"),fine=attachmentPhotoPolicy("customer-claim",true);expect(balanced).toMatchObject({maxEdge:2048,quality:.8});expect(fine).toMatchObject({...balanced,maxEdge:4096,quality:.92});expect(fine.allowed).toEqual(["image/jpeg","image/png","image/webp"]);});
});
