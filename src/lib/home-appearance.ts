export const HOME_APPEARANCE_AREA = "homeAppearance";
export const homeTextSizes = [
  { value: 100, label: "Normal" },
  { value: 110, label: "Grande" },
  { value: 120, label: "Muy grande" },
  { value: 130, label: "Extra grande" },
] as const;
export type HomeTextSize = typeof homeTextSizes[number]["value"];
export function isHomeTextSize(value: unknown): value is HomeTextSize {
  return homeTextSizes.some(option => option.value === value);
}
export function readHomeTextSize(payload: unknown): HomeTextSize {
  const value = payload && typeof payload === "object" && "textSize" in payload ? payload.textSize : undefined;
  return isHomeTextSize(value) ? value : 100;
}
export interface HomeAppearance { textSize: HomeTextSize; revision: number; }