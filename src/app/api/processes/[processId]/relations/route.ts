import { NextResponse } from "next/server";

import { getProcessRelations, ProcessRelationError } from "@/lib/relations/process-relations";
import { SupabaseProcessRelationsRepository } from "@/lib/relations/supabase-process-relations";
import { canAccessProcess } from "@/lib/session-data";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ processId: string }> }) {
  const session = await getAuthenticatedSession();
  if (!session) return NextResponse.json({ error: "Inicia sesión para consultar las relaciones del proceso." }, { status: 401 });
  const { processId } = await params;
  if (!canAccessProcess(session, processId)) return NextResponse.json({ error: "No tienes acceso al proceso solicitado." }, { status: 403 });
  try {
    const relations = await getProcessRelations(processId, new SupabaseProcessRelationsRepository(await createClient()));
    return NextResponse.json({ relations });
  } catch (error) {
    if (error instanceof ProcessRelationError) return NextResponse.json({ error: error.message }, { status: error.code === "PROCESS_NOT_FOUND" ? 404 : 409 });
    console.error("No fue posible consultar las relaciones del proceso.", error);
    return NextResponse.json({ error: "No fue posible consultar las relaciones del proceso." }, { status: 500 });
  }
}

