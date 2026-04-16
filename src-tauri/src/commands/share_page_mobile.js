export function mountMobileSharePage(root) {
  root.innerHTML = `
    <div class="share-layout share-layout--mobile">
      <header class="shell-panel share-topline">
        <div class="share-topline__brand">
          <span id="share-brand" class="share-brand"></span>
          <span class="share-topline__divider" aria-hidden="true">/</span>
          <span id="title-text" class="share-title"></span>
        </div>
        <div class="share-topline__status">
          <span id="connected-badge" class="connected-badge">Idle</span>
        </div>
      </header>

      <section class="shell-panel mobile-access">
        <span id="access-title" class="sr-only"></span>
        <div class="mobile-access__meta">
          <span id="meta" class="share-meta"></span>
          <span id="status" class="status-pill">Idle</span>
        </div>
        <div class="mobile-access__fields">
          <label class="field">
            <span class="field-label" id="identity-label"></span>
            <input id="username" maxlength="32" />
          </label>
          <label class="field">
            <span class="field-label" id="password-label"></span>
            <input id="pwd" />
          </label>
        </div>
        <div class="mobile-access__actions">
          <button id="connect" type="button"></button>
          <button id="copy-password" class="secondary" type="button"></button>
        </div>
        <p id="share-hint" class="access-panel__hint"></p>
      </section>

      <section class="shell-panel mobile-tabs">
        <div class="panel-kicker" id="modes-kicker"></div>
        <span id="modes-title" class="sr-only"></span>
        <div class="tab-row">
          <button id="view-tex" class="outline active" type="button"></button>
          <button id="view-pdf" class="outline" type="button"></button>
          <button id="view-comments" class="outline" type="button"></button>
        </div>
      </section>

      <section id="pane-main" class="shell-panel mobile-pane pane active">
        <div class="stage-panel__head">
          <div class="stage-panel__label-group">
            <span class="panel-kicker" id="workspace-kicker"></span>
            <span id="manuscript-kicker" class="sr-only"></span>
            <h2 id="editor-panel-label" class="panel-title"></h2>
          </div>
          <span id="cursor-info" class="cursor">0-0</span>
        </div>

        <section id="editor-wrap" class="content-panel editor-panel">
          <div id="editor-stage" class="editor-stage">
            <div class="editor-stage__body">
              <div class="editor-stage__surface">
                <div id="editor-highlight-layer" class="editor-highlight-layer" aria-hidden="true"></div>
                <textarea id="editor" rows="18"></textarea>
              </div>
              <aside id="editor-thread-layer" class="editor-thread-layer" aria-hidden="true"></aside>
            </div>
          </div>
        </section>

        <section id="pdf-wrap" class="content-panel pdf-panel hidden">
          <div class="panel-header">
            <div>
              <span class="panel-kicker" id="preview-kicker"></span>
              <span id="pdf-panel-label" class="panel-title panel-title--compact"></span>
            </div>
            <div class="pdf-nav">
              <button id="pdf-prev" class="secondary" type="button" aria-label="Previous PDF page">&lt;</button>
              <span id="pdf-page-label" class="meta">PDF page 1/1</span>
              <button id="pdf-next" class="secondary" type="button" aria-label="Next PDF page">&gt;</button>
            </div>
          </div>
          <div class="pdf-stage-grid">
            <div id="pdf-canvas-wrap" class="pdf-stage">
              <canvas id="pdf-canvas" hidden></canvas>
              <div id="pdf-empty" class="pdf-empty">No PDF preview is available right now.</div>
            </div>
          </div>
        </section>
      </section>

      <section id="pane-side" class="mobile-pane pane">
        <section class="shell-panel side-panel presence-panel">
          <div class="side-heading-row">
            <div>
              <span class="panel-kicker" id="presence-kicker"></span>
              <h2 id="participants-title" class="panel-title"></h2>
            </div>
          </div>
          <div id="participants" class="participants"></div>
        </section>

        <section class="shell-panel side-panel comments-panel">
          <div class="side-heading-row">
            <div>
              <span class="panel-kicker" id="discussion-kicker"></span>
              <h2 id="comments-title" class="panel-title"></h2>
            </div>
          </div>
          <div id="comments" class="comments"></div>
          <div class="comment-composer">
            <div id="quote-preview" class="quote-preview" hidden>
              <div id="quote-source" class="quote-source"></div>
              <div id="quote-content" class="quote-content"></div>
              <button id="clear-quote" class="secondary" type="button"></button>
            </div>
            <textarea id="comment-editor" rows="4"></textarea>
            <button id="post-comment" type="button"></button>
          </div>
        </section>
      </section>
    </div>
  `;
}
