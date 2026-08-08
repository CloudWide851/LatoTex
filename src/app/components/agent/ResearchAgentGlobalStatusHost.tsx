import type { MessageKey } from "../../../i18n/messages/en-US/index";
import type { WorkspacePage } from "../../../shared/types/app";
import type { ResearchAgentRuntimeProjection } from "../../hooks/useResearchAgentRuntime";
import { ResearchAgentGlobalStatus } from "./ResearchAgentGlobalStatus";

export function ResearchAgentGlobalStatusHost(props: {
  runtime: ResearchAgentRuntimeProjection;
  onPageChange: (page: WorkspacePage) => void;
  onSelectLibraryPath: (path: string) => void;
  onSelectWorkspacePath: (path: string) => void | Promise<void>;
  t: (key: MessageKey) => string;
}) {
  const jumpToResource = (path: string) => {
    const paperPrefix = ".latotex/papers/";
    if (path.startsWith(paperPrefix)) {
      props.onSelectLibraryPath(path.slice(paperPrefix.length));
      props.onPageChange("library");
      return;
    }
    void props.onSelectWorkspacePath(path);
    props.onPageChange("latex");
  };

  return (
    <ResearchAgentGlobalStatus
      runtime={props.runtime}
      onOpenAgent={() => props.onPageChange("agents")}
      onJumpToResource={jumpToResource}
      t={props.t}
    />
  );
}
