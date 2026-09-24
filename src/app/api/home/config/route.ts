import { NextResponse } from "next/server";

import {
  defaultHomeSectionConfigurations,
  homeSectionDefinitions,
  type HomeSectionConfiguration,
  type HomeSectionId,
  type HomeSectionScope,
} from "@/lib/home-visibility";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createAdminClient } from "@/lib/supabase/admin";

const scopeFromDatabase: Record<string, HomeSectionScope> = {
  all_processes: "all-processes",
  selected_processes: "selected-processes",
  specific_users: "specific-users",
};

const scopeToDatabase: Record<HomeSectionScope, string> = {
  "all-processes": "all_processes",
  "selected-processes": "selected_processes",
  "specific-users": "specific_users",
};

type HomeSectionRow = {
  id: string;
  label: string;
  description: string;
  scope: string;
  visible_to_administrators: boolean;
  active: boolean;
};

export async function GET() {
  const session = await getAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ error: "Sesión no autorizada." }, { status: 401 });
  }

  const admin = createAdminClient();
  const [sectionsResult, processesResult, usersResult] = await Promise.all([
    admin.from("home_sections").select("id,label,description,scope,visible_to_administrators,active").order("display_order"),
    admin.from("home_section_processes").select("home_section_id,process_id"),
    admin.from("home_section_users").select("home_section_id,user_id"),
  ]);

  if (sectionsResult.error || processesResult.error || usersResult.error) {
    return NextResponse.json({
      configurations: defaultHomeSectionConfigurations,
      persisted: false,
    });
  }

  const isAdmin = session.userType === "Administrador";
  const currentIds = new Set([session.authUserId, session.userId].filter(Boolean));
  const configurations = ((sectionsResult.data ?? []) as HomeSectionRow[])
    .filter((row) => homeSectionDefinitions.some((section) => section.id === row.id))
    .map((row) => ({
      id: row.id as HomeSectionId,
      label: row.label,
      description: row.description,
      scope: scopeFromDatabase[row.scope] ?? "all-processes",
      visibleToAdministrators: row.visible_to_administrators,
      active: row.active,
      processIds: (processesResult.data ?? [])
        .filter((item) => item.home_section_id === row.id)
        .map((item) => item.process_id),
      userIds: (usersResult.data ?? [])
        .filter(
          (item) =>
            item.home_section_id === row.id &&
            (isAdmin || currentIds.has(item.user_id)),
        )
        .map((item) => item.user_id),
    } satisfies HomeSectionConfiguration));

  if (!isAdmin) {
    return NextResponse.json({ configurations, persisted: true });
  }

  const [processCatalogResult, profilesResult] = await Promise.all([
    admin.from("processes").select("id,name,level,parent_id,active").eq("active", true).order("id"),
    admin.from("profiles").select("id,external_id,full_name,status,user_type").eq("status", "active").in("user_type", ["administrator", "internal"]).order("full_name"),
  ]);

  return NextResponse.json({
    configurations,
    persisted: true,
    processes: processCatalogResult.data ?? [],
    users: profilesResult.data ?? [],
  });
}

export async function PATCH(request: Request) {
  const session = await getAuthenticatedSession();
  if (!session || session.userType !== "Administrador" || !session.authUserId) {
    return NextResponse.json({ error: "Acceso exclusivo para administrador." }, { status: 403 });
  }

  const configuration = (await request.json()) as HomeSectionConfiguration;
  if (!homeSectionDefinitions.some((section) => section.id === configuration.id)) {
    return NextResponse.json({ error: "Bloque de Inicio inválido." }, { status: 400 });
  }
  if (!(configuration.scope in scopeToDatabase)) {
    return NextResponse.json({ error: "Tipo de alcance inválido." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error: sectionError } = await admin
    .from("home_sections")
    .update({
      scope: scopeToDatabase[configuration.scope],
      visible_to_administrators: configuration.visibleToAdministrators,
      active: configuration.active,
    })
    .eq("id", configuration.id);
  if (sectionError) {
    return NextResponse.json({ error: sectionError.message }, { status: 400 });
  }

  const [processDelete, userDelete] = await Promise.all([
    admin.from("home_section_processes").delete().eq("home_section_id", configuration.id),
    admin.from("home_section_users").delete().eq("home_section_id", configuration.id),
  ]);
  const deleteError = processDelete.error ?? userDelete.error;
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 400 });
  }

  const writes = [];
  if (configuration.scope === "selected-processes" && configuration.processIds.length) {
    writes.push(
      admin.from("home_section_processes").insert(
        [...new Set(configuration.processIds)].map((processId) => ({
          home_section_id: configuration.id,
          process_id: processId,
        })),
      ),
    );
  }
  if (configuration.scope === "specific-users" && configuration.userIds.length) {
    writes.push(
      admin.from("home_section_users").insert(
        [...new Set(configuration.userIds)].map((userId) => ({
          home_section_id: configuration.id,
          user_id: userId,
        })),
      ),
    );
  }
  const writeResults = await Promise.all(writes);
  const writeError = writeResults.find((result) => result.error)?.error;
  if (writeError) {
    return NextResponse.json({ error: writeError.message }, { status: 400 });
  }

  await admin.from("audit_log").insert({
    actor_id: session.authUserId,
    action: "home.section_visibility_updated",
    resource_type: "home_section",
    resource_id: configuration.id,
    metadata: {
      scope: scopeToDatabase[configuration.scope],
      process_count: configuration.processIds.length,
      user_count: configuration.userIds.length,
      active: configuration.active,
    },
  });

  return NextResponse.json({ ok: true });
}
