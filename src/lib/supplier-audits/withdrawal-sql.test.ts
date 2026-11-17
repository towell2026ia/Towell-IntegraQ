import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql = readFileSync("docs/database/proposals/IQ-PROV-MEJORAS-02-audit-withdrawal.sql", "utf8");
const original = readFileSync("supabase/migrations/20261106221636_supplier_audit_calendar.sql", "utf8");
const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
function body(name: string) {
 const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
 const from = sql.indexOf("AS $function$", start) + "AS $function$".length;
 return sql.slice(from, sql.indexOf("$function$", from));
}
describe("proposed SQL static safety review (does not execute SQL)", () => {
 it("creates only the three retirement columns, with all-or-none constraint and original state unchanged", () => {
  expect(sql.match(/ADD COLUMN /g)).toHaveLength(3);
  expect(sql).toContain("withdrawn_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT");
  expect(sql).toContain("withdrawn_at IS NULL AND withdrawn_by IS NULL AND withdrawal_reason IS NULL");
  expect(sql).not.toMatch(/CREATE TABLE|DROP |TRUNCATE|DELETE FROM|ALTER .*state_check/i);
 });
 it("pins replaced dependencies and fails atomically instead of overriding unknown functions", () => {
  expect(sql.match(/md5\(pg_get_functiondef/g)).toHaveLength(5);
  expect(sql).toContain("AUDIT_WITHDRAWAL_ALREADY_INSTALLED_REVIEW_REQUIRED");
  expect(sql).toContain("BEGIN;"); expect(sql.trim().endsWith("COMMIT;")).toBe(true);
 });
 it.each([["iq_supplier_audit_save", "previous"], ["iq_supplier_audit_file", "event_row"], ["iq_supplier_audit_result", "e"]])("%s changes only the guarded retirement check", (name, row) => {
  const oldStart = original.indexOf(`create function public.${name}(`), from = original.indexOf("as $$", oldStart) + 5;
  const oldBody = original.slice(from, original.indexOf("$$;", from));
  const guarded = body(name), guard = `if ${row}.withdrawn_at is not null then raise exception 'AUDIT_WITHDRAWN'; end if;`;
  expect(guarded).toContain(guard);
  expect(normalize(guarded.replace(guard, ""))).toBe(normalize(oldBody));
  expect(guarded.indexOf(guard)).toBeGreaterThan(guarded.indexOf("for update"));
  expect(guarded.indexOf(guard)).toBeGreaterThan(guarded.indexOf("AUDIT_CONFLICT"));
 });
 it("retirement uses scoped lock, revision and transaction log without changing documents or results", () => {
  const rpc = sql.split("AS $withdraw$")[1].split("$withdraw$;")[0];
  expect(rpc.indexOf("AUDIT_ADMIN_REQUIRED")).toBeLessThan(rpc.indexOf("for update"));
  expect(rpc).toContain("where id=p_event and organization_id=selected_org for update");
  expect(rpc.indexOf("AUDIT_CONFLICT")).toBeLessThan(rpc.indexOf("update public.supplier_audit_events"));
  const update = rpc.split("update public.supplier_audit_events set")[1].split("returning * into saved")[0];
  expect(update).not.toMatch(/state=|actual_date|supplier_id|planned_date|score|file_objects|storage/i);
  expect(rpc).toContain("to_jsonb(previous),to_jsonb(saved),reason");
  expect(rpc).toContain("AUDIT_WITHDRAWAL_LOG_REQUIRED");
  expect(rpc).not.toMatch(/insert into public.supplier_audit_events|delete |storage\.|supplier_assessments/i);
 });
 it("RPC is internal-only and has a fixed search path without granting table writes", () => {
  expect(sql).toContain("SECURITY DEFINER SET search_path = ''");
  expect(sql).toContain("FROM PUBLIC, anon, authenticated");
  expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.iq_supplier_audit_set_withdrawn(uuid,integer,boolean,text) TO authenticated");
  expect(sql).not.toMatch(/GRANT ALL|CREATE POLICY|CREATE TRIGGER/i);
 });
 it("does not invoke mutation RPCs or seed/import data during activation", () => {
  const outsideBodies = sql.replace(/\$([a-z]+)\$[\s\S]*?\$\1\$/g, "BODY");
  expect(outsideBodies).not.toMatch(/INSERT INTO|UPDATE public\.|DELETE FROM|SELECT public\.iq_supplier_audit_|PERFORM /i);
 });
});
