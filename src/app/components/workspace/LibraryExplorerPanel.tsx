import type { ResourceNode } from "../../../shared/types/app";
import { ExplorerTree } from "../ExplorerTree";
import { LibraryUploadMenu } from "../LibraryUploadMenu";

type TranslationFn = (key: any) => string;

export function LibraryExplorerPanel(props: {
  libraryTree: ResourceNode[];
  selectedLibraryPath: string | null;
  busy: boolean;
  onSelectLibraryPath: (path: string | null) => void;
  onLibraryRescan: () => void;
  onLibraryImportPdf: () => void;
  onLibraryImportLink: (link: string) => void;
  t: TranslationFn;
}) {
  const {
    libraryTree,
    selectedLibraryPath,
    busy,
    onSelectLibraryPath,
    onLibraryRescan,
    onLibraryImportPdf,
    onLibraryImportLink,
    t,
  } = props;

  return (
    <aside className="h-full min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-2 shadow-soft">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t("library.title")}
        </h2>
        <LibraryUploadMenu
          busy={busy}
          onImportPdf={onLibraryImportPdf}
          onImportLink={onLibraryImportLink}
          t={t}
        />
      </div>
      <div className="h-[calc(100%-32px)] overflow-auto pr-1">
        <ExplorerTree
          mode="library"
          tree={libraryTree}
          selectedPath={selectedLibraryPath}
          allowRescan
          busy={busy}
          onSelect={onSelectLibraryPath}
          onRescan={onLibraryRescan}
          onImportPdf={onLibraryImportPdf}
          onImportLink={onLibraryImportLink}
          onAction={() => Promise.resolve()}
          t={t}
        />
      </div>
    </aside>
  );
}
