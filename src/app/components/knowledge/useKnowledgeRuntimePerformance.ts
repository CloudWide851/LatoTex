import { useEffect } from "react";
import {
  monitorKnowledgeFrames,
  observeKnowledgeLongTasks,
} from "./knowledgeRuntimePerformance";

export function useKnowledgeRuntimePerformance(active: boolean) {
  useEffect(() => {
    if (!active) {
      return;
    }
    const stopLongTasks = observeKnowledgeLongTasks();
    const stopFrames = monitorKnowledgeFrames();
    return () => {
      stopFrames();
      stopLongTasks();
    };
  }, [active]);
}
