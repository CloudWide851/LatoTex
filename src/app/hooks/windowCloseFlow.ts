export type WindowAction = "minimize" | "toggle" | "close";
export type CloseBehavior = "ask" | "tray" | "exit";

export type WindowControlPlan =
  | { type: "minimize"; trackBusy: false }
  | { type: "toggle"; trackBusy: true }
  | { type: "request-close-decision"; trackBusy: false }
  | { type: "run-close-behavior"; trackBusy: true; behavior: Exclude<CloseBehavior, "ask"> };

export type WindowCloseRequestPlan =
  | { type: "continue-close"; candidatePaths: string[] }
  | { type: "request-unsaved-guard"; candidatePaths: string[]; dirtyPaths: string[] };

export function resolveWindowControlPlan(
  action: WindowAction,
  closeBehavior: CloseBehavior,
): WindowControlPlan {
  if (action === "minimize") {
    return { type: "minimize", trackBusy: false };
  }
  if (action === "toggle") {
    return { type: "toggle", trackBusy: true };
  }
  if (closeBehavior === "ask") {
    return { type: "request-close-decision", trackBusy: false };
  }
  return {
    type: "run-close-behavior",
    trackBusy: true,
    behavior: closeBehavior,
  };
}

export function resolveWindowCloseRequestPlan(
  candidatePaths: string[],
  dirtyPaths: string[],
): WindowCloseRequestPlan {
  if (dirtyPaths.length > 0) {
    return {
      type: "request-unsaved-guard",
      candidatePaths,
      dirtyPaths,
    };
  }
  return {
    type: "continue-close",
    candidatePaths,
  };
}
