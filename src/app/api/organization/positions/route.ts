import { NextResponse } from "next/server";

import { authorize } from "@/lib/access/authorize";
import type { ProcessRelationship } from "@/lib/organization-data";
import { normalizePositionName } from "@/lib/organization-position-data";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Actor = { id: string; userType: "administrator" | "internal"; organizationId: string };
type ImportItem = {
  clientId: string;
  name: string;
  branch: string;
  parentId?: string;
  parentClientId?: string;
  processId?: string;
  relationship?: ProcessRelationship;
  requestedLevel?: number;
};
type PositionRow = { id: string; name: string; level: number; parent_id: string | null; branch: string };
type PositionPermissionRow = { position_id: string; process_id: string; relationship: ProcessRelationship };

async function getActor(): Promise<Actor | null> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;
  const admin = createAdminClient();
  const result = await admin.from("profiles").select("user_type,status,organization_id").eq("id", userData.user.id).maybeSingle();
  if (result.error || !result.data || result.data.status !== "active" || !["administrator", "internal"].includes(result.data.user_type) || !result.data.organization_id) return null;
  return { id: userData.user.id, userType: result.data.user_type as Actor["userType"], organizationId: result.data.organization_id };
}

async function canImportProcess(actor: Actor, processId: string) {
  if (actor.userType === "administrator") return true;
  const admin = createAdminClient();
  const result = await admin.from("user_process_permissions").select("document_role").eq("user_id", actor.id).eq("process_id", processId).in("document_role", ["modifier", "authorizer"]).limit(1);
  return !result.error && Boolean(result.data?.length);
}

export async function GET() {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Acceso interno requerido." }, { status: 403 });
    const admin = createAdminClient();
    const positionsResult = await admin
      .from("positions")
      .select("id,name,level,parent_id,branch")
      .eq("organization_id", actor.organizationId)
      .order("id");
    if (positionsResult.error) throw positionsResult.error;
    const rows = (positionsResult.data ?? []) as PositionRow[];
    const ids = rows.map((row) => row.id);
    const permissionsResult = ids.length
      ? await admin
          .from("position_process_permissions")
          .select("position_id,process_id,relationship")
          .in("position_id", ids)
      : { data: [] as PositionPermissionRow[], error: null };
    if (permissionsResult.error) throw permissionsResult.error;
    const links = ((permissionsResult.data ?? []) as PositionPermissionRow[]).reduce<Record<string, Array<{ processId: string; relationship: ProcessRelationship }>>>((result, row) => {
      (result[row.position_id] ??= []).push({ processId: row.process_id, relationship: row.relationship });
      return result;
    }, {});
    return NextResponse.json({
      positions: rows.map((row) => ({
        id: row.id,
        name: row.name,
        level: row.level,
        parentId: row.parent_id ?? undefined,
        branch: row.branch,
        processLinks: links[row.id] ?? [],
      })),
    });
  } catch (error) {
    console.error("No fue posible consultar los puestos.", error);
    return NextResponse.json({ error: "No fue posible cargar los puestos desde Supabase." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Acceso interno requerido." }, { status: 403 });
    const body = await request.json() as { mode?: "manual" | "process-import"; processId?: string; items?: unknown };
    const items = normalizeItems(body.items);
    if (!items.length) return NextResponse.json({ error: "Agrega al menos un puesto válido." }, { status: 400 });
    if (body.mode === "process-import") {
      if (!body.processId || !(await canImportProcess(actor, body.processId))) return NextResponse.json({ error: "No tienes permiso para integrar puestos de este proceso." }, { status: 403 });
      if (items.some((item) => item.processId && item.processId !== body.processId)) return NextResponse.json({ error: "La importación contiene puestos de otro proceso." }, { status: 400 });
      items.forEach((item) => { item.processId = body.processId; });
    } else if (actor.userType !== "administrator") {
      return NextResponse.json({ error: "Sólo una cuenta administradora puede crear puestos manualmente." }, { status: 403 });
    }
    const session = await getAuthenticatedSession();
    const permission = body.mode === "process-import" ? "organization.position.create" : "system.organization.administer";
    const access = authorize({ user: session, permission, record: { organizationId: actor.organizationId, processId: body.processId }, grants: body.mode === "process-import" && body.processId ? [{ permission, scope: "process", processId: body.processId }] : [] });
    if (!access.allowed) return NextResponse.json({ error: access.reason }, { status: 403 });

    const admin = createAdminClient();
    const existingResult = await admin.from("positions").select("id,name,level,parent_id,branch").eq("organization_id", actor.organizationId).order("id");
    if (existingResult.error) throw existingResult.error;
    const positions = (existingResult.data ?? []) as PositionRow[];
    const byId = new Map(positions.map((position) => [position.id, position]));
    const createdByClientId = new Map<string, string>();
    let nextNumber = Math.max(0, ...positions.map((position) => Number(position.id.match(/\d+/)?.[0] ?? 0))) + 1;
    const pending = [...items];
    const created: Array<{ id: string; clientId: string; name: string; level: number }> = [];
    const skipped: Array<{ clientId: string; name: string; reason: string }> = [];

    while (pending.length) {
      const nextIndex = pending.findIndex((item) => !item.parentClientId || createdByClientId.has(item.parentClientId) || !items.some((candidate) => candidate.clientId === item.parentClientId));
      const item = pending.splice(nextIndex >= 0 ? nextIndex : 0, 1)[0];
      const parentId = item.parentClientId ? createdByClientId.get(item.parentClientId) : item.parentId;
      const duplicate = positions.find((position) => normalize(position.name) === normalize(item.name) && (position.parent_id ?? undefined) === parentId);
      if (duplicate) {
        createdByClientId.set(item.clientId, duplicate.id);
        skipped.push({ clientId: item.clientId, name: item.name, reason: `Ya existe como ${duplicate.id}.` });
        continue;
      }
      const parent = parentId ? byId.get(parentId) : undefined;
      if (parentId && !parent) {
        skipped.push({ clientId: item.clientId, name: item.name, reason: "No se encontró el puesto superior." });
        continue;
      }
      const actualLevel = parent ? hierarchyLevel(parent, byId) + 1 : 1;
      if (body.mode !== "process-import" && actualLevel < 5) {
        return NextResponse.json({ error: "Los nuevos puestos deben agregarse debajo de un puesto de nivel 4 o posterior." }, { status: 400 });
      }
      if (body.mode !== "process-import" && item.requestedLevel && item.requestedLevel !== actualLevel) {
        return NextResponse.json({ error: `El puesto superior seleccionado corresponde al nivel ${actualLevel}, no al nivel ${item.requestedLevel}.` }, { status: 400 });
      }
      const id = `PU-${String(nextNumber).padStart(2, "0")}`;
      nextNumber += 1;
      const positionData = {
        id,
        organization_id: actor.organizationId,
        name: item.name,
        level: actualLevel,
        parent_id: parentId ?? null,
        branch: item.branch,
      };
      let inserted = await admin.from("positions").insert(positionData).select("id,name,level,parent_id,branch").single();
      if (inserted.error?.code === "23514" && actualLevel > 4) {
        inserted = await admin.from("positions").insert({ ...positionData, level: 4 }).select("id,name,level,parent_id,branch").single();
      }
      if (inserted.error) throw inserted.error;
      const row = inserted.data as PositionRow;
      positions.push(row); byId.set(id, row); createdByClientId.set(item.clientId, id);
      created.push({ id, clientId: item.clientId, name: item.name, level: actualLevel });
      try {
        await copyParentModulePermissions(admin, parentId, id);
        if (item.processId) await upsertProcessPermission(admin, id, item.processId, item.relationship ?? "participant");
      } catch (error) {
        await admin.from("positions").delete().eq("id", id).eq("organization_id", actor.organizationId);
        throw error;
      }
    }

    await admin.from("audit_log").insert({
      actor_id: actor.id,
      action: body.mode === "process-import" ? "organization.process_chart_imported" : "organization.position_created",
      resource_type: "organization_position",
      metadata: { process_id: body.processId ?? null, created, skipped },
    });
    return NextResponse.json({ created, skipped });
  } catch (error) {
    console.error("No fue posible crear los puestos.", error);
    return NextResponse.json({ error: "No fue posible guardar los puestos en Supabase." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await getActor();
    if (!actor || actor.userType !== "administrator") return NextResponse.json({ error: "Sólo una cuenta administradora puede editar puestos." }, { status: 403 });
    const access = authorize({ user: await getAuthenticatedSession(), permission: "system.organization.administer", record: { organizationId: actor.organizationId } });
    if (!access.allowed) return NextResponse.json({ error: access.reason }, { status: 403 });
    const body = await request.json() as { id?: string; name?: string; branch?: string; parentId?: string | null };
    if (!body.id || !body.name?.trim() || !body.branch?.trim()) return NextResponse.json({ error: "Completa los datos del puesto." }, { status: 400 });
    if (body.id === body.parentId) return NextResponse.json({ error: "Un puesto no puede reportarse a sí mismo." }, { status: 400 });
    const admin = createAdminClient();
    const result = await admin.from("positions").select("id,parent_id,level").eq("organization_id", actor.organizationId);
    if (result.error) throw result.error;
    const rows = (result.data ?? []) as PositionRow[];
    if (createsCycle(body.id, body.parentId ?? undefined, rows)) return NextResponse.json({ error: "La dependencia seleccionada crea un ciclo jerárquico." }, { status: 400 });
    const parent = body.parentId ? rows.find((row) => row.id === body.parentId) : undefined;
    if (body.parentId && !parent) return NextResponse.json({ error: "No se encontró el puesto superior." }, { status: 400 });
    const actualLevel = parent ? hierarchyLevel(parent, new Map(rows.map((row) => [row.id, row]))) + 1 : 1;
    const updateData = { name: normalizePositionName(body.name), branch: body.branch.trim(), parent_id: body.parentId || null, level: actualLevel };
    let updated = await admin.from("positions").update(updateData).eq("id", body.id).eq("organization_id", actor.organizationId).select("id").maybeSingle();
    if (updated.error?.code === "23514" && actualLevel > 4) {
      updated = await admin.from("positions").update({ ...updateData, level: 4 }).eq("id", body.id).eq("organization_id", actor.organizationId).select("id").maybeSingle();
    }
    if (updated.error) throw updated.error;
    if (!updated.data) return NextResponse.json({ error: "El puesto no existe." }, { status: 404 });
    await admin.from("audit_log").insert({ actor_id: actor.id, action: "organization.position_updated", resource_type: "organization_position", resource_id: body.id, metadata: { parent_id: body.parentId ?? null } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("No fue posible editar el puesto.", error);
    return NextResponse.json({ error: "No fue posible editar el puesto." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await getActor();
    if (!actor || actor.userType !== "administrator") return NextResponse.json({ error: "Sólo una cuenta administradora puede eliminar puestos." }, { status: 403 });
    const access = authorize({ user: await getAuthenticatedSession(), permission: "system.organization.administer", record: { organizationId: actor.organizationId } });
    if (!access.allowed) return NextResponse.json({ error: access.reason }, { status: 403 });
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Indica el puesto a eliminar." }, { status: 400 });
    const admin = createAdminClient();
    const [children, profiles] = await Promise.all([
      admin.from("positions").select("id", { count: "exact", head: true }).eq("parent_id", id),
      admin.from("profiles").select("id", { count: "exact", head: true }).eq("position_id", id),
    ]);
    if (children.error || profiles.error) throw children.error ?? profiles.error;
    if ((children.count ?? 0) > 0) return NextResponse.json({ error: "Reasigna primero los puestos que dependen de éste." }, { status: 409 });
    if ((profiles.count ?? 0) > 0) return NextResponse.json({ error: "Reasigna primero las cuentas vinculadas a este puesto." }, { status: 409 });
    const removed = await admin.from("positions").delete().eq("id", id).eq("organization_id", actor.organizationId).select("id").maybeSingle();
    if (removed.error) throw removed.error;
    if (!removed.data) return NextResponse.json({ error: "El puesto no existe." }, { status: 404 });
    await admin.from("audit_log").insert({ actor_id: actor.id, action: "organization.position_deleted", resource_type: "organization_position", resource_id: id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("No fue posible eliminar el puesto.", error);
    return NextResponse.json({ error: "No fue posible eliminar el puesto." }, { status: 500 });
  }
}

function normalizeItems(value: unknown): ImportItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Partial<ImportItem>;
    const name = typeof item.name === "string" ? normalizePositionName(item.name) : "";
    const branch = typeof item.branch === "string" ? item.branch.trim() : "";
    if (!name || !branch) return [];
    const relationships: ProcessRelationship[] = ["owner", "approver", "participant", "support"];
    return [{
      clientId: typeof item.clientId === "string" && item.clientId.trim() ? item.clientId.trim() : `new-${index + 1}`,
      name: name.slice(0, 120), branch: branch.slice(0, 100),
      ...(typeof item.parentId === "string" && item.parentId ? { parentId: item.parentId } : {}),
      ...(typeof item.parentClientId === "string" && item.parentClientId ? { parentClientId: item.parentClientId } : {}),
      ...(typeof item.processId === "string" && item.processId ? { processId: item.processId } : {}),
      ...(Number.isInteger(item.requestedLevel) && Number(item.requestedLevel) >= 5 ? { requestedLevel: Number(item.requestedLevel) } : {}),
      relationship: relationships.includes(item.relationship as ProcessRelationship) ? item.relationship : "participant",
    }];
  }).slice(0, 100);
}

function hierarchyLevel(position: PositionRow, byId: Map<string, PositionRow>, trail = new Set<string>()): number {
  if (!position.parent_id || trail.has(position.id)) return Math.max(1, position.level);
  const parent = byId.get(position.parent_id);
  if (!parent) return Math.max(1, position.level);
  return hierarchyLevel(parent, byId, new Set(trail).add(position.id)) + 1;
}

function createsCycle(id: string, parentId: string | undefined, rows: PositionRow[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  let current = parentId;
  const seen = new Set<string>();
  while (current) {
    if (current === id || seen.has(current)) return true;
    seen.add(current);
    current = byId.get(current)?.parent_id ?? undefined;
  }
  return false;
}

async function copyParentModulePermissions(admin: ReturnType<typeof createAdminClient>, parentId: string | undefined, positionId: string) {
  if (!parentId) return;
  const [modules, actions] = await Promise.all([
    admin.from("position_module_permissions").select("module_id,can_view,can_manage").eq("position_id", parentId),
    admin.from("position_module_action_permissions").select("module_id,action").eq("position_id", parentId),
  ]);
  if (modules.error || actions.error) throw modules.error ?? actions.error;
  if (modules.data?.length) {
    const result = await admin.from("position_module_permissions").upsert(modules.data.map((item) => ({ ...item, position_id: positionId })), { onConflict: "position_id,module_id" });
    if (result.error) throw result.error;
  }
  if (actions.data?.length) {
    const result = await admin.from("position_module_action_permissions").upsert(actions.data.map((item) => ({ ...item, position_id: positionId })), { onConflict: "position_id,module_id,action" });
    if (result.error) throw result.error;
  }
}

async function upsertProcessPermission(admin: ReturnType<typeof createAdminClient>, positionId: string, processId: string, relationship: ProcessRelationship) {
  const documentRole = relationship === "participant" ? "modifier" : relationship === "support" ? "viewer" : "authorizer";
  const result = await admin.from("position_process_permissions").upsert({ position_id: positionId, process_id: processId, relationship, document_role: documentRole }, { onConflict: "position_id,process_id" });
  if (result.error) throw result.error;
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX").replace(/\s+/g, " ").trim();
}
