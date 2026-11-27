import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listReviewFiles, readReviewPeriods, reviewDocuments, saveReviewFile, resumeReviewTransfer } from "./review-document-storage";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), upload: vi.fn(), confirm: vi.fn(),
}));
vi.mock("./supabase/client", () => ({
  createClient: () => ({ rpc: mocks.rpc, from: mocks.from,
    storage: { from: () => ({upload: mocks.upload}) } }),
}));

const year = 2025;
const base: Parameters<typeof saveReviewFile>[0] = {
  year, kind: reviewDocuments, action: "add" as const, uploadId: "revision-id", documentId: "document-id",
  metadata: { category: "support", section: "risks", responsible: "SGC", title: "Soporte", notes: "", date: "2025-01-01" },
  file: new File(["test"], "Documento.pdf", { type:"application/pdf" }),
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.upload.mockResolvedValue({error:null});
  mocks.confirm.mockResolvedValue(Response.json({id:base.uploadId}));
  vi.stubGlobal("fetch",mocks.confirm);
  mocks.rpc.mockImplementation((name, args) => {
    if (name === "iq_review_reserve") {
      const transfer = {id:args.p_id, uploaded:false, result_id:null, object_path:"reserved/path",payload:args.p_data};
      mocks.rpc.mockImplementation(() => ({eq:() => ({single:async () => ({data:transfer})})}));
      return Promise.resolve({data:transfer.id});
    }
    throw new Error("Unexpected RPC");
  });
});
afterEach(() => vi.unstubAllGlobals());

function duplicates(rows: {id:string}[]) {
  const chain = { select:vi.fn().mockReturnThis(), eq:vi.fn().mockReturnThis(), neq:vi.fn().mockReturnThis(),
    limit:vi.fn().mockResolvedValue({data:rows,error:null}) };
  mocks.from.mockReturnValue(chain);
  return chain;
}

describe("Expediente documental de Dirección", () => {
  it("solicita el registro después de cargar el objeto privado sin sobrescribirlo",async () => {
    duplicates([]);
    expect(await saveReviewFile(base)).toBe(base.uploadId);
    expect(mocks.upload).toHaveBeenCalledWith("reserved/path",base.file,{contentType:"application/pdf",upsert:false});
    expect(mocks.rpc).toHaveBeenCalledWith("iq_review_reserve",expect.objectContaining({
      p_type:reviewDocuments,p_key:"2025:document-id",p_previous:null,p_data:expect.objectContaining({section:"risks",size:4,sha:expect.stringMatching(/^[a-f0-9]{64}$/)}),
    }));
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.upload.mock.invocationCallOrder[0]);
  });
  it("recupera la reserva desde una pantalla recién abierta y utiliza el objeto existente",async () => {
    const uploaded={id:base.uploadId,uploaded:true,result_id:null,object_path:"private",resource_key:"2025:key",payload:{...base.metadata,name:"Documento.pdf",size:4,mime:"application/pdf",sha:"fixture"}};
    mocks.rpc.mockImplementation(()=>({eq:()=>({is:()=>({order:()=>({range:async()=>({data:[uploaded]})})})})}));
    vi.resetModules();
    const reopened=await import("./review-document-storage");
    const [restored]=await reopened.pendingReviewTransfers(reviewDocuments);
    expect(await reopened.resumeReviewTransfer(restored)).toBe(base.uploadId);
    expect(mocks.upload).not.toHaveBeenCalled();
    await expect(resumeReviewTransfer({...restored,uploaded:false},new File(["xxxx"],"Documento.pdf"))).rejects.toThrow("archivo original");
    expect(mocks.upload).not.toHaveBeenCalled();
    mocks.confirm.mockClear();
    expect(await resumeReviewTransfer({...restored,result_id:base.uploadId})).toBe(base.uploadId);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("conserva el original registrado y no vuelve a cargar sus bytes",async () => {
    duplicates([{id:"original"}]);
    await expect(saveReviewFile(base)).rejects.toThrow("ya está registrado");
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("distingue un archivo cargado de un registro confirmado",async () => {
    duplicates([]);
    mocks.confirm.mockResolvedValue(new Response(null,{status:409}));
    await expect(saveReviewFile(base)).rejects.toThrow("No se confirmó el registro");
  });
  it("una consulta denegada no habilita el registro ni presenta años vacíos",async () => {
    mocks.rpc.mockResolvedValue({data:null,error:{code:"42501"}});
    await expect(readReviewPeriods()).rejects.toThrow();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("pagina sólo metadatos del año seleccionado sin descargar objetos",async () => {
    const stub={id:"arch",resource_key:"2025:id",resource_type:reviewDocuments,category:"support"};
    const chain = { select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),like:vi.fn().mockReturnThis(),is:vi.fn().mockReturnThis(),
      order:vi.fn().mockReturnThis(),range:vi.fn().mockResolvedValueOnce({data:Array.from({length:100},(_,i)=>({...stub,id:String(i)}))}).mockResolvedValueOnce({data:[stub]}) };
    mocks.from.mockReturnValue(chain);
    expect(await listReviewFiles(reviewDocuments,year,false)).toHaveLength(101);
    expect(chain.like).toHaveBeenCalledWith("resource_key","2025:%");
    expect(chain.range.mock.calls).toEqual([[0,99],[100,199]]);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
