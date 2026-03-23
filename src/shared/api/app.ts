import type { Ack } from "../types/app";
import type { HealthCheckResponse } from "../types/health";
import { invokeCommand } from "./core";

export function getHealthCheck(): Promise<HealthCheckResponse> {
  return invokeCommand<HealthCheckResponse>("health_check");
}

export function windowSyncIcon(): Promise<Ack> {
  return invokeCommand<Ack>("window_sync_icon");
}

export function exitApplication(): Promise<Ack> {
  return invokeCommand<Ack>("app_exit");
}

export function setTrayLabels(showLabel: string, exitLabel: string, tooltip: string): Promise<Ack> {
  return invokeCommand<Ack>("tray_set_labels", {
    input: {
      showLabel,
      exitLabel,
      tooltip,
    },
  });
}

export function openExternalLink(url: string): Promise<Ack> {
  return invokeCommand<Ack>("open_external_link", {
    input: { url },
  });
}
