import type { CompileInstallProgress } from "../../hooks/compileWorkflow";
import type { WorkspacePreviewMode } from "../workspace/workspacePreviewMode";
import { WorkspacePreviewPanel } from "../workspace/WorkspacePreviewPanel";

type PreviewFocusRequest = { page: number; token: number } | null;

export function WorkspaceEditorPreviewPanel(props: {
  activeProjectId: string | null;
  selectedFile: string | null;
  selectedIsCsv: boolean;
  selectedIsMarkdown: boolean;
  selectedIsHtml: boolean;
  selectedIsImage: boolean;
  selectedIsSvg: boolean;
  selectedIsTabular: boolean;
  editorContent: string;
  compiledPdfUrl: string | null;
  previewMode: WorkspacePreviewMode;
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
  previewFocusRequest: PreviewFocusRequest;
  t: (key: any) => string;
}) {
  return (
    <WorkspacePreviewPanel
      activeProjectId={props.activeProjectId}
      selectedFile={props.selectedFile}
      selectedIsCsv={props.selectedIsCsv}
      selectedIsMarkdown={props.selectedIsMarkdown}
      selectedIsHtml={props.selectedIsHtml}
      selectedIsImage={props.selectedIsImage}
      selectedIsSvg={props.selectedIsSvg}
      selectedIsTabular={props.selectedIsTabular}
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
      previewFocusRequest={props.previewFocusRequest}
      t={props.t}
    />
  );
}
