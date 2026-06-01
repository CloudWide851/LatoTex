import { invokeCommand } from "../../shared/api/core";

type SmokeProgressDetail = Record<string, unknown> | null | undefined;

export function writeTauriSmokeProgress(
  stage: string,
  status: "ok" | "error" | "warning",
  detail?: SmokeProgressDetail,
) {
  if (typeof window === "undefined") {
    return;
  }
  void invokeCommand("app_smoke_progress", {
    input: {
      stage,
      status,
      detail: detail ?? null,
    },
  }).catch(() => undefined);
}
