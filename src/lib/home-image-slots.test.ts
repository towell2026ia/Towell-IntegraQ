import { describe, expect, it } from "vitest";
import { homeImageMime, homeImageSlots, isHomeImageSlot, createHomeImageDraft, parseHomeImageRevision, type HomeImageVersion } from "./home-image-slots";
describe("home image attachments", () => {
  it("reserves four independent empty slots", () => {
    expect(homeImageSlots.map((slot) => slot.id)).toEqual(["quality", "environment", "safety", "objectives"]);
    expect(isHomeImageSlot("unexpected")).toBe(false);
  });
  it("rejects disguised SVG and executable payloads regardless of extension", () => {
    expect(homeImageMime(new TextEncoder().encode("<svg onload='alert(1)'/>"))).toBeNull();
    expect(homeImageMime(new Uint8Array([77, 90, 0, 0]))).toBeNull();
    expect(homeImageMime(new Uint8Array([137, 80, 78]))).toBeNull();
  });
  it("detects supported raster signatures", () => {
    expect(homeImageMime(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))).toBe("image/png");
    expect(homeImageMime(new Uint8Array([255, 216, 255]))).toBe("image/jpeg");
    expect(homeImageMime(new TextEncoder().encode("RIFFxxxxWEBP"))).toBe("image/webp");
  });
});

describe("image draft concurrency", () => {
  const version = (revision: number): HomeImageVersion => ({ id: "v" + revision, slot: "quality", revision, file_name: "image.png", reason: "Update image", created_at: "2026-10-27" });
  it("keeps the revision seen when the administrator selected the attachment", () => {
    const versions = [version(1)];
    const draft = createHomeImageDraft("quality", versions);
    versions.unshift(version(2));
    expect(draft.expectedRevision).toBe(1);
    expect(createHomeImageDraft("quality", versions).expectedRevision).toBe(2);
  });
  it("does not inherit the revision of a different slot", () => {
    expect(createHomeImageDraft("safety", [version(7)]).expectedRevision).toBe(0);
  });
  it("rejects missing, fractional, negative and overflowing revisions", () => {
    for (const value of ["", "-1", "1.5", "NaN", "2147483647", "9007199254740992"]) expect(parseHomeImageRevision(value)).toBeNull();
    expect(parseHomeImageRevision("0")).toBe(0);
    expect(parseHomeImageRevision("2147483646")).toBe(2147483646);
  });
});
