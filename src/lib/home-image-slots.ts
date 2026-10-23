export const homeImageSlots = [
  { id: "quality", title: "Política de Calidad" },
  { id: "environment", title: "Política Ambiental" },
  { id: "safety", title: "Política de Seguridad e Higiene" },
  { id: "objectives", title: "Objetivos de Calidad" },
] as const;

export type HomeImageSlotId = (typeof homeImageSlots)[number]["id"];
export type HomeImageVersion = {
  id: string;
  slot: HomeImageSlotId;
  revision: number;
  file_name: string;
  created_at: string;
  reason: string;
  url?: string;
};
export const maximumHomeImageBytes = 5 * 1024 * 1024;
export function isHomeImageSlot(value: string): value is HomeImageSlotId {
  return homeImageSlots.some((slot) => slot.id === value);
}
export function homeImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}
