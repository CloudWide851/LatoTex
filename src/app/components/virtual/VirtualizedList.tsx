import { useMemo, useRef, useState } from "react";
import type React from "react";
import { cn } from "../../../lib/utils";

export type VirtualizedListProps<T> = {
  items: T[];
  estimatedItemHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  getKey: (item: T, index: number) => React.Key;
  className?: string;
  contentClassName?: string;
  overscan?: number;
  fallbackViewportHeight?: number;
};

export function getVirtualRange(params: {
  itemCount: number;
  scrollTop: number;
  viewportHeight: number;
  estimatedItemHeight: number;
  overscan?: number;
}) {
  const {
    itemCount,
    scrollTop,
    viewportHeight,
    estimatedItemHeight,
    overscan = 4,
  } = params;
  if (itemCount <= 0 || estimatedItemHeight <= 0) {
    return { start: 0, end: 0, before: 0, after: 0 };
  }
  const start = Math.max(0, Math.floor(scrollTop / estimatedItemHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / estimatedItemHeight) + overscan * 2;
  const end = Math.min(itemCount, start + visibleCount);
  return {
    start,
    end,
    before: start * estimatedItemHeight,
    after: Math.max(0, (itemCount - end) * estimatedItemHeight),
  };
}

export function VirtualizedList<T>(props: VirtualizedListProps<T>) {
  const {
    items,
    estimatedItemHeight,
    renderItem,
    getKey,
    className,
    contentClassName,
    overscan,
    fallbackViewportHeight = 480,
  } = props;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(fallbackViewportHeight);

  const range = useMemo(
    () => getVirtualRange({
      itemCount: items.length,
      scrollTop,
      viewportHeight,
      estimatedItemHeight,
      overscan,
    }),
    [estimatedItemHeight, items.length, overscan, scrollTop, viewportHeight],
  );
  const visibleItems = items.slice(range.start, range.end);

  return (
    <div
      ref={(node) => {
        scrollRef.current = node;
        if (node?.clientHeight) {
          setViewportHeight(node.clientHeight);
        }
      }}
      className={cn("min-h-0 overflow-auto", className)}
      onScroll={(event) => {
        const target = event.currentTarget;
        setScrollTop(target.scrollTop);
        if (target.clientHeight && target.clientHeight !== viewportHeight) {
          setViewportHeight(target.clientHeight);
        }
      }}
    >
      <div style={{ paddingTop: range.before, paddingBottom: range.after }}>
        <div className={contentClassName}>
          {visibleItems.map((item, offset) => {
            const index = range.start + offset;
            return (
              <div key={getKey(item, index)} data-virtual-index={index}>
                {renderItem(item, index)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
