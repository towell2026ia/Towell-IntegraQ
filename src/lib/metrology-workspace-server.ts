import "server-only";

import { randomUUID } from "node:crypto";

import { demoMeasurementAssets } from "@/lib/demo-data";
import { normalizeMetrologyWorkspace, type MetrologyWorkspaceState } from "@/lib/metrology-report-data";
import { createAdminClient } from "@/lib/supabase/admin";

export const metrologyRegistrationNumber = "SYS-METROLOGY-WORKSPACE";
export const metrologyRecordNumber = "METROLOGY-WORKSPACE";

export type MetrologyActor = { id: string; userType: "administrator" | "internal" };

function withPublicTokens(workspace: MetrologyWorkspaceState) {
  let changed = false;
  const assets = workspace.assets.map((asset) => {
    if (asset.publicToken) return asset;
    changed = true;
    return { ...asset, publicToken: randomUUID().replace(/-/g, "") };
  });
  return { workspace: { ...workspace, assets }, changed };
}

export function isMetrologyWorkspace(value: unknown): value is MetrologyWorkspaceState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MetrologyWorkspaceState>;
  return Array.isArray(candidate.assets) && Array.isArray(candidate.reports);
}

export async function ensureMetrologyWorkspace(actor: MetrologyActor) {
  const admin = createAdminClient();
  let definition = await admin.from("form_definitions").select("id").eq("registration_number", metrologyRegistrationNumber).maybeSingle();
  if (definition.error) throw definition.error;
  if (!definition.data) {
    const created = await admin.from("form_definitions").insert({ registration_number: metrologyRegistrationNumber, name: "Expediente digital de metrología", process_id: "P-08", version: 1, status: "active", source_type: "manual", created_by: actor.id }).select("id").single();
    if (created.error) throw created.error;
    definition = { ...definition, data: created.data };
  }
  if (!definition.data) throw new Error("No fue posible inicializar la definición de metrología.");

  let record = await admin.from("form_records").select("id,values,updated_at").eq("record_number", metrologyRecordNumber).maybeSingle();
  if (record.error) throw record.error;
  if (!record.data) {
    const initial = withPublicTokens(normalizeMetrologyWorkspace(null, demoMeasurementAssets)).workspace;
    const created = await admin.from("form_records").insert({ form_id: definition.data.id, record_number: metrologyRecordNumber, status: "active", values: initial, created_by: actor.id }).select("id,values,updated_at").single();
    if (created.error) throw created.error;
    record = { ...record, data: created.data };
  } else {
    const normalized = withPublicTokens(normalizeMetrologyWorkspace(isMetrologyWorkspace(record.data.values) ? record.data.values : null, demoMeasurementAssets));
    if (normalized.changed) {
      const updated = await admin.from("form_records").update({ values: normalized.workspace }).eq("id", record.data.id).select("id,values,updated_at").single();
      if (updated.error) throw updated.error;
      record = { ...record, data: updated.data };
    }
  }
  if (!record.data) throw new Error("No fue posible inicializar el expediente de metrología.");
  return record.data;
}

export async function readMetrologyWorkspace() {
  const admin = createAdminClient();
  const result = await admin.from("form_records").select("id,values,updated_at").eq("record_number", metrologyRecordNumber).maybeSingle();
  if (result.error) throw result.error;
  return result.data && isMetrologyWorkspace(result.data.values) ? { ...result.data, values: result.data.values } : null;
}

export function prepareMetrologyWorkspace(incoming: MetrologyWorkspaceState, current?: MetrologyWorkspaceState) {
  const currentTokens = new Map((current?.assets ?? []).map((asset) => [asset.id, asset.publicToken]));
  return withPublicTokens({
    assets: incoming.assets.map((asset) => ({ ...asset, publicToken: asset.publicToken ?? currentTokens.get(asset.id) })),
    reports: incoming.reports,
  }).workspace;
}
