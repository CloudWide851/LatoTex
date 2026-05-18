export type TranslationFn = (key: any) => string;
export type DoctorStatus = "pass" | "warn" | "fail" | "info";
export type DoctorPhase = "pending" | "running" | "done";
export type DoctorRepairId =
  | "projectIntegrity"
  | "searchIndex"
  | "libraryCitationIndex"
  | "latexSession"
  | "latexLayout"
  | "pythonEnv"
  | "releaseMemory";

export const SAFE_REPAIR_IDS = new Set<DoctorRepairId>([
  "projectIntegrity",
  "searchIndex",
  "libraryCitationIndex",
  "latexSession",
  "latexLayout",
  "releaseMemory",
]);

const REPAIR_CHECK_TARGETS: Record<DoctorRepairId, DoctorCheckId[]> = {
  projectIntegrity: ["projectIntegrity"],
  searchIndex: ["searchIndex"],
  libraryCitationIndex: ["libraryCitationIndex"],
  latexSession: ["latexSession"],
  latexLayout: ["latexLayout"],
  pythonEnv: ["pythonEnv"],
  releaseMemory: ["memory"],
};

export type DoctorCheck = {
  id: string;
  titleKey: string;
  status: DoctorStatus;
  phase: DoctorPhase;
  messageKey: string;
  params?: Record<string, string>;
  repairId?: DoctorRepairId;
};

export type DoctorCheckId =
  | "runtimeLog"
  | "memory"
  | "projectIntegrity"
  | "searchIndex"
  | "latexSession"
  | "pythonEnv"
  | "latexLayout"
  | "mcpConfig"
  | "skillsConfig"
  | "analysisStore"
  | "libraryCitationIndex"
  | "shareCollab"
  | "releaseReadiness"
  | "runtimeAssets";

export function repairTargetsForRepairId(repairId: DoctorRepairId): DoctorCheckId[] {
  return REPAIR_CHECK_TARGETS[repairId] ?? [];
}

export const DOCTOR_CHECK_ORDER: Array<{ id: DoctorCheckId; titleKey: string }> = [
  { id: "runtimeLog", titleKey: "settings.doctor.runtimeLog" },
  { id: "memory", titleKey: "settings.doctor.memory" },
  { id: "projectIntegrity", titleKey: "settings.doctor.project" },
  { id: "searchIndex", titleKey: "settings.doctor.searchIndex" },
  { id: "latexSession", titleKey: "settings.doctor.latexSession" },
  { id: "pythonEnv", titleKey: "settings.doctor.pythonEnv" },
  { id: "latexLayout", titleKey: "settings.doctor.latexLayout" },
  { id: "mcpConfig", titleKey: "settings.doctor.mcpConfig" },
  { id: "skillsConfig", titleKey: "settings.doctor.skillsConfig" },
  { id: "analysisStore", titleKey: "settings.doctor.analysisStore" },
  { id: "libraryCitationIndex", titleKey: "settings.doctor.libraryCitationIndex" },
  { id: "shareCollab", titleKey: "settings.doctor.shareCollab" },
  { id: "releaseReadiness", titleKey: "settings.doctor.releaseReadiness" },
  { id: "runtimeAssets", titleKey: "settings.doctor.runtimeAssets" },
];

export function formatDoctorMessage(
  t: TranslationFn,
  key: string,
  params?: Record<string, string>,
): string {
  let message = t(key);
  for (const [name, value] of Object.entries(params ?? {})) {
    message = message.replaceAll(`{${name}}`, value);
  }
  return message;
}

export function createInitialDoctorChecks(activeProjectId: string | null): DoctorCheck[] {
  const projectScopedChecks = [
    "projectIntegrity",
    "searchIndex",
    "latexSession",
    "pythonEnv",
    "analysisStore",
    "libraryCitationIndex",
    "shareCollab",
  ];
  return DOCTOR_CHECK_ORDER
    .filter((item) => activeProjectId || !projectScopedChecks.includes(item.id))
    .map((item) => ({
      id: item.id,
      titleKey: item.titleKey,
      status: "info",
      phase: "pending",
      messageKey: "settings.doctor.pending",
    }));
}

export function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function bytesToMb(value: number | null | undefined): string {
  if (!value || value <= 0) {
    return "-";
  }
  return `${Math.round(value / 1024 / 1024)} MB`;
}

export function isValidPanelLayout(layout: unknown, fallback: number[]): boolean {
  if (!Array.isArray(layout) || layout.length !== fallback.length) {
    return false;
  }
  const sum = layout.reduce((acc, value) => acc + Number(value), 0);
  return Number.isFinite(sum)
    && sum > 0
    && layout.every((value) => Number.isFinite(Number(value)) && Number(value) >= 5);
}

export function statusTone(status: DoctorStatus) {
  if (status === "pass") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "warn") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (status === "fail") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function skillIdIsValid(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0
    && trimmed.length <= 80
    && /^[a-zA-Z0-9_.:-]+$/.test(trimmed);
}
