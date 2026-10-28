import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UserAccountModal } from "./access-module";
import type { UserAccessAccount } from "@/lib/user-access-data";
describe("existing user permission editor",()=>{
  it("opens with the stored grant and revocation instead of resetting both",()=>{
    const account:UserAccessAccount={id:"u",authUserId:"auth-u",accessRevision:"2026-10-28T00:00:00Z",fullName:"Existing",email:"existing@example.invalid",userType:"Usuario interno",status:"active",assignedProcessIds:[],assignedModuleIds:["customers"],moduleActionPermissions:[{moduleId:"customers",action:"view"}],documentAccess:[],specificPermissions:{"clientes.administrar":true,"portal_clientes.acceder":false},createdAt:"2026-10-28"};
    const html=renderToStaticMarkup(createElement(UserAccountModal,{account,companies:[],positions:[],onCompaniesChange:async()=>[],onClose:()=>undefined,onSave:async()=>undefined}));
    const label=(key:string)=>{const end=html.indexOf(">"+key+"</small>");return html.slice(html.lastIndexOf("<label",end),end);};
    expect(label("clientes.administrar")).toContain('checked=""');
    expect(label("portal_clientes.acceder")).not.toContain('checked=""');
    expect(html).toContain("Guardar cambios");
  });
});
