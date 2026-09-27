"use client";

import { useCallback, useEffect, useState } from "react";

import type { GeneralInformationSnapshot } from "@/lib/general-information";
import { fetchGeneralInformation } from "@/lib/services/general-information-service";

const emptySnapshot: GeneralInformationSnapshot = { folders: [], documents: [], audit: [] };

export function useGeneralInformation(parameters: Parameters<typeof fetchGeneralInformation>[0]) {
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const folderId = parameters?.folderId;
  const query = parameters?.query;
  const referenceType = parameters?.referenceType;
  const validityStatus = parameters?.validityStatus;
  const sort = parameters?.sort;
  const administrationView = parameters?.administrationView;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSnapshot(await fetchGeneralInformation({ folderId, query, referenceType, validityStatus, sort, administrationView }));
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar Información General.");
    } finally {
      setLoading(false);
    }
  }, [administrationView, folderId, query, referenceType, sort, validityStatus]);

  useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);
  return { ...snapshot, loading, error, refresh };
}
