import { beforeEach, describe, expect, it, vi } from "vitest";
import { listReviewFiles, readReviewPeriods, reviewDocuments, saveReviewFile } from "./review-document-storage";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), upload: vi.fn(), user: vi.fn(),
}));
vi.mock("./supabase/client", () => ({
  createClient: () => ({ rpc: mocks.rpc, from: mocks.from, auth: { getUser: mocks.user },
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
  mocks.user.mockResolvedValue({data:{user:{id:"actor"}}});
  mocks.upload.mockResolvedValue({error:null});
  mocks.rpc.mockResolvedValue({data:"revision-id",error:null});
});

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
    expect(mocks.upload).toHaveBeenCalledWith("actor/attachments/management-review/management_review_document/2025-document-id/revision-id/Documento.pdf",base.file,{contentType:"application/pdf",upsert:false});
    expect(mocks.rpc).toHaveBeenCalledWith("iq_review_write",expect.objectContaining({
      p_type:reviewDocuments,p_key:"2025:document-id",p_previous:null,p_data:expect.objectContaining({section:"risks",size:4,sha:expect.stringMatching(/^[a-f0-9]{64}$/)}),
    }));
  });
  it("conserva el original registrado y no vuelve a cargar sus bytes",async () => {
    duplicates([{id:"original"}]);
    await expect(saveReviewFile(base)).rejects.toThrow("ya está registrado");
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("distingue un archivo cargado de un registro confirmado",async () => {
    duplicates([]);
    mocks.rpc.mockResolvedValue({data:null,error:{message:"REVIEW_CHANGED"}});
    await expect(saveReviewFile(base)).rejects.toThrow("El expediente cambió");
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
