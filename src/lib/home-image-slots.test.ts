import { describe, expect, it } from "vitest";
import { homeImageMime, homeImageSlots, isHomeImageSlot } from "./home-image-slots";
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
