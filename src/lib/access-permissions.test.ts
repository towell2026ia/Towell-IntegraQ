import { describe, expect, it } from "vitest";
import { rolePermissionDefaults, changedSpecificPermissions, effectiveSpecificPermissions, synchronizeSpecificPermissions } from "./access-permissions";
import { canAccessModule, canAccessCompanyRecord } from "./access-policy";
import { canPerformModuleAction } from "./module-permissions";
import { canUseSupplierApi } from "./portal-security";
import { buildSessionFromAccount, createUserAccessAccount } from "./user-access-data";
import { resolvePortalCompany, getCustomerPortalData } from "./portal-access";
import { demoCorrectiveActions } from "./demo-data";
import type { ActiveSession } from "./session-data";
const user: ActiveSession = { userId:"u",name:"U",shortName:"U",initials:"U",position:"P",department:"D",company:"C",userType:"Usuario interno",assignedProcessIds:[],assignedModuleIds:["customers","suppliers","access"],moduleActionPermissions:[{moduleId:"customers",action:"manage"},{moduleId:"access",action:"manage"}] };
const external = (kind: "customer" | "supplier"): ActiveSession => ({ ...user,userType:kind === "customer" ? "Cliente":"Proveedor",workspaceMode:"production",specificPermissions:{[kind === "customer" ? "portal_clientes.acceder":"portal_proveedores.acceder"]:true},externalParty:{kind,companyId:"company-a",companyName:"A"} });
describe("FIX-03 effective permissions and portal isolation",()=>{
  it("sends only explicit changes and preserves unrelated existing permissions",()=>{
    expect(changedSpecificPermissions({"clientes.ver":true,"portal_clientes.acceder":true},{"clientes.ver":true,"portal_clientes.acceder":false})).toEqual({"portal_clientes.acceder":false});
  });
  it("preserves an active inherited portal grant within its company",()=>{
    const assignments=[{user_id:"a",organization_id:"company-a",status:"active",role:{status:"active",scope_type:"company",grants:[{allowed:true,permission:{code:"portal_clientes.acceder",status:"active"}}]}}];
    expect(rolePermissionDefaults("a","company-a",assignments)).toEqual({"portal_clientes.acceder":true});
    expect(rolePermissionDefaults("a","company-b",assignments)).toEqual({});
  });
  it("never resurrects an expired or foreign role assignment",()=>{
    const role={status:"active",scope_type:"global",grants:[{allowed:true,permission:{code:"usuarios.ver",status:"active"}}]};
    expect(rolePermissionDefaults("a",undefined,[{user_id:"b",status:"active",role},{user_id:"a",status:"active",ends_at:"2020-01-01",role}])).toEqual({});
  });
  it("shows current legacy grants while preserving an explicit revocation",()=>{
    expect(effectiveSpecificPermissions(user)).toMatchObject({"clientes.administrar":true,"usuarios.administrar_permisos":true,"portal_clientes.acceder":false});
    const denied={...user,specificPermissions:{"clientes.administrar":false,"proveedores.acceder":false}};
    expect(effectiveSpecificPermissions(denied)["clientes.administrar"]).toBe(false);
    expect(canPerformModuleAction(denied,"customers","manage")).toBe(false);
    expect(canPerformModuleAction(denied,"suppliers","view")).toBe(false);
  });
  it("synchronizes the two existing editors and removes dependent actions on revocation",()=>{
    expect(synchronizeSpecificPermissions({}, {moduleId:"customers",action:"manage"},true)).toMatchObject({"clientes.acceder":true,"clientes.ver":true,"clientes.administrar":true});
    expect(synchronizeSpecificPermissions({"clientes.administrar":true},{moduleId:"customers",action:"view"},false)).toMatchObject({"clientes.administrar":false,"clientes.acceder":false});
  });
  it("does not let a stale module menu bypass a specific read denial",()=>{
    expect(canPerformModuleAction({...user,specificPermissions:{"proveedores.acceder":true,"proveedores.ver":false}},"suppliers","view")).toBe(false);
  });
  it.each(["customer","supplier"] as const)("isolates %s A from B and denies missing or revoked portal authorization",(kind)=>{
    const u=external(kind), portalModule=kind === "customer"?"customer-portal":"supplier-portal";
    expect(canAccessModule(u,portalModule)).toBe(true);
    expect(canAccessCompanyRecord(u,kind,"company-a")).toBe(true);
    expect(canAccessCompanyRecord(u,kind,"company-b")).toBe(false);
    expect(canAccessModule({...u,specificPermissions:{}},portalModule)).toBe(false);
    expect(canAccessModule({...u,specificPermissions:{[kind==="customer"?"portal_clientes.acceder":"portal_proveedores.acceder"]:false}},portalModule)).toBe(false);
    expect(canPerformModuleAction(u,"access","manage")).toBe(false);
  });
  it("retains specific permissions when reconstructing a new login",()=>{
    const account=createUserAccessAccount({id:"test",fullName:"External",email:"test@example.invalid",userType:"Proveedor",companyId:"company-a",companyName:"A",specificPermissions:{"portal_proveedores.acceder":false},createdAt:"2026-10-28"})!;
    expect(buildSessionFromAccount(account).specificPermissions?.["portal_proveedores.acceder"]).toBe(false);
    expect(canAccessModule(buildSessionFromAccount(account),"supplier-portal")).toBe(false);
  });
  it("has no fixed production company for an administrator and uses the real external ID",()=>{
    expect(resolvePortalCompany({...user,userType:"Administrador"},"customer")).toBeNull();
    expect(resolvePortalCompany(external("customer"),"customer")?.companyId).toBe("company-a");
    expect(getCustomerPortalData("customer-001",demoCorrectiveActions)).toEqual({actions:[],audits:[],certifications:[]});
  });
  it("retains DEMO isolation for companies absent from the example catalog",()=>{
    expect(resolvePortalCompany({...external("customer"),workspaceMode:"demo"},"customer")?.demo).toBe(true);
  });
  it("never opens live supplier APIs from a demo or revoked account",()=>{
    const supplier=external("supplier");
    expect(canUseSupplierApi(supplier)).toBe(true);
    expect(canUseSupplierApi({...supplier,workspaceMode:"demo"})).toBe(false);
    expect(canUseSupplierApi({...supplier,specificPermissions:{"portal_proveedores.acceder":false}})).toBe(false);
  });
});
