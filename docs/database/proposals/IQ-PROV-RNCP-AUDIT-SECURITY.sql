-- PROPOSAL ONLY. No execution. Install after RNCP base + V2 + PHOTO-KEY, before FLOW/ENVIO.
-- Reuses/supersedes the PREPARED PHOTO-AUDIT-GUARD policies. Do NOT install both files.
-- No existing audit rows are rewritten. Unrelated modules and manual audits return unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $preflight$
DECLARE t text;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'RNCP_AUDIT_OWNER_REQUIRED'; END IF;
 FOREACH t IN ARRAY ARRAY['audit_log','supplier_rncp_reports','supplier_rncp_notification_outbox','supplier_rncp_initial_photo_sets'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.'||t) AND relrowsecurity AND pg_get_userbyid(relowner)='postgres') THEN RAISE EXCEPTION 'RNCP_AUDIT_BASE_REQUIRED: %',t; END IF;
 END LOOP;
 IF to_regprocedure('public.iq_rncp_actor_org(boolean)') IS NULL
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.iq_rncp_initial_photo_stage(uuid,jsonb)')
    AND pg_get_userbyid(proowner)='postgres' AND position('initial-photo:' in prosrc)>0)
 THEN RAISE EXCEPTION 'RNCP_AUDIT_PHOTO_KEY_REQUIRED'; END IF;
 IF to_regprocedure('public.iq_rncp_audit_integrity()') IS NOT NULL
  OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.audit_log'::regclass
   AND polname IN ('rncp_initial_photo_audit_organization','rncp_initial_photo_audit_server_insert','rncp_audit_no_update','rncp_audit_no_delete'))
 THEN RAISE EXCEPTION 'RNCP_AUDIT_ALREADY_PRESENT_REVIEW'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.audit_log'::regclass AND tgname='audit_log_prepare' AND tgenabled<>'D')
 THEN RAISE EXCEPTION 'RNCP_AUDIT_PREPARE_TRIGGER_REQUIRED'; END IF;
END;
$preflight$;

-- Parent organization is authoritative; never trust actor_id or supplied organization alone.
-- Extends the existing proposed photo guard to reserve the mail/PDF namespaces too.
CREATE POLICY rncp_initial_photo_audit_organization ON public.audit_log
 AS RESTRICTIVE FOR SELECT TO authenticated
 USING (
  CASE WHEN resource_type='supplier_rncp_report' THEN
   EXISTS(
    SELECT 1 FROM public.profiles p
    JOIN public.organizations o ON o.id=p.organization_id
    JOIN public.supplier_rncp_reports r ON r.id::text=audit_log.resource_id
    WHERE p.id=auth.uid() AND r.organization_id=p.organization_id
     AND p.status='active' AND p.user_type IN ('administrator','internal')
     AND coalesce(p.workspace_mode,'production')='production' AND o.kind='internal' AND o.active
     AND (r.deleted_at IS NULL OR p.user_type='administrator')
     AND public.has_module_permission('suppliers','view')
     AND public.has_permission('proveedores.acceder') AND public.has_permission('proveedores.ver')
   )
  WHEN left(action,18)='rncp.initial_photo' OR left(action,10)='rncp.mail_'
   OR action IN ('rncp.pdf_generated','rncp.classification_changed','rncp.record_manual_notification') THEN false
  ELSE true END
 );
-- Authoritative SECURITY DEFINER RPCs owned by postgres bypass RLS.
-- Direct authenticated inserts cannot forge RNCP events, including their own records.
CREATE POLICY rncp_initial_photo_audit_server_insert ON public.audit_log
 AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK (
  coalesce(resource_type,'')<>'supplier_rncp_report'
  AND left(coalesce(action,''),18)<>'rncp.initial_photo'
  AND left(coalesce(action,''),10)<>'rncp.mail_'
  AND coalesce(action,'') NOT IN ('rncp.pdf_generated','rncp.classification_changed','rncp.record_manual_notification')
 );
CREATE POLICY rncp_audit_no_update ON public.audit_log
 AS RESTRICTIVE FOR UPDATE TO authenticated
 USING (coalesce(resource_type,'')<>'supplier_rncp_report'
  AND left(coalesce(action,''),18)<>'rncp.initial_photo'
  AND left(coalesce(action,''),10)<>'rncp.mail_'
  AND coalesce(action,'') NOT IN ('rncp.pdf_generated','rncp.classification_changed','rncp.record_manual_notification'))
 WITH CHECK (coalesce(resource_type,'')<>'supplier_rncp_report'
  AND left(coalesce(action,''),18)<>'rncp.initial_photo'
  AND left(coalesce(action,''),10)<>'rncp.mail_'
  AND coalesce(action,'') NOT IN ('rncp.pdf_generated','rncp.classification_changed','rncp.record_manual_notification'));
CREATE POLICY rncp_audit_no_delete ON public.audit_log
 AS RESTRICTIVE FOR DELETE TO authenticated
 USING (coalesce(resource_type,'')<>'supplier_rncp_report'
  AND left(coalesce(action,''),18)<>'rncp.initial_photo'
  AND left(coalesce(action,''),10)<>'rncp.mail_'
  AND coalesce(action,'') NOT IN ('rncp.pdf_generated','rncp.classification_changed','rncp.record_manual_notification'));

-- SECURITY INVOKER deliberately: the trigger must observe the actual DML execution role.
-- A SECURITY DEFINER trigger here would incorrectly turn an authenticated insert into postgres.
CREATE FUNCTION public.iq_rncp_audit_integrity() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $integrity$
DECLARE protected_old boolean:=false; protected_new boolean:=false;
 r public.supplier_rncp_reports%rowtype; job jsonb; is_mail boolean;
BEGIN
 IF TG_OP IN ('UPDATE','DELETE') THEN
  protected_old:=coalesce(OLD.resource_type,'')='supplier_rncp_report'
   OR left(coalesce(OLD.action,''),18)='rncp.initial_photo'
   OR left(coalesce(OLD.action,''),10)='rncp.mail_'
   OR coalesce(OLD.action,'') IN ('rncp.pdf_generated','rncp.classification_changed','rncp.record_manual_notification');
  IF protected_old THEN RAISE EXCEPTION 'RNCP_AUDIT_IMMUTABLE'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 protected_new:=coalesce(NEW.resource_type,'')='supplier_rncp_report'
  OR left(coalesce(NEW.action,''),18)='rncp.initial_photo'
  OR left(coalesce(NEW.action,''),10)='rncp.mail_'
  OR coalesce(NEW.action,'') IN ('rncp.pdf_generated','rncp.classification_changed','rncp.record_manual_notification');
 IF NOT protected_new THEN RETURN NEW; END IF;
 IF TG_OP<>'INSERT' OR current_user<>'postgres' THEN
  RAISE EXCEPTION USING errcode='42501',message='RNCP_AUDIT_RPC_ONLY';
 END IF;
 IF NEW.resource_type IS DISTINCT FROM 'supplier_rncp_report' OR NEW.module IS DISTINCT FROM 'suppliers'
  OR NEW.actor_id IS NULL THEN RAISE EXCEPTION 'RNCP_AUDIT_IDENTITY_REQUIRED'; END IF;
 SELECT * INTO r FROM public.supplier_rncp_reports WHERE id::text=NEW.resource_id;
 IF r.id IS NULL OR r.organization_id IS NULL THEN RAISE EXCEPTION 'RNCP_AUDIT_PARENT_REQUIRED'; END IF;
 -- Runs AFTER audit_log_prepare: override inferred actor organization with the actual parent.
 NEW.organization_id:=r.organization_id;
 NEW.entity_code_snapshot:=r.folio;
 is_mail:=left(coalesce(NEW.action,''),10)='rncp.mail_';
 IF is_mail THEN
  -- JSON projection lets this guard be installed BEFORE the ENVIO columns exist.
  SELECT to_jsonb(j) INTO job FROM public.supplier_rncp_notification_outbox j
   WHERE j.report_id=r.id AND j.organization_id=r.organization_id AND j.event_type='initial';
  IF job IS NULL OR job->>'initial_phase' IS NULL THEN RAISE EXCEPTION 'RNCP_MAIL_AUDIT_JOB_REQUIRED'; END IF;
  IF NEW.action IN ('rncp.mail_prepared','rncp.mail_preparation_revised','rncp.mail_claimed','rncp.mail_transport_result') THEN
   IF NEW.actor_id::text IS DISTINCT FROM job#>>'{initial_payload,actorId}' THEN RAISE EXCEPTION 'RNCP_MAIL_AUDIT_ACTOR'; END IF;
  END IF;
  IF NEW.action='rncp.mail_preparation_revised' THEN
   IF job->>'initial_phase'<>'prepared' OR NEW.new_value IS DISTINCT FROM job->'initial_payload'
    THEN RAISE EXCEPTION 'RNCP_MAIL_AUDIT_STATE'; END IF;
  ELSIF NEW.action IN ('rncp.mail_prepared','rncp.mail_claimed','rncp.mail_transport_result') THEN
   IF NEW.new_value IS DISTINCT FROM job THEN RAISE EXCEPTION 'RNCP_MAIL_AUDIT_SNAPSHOT'; END IF;
   IF (NEW.action='rncp.mail_prepared' AND job->>'initial_phase'<>'prepared')
    OR (NEW.action='rncp.mail_claimed' AND job->>'initial_phase'<>'dispatching')
    OR (NEW.action='rncp.mail_transport_result' AND job->>'initial_phase' NOT IN ('dispatching','unknown','failed','accepted_pending_record'))
    THEN RAISE EXCEPTION 'RNCP_MAIL_AUDIT_STATE'; END IF;
   IF job->>'initial_phase'='accepted_pending_record' AND (
     job#>>'{initial_receipt,outcome}' IS DISTINCT FROM 'accepted'
     OR nullif(job->>'provider_message_id','') IS NULL
     OR job->>'provider_message_id' IS DISTINCT FROM job#>>'{initial_receipt,messageId}'
     OR job->>'sent_at' IS NULL)
    THEN RAISE EXCEPTION 'RNCP_MAIL_AUDIT_RECEIPT'; END IF;
  ELSIF NEW.action='rncp.mail_accepted' THEN
   IF NEW.actor_id IS DISTINCT FROM auth.uid()
    OR job->>'initial_phase'<>'accepted' OR job->>'delivery_state' IS DISTINCT FROM 'sent'
    OR job#>>'{initial_receipt,outcome}' IS DISTINCT FROM 'accepted'
    OR nullif(job->>'provider_message_id','') IS NULL
    OR job->>'provider_message_id' IS DISTINCT FROM job#>>'{initial_receipt,messageId}'
    OR job->>'sent_at' IS NULL
    OR NEW.new_value IS DISTINCT FROM to_jsonb(r)
    OR NEW.metadata->>'jobId' IS DISTINCT FROM job->>'id'
    OR NEW.metadata->'pdf' IS DISTINCT FROM job->'initial_payload'
    OR NEW.metadata->>'recipient' IS DISTINCT FROM job->>'recipient_email'
    OR r.notified_at IS DISTINCT FROM (job->>'sent_at')::timestamptz
    OR r.notification_reference IS DISTINCT FROM 'email:microsoft-graph:'||(job->>'provider_message_id')
   THEN RAISE EXCEPTION 'RNCP_MAIL_AUDIT_ACCEPTANCE_REQUIRED'; END IF;
  ELSE RAISE EXCEPTION 'RNCP_MAIL_AUDIT_EVENT_UNSUPPORTED';
  END IF;
 END IF;
 RETURN NEW;
END;
$integrity$;
ALTER FUNCTION public.iq_rncp_audit_integrity() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.iq_rncp_audit_integrity() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER zz_iq_rncp_audit_integrity BEFORE INSERT OR UPDATE OR DELETE ON public.audit_log
 FOR EACH ROW EXECUTE FUNCTION public.iq_rncp_audit_integrity();
NOTIFY pgrst,'reload schema';
COMMIT;
