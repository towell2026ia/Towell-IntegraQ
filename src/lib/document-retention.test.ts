import {describe,it,expect,vi} from "vitest";
import {relationRecord,discardUnpublishedUpload} from "./document-retention";
import {softDeleteControlledDocument,restoreControlledDocument} from "./document-control-data";

describe("STB-02 retained documentary identity",()=>{
  it("reads a deleted lifecycle from either PostgREST relationship shape",()=>{
    const row={is_deleted:true,delete_reason:"Reemplazo autorizado"};
    expect(relationRecord(row)?.is_deleted).toBe(true);
    expect(relationRecord([row])?.delete_reason).toBe(row.delete_reason);
    expect(relationRecord([])).toBeUndefined();
    expect(relationRecord(null)).toBeUndefined();
  });
  it.each([{registered:true,uncertain:false},{registered:false,uncertain:true},{registered:true,uncertain:true}])("never removes a binary when publication was registered or is unknown: %j",async state=>{
    const remove=vi.fn();await discardUnpublishedUpload(async()=>state,remove);expect(remove).not.toHaveBeenCalled();
  });
  it("removes only a proven unregistered staged upload",async()=>{
    const remove=vi.fn().mockResolvedValue(undefined);await discardUnpublishedUpload(async()=>({registered:false,uncertain:false}),remove);expect(remove).toHaveBeenCalledTimes(1);
  });
  it("retains IDs and all versions across deletion and restoration",()=>{
    const document={id:"old-document",processId:"P-TEST",documentTypeId:"procedures",code:"DOC-1",name:"Documento",owner:"Administrador",versions:[{id:"official-version",revision:3,status:"current",fileName:"official.pdf",uploadedBy:"Administrador",validator:"Dirección",modifiedAt:"2026-01-01",changeReason:"Autorizado",fileObjectId:"retained-file",storageObjectPath:"immutable/path.pdf"}]} as Parameters<typeof softDeleteControlledDocument>[0];
    const deleted=softDeleteControlledDocument(document,"Administrador","Sustitución","2026-10-22T00:00:00Z");
    expect(deleted.id).toBe(document.id);expect(deleted.versions).toEqual(document.versions);
    const restored=restoreControlledDocument(deleted,"Administrador","2026-10-22T01:00:00Z");
    expect(restored.id).toBe(document.id);expect(restored.versions).toEqual(document.versions);
  });
});
