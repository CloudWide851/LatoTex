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
import { InfoHint } from "../components/ui/info-hint";

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
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--share-muted)]">{label}</span>
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
          <span className="text-[color:var(--share-muted)]">▾</span>
        </AriaButton>
        <Popover className="share-popover z-[760] w-[--trigger-width] p-1">
          <ListBox className="outline-none">
            <Collection items={options}>
              {(item) => (
                <ListBoxItem
                  id={item.id}
                  textValue={item.label}
                  className="flex cursor-default items-center justify-between rounded-lg px-3 py-2 text-sm text-[color:var(--share-text)] outline-none data-[focused]:bg-[color:var(--share-inset)] data-[selected]:bg-[color:var(--share-accent-soft)] data-[selected]:text-[color:var(--share-accent)]"
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
    <div className="share-canvas min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-[1640px] flex-col gap-4 px-3 py-3 sm:px-4 sm:py-4">
        <header className="share-panel flex items-center justify-between gap-4 px-5 py-4">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="truncate text-base font-semibold text-[color:var(--share-text)]">{i18n.title}</h1>
              <span className="share-inset rounded-full border px-3 py-1 text-xs text-[color:var(--share-muted)]">
                {sid ? i18n.sessionBadge(sid) : i18n.missingSession}
              </span>
            </div>
          </div>
          <div className={`share-status rounded-full px-3 py-1 text-xs font-semibold ${statusError ? "share-status--error" : connected ? "share-status--success" : ""}`}>
            {connected ? i18n.connectedBadge : status}
          </div>
        </header>

        <div className={device === "desktop" ? "grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)_360px] gap-4" : "grid min-h-0 flex-1 gap-4"}>
          <aside className="share-panel flex flex-col gap-4 p-4">
            <div className="flex items-center gap-1">
              <h2 className="text-base font-semibold text-[color:var(--share-text)]">{i18n.accessTitle}</h2>
              <InfoHint
                content={i18n.connectHelp}
                label={i18n.accessTitle}
                className="text-[color:var(--share-muted)]"
                popupClassName="!border-[color:var(--share-border)] !bg-[color:var(--share-floating)] !text-[color:var(--share-text)]"
              />
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--share-muted)]">{i18n.identityLabel}</span>
              <Input className="share-control h-10 px-3 text-sm" value={username} onChange={(event) => onUsernameChange(event.target.value)} placeholder={i18n.usernamePlaceholder} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--share-muted)]">{i18n.passwordLabel}</span>
              <Input className="share-control h-10 px-3 text-sm" value={password} onChange={(event) => onPasswordChange(event.target.value)} placeholder={i18n.passwordPlaceholder} />
            </label>
            <div className="flex gap-2">
              <AriaButton className="share-primary flex-1 justify-center" onPress={onConnect}>{i18n.join}</AriaButton>
              <AriaButton className="share-secondary justify-center" onPress={onCopyPassword}>
                <Copy className="h-4 w-4" />
                <span>{copiedPassword ? i18n.copyPasswordDone : i18n.copyPassword}</span>
              </AriaButton>
            </div>
            <div className={`share-status rounded-lg px-3 py-2 text-sm ${statusError ? "share-status--error" : ""}`} role={statusError ? "alert" : "status"}>
              {status}
            </div>
            {device === "desktop" ? null : (
              <Tabs selectedKey={view} onSelectionChange={(key) => onViewChange(String(key) as ShareView)}>
                <TabList className="share-tab-list grid grid-cols-3 gap-1 p-1">
                  {tabOptions.map((item) => (
                    <Tab key={item.id} id={item.id} className="share-tab px-3 py-2 text-sm font-medium outline-none">
                      {item.label}
                    </Tab>
                  ))}
                </TabList>
              </Tabs>
            )}
          </aside>

          {device === "mobile" && view === "comments" ? null : (
            <section className="share-panel flex min-h-0 flex-col overflow-hidden">
              <div className="flex items-center justify-between border-b border-[color:var(--share-border)] px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--share-text)]">
                    <FileCode2 className="h-3.5 w-3.5 text-[color:var(--share-accent)]" />
                    <span>{view === "pdf" ? i18n.pdfPanelLabel : i18n.editorPanelLabel}</span>
                  </div>
                </div>
                {device === "desktop" ? (
                  <Tabs selectedKey={view === "comments" ? "tex" : view} onSelectionChange={(key) => onViewChange(String(key) as ShareView)}>
                    <TabList className="share-tab-list flex gap-1 p-1">
                      {tabOptions.slice(0, 2).map((item) => (
                        <Tab key={item.id} id={item.id} className="share-tab px-3 py-2 text-sm font-medium outline-none">
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
                    <div className="text-xs font-medium text-[color:var(--share-muted)]">{pdf.pageLabel}</div>
                    <div className="flex items-center gap-2">
                      <button className="share-icon-btn" onClick={pdf.goPrev} type="button"><ChevronLeft className="h-4 w-4" /></button>
                      <button className="share-icon-btn" onClick={pdf.goNext} type="button"><ChevronRight className="h-4 w-4" /></button>
                      <button className="share-icon-btn" onClick={onReloadPdf} type="button"><RefreshCw className="h-4 w-4" /></button>
                    </div>
                  </div>
                  <div className="share-pdf-viewer-shell relative min-h-0 flex-1 overflow-hidden">
                    <div ref={pdfPagesRef} className="share-scrollbar h-full overflow-auto px-4 py-4" />
                    {!pdf.ready ? (
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-[color:var(--share-muted)]">
                        {pdf.placeholder}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-[color:var(--share-muted)]">{i18n.currentSelection}</div>
                      <div className="mt-1 truncate text-sm text-[color:var(--share-text)]">{selectionQuote ? currentSelectionPreview : i18n.editorPlaceholder}</div>
                    </div>
                    <button type="button" className="share-secondary justify-center" onClick={onQuoteSelection}>{i18n.addQuote}</button>
                  </div>
                  <div className="share-document-surface relative min-h-0 flex-1 overflow-hidden">
                    <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[300px] border-l border-dashed border-[color:var(--share-border)] bg-[color:var(--share-content)]/50 xl:block" />
                    {editorReview.map((item) => (
                      <div key={`highlight-${item.id}`} className="pointer-events-none absolute left-4 right-[312px] hidden rounded-xl border-l-4 border-[color:var(--share-accent)] bg-[color:var(--share-accent-soft)] xl:block" style={{ top: item.top, height: item.height }} />
                    ))}
                    {editorReview.map((item) => (
                      <button
                        key={`card-${item.id}`}
                        type="button"
                        className="absolute right-4 hidden w-[272px] rounded-xl border border-[color:var(--share-border)] bg-[color:var(--share-content)] p-3 text-left shadow-sm xl:grid"
                        style={{ top: item.cardTop }}
                        onClick={() => onJumpToComment(item.comment)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-[color:var(--share-text)]">{item.comment.username}</span>
                          <span className="rounded-full bg-[color:var(--share-accent-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--share-accent)]">{i18n.inlineBadge}</span>
                        </div>
                        {item.comment.quote ? <div className="mt-2 border-l-2 border-[color:var(--share-accent)] pl-3 text-xs leading-5 text-[color:var(--share-muted)]">{item.comment.quote}</div> : null}
                        <div className="mt-2 text-sm leading-6 text-[color:var(--share-text)]">{item.comment.text || item.comment.quote}</div>
                      </button>
                    ))}
                    <textarea
                      ref={textareaRef}
                      className="share-scrollbar h-full w-full resize-none border-0 bg-transparent px-5 py-4 font-mono text-[13px] leading-7 text-[color:var(--share-text)] outline-none xl:pr-[324px]"
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
              <section className="flex min-h-0 flex-col border-b border-[color:var(--share-border)] px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--share-text)]">
                  <Users className="h-3.5 w-3.5 text-[color:var(--share-accent)]" />
                  <span>{i18n.collaborators}</span>
                </div>
                <div className="share-scrollbar mt-3 min-h-0 flex-1 overflow-auto pr-1">
                  {participants.length === 0 ? (
                    <div className="share-inset rounded-xl border border-dashed px-4 py-5 text-center text-sm text-[color:var(--share-muted)]">{i18n.noCollaborators}</div>
                  ) : (
                    participants.map((participant, index) => {
                      const name = String(participant.username || "Guest");
                      return (
                        <article key={`${name}-${index}`} className="mb-2 flex items-start gap-3 rounded-xl border border-[color:var(--share-border)] bg-[color:var(--share-content)] px-3 py-3">
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ background: avatarColor(name) }}>
                            {name.slice(0, 1).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-[color:var(--share-text)]">{name}</div>
                            <div className="text-xs text-[color:var(--share-muted)]">{participant.lastAction || i18n.actionReading}</div>
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
              </section>

              <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--share-text)]">
                  <MessageSquareText className="h-3.5 w-3.5 text-[color:var(--share-accent)]" />
                  <span>{i18n.comments}</span>
                </div>
                <div className="share-scrollbar mt-3 min-h-0 overflow-auto pr-1">
                  {comments.length === 0 ? (
                    <div className="share-inset rounded-xl border border-dashed px-4 py-5 text-center text-sm text-[color:var(--share-muted)]">{i18n.noComments}</div>
                  ) : (
                    [...comments].reverse().map((comment) => (
                      <button
                        key={comment.id}
                        type="button"
                        className="mb-2 w-full rounded-xl border border-[color:var(--share-border)] bg-[color:var(--share-content)] px-3 py-3 text-left transition hover:border-[color:var(--share-accent)] hover:bg-[color:var(--share-accent-soft)]"
                        onClick={() => onJumpToComment(comment)}
                        title={i18n.clickJump}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <strong className="text-sm text-[color:var(--share-text)]">{comment.username}</strong>
                          <span className="text-xs text-[color:var(--share-muted)]">{comment.createdAt}</span>
                        </div>
                        {comment.quote ? <div className="mt-2 rounded-xl border border-[color:var(--share-accent)] bg-[color:var(--share-accent-soft)] px-3 py-2 text-xs leading-5 text-[color:var(--share-accent)]">{comment.quote}</div> : null}
                        <div className="mt-2 text-sm leading-6 text-[color:var(--share-text)]">{comment.text}</div>
                        <div className="mt-2 text-xs text-[color:var(--share-muted)]">
                          {comment.source === "pdf" && comment.page ? i18n.quoteFromPdf(comment.page) : i18n.quoteFromTex}
                        </div>
                      </button>
                    ))
                  )}
                </div>
                <div className="mt-3 grid gap-2 rounded-xl border border-[color:var(--share-border)] bg-[color:var(--share-content)] p-3">
                  {quoteDraft ? (
                    <div className="rounded-xl border border-[color:var(--share-accent)] bg-[color:var(--share-accent-soft)] px-3 py-2 text-sm text-[color:var(--share-accent)]">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em]">{i18n.quoteLabel}</div>
                      <div className="mt-1 leading-6">{trimQuote(quoteDraft.text, 200)}</div>
                      <button type="button" className="mt-2 text-xs font-semibold text-[color:var(--share-accent)] underline" onClick={onClearQuote}>
                        {i18n.clearQuote}
                      </button>
                    </div>
                  ) : null}
                  <textarea className="share-control share-scrollbar min-h-[132px] resize-y px-3 py-3 text-sm leading-6" value={commentText} onChange={(event) => onCommentTextChange(event.target.value)} placeholder={i18n.commentPlaceholder} />
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-[color:var(--share-muted)]">{i18n.discussionPlaceholder}</div>
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
