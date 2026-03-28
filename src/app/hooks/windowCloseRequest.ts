import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef } from "react";
import type { EditorTab } from "../../shared/types/app";
import type { CloseBehavior } from "./windowCloseFlow";

export type NativeWindowClosePlan =
  | { type: "allow-native-close" }
  | {
      type: "delegate-close";
      candidatePaths: string[];
      dirtyPaths: string[];
      reason: "dirty" | "closeBehavior";
    };

export function resolveNativeWindowClosePlan(
  candidatePaths: string[],
  dirtyPaths: string[],
  closeBehavior: CloseBehavior,
): NativeWindowClosePlan {
  if (dirtyPaths.length > 0) {
    return {
      type: "delegate-close",
      candidatePaths,
      dirtyPaths,
      reason: "dirty",
    };
  }
  if (closeBehavior === "exit") {
    return { type: "allow-native-close" };
  }
  return {
    type: "delegate-close",
    candidatePaths,
    dirtyPaths,
    reason: "closeBehavior",
  };
}

export function useNativeWindowCloseBridge(isTauriRuntime: boolean) {
  const allowNextWindowCloseRef = useRef(false);

  const requestNativeWindowClose = useCallback(async (bypassInterception = false) => {
    if (!isTauriRuntime) {
      return false;
    }
    if (bypassInterception) {
      allowNextWindowCloseRef.current = true;
    }
    try {
      await getCurrentWindow().close();
      return true;
    } catch (error) {
      if (bypassInterception) {
        allowNextWindowCloseRef.current = false;
      }
      throw error;
    }
  }, [isTauriRuntime]);

  return {
    allowNextWindowCloseRef,
    requestNativeWindowClose,
  };
}

export function useNativeWindowCloseInterception(params: {
  isTauriRuntime: boolean;
  closeBehavior: CloseBehavior;
  editorTabsRef: React.MutableRefObject<EditorTab[]>;
  allowNextWindowCloseRef: React.MutableRefObject<boolean>;
  collectDirtyPaths: (candidatePaths: string[]) => string[];
  requestUnsavedGuard: (
    intent: "switchFile" | "switchProject" | "closeWindow" | "closeTabs",
    candidatePaths: string[],
    onContinue: () => void | Promise<void>,
  ) => void;
  onDelegateClose: () => void | Promise<void>;
}) {
  const {
    isTauriRuntime,
    closeBehavior,
    editorTabsRef,
    allowNextWindowCloseRef,
    collectDirtyPaths,
    requestUnsavedGuard,
    onDelegateClose,
  } = params;

  useEffect(() => {
    if (!isTauriRuntime) {
      return;
    }
    let unlisten: (() => void) | undefined;
    let disposed = false;

    getCurrentWindow()
      .onCloseRequested((event) => {
        if (allowNextWindowCloseRef.current) {
          allowNextWindowCloseRef.current = false;
          return;
        }
        const candidatePaths = editorTabsRef.current.map((tab) => tab.path);
        const dirtyPaths = collectDirtyPaths(candidatePaths);
        const plan = resolveNativeWindowClosePlan(candidatePaths, dirtyPaths, closeBehavior);
        if (plan.type === "allow-native-close") {
          return;
        }
        event.preventDefault();
        if (plan.reason === "dirty") {
          requestUnsavedGuard("closeWindow", plan.candidatePaths, async () => {
            await onDelegateClose();
          });
          return;
        }
        void onDelegateClose();
      })
      .then((off) => {
        if (disposed) {
          off();
          return;
        }
        unlisten = off;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [
    allowNextWindowCloseRef,
    closeBehavior,
    collectDirtyPaths,
    editorTabsRef,
    isTauriRuntime,
    onDelegateClose,
    requestUnsavedGuard,
  ]);
}
