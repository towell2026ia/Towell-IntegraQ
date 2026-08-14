export interface ActiveSession {
  userId: string;
  name: string;
  shortName: string;
  initials: string;
  position: string;
  department: string;
  company: string;
  site?: string;
  userType: "Administrador" | "Usuario";
  assignedProcessIds: string[];
}

export const activeSession: ActiveSession = {
  userId: "USR-FJHR-001",
  name: "Francisco Javier Hernández Retana",
  shortName: "Francisco J. Hernández",
  initials: "FH",
  position: "Gerente de Calidad",
  department: "Calidad",
  company: "Towell",
  site: "Planta principal",
  userType: "Administrador",
  assignedProcessIds: ["P-08"],
};
