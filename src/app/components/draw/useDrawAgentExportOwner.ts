import { useEffect, useRef, type MutableRefObject } from "react";
import {
  registerDrawAgentExportOwner,
  type DrawAgentExportResult,
} from "./drawAgentCommandBridge";
import {
  buildDrawExportAction,
  toDrawExportDialogDefaults,
  type PendingDrawExportRequest,
} from "./drawWorkspaceUtils";

export type DrawAgentExportPending = {
  relativePath: string;
  resolve: (result: DrawAgentExportResult) => void;
  reject: (error: Error) => void;
};

export function useDrawAgentExportOwner(params: {
  activePath: string | null;
  ready: boolean;
  pendingExportRequestRef: MutableRefObject<PendingDrawExportRequest | null>;
  postToFrame: (payload: Record<string, unknown>) => void;
  setBusy: (value: boolean) => void;
  setStatus: (value: string) => void;
  waitingLabel: string;
}) {
  const {
    activePath,
    ready,
    pendingExportRequestRef,
    postToFrame,
    setBusy,
    setStatus,
    waitingLabel,
  } = params;
  const agentExportRef = useRef<DrawAgentExportPending | null>(null);

  useEffect(() => {
    if (!activePath || !ready) {
      return;
    }
    const unregister = registerDrawAgentExportOwner(activePath, (command) => {
      const format = command.format.trim().toLowerCase();
      if (!new Set(["png", "jpg", "jpeg", "svg", "pdf"]).has(format)) {
        return Promise.reject(new Error("research.ui_command.draw_format_invalid"));
      }
      if (agentExportRef.current) {
        return Promise.reject(new Error("research.ui_command.draw_export_busy"));
      }
      const defaults = toDrawExportDialogDefaults(command.sourcePath, format);
      const relativePath = `${defaults.defaultRelativeDir}/${defaults.defaultFileName}`
        .replace(/\\/g, "/")
        .replace(/\/+/g, "/");
      pendingExportRequestRef.current = { filename: defaults.defaultFileName, format };
      setBusy(true);
      setStatus(waitingLabel);
      postToFrame(buildDrawExportAction(pendingExportRequestRef.current));
      return new Promise<DrawAgentExportResult>((resolve, reject) => {
        agentExportRef.current = { relativePath, resolve, reject };
      });
    });
    return () => {
      unregister();
      const pending = agentExportRef.current;
      if (pending) {
        pending.reject(new Error("research.ui_command.draw_owner_changed"));
        agentExportRef.current = null;
      }
    };
  }, [activePath, pendingExportRequestRef, postToFrame, ready, setBusy, setStatus, waitingLabel]);

  return agentExportRef;
}
