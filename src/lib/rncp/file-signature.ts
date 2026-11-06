/** Server-side byte signatures. File extensions alone never validate an attachment. */
export function validRncpFileSignature(bytes: Uint8Array, mime: string) {
  const starts = (...values: number[]) => bytes.length >= values.length && values.every((value, i) => bytes[i] === value);
  if (mime === "application/pdf") return starts(37, 80, 68, 70, 45);
  if (mime === "image/jpeg") return starts(255, 216, 255);
  if (mime === "image/png") return starts(137, 80, 78, 71, 13, 10, 26, 10);
  if (mime === "image/webp") return new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP";
  if (mime === "application/vnd.ms-excel") return starts(208, 207, 17, 224, 161, 177, 26, 225);
  if (mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return starts(80, 75, 3, 4);
  return false;
}
