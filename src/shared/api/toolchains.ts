import type { ToolchainStatus } from "../plugins/pluginTypes";
import { invokeCommand } from "./core";

export function listToolchains(): Promise<ToolchainStatus[]> {
  return invokeCommand<ToolchainStatus[]>("toolchain_list");
}

export function installToolchain(pluginId: string, contributionId: string): Promise<ToolchainStatus> {
  return invokeCommand<ToolchainStatus>("toolchain_install", {
    input: { pluginId, contributionId },
  });
}

export function verifyToolchain(pluginId: string, contributionId: string): Promise<ToolchainStatus> {
  return invokeCommand<ToolchainStatus>("toolchain_verify", {
    input: { pluginId, contributionId },
  });
}

export function pickToolchainDirectory(): Promise<string | null> {
  return invokeCommand<string | null>("toolchain_pick_directory");
}

export function registerLocalToolchain(
  pluginId: string,
  contributionId: string,
  rootDir: string,
): Promise<ToolchainStatus> {
  return invokeCommand<ToolchainStatus>("toolchain_register_local", {
    input: { pluginId, contributionId, rootDir },
  });
}

export function removeToolchain(pluginId: string, contributionId: string): Promise<ToolchainStatus> {
  return invokeCommand<ToolchainStatus>("toolchain_remove", {
    input: { pluginId, contributionId },
  });
}
