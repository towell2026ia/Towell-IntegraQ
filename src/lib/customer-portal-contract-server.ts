import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export const unavailableMessage = "Publicación individual temporalmente no disponible";

export async function individualPublicationReady() {
  const result = await createAdminClient().rpc("iq_u01_publication_ready_v2");
  if (result.error) {
    if (["PGRST202", "42883"].includes(result.error.code)) return false;
    throw new Error("No se pudo comprobar el contrato de publicación individual.");
  }
  return result.data === true;
}

export async function requireIndividualPublication() {
  if (!(await individualPublicationReady())) throw new PublicationUnavailable();
}

export class PublicationUnavailable extends Error {
  constructor() { super(unavailableMessage); }
}
