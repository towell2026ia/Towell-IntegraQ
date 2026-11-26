const typeLabels: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "Imagen JPEG",
  "image/png": "Imagen PNG",
  "image/webp": "Imagen WEBP",
  "application/vnd.ms-excel": "Excel (XLS)",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    "Excel (XLSX)",
};
const formatter = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });

export function attachmentDescription(file: File) {
  const type = typeLabels[file.type] || file.type ||
    file.name.split(".").slice(1).pop()?.toUpperCase() || "Tipo desconocido";
  if (file.size < 1024) return `${type} · ${file.size} B`;
  if (file.size < 1024 ** 2) {
    return `${type} · ${formatter.format(file.size / 1024)} KB`;
  }
  return `${type} · ${formatter.format(file.size / 1024 ** 2)} MB`;
}
