import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { POST } from "./route";

const m = vi.hoisted(() => ({ user: vi.fn(), db: vi.fn(), attest: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: m.user }, rpc: m.db, storage: { from: () => ({ download: m.read }) },
}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: m.attest }) }));
const id = "55555555-5555-4555-8555-555555555555";
const sha = createHash("sha256").update("acta").digest("hex");
const transfer = { id, resource_type:"management_review_document", resource_key:"2025:key", previous_id:null,
  expected_at:null, result_id:null, uploaded:true, payload:{sha,size:4}, object_path:"ruta-reservada" };
const request = () => new Request("https://integraq.test/api/management-review/transfers", {
  method:"POST",body:JSON.stringify({id,object_path:"ignored"}),headers:{"Content-Type":"application/json"},
});
function bind(row: typeof transfer | null) {
  m.db.mockImplementation((name:string) => name === "iq_review_transfers" ?
    {eq:()=>({maybeSingle:async()=>({data:row})})} : Promise.resolve({data:id}));
}
beforeEach(() => {
  vi.resetAllMocks();
  m.user.mockResolvedValue({data:{user:{id:"admin"}}});
  bind(transfer);
  m.attest.mockResolvedValue({error:null});
  m.read.mockResolvedValue({data:new Blob(["acta"])});
});
it("confirma a partir de los bytes privados y los metadatos de la reserva", async () => {
  expect((await POST(request())).status).toBe(200);
  expect(m.read).toHaveBeenCalledWith("ruta-reservada");
  expect(m.attest).toHaveBeenCalledWith("iq_review_attest",{p_id:id,p_actor:"admin",p_size:4,p_sha:sha});
  expect(m.db).toHaveBeenCalledWith("iq_review_write",expect.objectContaining({p_data:transfer.payload}));
});
it("rechaza bytes distintos de igual tamaño y permite reintentar una lectura interrumpida",async () => {
  m.read.mockResolvedValueOnce({data:new Blob(["xxxx"])}).mockResolvedValueOnce({error:true});
  expect((await POST(request())).status).toBe(409);
  expect((await POST(request())).status).toBe(503);
  expect(m.attest).not.toHaveBeenCalled();
  expect((await POST(request())).status).toBe(200);
});
it("rechaza una reserva ajena y una sesión ausente antes de abrir el objeto",async () => {
  bind(null);
  expect((await POST(request())).status).toBe(403);
  m.user.mockResolvedValue({data:{user:null}});
  expect((await POST(request())).status).toBe(401);
  expect(m.read).not.toHaveBeenCalled();
  expect(m.attest).not.toHaveBeenCalled();
});
