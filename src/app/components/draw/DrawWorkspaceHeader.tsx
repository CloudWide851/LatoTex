import { DrawWorkspaceTabs } from "./DrawWorkspaceTabs";

type TranslationFn = (key: any) => string;

export function DrawWorkspaceHeader(props: {
  tabPaths: string[];
  activePath: string | null;
  renamingPath: string | null;
  renameInput: string;
  busy: boolean;
  status: string;
  onRenameInputChange: (value: string) => void;
  onSelectPath: (path: string | null) => void;
  onStartRename: (path: string) => void;
  onCancelRename: () => void;
  onCommitRename: (path: string) => void;
  onClosePath: (path: string) => void;
  onCreateNewTab: () => void;
  t: TranslationFn;
}) {
  return <DrawWorkspaceTabs {...props} />;
}
