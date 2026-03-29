import type { EditorTab } from "../../../shared/types/app";

const FILE_TAB_MIN_WIDTH = 84;
const FILE_TAB_MAX_WIDTH = 220;
const FILE_TAB_CHROME_WIDTH = 50;
const FILE_TAB_DIRTY_WIDTH = 12;
const FILE_TAB_PREVIEW_BADGE_WIDTH = 58;
const EXTRA_TAB_MIN_WIDTH = 108;
const EXTRA_TAB_MAX_WIDTH = 220;
const EXTRA_TAB_CHROME_WIDTH = 18;
const EXTRA_TAB_DIRTY_WIDTH = 12;
const EXTRA_TAB_BUTTON_WIDTH = 20;
const PREVIEW_BADGE_MIN_WIDTH = 170;

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
    return 4.5;
  }
  if (/[A-Z0-9]/.test(char)) {
    return 7.4;
  }
  return 6.8;
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
    FILE_TAB_CHROME_WIDTH + estimateTabTitleWidth(tab.title) + (dirty ? FILE_TAB_DIRTY_WIDTH : 0),
    FILE_TAB_MIN_WIDTH,
    FILE_TAB_MAX_WIDTH,
  );
  const showPreviewBadge = Boolean(tab.preview && !tab.pinned && baseWidth >= PREVIEW_BADGE_MIN_WIDTH);
  const width = clampTabWidth(
    baseWidth + (showPreviewBadge ? FILE_TAB_PREVIEW_BADGE_WIDTH : 0),
    FILE_TAB_MIN_WIDTH,
    FILE_TAB_MAX_WIDTH,
  );
  return { width, showPreviewBadge };
}

export function resolveExtraTabWidth(title: string, options: ExtraTabSizingOptions = {}) {
  const { dirty = false, hasMenu = false, hasClose = false } = options;
  const width = EXTRA_TAB_CHROME_WIDTH
    + estimateTabTitleWidth(title)
    + (dirty ? EXTRA_TAB_DIRTY_WIDTH : 0)
    + (hasMenu ? EXTRA_TAB_BUTTON_WIDTH : 0)
    + (hasClose ? EXTRA_TAB_BUTTON_WIDTH : 0);
  return clampTabWidth(width, EXTRA_TAB_MIN_WIDTH, EXTRA_TAB_MAX_WIDTH);
}

export const editorTabSizingConstants = {
  FILE_TAB_MIN_WIDTH,
  FILE_TAB_MAX_WIDTH,
  EXTRA_TAB_MIN_WIDTH,
  EXTRA_TAB_MAX_WIDTH,
  PREVIEW_BADGE_MIN_WIDTH,
};
