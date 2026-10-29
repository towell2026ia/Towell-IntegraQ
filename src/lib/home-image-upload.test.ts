import { describe, expect, it } from "vitest";
import { maximumHomeImageBytes } from "./home-image-slots";
import { HomeImageBodyTooLarge, readHomeImageForm } from "./home-image-upload";

describe("bounded home image request body", () => {
  it("parses an ordinary attachment without requiring content-length", async () => {
    const form = new FormData();
    form.set("slot", "quality");
    form.set("file", new File(["fixture"], "fixture.png", { type: "image/png" }));
    const parsed = await readHomeImageForm(new Request("https://preview.test/api/home/images", { method: "POST", body: form }));
    expect(parsed.get("slot")).toBe("quality");
    expect((parsed.get("file") as File).name).toBe("fixture.png");
  });
  it("rejects an oversized content-length before reading the stream", async () => {
    const request = new Request("https://preview.test", { method: "POST", body: "small", headers: { "content-length": String(maximumHomeImageBytes + 65537) } });
    await expect(readHomeImageForm(request)).rejects.toBeInstanceOf(HomeImageBodyTooLarge);
  });
  it("also limits an actual body when content-length is absent or false", async () => {
    for (const headers of [new Headers(), new Headers({ "content-length": "1" })]) {
      const request = new Request("https://preview.test", { method: "POST", body: new Uint8Array(maximumHomeImageBytes + 65537), headers });
      await expect(readHomeImageForm(request)).rejects.toBeInstanceOf(HomeImageBodyTooLarge);
    }
  });
});
