import { expect, it } from "vitest";
import { applySupplierLevel, supplierLevels } from "./permission-presets";

it.each(supplierLevels)("applies %s only to the selected supplier modules",level=>{
  const next=applySupplierLevel(level,{"portal_clientes.acceder":false},[{moduleId:"customers",action:"view"}]);
  const index=supplierLevels.indexOf(level);
  expect(next.modules).toContainEqual({moduleId:"customers",action:"view"});
  expect(next.permissions["portal_clientes.acceder"]).toBe(false);
  expect(next.permissions["rncp.consultar_rncp"]).toBe(index>=1);
  expect(next.permissions["rncp.editar_rncp"]).toBe(index>=2);
  expect(next.permissions["portal_proveedores.revocar_invitaciones"]).toBe(index>=3);
  expect(next.permissions["rncp.configurar_modulo"]).toBe(index===4);
  for(const key of ["rncp.validar_acciones","rncp.verificar_efectividad","rncp.cerrar_planes","rncp.cerrar_rncp","rncp.reabrir_rncp"] as const) expect(next.permissions[key]).toBe(false);
});
