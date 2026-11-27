"use server";

import { canAccessModule } from "./access-policy";
import { isWorkspaceModuleId, type WorkspaceModuleId } from "./navigation";
import { isExternalUser } from "./session-data";
import { getAuthenticatedSession } from "./supabase/auth-session";
import { sessionAccessKey } from "./workspace-continuity";

export async function verifyReviewNavigation(destination: WorkspaceModuleId, expectedScope: string) {
  const session = await getAuthenticatedSession();
  return Boolean(session?.authUserId && session.organizationId && !isExternalUser(session)
    && isWorkspaceModuleId(destination) && canAccessModule(session, "management-review")
    && canAccessModule(session, destination) && sessionAccessKey(session) === expectedScope);
}
