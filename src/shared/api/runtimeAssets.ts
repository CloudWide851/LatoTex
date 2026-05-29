import type { RuntimeAssetStatus } from "../plugins/pluginTypes";
import { invokeCommand } from "./core";

export function listRuntimeAssets(): Promise<RuntimeAssetStatus[]> {
  return invokeCommand<RuntimeAssetStatus[]>("runtime_asset_list");
}

export function installRuntimeAsset(pluginId: string, contributionId: string): Promise<RuntimeAssetStatus> {
  return invokeCommand<RuntimeAssetStatus>("runtime_asset_install", {
    input: { pluginId, contributionId },
  });
}

export function verifyRuntimeAsset(pluginId: string, contributionId: string): Promise<RuntimeAssetStatus> {
  return invokeCommand<RuntimeAssetStatus>("runtime_asset_verify", {
    input: { pluginId, contributionId },
  });
}

export function removeRuntimeAsset(pluginId: string, contributionId: string): Promise<RuntimeAssetStatus> {
  return invokeCommand<RuntimeAssetStatus>("runtime_asset_remove", {
    input: { pluginId, contributionId },
  });
}
