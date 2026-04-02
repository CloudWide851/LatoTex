import type { CodeLanguageInfo } from "../../../shared/utils/codeLanguage";
import type { CompileInstallProgress } from "../../hooks/compileWorkflow";
import { WorkspacePreviewPanel } from "../workspace/WorkspacePreviewPanel";

type PreviewFocusRequest = { page: number; token: number } | null;

export function WorkspaceEditorPreviewPanel(props: {
  activeProjectId: string | null;
  selectedFile: string | null;
  selectedIsCsv: boolean;
  selectedIsMarkdown: boolean;
  selectedIsImage: boolean;
  selectedIsSvg: boolean;
  selectedIsTabular: boolean;
  selectedIsCode: boolean;
  selectedCodeLanguage?: CodeLanguageInfo;
  selectedCodeLanguageTag?: string;
  editorContent: string;
  compiledPdfUrl: string | null;
  previewMode: "pdf" | "image" | "markdown" | "svg" | "code" | "empty";
  previewPdfUrl: string | null;
  previewPdfFallbackRelativePath: string | null;
  imagePreviewUrl: string | null;
  canZoomPreview: boolean;
  previewZoom: number;
  compileErrorLine: string | null;
  compileInstallProgress: CompileInstallProgress | null;
  onEditorChange: (value: string) => void;
  onOpenLogs: (tab: "status" | "events") => void;
  onExportPdf: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onPreviewZoomChange: (nextZoom: number) => void;
  shareComments: any[];
  onJumpToShareComment: (page: number) => void;
  previewFocusRequest: PreviewFocusRequest;
  t: (key: any) => string;
}) {
  return (
    <WorkspacePreviewPanel
      activeProjectId={props.activeProjectId}
      selectedFile={props.selectedFile}
      selectedIsCsv={props.selectedIsCsv}
      selectedIsMarkdown={props.selectedIsMarkdown}
      selectedIsImage={props.selectedIsImage}
      selectedIsSvg={props.selectedIsSvg}
      selectedIsTabular={props.selectedIsTabular}
      selectedIsCode={props.selectedIsCode}
      selectedCodeLanguage={props.selectedCodeLanguage}
      selectedCodeLanguageTag={props.selectedCodeLanguageTag}
      editorContent={props.editorContent}
      compiledPdfUrl={props.compiledPdfUrl}
      previewMode={props.previewMode}
      previewPdfUrl={props.previewPdfUrl}
      previewPdfFallbackRelativePath={props.previewPdfFallbackRelativePath}
      imagePreviewUrl={props.imagePreviewUrl}
      canZoomPreview={props.canZoomPreview}
      previewZoom={props.previewZoom}
      compileErrorLine={props.compileErrorLine}
      compileInstallProgress={props.compileInstallProgress}
      onEditorChange={props.onEditorChange}
      onOpenLogs={props.onOpenLogs}
      onExportPdf={props.onExportPdf}
      onZoomIn={props.onZoomIn}
      onZoomOut={props.onZoomOut}
      onZoomReset={props.onZoomReset}
      onPreviewZoomChange={props.onPreviewZoomChange}
      shareComments={props.shareComments}
      onJumpToShareComment={props.onJumpToShareComment}
      previewFocusRequest={props.previewFocusRequest}
      t={props.t}
    />
  );
}
