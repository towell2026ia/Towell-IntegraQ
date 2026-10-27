import { maximumHomeImageBytes } from "./home-image-slots";

export class HomeImageBodyTooLarge extends Error {}
export async function readHomeImageForm(request: Request): Promise<FormData> {
  const limit = maximumHomeImageBytes + 65536;
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > limit) throw new HomeImageBodyTooLarge();
  if (!request.body) throw new Error("EMPTY_BODY");
  const reader = request.body.getReader();
  const parts: ArrayBuffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new HomeImageBodyTooLarge();
      }
      parts.push(value.slice().buffer);
    }
  } finally { reader.releaseLock(); }
  return new Response(new Blob(parts), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
}
