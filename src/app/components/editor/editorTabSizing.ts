import type { EditorTab } from "../../../shared/types/app";

const FILE_TAB_MIN_WIDTH = 72;
const FILE_TAB_MAX_WIDTH = 208;
const FILE_TAB_HORIZONTAL_PADDING = 14;
const FILE_TAB_ACTION_WIDTH = 16;
const FILE_TAB_GAP_WIDTH = 4;
const FILE_TAB_DIRTY_WIDTH = 10;
const FILE_TAB_PREVIEW_BADGE_WIDTH = 54;
const EXTRA_TAB_MIN_WIDTH = 84;
const EXTRA_TAB_MAX_WIDTH = 188;
const EXTRA_TAB_HORIZONTAL_PADDING = 14;
const EXTRA_TAB_DIRTY_WIDTH = 10;
const EXTRA_TAB_BUTTON_WIDTH = 18;
const EXTRA_TAB_GAP_WIDTH = 4;
const PREVIEW_BADGE_MIN_WIDTH = 162;

type ExtraTabSizingOptions = {
  dirty?: boolean;
  hasMenu?: boolean;
  hasClose?: boolean;
};

function clampTabWidth(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function estimateCharacterWidth(char: string) {
  if (/[\u1100-\u9fff\u3040-\u30ff\uff00-\uffef]/u.test(char)) {
    return 12;
  }
  if (/[ilI.,'"`!|:; ]/.test(char)) {
    return 4.2;
  }
  if (/[A-Z0-9]/.test(char)) {
    return 6.9;
  }
  return 6.2;
}

export function estimateTabTitleWidth(title: string) {
  const measured = Array.from(title.trim()).reduce((sum, char) => sum + estimateCharacterWidth(char), 0);
  return Math.ceil(measured || 28);
}

export function resolveFileTabLayout(
  tab: Pick<EditorTab, "title" | "preview" | "pinned">,
  dirty: boolean,
) {
  const baseWidth = clampTabWidth(
    FILE_TAB_HORIZONTAL_PADDING
      + estimateTabTitleWidth(tab.title)
      + FILE_TAB_GAP_WIDTH
      + FILE_TAB_ACTION_WIDTH
      + (dirty ? FILE_TAB_GAP_WIDTH + FILE_TAB_DIRTY_WIDTH : 0),
    FILE_TAB_MIN_WIDTH,
    FILE_TAB_MAX_WIDTH,
  );
  const showPreviewBadge = Boolean(tab.preview && !tab.pinned && baseWidth >= PREVIEW_BADGE_MIN_WIDTH);
  const width = clampTabWidth(
    baseWidth + (showPreviewBadge ? FILE_TAB_GAP_WIDTH + FILE_TAB_PREVIEW_BADGE_WIDTH : 0),
    FILE_TAB_MIN_WIDTH,
    FILE_TAB_MAX_WIDTH,
  );
  return { width, showPreviewBadge };
}

export function resolveExtraTabWidth(title: string, options: ExtraTabSizingOptions = {}) {
  const { dirty = false, hasMenu = false, hasClose = false } = options;
  const width = EXTRA_TAB_HORIZONTAL_PADDING
    + estimateTabTitleWidth(title)
    + (dirty ? EXTRA_TAB_GAP_WIDTH + EXTRA_TAB_DIRTY_WIDTH : 0)
    + (hasMenu ? EXTRA_TAB_GAP_WIDTH + EXTRA_TAB_BUTTON_WIDTH : 0)
    + (hasClose ? EXTRA_TAB_GAP_WIDTH + EXTRA_TAB_BUTTON_WIDTH : 0);
  return clampTabWidth(width, EXTRA_TAB_MIN_WIDTH, EXTRA_TAB_MAX_WIDTH);
}

export const editorTabSizingConstants = {
  FILE_TAB_MIN_WIDTH,
  FILE_TAB_MAX_WIDTH,
  EXTRA_TAB_MIN_WIDTH,
  EXTRA_TAB_MAX_WIDTH,
  PREVIEW_BADGE_MIN_WIDTH,
};
