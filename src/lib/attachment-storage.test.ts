import { beforeEach, describe, expect, it, vi } from "vitest";
import { getReferencedAttachment, getAttachmentSignedUrl, mergeReferencedAttachment } from "./attachment-storage";
const mock = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/client", () => mock);
describe("existing result evidence, including closed capture periods", () => {
  beforeEach(() => vi.clearAllMocks());
  it("resolves a retained explicit file ID through RLS without asking for capture permission", async () => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "is"]) chain[method] = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "file-1", module_id: "indicators", is_current: false, original_name: "evidence.pdf" }, error: null });
    const rpc = vi.fn();
    mock.createClient.mockReturnValue({ from: vi.fn(() => chain), rpc });
    const file = await getReferencedAttachment("file-1", "indicators");
    expect(chain.eq.mock.calls).toEqual([["id", "file-1"], ["module_id", "indicators"]]);
    expect(chain.is).toHaveBeenCalledWith("deleted_at", null);
    expect(rpc).not.toHaveBeenCalled();
    expect(file?.isCurrent).toBe(false);
    expect(mergeReferencedAttachment([], file)).toEqual([file]);
    expect(mergeReferencedAttachment([file!], file)).toHaveLength(1);
  });
  it("preserves denied access instead of returning a fabricated file", async () => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "is"]) chain[method] = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: { message: "denied" } });
    mock.createClient.mockReturnValue({ from: vi.fn(() => chain) });
    await expect(getReferencedAttachment("file-1", "indicators")).rejects.toThrow("denied");
    expect(mergeReferencedAttachment([], null)).toEqual([]);
  });
  it("renews private signed URLs each time existing evidence is opened", async () => {
    const sign = vi.fn().mockResolvedValueOnce({ data: { signedUrl: "first" } }).mockResolvedValueOnce({ data: { signedUrl: "renewed" } });
    mock.createClient.mockReturnValue({ storage: { from: vi.fn(() => ({ createSignedUrl: sign })) } });
    const attachment = { bucketId: "private", objectPath: "evidence.pdf" } as Parameters<typeof getAttachmentSignedUrl>[0];
    expect(await getAttachmentSignedUrl(attachment)).toBe("first");
    expect(await getAttachmentSignedUrl(attachment)).toBe("renewed");
    expect(sign).toHaveBeenCalledWith("evidence.pdf", 120);
  });
});
