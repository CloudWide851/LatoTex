import { Check, ChevronLeft, ChevronRight, Copy, FileCode2, MessageSquareText, RefreshCw, Users } from "lucide-react";
import {
  Button as AriaButton,
  Collection,
  Input,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
  Tab,
  TabList,
  Tabs,
} from "react-aria-components";
import { avatarColor, trimQuote } from "./shareUtils";
import type { ShareComment, ShareDevice, ShareI18n, ShareParticipant, ShareQuote, ShareView } from "./shareTypes";

type EditorReviewItem = {
  id: string;
  top: number;
  height: number;
  cardTop: number;
  comment: ShareComment;
};

function ShareSelect(props: {
  label: string;
  selectedKey: string;
  options: Array<{ id: string; label: string }>;
  onSelectionChange: (value: string) => void;
}) {
  const { label, selectedKey, options, onSelectionChange } = props;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      <Select
        selectedKey={selectedKey}
        onSelectionChange={(key) => {
          if (typeof key === "string") {
            onSelectionChange(key);
          }
        }}
        className="w-full"
      >
        <AriaButton className="share-control flex h-10 w-full items-center justify-between px-3 text-left text-sm">
          <SelectValue />
          <span className="text-slate-400">▾</span>
        </AriaButton>
        <Popover className="z-[760] w-[--trigger-width] rounded-2xl border border-slate-200 bg-white p-1 shadow-2xl">
          <ListBox className="outline-none">
            <Collection items={options}>
              {(item) => (
                <ListBoxItem
                  id={item.id}
                  textValue={item.label}
                  className="flex cursor-default items-center justify-between rounded-xl px-3 py-2 text-sm text-slate-700 outline-none data-[focused]:bg-slate-100 data-[selected]:bg-emerald-50 data-[selected]:text-emerald-700"
                >
                  {({ isSelected }) => (
                    <>
                      <span>{item.label}</span>
                      {isSelected ? <Check className="h-4 w-4" /> : null}
                    </>
                  )}
                </ListBoxItem>
              )}
            </Collection>
          </ListBox>
        </Popover>
      </Select>
    </div>
  );
}

export function SharePageLayout(props: {
  device: ShareDevice;
  sid: string;
  i18n: ShareI18n;
  username: string;
  password: string;
  status: string;
  statusError: boolean;
  connected: boolean;
  participants: ShareParticipant[];
  comments: ShareComment[];
  view: ShareView;
  editorText: string;
  quoteDraft: ShareQuote | null;
  selectionQuote: ShareQuote | null;
  commentText: string;
  copiedPassword: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  pdfPagesRef: React.RefObject<HTMLDivElement>;
  editorReview: EditorReviewItem[];
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onViewChange: (value: ShareView) => void;
  onConnect: () => void;
  onCopyPassword: () => void;
  onReloadPdf: () => void;
  onEditorChange: (value: string) => void;
  onEditorSelectionChange: () => void;
  onQuoteSelection: () => void;
  onClearQuote: () => void;
  onCommentTextChange: (value: string) => void;
  onPostComment: () => void;
  onJumpToComment: (comment: ShareComment) => void;
  pdf: {
    ready: boolean;
    pageLabel: string;
    placeholder: string;
    goPrev: () => void;
    goNext: () => void;
  };
}) {
  const {
    device,
    sid,
    i18n,
    username,
    password,
    status,
    statusError,
    connected,
    participants,
    comments,
    view,
    editorText,
    quoteDraft,
    selectionQuote,
    commentText,
    copiedPassword,
    textareaRef,
    pdfPagesRef,
    editorReview,
    onUsernameChange,
    onPasswordChange,
    onViewChange,
    onConnect,
    onCopyPassword,
    onReloadPdf,
    onEditorChange,
    onEditorSelectionChange,
    onQuoteSelection,
    onClearQuote,
    onCommentTextChange,
    onPostComment,
    onJumpToComment,
    pdf,
  } = props;

  const tabOptions = [
    { id: "tex", label: i18n.tabTex },
    { id: "pdf", label: i18n.tabPdf },
    { id: "comments", label: i18n.tabComments },
  ];
  const currentSelectionPreview = selectionQuote ? trimQuote(selectionQuote.text, 120) : "";

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.14),transparent_26%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.1),transparent_24%),linear-gradient(180deg,#f7fbfa_0%,#eef5f2_100%)] text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-[1640px] flex-col gap-4 px-3 py-3 sm:px-4 sm:py-4">
        <header className="share-panel flex items-center justify-between gap-4 px-5 py-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">{i18n.reviewSurface}</div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold text-slate-950">{i18n.title}</h1>
              <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs text-slate-600">
                {sid ? i18n.sessionBadge(sid) : i18n.missingSession}
              </span>
            </div>
          </div>
          <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusError ? "border-rose-200 bg-rose-50 text-rose-700" : connected ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-600"}`}>
            {connected ? i18n.connectedBadge : status}
          </div>
        </header>

        <div className={device === "desktop" ? "grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)_360px] gap-4" : "grid min-h-0 flex-1 gap-4"}>
          <aside className="share-panel flex flex-col gap-4 p-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{i18n.workspaceKicker}</div>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">{i18n.accessTitle}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">{i18n.connectHelp}</p>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{i18n.identityLabel}</span>
              <Input className="share-control h-10 px-3 text-sm" value={username} onChange={(event) => onUsernameChange(event.target.value)} placeholder={i18n.usernamePlaceholder} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{i18n.passwordLabel}</span>
              <Input className="share-control h-10 px-3 text-sm" value={password} onChange={(event) => onPasswordChange(event.target.value)} placeholder={i18n.passwordPlaceholder} />
            </label>
            <div className="flex gap-2">
              <AriaButton className="share-primary flex-1 justify-center" onPress={onConnect}>{i18n.join}</AriaButton>
              <AriaButton className="share-secondary justify-center" onPress={onCopyPassword}>
                <Copy className="h-4 w-4" />
                <span>{copiedPassword ? i18n.copyPasswordDone : i18n.copyPassword}</span>
              </AriaButton>
            </div>
            <div className={`rounded-2xl border px-3 py-2 text-sm ${statusError ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
              {status}
            </div>
            {device === "desktop" ? null : (
              <Tabs selectedKey={view} onSelectionChange={(key) => onViewChange(String(key) as ShareView)}>
                <TabList className="grid grid-cols-3 gap-2 rounded-2xl border border-slate-200 bg-white p-1">
                  {tabOptions.map((item) => (
                    <Tab key={item.id} id={item.id} className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 outline-none data-[selected]:bg-emerald-600 data-[selected]:text-white">
                      {item.label}
                    </Tab>
                  ))}
                </TabList>
              </Tabs>
            )}
          </aside>

          {device === "mobile" && view === "comments" ? null : (
            <section className="share-panel flex min-h-0 flex-col overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    <FileCode2 className="h-3.5 w-3.5 text-emerald-600" />
                    <span>{view === "pdf" ? i18n.previewKicker : i18n.manuscriptKicker}</span>
                  </div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{view === "pdf" ? i18n.pdfPanelLabel : i18n.editorPanelLabel}</div>
                </div>
                {device === "desktop" ? (
                  <Tabs selectedKey={view === "comments" ? "tex" : view} onSelectionChange={(key) => onViewChange(String(key) as ShareView)}>
                    <TabList className="flex gap-2 rounded-2xl border border-slate-200 bg-white p-1">
                      {tabOptions.slice(0, 2).map((item) => (
                        <Tab key={item.id} id={item.id} className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 outline-none data-[selected]:bg-emerald-600 data-[selected]:text-white">
                          {item.label}
                        </Tab>
                      ))}
                    </TabList>
                  </Tabs>
                ) : null}
              </div>

              {view === "pdf" ? (
                <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-xs font-medium text-slate-500">{pdf.pageLabel}</div>
                    <div className="flex items-center gap-2">
                      <button className="share-icon-btn" onClick={pdf.goPrev} type="button"><ChevronLeft className="h-4 w-4" /></button>
                      <button className="share-icon-btn" onClick={pdf.goNext} type="button"><ChevronRight className="h-4 w-4" /></button>
                      <button className="share-icon-btn" onClick={onReloadPdf} type="button"><RefreshCw className="h-4 w-4" /></button>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-hidden rounded-[28px] border border-slate-200 bg-[#fcfbf7]">
                    <div ref={pdfPagesRef} className="share-scrollbar h-full overflow-auto px-4 py-4" />
                    {!pdf.ready ? (
                      <div className="pointer-events-none -mt-full flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
                        {pdf.placeholder}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-500">{i18n.currentSelection}</div>
                      <div className="mt-1 truncate text-sm text-slate-700">{selectionQuote ? currentSelectionPreview : i18n.editorPlaceholder}</div>
                    </div>
                    <button type="button" className="share-secondary justify-center" onClick={onQuoteSelection}>{i18n.addQuote}</button>
                  </div>
                  <div className="relative min-h-0 flex-1 overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,#fffefb_0%,#f7f4ed_100%)]">
                    <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[300px] border-l border-dashed border-slate-200 bg-white/35 xl:block" />
                    {editorReview.map((item) => (
                      <div key={`highlight-${item.id}`} className="pointer-events-none absolute left-4 right-[312px] hidden rounded-xl border-l-4 border-emerald-500 bg-emerald-100/65 xl:block" style={{ top: item.top, height: item.height }} />
                    ))}
                    {editorReview.map((item) => (
                      <button
                        key={`card-${item.id}`}
                        type="button"
                        className="absolute right-4 hidden w-[272px] rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-lg shadow-slate-900/5 xl:grid"
                        style={{ top: item.cardTop }}
                        onClick={() => onJumpToComment(item.comment)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-900">{item.comment.username}</span>
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700">{i18n.inlineBadge}</span>
                        </div>
                        {item.comment.quote ? <div className="mt-2 border-l-2 border-emerald-300 pl-3 text-xs leading-5 text-slate-500">{item.comment.quote}</div> : null}
                        <div className="mt-2 text-sm leading-6 text-slate-700">{item.comment.text || item.comment.quote}</div>
                      </button>
                    ))}
                    <textarea
                      ref={textareaRef}
                      className="share-scrollbar h-full w-full resize-none border-0 bg-transparent px-5 py-4 font-mono text-[13px] leading-7 text-slate-800 outline-none xl:pr-[324px]"
                      value={editorText}
                      onChange={(event) => onEditorChange(event.target.value)}
                      onSelect={onEditorSelectionChange}
                      onKeyUp={onEditorSelectionChange}
                      onMouseUp={onEditorSelectionChange}
                    />
                  </div>
                </div>
              )}
            </section>
          )}

          {(device === "desktop" || view === "comments") ? (
            <aside className="share-panel grid min-h-0 grid-rows-[minmax(180px,0.44fr)_minmax(0,1fr)] overflow-hidden">
              <section className="flex min-h-0 flex-col border-b border-slate-200 px-4 py-3">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  <Users className="h-3.5 w-3.5 text-emerald-600" />
                  <span>{i18n.livePresence}</span>
                </div>
                <h2 className="mt-1 text-sm font-semibold text-slate-900">{i18n.collaborators}</h2>
                <div className="share-scrollbar mt-3 min-h-0 flex-1 overflow-auto pr-1">
                  {participants.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">{i18n.noCollaborators}</div>
                  ) : (
                    participants.map((participant, index) => {
                      const name = String(participant.username || "Guest");
                      return (
                        <article key={`${name}-${index}`} className="mb-2 flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ background: avatarColor(name) }}>
                            {name.slice(0, 1).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900">{name}</div>
                            <div className="text-xs text-slate-500">{participant.lastAction || i18n.actionReading}</div>
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
              </section>

              <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] px-4 py-3">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  <MessageSquareText className="h-3.5 w-3.5 text-emerald-600" />
                  <span>{i18n.discussionKicker}</span>
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{i18n.comments}</div>
                <div className="share-scrollbar mt-3 min-h-0 overflow-auto pr-1">
                  {comments.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">{i18n.noComments}</div>
                  ) : (
                    [...comments].reverse().map((comment) => (
                      <button
                        key={comment.id}
                        type="button"
                        className="mb-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/40"
                        onClick={() => onJumpToComment(comment)}
                        title={i18n.clickJump}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <strong className="text-sm text-slate-900">{comment.username}</strong>
                          <span className="text-xs text-slate-500">{comment.createdAt}</span>
                        </div>
                        {comment.quote ? <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800">{comment.quote}</div> : null}
                        <div className="mt-2 text-sm leading-6 text-slate-700">{comment.text}</div>
                        <div className="mt-2 text-xs text-slate-500">
                          {comment.source === "pdf" && comment.page ? i18n.quoteFromPdf(comment.page) : i18n.quoteFromTex}
                        </div>
                      </button>
                    ))
                  )}
                </div>
                <div className="mt-3 grid gap-2 rounded-[24px] border border-slate-200 bg-white p-3">
                  {quoteDraft ? (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em]">{i18n.quoteLabel}</div>
                      <div className="mt-1 leading-6">{trimQuote(quoteDraft.text, 200)}</div>
                      <button type="button" className="mt-2 text-xs font-semibold text-emerald-700 underline" onClick={onClearQuote}>
                        {i18n.clearQuote}
                      </button>
                    </div>
                  ) : null}
                  <textarea className="share-control share-scrollbar min-h-[132px] resize-y px-3 py-3 text-sm leading-6" value={commentText} onChange={(event) => onCommentTextChange(event.target.value)} placeholder={i18n.commentPlaceholder} />
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-slate-500">{i18n.discussionPlaceholder}</div>
                    <button type="button" className="share-primary justify-center" onClick={onPostComment}>{i18n.postComment}</button>
                  </div>
                </div>
              </section>
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}
