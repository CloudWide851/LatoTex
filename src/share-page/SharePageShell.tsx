import { Copy, MessageSquareText, PanelLeft, ScanSearch, Users, FileCode2, ChevronLeft, ChevronRight } from "lucide-react";

type SharePageShellProps = {
  mobile: boolean;
};

function ShareAccessCard(props: { showStatus: boolean }) {
  const { showStatus } = props;
  return (
    <section className="share-surface flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div id="workspace-kicker" className="share-kicker" />
          <div id="access-title" className="share-title mt-1" />
        </div>
        {showStatus ? <div id="status" className="share-badge share-badge-muted" /> : null}
      </div>
      <div id="meta" className="text-xs text-slate-500" />
      <div className="grid gap-3">
        <label className="grid gap-1.5">
          <span id="identity-label" className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500" />
          <input
            id="username"
            maxLength={32}
            className="share-input"
          />
        </label>
        <label className="grid gap-1.5">
          <span id="password-label" className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500" />
          <input id="pwd" className="share-input" />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button id="connect" type="button" className="share-primary-btn flex-1" />
        <button id="copy-password" type="button" className="share-secondary-btn inline-flex items-center justify-center gap-2 px-4">
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
      <p id="share-hint" className="text-sm leading-6 text-slate-500" />
    </section>
  );
}

function ShareTabs() {
  return (
    <div className="share-surface flex items-center justify-between gap-3 p-3">
      <div className="min-w-0">
        <div id="modes-kicker" className="share-kicker" />
        <div id="modes-title" className="share-title mt-1" />
      </div>
      <div className="flex flex-wrap gap-2">
        <button id="view-tex" type="button" className="share-tab active" />
        <button id="view-pdf" type="button" className="share-tab" />
        <button id="view-comments" type="button" className="share-tab" />
      </div>
    </div>
  );
}

function ShareEditorPanel(props: { showTabs: boolean }) {
  const { showTabs } = props;
  return (
    <section id="pane-main" className="share-pane active grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
      <div className="share-surface flex items-center justify-between gap-3 p-3">
        <div className="min-w-0">
          <div className="share-kicker flex items-center gap-2">
            <FileCode2 className="h-3.5 w-3.5" />
            <span id="manuscript-kicker" />
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span id="editor-panel-label" className="share-title" />
            <span id="cursor-info" className="text-xs text-slate-500">0-0</span>
          </div>
        </div>
        {showTabs ? (
          <div className="flex flex-wrap gap-2">
            <button id="view-tex" type="button" className="share-tab active" />
            <button id="view-pdf" type="button" className="share-tab" />
            <button id="view-comments" type="button" className="share-tab" />
          </div>
        ) : null}
      </div>

      <section id="editor-wrap" className="share-surface min-h-0 overflow-hidden p-3">
        <div id="editor-stage" className="grid h-full min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="relative min-h-0 overflow-hidden rounded-2xl border border-slate-200 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.08),transparent_32%),linear-gradient(180deg,#fffdf8_0%,#f8f7f3_100%)]">
            <div id="editor-highlight-layer" className="pointer-events-none absolute inset-0 z-10" aria-hidden="true" />
            <textarea
              id="editor"
              rows={18}
              className="h-full min-h-0 w-full resize-none border-0 bg-transparent px-5 py-4 font-mono text-[13px] leading-7 text-slate-800 outline-none"
            />
          </div>
          <aside
            id="editor-thread-layer"
            className="share-scrollbar hidden min-h-0 overflow-auto rounded-2xl border border-slate-200 bg-slate-50/90 p-3 xl:block"
            aria-hidden="true"
          />
        </div>
      </section>

      <section id="pdf-wrap" className="share-surface hidden min-h-0 overflow-hidden p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="share-kicker flex items-center gap-2">
              <ScanSearch className="h-3.5 w-3.5" />
              <span id="preview-kicker" />
            </div>
            <div id="pdf-panel-label" className="share-title mt-1" />
          </div>
          <div className="flex items-center gap-2">
            <button id="pdf-prev" type="button" className="share-icon-btn">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span id="pdf-page-label" className="text-xs text-slate-500" />
            <button id="pdf-next" type="button" className="share-icon-btn">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div id="pdf-canvas-wrap" className="share-scrollbar flex h-full min-h-[280px] items-start justify-center overflow-auto rounded-2xl border border-slate-200 bg-[#fffdf8] p-4">
          <canvas id="pdf-canvas" hidden />
          <div id="pdf-empty" className="m-auto text-center text-sm leading-6 text-slate-500" />
        </div>
      </section>
    </section>
  );
}

function ShareSidePanel() {
  return (
    <aside id="pane-side" className="share-pane active grid min-h-0 gap-3 xl:grid-rows-[minmax(180px,0.45fr)_minmax(0,1fr)]">
      <section className="share-surface grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3 p-3">
        <div>
          <div className="share-kicker flex items-center gap-2">
            <Users className="h-3.5 w-3.5" />
            <span id="presence-kicker" />
          </div>
          <div id="participants-title" className="share-title mt-1" />
        </div>
        <div id="participants" className="share-scrollbar min-h-0 overflow-auto rounded-2xl border border-slate-200 bg-slate-50/80 p-2.5" />
      </section>

      <section className="share-surface grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3 p-3">
        <div>
          <div className="share-kicker flex items-center gap-2">
            <MessageSquareText className="h-3.5 w-3.5" />
            <span id="discussion-kicker" />
          </div>
          <div id="comments-title" className="share-title mt-1" />
        </div>
        <div id="comments" className="share-scrollbar min-h-0 overflow-auto rounded-2xl border border-slate-200 bg-slate-50/80 p-2.5" />
        <div className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-3">
          <div id="quote-preview" className="hidden rounded-xl border border-blue-200 bg-blue-50 px-3 py-2">
            <div id="quote-source" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700" />
            <div id="quote-content" className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700" />
            <button id="clear-quote" type="button" className="share-secondary-btn mt-2 w-full" />
          </div>
          <textarea
            id="comment-editor"
            rows={4}
            className="share-input min-h-[120px] resize-y py-3"
          />
          <button id="post-comment" type="button" className="share-primary-btn w-full" />
        </div>
      </section>
    </aside>
  );
}

function MobileShareShell() {
  return (
    <div className="grid min-h-screen grid-rows-[auto_auto_auto_minmax(0,1fr)] gap-3 p-3">
      <header className="share-surface flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="share-kicker flex items-center gap-2">
            <PanelLeft className="h-3.5 w-3.5" />
            <span id="share-brand" />
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
            <span id="title-text" className="share-title" />
            <span id="meta" className="truncate text-xs text-slate-500" />
          </div>
        </div>
        <div id="connected-badge" className="share-badge share-badge-muted" />
      </header>
      <ShareAccessCard showStatus />
      <ShareTabs />
      <div className="grid min-h-0 gap-3">
        <ShareEditorPanel showTabs={false} />
        <ShareSidePanel />
      </div>
      <button id="quick-quote" hidden type="button" className="share-primary-btn fixed bottom-4 right-4 z-50 px-4 shadow-lg" />
    </div>
  );
}

function DesktopShareShell() {
  return (
    <div className="grid min-h-screen grid-rows-[auto_minmax(0,1fr)] gap-3 p-4">
      <header className="share-surface flex items-center justify-between gap-4 px-5 py-3.5">
        <div className="min-w-0">
          <div className="share-kicker flex items-center gap-2">
            <PanelLeft className="h-3.5 w-3.5" />
            <span id="share-brand" />
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
            <span id="title-text" className="share-title" />
            <span id="meta" className="truncate text-xs text-slate-500" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div id="status" className="share-badge share-badge-muted" />
          <div id="connected-badge" className="share-badge share-badge-muted" />
        </div>
      </header>
      <div className="sr-only" aria-hidden="true">
        <span id="modes-kicker" />
        <span id="modes-title" />
      </div>
      <section className="grid min-h-0 gap-3 xl:grid-cols-[300px_minmax(0,1fr)_360px]">
        <ShareAccessCard showStatus={false} />
        <ShareEditorPanel showTabs />
        <ShareSidePanel />
      </section>
      <button id="quick-quote" hidden type="button" className="share-primary-btn fixed bottom-5 right-5 z-50 px-4 shadow-lg" />
    </div>
  );
}

export function SharePageShell(props: SharePageShellProps) {
  return props.mobile ? <MobileShareShell /> : <DesktopShareShell />;
}
