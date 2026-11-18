"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { loadWorkspaceData, saveWorkspaceData } from "@/lib/services/workspace-data-service";
import type { WorkspaceDataArea, WorkspaceDataSnapshot } from "@/lib/workspace-data";

export function useWorkspaceData(
  onHydrate: (data: WorkspaceDataSnapshot) => void,
  enabled = true,
) {
  const hydrateRef = useRef(onHydrate);
  const [ready, setReady] = useState(!enabled);
  const [error, setError] = useState("");

  useEffect(() => {
    hydrateRef.current = onHydrate;
  }, [onHydrate]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let active = true;
    void loadWorkspaceData()
      .then((data) => {
        if (!active) return;
        hydrateRef.current(data);
        setError("");
        setReady(true);
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el espacio.");
      });
    return () => { active = false; };
  }, [enabled]);

  const save = useCallback(async (area: WorkspaceDataArea, data: unknown) => {
    try {
      await saveWorkspaceData(area, data);
      setError("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No fue posible guardar el espacio.");
      throw saveError;
    }
  }, []);

  return { ready, error, save };
}
