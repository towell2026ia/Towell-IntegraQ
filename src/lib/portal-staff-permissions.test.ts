import { describe, expect, it } from "vitest";
import { canSupervisePortal, invitationActions, invitationPermissions } from "./portal-staff-permissions";
import type { ActiveSession } from "./session-data";

const staff: ActiveSession = {userId:"internal", name:"Calidad", shortName:"Calidad", initials:"C", position:"Auditoría", department:"Calidad", company:"Empresa", userType:"Usuario interno", workspaceMode:"production", organizationId:"workspace", assignedProcessIds:["quality"], assignedModuleIds:["suppliers","supplier-portal","customers","customer-portal"]};

describe.each(["supplier","customer"] as const)("invitaciones del portal %s",kind=>{
  const prefix = kind === "supplier" ? "portal_proveedores" : "portal_clientes";
  it("permite la consulta del módulo sin conceder acciones de invitación",()=>{
    expect(canSupervisePortal(staff,kind)).toBe(true);
    expect(Object.values(invitationPermissions(staff,kind))).toEqual([false,false,false,false]);
  });
  it.each(invitationActions)("concede y retira únicamente %s",action=>{
    const key = `${prefix}.${action}_invitaciones` as const;
    const session={...staff,specificPermissions:{[key]:true}};
    for(const check of invitationActions) expect(invitationPermissions(session,kind)[check]).toBe(check===action);
    session.specificPermissions[key]=false;
    expect(invitationPermissions(session,kind)[action]).toBe(false);
  });
  it("respeta las denegaciones expresas, el tipo de identidad y la organización",()=>{
    for(const session of [{...staff,specificPermissions:{[`${prefix}.acceder`]:false}},{...staff,userType:"Proveedor" as const},{...staff,organizationId:undefined}]){
      expect(canSupervisePortal(session,kind)).toBe(false);
    }
  });
});
