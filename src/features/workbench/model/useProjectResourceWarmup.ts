import { useEffect, useRef } from "react";
import { resourceWarmupStart } from "@shared/api/resource-warmup";

export function useProjectResourceWarmup(params: {
  activeProjectId: string | null;
  suspended?: boolean;
}) {
  const { activeProjectId, suspended = false } = params;
  const warmedProjectRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeProjectId || suspended) {
      return;
    }
    if (warmedProjectRef.current === activeProjectId) {
      return;
    }
    warmedProjectRef.current = activeProjectId;
    void resourceWarmupStart({
      projectId: activeProjectId,
      scopes: ["drawio", "tectonic"],
    }).catch(() => {
      if (warmedProjectRef.current === activeProjectId) {
        warmedProjectRef.current = null;
      }
    });
  }, [activeProjectId, suspended]);
}
