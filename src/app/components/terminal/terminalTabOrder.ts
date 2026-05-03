import type { TerminalTab } from "./terminalTypes";

export function reorderTerminalTabs(tabs: TerminalTab[], sourceId: string, targetId: string): TerminalTab[] {
  const sourceIndex = tabs.findIndex((tab) => tab.id === sourceId);
  const targetIndex = tabs.findIndex((tab) => tab.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return tabs;
  }
  const next = [...tabs];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}
