import { createAdminClient } from "@/lib/supabase/admin";
import { certificationUuid } from "@/lib/customer-certifications";
import type { PortalReader } from "@/lib/customer-portal-link-server";

const headers = {"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"};
const missing = () => Response.json({error:"Expediente o evidencia no disponible."},{status:404,headers});
const unavailable = () => Response.json({error:"No se pudo verificar el expediente."},{status:503,headers});

type Plan = {id:string; corrective_action_id:string; description:string; status:string; due_date:string; evidence_file_id:string|null};
type Analysis = {root_cause:string|null; event_type:string|null; non_detection_cause:string|null; root_cause_whys?: unknown; non_detection_whys?: unknown; five_w_two_h?: Record<string, unknown> | null; workflow_metadata?:{evidenceId?:string;portalEvidence?:{actionId:string;customerId:string;ids:string[]}}|null};
type FileRow = {id:string; workspace_id:string|null; external_organization_id:string|null; audience:string; module_id:string; resource_type:string;
  resource_key:string; bucket_id:string; object_path:string; uploaded_by:string; original_name:string; is_current:boolean; deleted_at:string|null};

async function authorizedEvidence(db: ReturnType<typeof createAdminClient>,workspaceId:string,companyId:string,
  actionId:string,detail:Analysis|undefined,plans:Plan[],fileId?:string,proposed?:string[]) {
  const group = detail?.workflow_metadata?.evidenceId;
  const keys = group && certificationUuid.test(group) ? [
    ...Array.from({length:8},(_,step) => group + "_step_" + step),
    ...plans.map(plan => group + "_plan_" + plan.id),
  ] : [];
  const ids = plans.map(plan => plan.evidence_file_id).filter((id): id is string => !!id && certificationUuid.test(id));
  const grant = detail?.workflow_metadata?.portalEvidence;
  const selected = proposed ?? (grant?.actionId === actionId && grant.customerId === companyId && Array.isArray(grant.ids)
    ? grant.ids.filter(id => typeof id === "string" && certificationUuid.test(id)) : []);
  if (keys.length) {
    const collision = await db.from("corrective_action_a3").select("corrective_action_id")
      .eq("workflow_metadata->>evidenceId",group).neq("corrective_action_id",actionId).limit(1);
    if (collision.error) return null;
    if (collision.data?.length) keys.length=0;
  }
  const files = new Map<string,FileRow>();
  // Older internal stage uploads have no workspace_id. Verify their uploader's organization independently.
  const queryFiles = () => db.from("file_objects")
    .select("id,workspace_id,external_organization_id,audience,module_id,resource_type,resource_key,bucket_id,object_path,uploaded_by,original_name,is_current,deleted_at")
    .eq("module_id","corrective-actions").eq("resource_type","root2cause_evidence")
    .eq("bucket_id","integraq-private").eq("is_current",true).is("deleted_at",null);
  const groups = [
    {column:"resource_key",values:keys,explicit:false},
    {column:"id",values:ids,explicit:false},
    {column:"id",values:selected,explicit:true},
  ];
  for (const group of groups) {
    if (!group.values.length) continue;
    let query = queryFiles().in(group.column,group.values);
    if (!group.explicit) query=query.eq("workspace_id",workspaceId).eq("external_organization_id",companyId).eq("audience","customer");
    if (fileId) query=query.eq("id",fileId);
    const found: {data:FileRow[]|null;error:unknown}=await query;
    if (found.error) return null;
    const rows=found.data ?? [];
    const legacy=rows.filter(f=>f.workspace_id===null && group.explicit);
    const verifiedUploaders=new Set<string>();
    if (legacy.length) {
      const owners=await db.from("profiles").select("id").eq("organization_id",workspaceId).in("id",legacy.map(f=>f.uploaded_by));
      if(owners.error)return null;
      for(const owner of owners.data ?? [])verifiedUploaders.add(owner.id);
    }
    for (const file of rows) {
      const prefix = file.uploaded_by + "/attachments/corrective-actions/root2cause_evidence/" + file.resource_key + "/";
      const tenant = file.workspace_id===workspaceId || (file.workspace_id===null && verifiedUploaders.has(file.uploaded_by));
      const granted = file.audience==="customer" && file.external_organization_id===companyId ||
        (file.audience==="internal" && file.external_organization_id===null && selected.includes(file.id));
      if (tenant && granted && file.module_id==="corrective-actions" && file.resource_type==="root2cause_evidence" &&
          file.bucket_id==="integraq-private" && file.is_current && file.deleted_at===null && file.object_path.startsWith(prefix) &&
          !file.object_path.split("/").some(part=>part===".." || part===".") && (keys.includes(file.resource_key) || ids.includes(file.id))) files.set(file.id,file);
    }
  }
  return files;
}

// Recheck the persisted case and actual attachments before storing the administrator's selection.
export async function validatePortalEvidenceSelection(db: ReturnType<typeof createAdminClient>,workspace:string,company:string,
  actionId:string,evidenceId:string,selected:string[]) {
  const [analysis,planRows] = await Promise.all([
    db.from("corrective_action_a3").select("workflow_metadata").eq("corrective_action_id",actionId).maybeSingle(),
    db.from("corrective_action_plans").select("id,corrective_action_id,description,status,due_date,evidence_file_id").eq("corrective_action_id",actionId),
  ]);
  if (analysis.error || planRows.error || analysis.data?.workflow_metadata?.evidenceId !== evidenceId) return false;
  const files = await authorizedEvidence(db, workspace, company, actionId, analysis.data as Analysis, planRows.data ?? [], undefined, selected);
  return files !== null && selected.every(id => files.has(id));
}

export async function readPortalA3(actor: PortalReader, actionId: string, fileId?: string) {
  if (actor?.kind !== "customer" || !actor.companyId) return Response.json({error:"Acceso no autorizado."},{status:403,headers});
  if (!certificationUuid.test(actionId) || (fileId !== undefined && !certificationUuid.test(fileId))) return missing();
  const db = createAdminClient();
  const result = await db.from("corrective_actions")
    .select("id,organization_id,external_organization_id,source,portal_visible,deleted_at,folio,title,problem,area,status,progress,due_date,root_cause,corrective_action_a3(root_cause,event_type,non_detection_cause,root_cause_whys,non_detection_whys,five_w_two_h,workflow_metadata),corrective_action_plans(id,corrective_action_id,description,status,due_date,evidence_file_id)")
    .eq("id",actionId).eq("organization_id",actor.workspaceId).eq("external_organization_id",actor.companyId)
    .eq("source","customer").eq("portal_visible",true).is("deleted_at",null).maybeSingle();
  if (result.error) return unavailable();
  const row = result.data;
  if (!row || row.id !== actionId || row.organization_id !== actor.workspaceId || row.external_organization_id !== actor.companyId ||
      row.source !== "customer" || row.portal_visible !== true || row.deleted_at !== null) return missing();
  const detail: Analysis | undefined = Array.isArray(row.corrective_action_a3) ? row.corrective_action_a3[0] : row.corrective_action_a3;
  const plans: Plan[] = (row.corrective_action_plans ?? []).filter((plan:Plan) => plan.corrective_action_id === actionId);
  const files = await authorizedEvidence(db,actor.workspaceId,actor.companyId,actionId,detail,plans,fileId);
  if (!files) return unavailable();
  if (fileId) {
    const file = files.get(fileId);
    if (!file) return missing();
    const signed = await db.storage.from("integraq-private").createSignedUrl(file.object_path,60,{download:file.original_name});
    return signed.error || !signed.data ? unavailable() : Response.json({url:signed.data.signedUrl},{headers});
  }
  const questions = { what: "Qué ocurrió", why: "Por qué", where: "Dónde", when: "Cuándo", who: "Quién", how: "Cómo", howMuch: "Cuánto" };
  const characterization = Object.entries(questions).flatMap(([key,label]) => {
    const value = detail?.five_w_two_h?.[key];
    return typeof value === "string" && value.trim() ? [{label,value}] : [];
  });
  const answers = (value: unknown) => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())) : [];
  return Response.json({ characterization, causeAnalysis: answers(detail?.root_cause_whys), detectionAnalysis: answers(detail?.non_detection_whys), folio:row.folio,title:row.title,problem:row.problem,area:row.area,status:row.status,progress:row.progress,dueDate:row.due_date,
    eventType:detail?.event_type,rootCause:detail?.root_cause || row.root_cause,nonDetection:detail?.non_detection_cause,
    plans:plans.map(plan=>({id:plan.id,description:plan.description,status:plan.status,dueDate:plan.due_date})),
    evidence:[...files.values()].map(file=>({id:file.id,name:file.original_name}))},{headers});
}
