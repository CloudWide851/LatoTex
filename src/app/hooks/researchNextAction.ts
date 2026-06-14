import type { ResearchQualityLaneId, ResearchQualityReport } from "./researchQualityGate";

export type ResearchNextActionKind = "open-tex" | "repair-compile" | "inspect-lane" | "build-evidence";

export type ResearchNextAction = {
  kind: ResearchNextActionKind;
  titleKey: string;
  detailKey: string;
  actionKey: string;
  laneId?: ResearchQualityLaneId;
};

export function resolveResearchNextAction(input: {
  selectedFile: string | null;
  canCompileSelectedFile: boolean;
  report: ResearchQualityReport;
}): ResearchNextAction {
  const { selectedFile, canCompileSelectedFile, report } = input;
  if (!selectedFile || !canCompileSelectedFile || !/\.tex$/i.test(selectedFile)) {
    return {
      kind: "open-tex",
      titleKey: "research.next.noTex.title",
      detailKey: "research.next.noTex.detail",
      actionKey: "research.next.noTex.action",
    };
  }
  const compileLane = report.lanes.find((lane) => lane.id === "compile");
  if (compileLane?.status === "fail") {
    return {
      kind: "repair-compile",
      titleKey: "research.next.compile.title",
      detailKey: "research.next.compile.detail",
      actionKey: "research.next.compile.action",
      laneId: "compile",
    };
  }
  const failedLane = report.lanes.find((lane) => lane.status === "fail" && lane.id !== "rebuttal");
  if (failedLane) {
    return {
      kind: "inspect-lane",
      titleKey: "research.next.blocked.title",
      detailKey: "research.next.blocked.detail",
      actionKey: "research.next.blocked.action",
      laneId: failedLane.id,
    };
  }
  return {
    kind: "build-evidence",
    titleKey: "research.next.ready.title",
    detailKey: "research.next.ready.detail",
    actionKey: "research.next.ready.action",
    laneId: "submission",
  };
}
