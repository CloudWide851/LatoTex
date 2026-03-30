type SizedTabItem = {
  id: string;
  width: number;
};

type ResolveTabOverflowOptions = {
  gap?: number;
  overflowButtonWidth?: number;
};

type ResolveTabOverflowResult = {
  visibleIds: string[];
  hiddenIds: string[];
  hasOverflow: boolean;
};

const DEFAULT_TAB_GAP = 4;
const DEFAULT_OVERFLOW_BUTTON_WIDTH = 34;

function resolveVisibleWindow(
  items: SizedTabItem[],
  activeId: string | null,
  availableWidth: number,
  gap: number,
): ResolveTabOverflowResult {
  if (items.length === 0) {
    return { visibleIds: [], hiddenIds: [], hasOverflow: false };
  }
  if (availableWidth <= 0) {
    const allIds = items.map((item) => item.id);
    return { visibleIds: allIds, hiddenIds: [], hasOverflow: false };
  }

  const activeIndex = Math.max(
    0,
    activeId ? items.findIndex((item) => item.id === activeId) : 0,
  );
  const visibleIndices = new Set<number>([activeIndex]);
  let usedWidth = items[activeIndex]?.width ?? 0;
  let leftIndex = activeIndex - 1;
  let rightIndex = activeIndex + 1;
  let preferLeft = true;

  const tryInclude = (index: number) => {
    const nextItem = items[index];
    if (!nextItem) {
      return false;
    }
    const nextWidth = nextItem.width + (visibleIndices.size > 0 ? gap : 0);
    if (visibleIndices.size > 0 && usedWidth + nextWidth > availableWidth) {
      return false;
    }
    visibleIndices.add(index);
    usedWidth += nextWidth;
    return true;
  };

  while (leftIndex >= 0 || rightIndex < items.length) {
    const candidateOrder = preferLeft
      ? [
          { index: leftIndex, side: "left" as const },
          { index: rightIndex, side: "right" as const },
        ]
      : [
          { index: rightIndex, side: "right" as const },
          { index: leftIndex, side: "left" as const },
        ];
    let added = false;
    for (const candidate of candidateOrder) {
      if (candidate.index < 0 || candidate.index >= items.length) {
        continue;
      }
      if (!tryInclude(candidate.index)) {
        continue;
      }
      if (candidate.side === "left") {
        leftIndex -= 1;
      } else {
        rightIndex += 1;
      }
      preferLeft = !preferLeft;
      added = true;
      break;
    }
    if (!added) {
      break;
    }
  }

  const visibleIds = items
    .map((item, index) => ({ id: item.id, index }))
    .filter((item) => visibleIndices.has(item.index))
    .map((item) => item.id);
  const hiddenIds = items
    .map((item, index) => ({ id: item.id, index }))
    .filter((item) => !visibleIndices.has(item.index))
    .map((item) => item.id);

  return {
    visibleIds,
    hiddenIds,
    hasOverflow: hiddenIds.length > 0,
  };
}

export function resolveEditorTabOverflow(
  items: SizedTabItem[],
  activeId: string | null,
  availableWidth: number,
  options: ResolveTabOverflowOptions = {},
): ResolveTabOverflowResult {
  const gap = options.gap ?? DEFAULT_TAB_GAP;
  const overflowButtonWidth = options.overflowButtonWidth ?? DEFAULT_OVERFLOW_BUTTON_WIDTH;
  const baseLayout = resolveVisibleWindow(items, activeId, availableWidth, gap);
  if (!baseLayout.hasOverflow) {
    return baseLayout;
  }
  const reservedWidth = Math.max(0, availableWidth - overflowButtonWidth - gap);
  return resolveVisibleWindow(items, activeId, reservedWidth, gap);
}

export const editorTabOverflowConstants = {
  DEFAULT_TAB_GAP,
  DEFAULT_OVERFLOW_BUTTON_WIDTH,
};
