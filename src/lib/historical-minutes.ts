export interface HistoricalMinutesInput {
  year: string;
  date: string;
  responsible: string;
  fileName: string;
  mimeType: string;
}

export function validateHistoricalMinutes(input: HistoricalMinutesInput, currentYear: number): string | null {
  const year = Number(input.year);
  const parsedDate = new Date(`${input.date}T00:00:00.000Z`);
  if (!/^\d{4}$/.test(input.year) || year < 1900 || year > currentYear ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== input.date ||
      !input.date.startsWith(`${input.year}-`)) {
    return "El año y la fecha del acta deben coincidir.";
  }
  if (!input.responsible.trim()) return "Indica el responsable del acta.";
  const extension = input.fileName.toLowerCase().match(/\.(pdf|docx)$/)?.[1];
  const acceptedMime = extension === "pdf" ? "application/pdf" :
    extension === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : null;
  if (!acceptedMime || (input.mimeType && input.mimeType !== acceptedMime)) return "Adjunta un archivo PDF o DOCX.";
  return null;
}
