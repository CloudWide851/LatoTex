import type {
  Ack,
  RuntimeLogInfo,
  RuntimeLogReadFilters,
  RuntimeLogReadResponse,
  RuntimeLogSessionListResponse,
  RuntimeMemorySnapshot,
} from "../types/app";
import { invokeCommand } from "./core";

export function runtimeLogWrite(level: string, message: string): Promise<Ack> {
  return invokeCommand<Ack>("runtime_log_write", { input: { level, message } });
}

export function runtimeLogInfo(): Promise<RuntimeLogInfo> {
  return invokeCommand<RuntimeLogInfo>("runtime_log_info");
}

export function runtimeLogListSessions(): Promise<RuntimeLogSessionListResponse> {
  return invokeCommand<RuntimeLogSessionListResponse>("runtime_log_list_sessions");
}

export function runtimeMemorySnapshot(): Promise<RuntimeMemorySnapshot> {
  return invokeCommand<RuntimeMemorySnapshot>("runtime_memory_snapshot");
}

export function runtimeLogRead(filters: RuntimeLogReadFilters = {}): Promise<RuntimeLogReadResponse> {
  return invokeCommand<RuntimeLogReadResponse>("runtime_log_read", { input: filters });
}

export function runtimeLogClearCurrentSession(confirmToken = "CLEAR_CURRENT_SESSION"): Promise<Ack> {
  return invokeCommand<Ack>("runtime_log_clear_current_session", {
    input: { confirmToken },
  });
}
