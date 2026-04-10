import { useEffect } from "react";

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function maxScrollTop(node: HTMLElement): number {
  return Math.max(0, node.scrollHeight - node.clientHeight);
}

export function useElementScrollRatio(params: {
  node: HTMLElement | null;
  enabled: boolean;
  initialRatio: number;
  onRatioChange?: (ratio: number) => void;
  restoreDeps: ReadonlyArray<unknown>;
}) {
  const { node, enabled, initialRatio, onRatioChange, restoreDeps } = params;

  useEffect(() => {
    if (!enabled || !node) {
      return;
    }
    const ratio = clampRatio(initialRatio);
    const limit = maxScrollTop(node);
    if (limit <= 0) {
      return;
    }
    const nextTop = ratio * limit;
    if (Math.abs(node.scrollTop - nextTop) < 2) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      node.scrollTop = nextTop;
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [enabled, initialRatio, node, ...restoreDeps]);

  useEffect(() => {
    if (!enabled || !node || !onRatioChange) {
      return;
    }
    let frame: number | null = null;
    const handleScroll = () => {
      if (frame !== null) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const limit = maxScrollTop(node);
        const ratio = limit > 0 ? node.scrollTop / limit : 0;
        onRatioChange(clampRatio(ratio));
      });
    };
    node.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      node.removeEventListener("scroll", handleScroll);
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [enabled, node, onRatioChange]);
}
