import type {
  Ack,
  AgentModelBinding,
  AgentTeamPrefs,
  AppBackgroundImage,
  AppBackgroundImagePayload,
  AppSettings,
  AgentToolPrefs,
  CredentialSaveResult,
  McpValidationResult,
  McpServerConfig,
  ModelApiKeyValue,
  ModelCatalogItemInput,
  ModelDraftTestInput,
  ModelTestResult,
  ModelProtocolInput,
  PanelLayoutPrefs,
  ProtocolHealth,
  ProtocolTestInput,
} from "../types/app";
import { invokeCommand } from "./core";

export function getSettings(): Promise<AppSettings> {
  return invokeCommand<AppSettings>("settings_get");
}

export function updateSettings(input: {
  activeProjectId: string | null;
  modelProtocols: ModelProtocolInput[];
  modelCatalog: ModelCatalogItemInput[];
  agentBindings: AgentModelBinding[];
  uiPrefs?: {
    language?: "en-US" | "zh-CN";
    skipDeleteConfirm?: boolean;
    closeToTrayNoticeEnabled?: boolean;
    theme?: "light" | "dark" | "system";
    themePreset?: "default" | "graphite" | "paper" | "forest" | "ocean" | "rose" | "amber" | "highContrast";
    previewDefaultZoom?: number;
    paperBriefEngine?: "auto" | "pdfjs" | "python";
    terminalShell?: "powershell" | "cmd" | "system";
    panelLayout?: PanelLayoutPrefs;
    featureModelBindings?: {
      latexAgentModelId?: string;
      analysisAgentModelId?: string;
      gitSummaryModelId?: string;
      chatAgentModelId?: string;
      translationModelId?: string;
      completionModelId?: string;
    };
    channels?: {
      telegramEnabled?: boolean;
      telegramBotToken?: string;
      telegramChatId?: string;
    };
    closeBehavior?: "ask" | "tray" | "exit";
    closeBehaviorRemember?: boolean;
    backgroundImagePath?: string;
    backgroundImagePaths?: string[];
    backgroundBlurPx?: number;
    interfaceDensity?: "compact" | "comfortable" | "spacious";
    accentColor?: "emerald" | "blue" | "violet" | "rose" | "amber" | "custom";
    accentCustomColor?: string;
    scrollbarColorMode?: "accent" | "custom";
    scrollbarWidthPx?: number;
    scrollbarThumbColor?: string;
    scrollbarTrackColor?: string;
    glassOpacity?: number;
    glassBlurPx?: number;
    motionLevel?: "full" | "reduced" | "none";
    pdfPageGapPx?: number;
    logFontSizePx?: number;
    panelRadiusPx?: number;
    panelBorderContrast?: "soft" | "normal" | "strong";
    memoryGuardPrefs?: {
      enabled?: boolean;
      highWatermarkMb?: number;
      criticalWatermarkMb?: number;
      sampleIntervalSec?: number;
      criticalAction?: "release" | "sleep";
    };
    analysisEnvRootsByProject?: Record<string, string>;
    librarySelectedPathByProject?: Record<string, string>;
    libraryViewModeByProject?: Record<string, "bib" | "pdf" | "compare">;
    workspaceExplorerDefaultExpanded?: boolean;
    libraryExplorerDefaultExpanded?: boolean;
    workspaceExplorerExpandedPathsByProject?: Record<string, string[]>;
    libraryExplorerExpandedPathsByProject?: Record<string, string[]>;
    agentToolPrefs?: AgentToolPrefs;
    agentTeamPrefs?: AgentTeamPrefs;
    mcpServers?: McpServerConfig[];
    enabledSkills?: string[];
  };
}): Promise<AppSettings> {
  return invokeCommand<AppSettings>("settings_update", { input });
}

export function validateMcpServer(input: McpServerConfig): Promise<McpValidationResult> {
  return invokeCommand<McpValidationResult>("agent_mcp_validate", { input });
}

export function pickBackgroundImage(): Promise<AppBackgroundImage | null> {
  return invokeCommand<AppBackgroundImage | null>("settings_pick_background_image");
}

export function readBackgroundImage(path: string): Promise<AppBackgroundImagePayload | null> {
  return invokeCommand<AppBackgroundImagePayload | null>("settings_read_background_image", {
    input: { path },
  });
}

export function removeBackgroundImage(path: string): Promise<Ack> {
  return invokeCommand<Ack>("settings_remove_background_image", {
    input: { path },
  });
}

export function testProtocol(input: ProtocolTestInput): Promise<ProtocolHealth> {
  return invokeCommand<ProtocolHealth>("protocol_test", {
    input: {
      protocolId: input.protocolId,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
    },
  });
}

export function testModel(modelId: string): Promise<ModelTestResult> {
  return invokeCommand<ModelTestResult>("model_test", { input: { modelId } });
}

export function testModelDraft(input: ModelDraftTestInput): Promise<ModelTestResult> {
  return invokeCommand<ModelTestResult>("model_test_draft", {
    input: {
      protocolId: input.protocolId,
      baseUrl: input.baseUrl,
      requestName: input.requestName,
      apiKey: input.apiKey,
    },
  });
}

export function setModelApiKey(modelId: string, apiKey: string): Promise<Ack> {
  return invokeCommand<Ack>("model_api_key_set", {
    input: { modelId, apiKey },
  });
}

export function getModelApiKey(modelId: string): Promise<ModelApiKeyValue> {
  return invokeCommand<ModelApiKeyValue>("model_api_key_get", {
    input: { modelId },
  });
}

export function saveModelApiKeyVerified(input: {
  modelId: string;
  apiKey: string;
}): Promise<CredentialSaveResult> {
  return invokeCommand<CredentialSaveResult>("model_api_key_save_verified", {
    input: {
      modelId: input.modelId,
      apiKey: input.apiKey,
    },
  });
}



