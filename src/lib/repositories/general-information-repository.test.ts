import { afterEach, describe, expect, it, vi } from "vitest";
import { getGeneralInformationFileUrl } from "./general-information-repository";

afterEach(() => vi.unstubAllGlobals());

describe("general information spreadsheet preview", () => {
  it("requests the original for an authorized preview without requesting admin-only download", async () => {
    const fetchMock = vi.fn(async () => Response.json({ signedUrl: "https://example.test/signed" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getGeneralInformationFileUrl("file id", "preview", true)).toEqual({ signedUrl: "https://example.test/signed" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/information-general/documents/file%20id/file?disposition=preview&original=1",
      { cache: "no-store" },
    );
  });
});
