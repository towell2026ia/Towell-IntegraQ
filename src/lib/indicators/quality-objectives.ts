export const QUALITY_OBJECTIVES = [
  "Mantener y mejorar continuamente nuestro Sistema de Gestión de la Calidad.",
  "Fomentar una cultura de mejora continua y eficiencia en todos nuestros procesos.",
  "Escuchar y responder proactivamente a las necesidades y expectativas de nuestros clientes y partes interesadas.",
  "Capacitar y desarrollar a nuestro equipo para que alcance su máximo potencial.",
  "Implementar prácticas sostenibles que protejan el medio ambiente.",
] as const;

export function validQualityObjective(value: unknown): value is string {
  return value === "" || typeof value === "string" && QUALITY_OBJECTIVES.some(item => item === value);
}
