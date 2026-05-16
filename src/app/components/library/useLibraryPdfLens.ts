import { useCallback, useEffect, useRef, useState } from "react";
import type { LensPendingPoint } from "./libraryPdfScrollViewerConfig";
import { LENS_SCALE, LENS_SIZE } from "./libraryPdfScrollViewerConfig";

export function useLibraryPdfLens() {
  const lensViewportRef = useRef<HTMLDivElement | null>(null);
  const lensContentRef = useRef<HTMLDivElement | null>(null);
  const lensRafRef = useRef<number | null>(null);
  const pendingLensPointRef = useRef<LensPendingPoint>({
    visible: false,
    viewportX: 0,
    viewportY: 0,
    pageX: 0,
    pageY: 0,
    pageNumber: 1,
  });
  const lensVisibleRef = useRef(false);
  const lensPageRef = useRef(1);
  const [lensVisible, setLensVisible] = useState(false);
  const [lensPage, setLensPage] = useState(1);

  const applyLensPoint = useCallback(() => {
    const lensViewport = lensViewportRef.current;
    const lensContent = lensContentRef.current;
    const pending = pendingLensPointRef.current;
    if (!lensViewport || !lensContent) {
      return;
    }

    if (pending.visible) {
      const left = pending.viewportX - LENS_SIZE / 2;
      const top = pending.viewportY - LENS_SIZE / 2;
      lensViewport.style.transform = `translate3d(${left}px, ${top}px, 0)`;
      const tx = LENS_SIZE / 2 - pending.pageX * LENS_SCALE;
      const ty = LENS_SIZE / 2 - pending.pageY * LENS_SCALE;
      lensContent.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
    } else {
      lensViewport.style.transform = "translate3d(-9999px, -9999px, 0)";
    }

    if (pending.pageNumber !== lensPageRef.current) {
      lensPageRef.current = pending.pageNumber;
      setLensPage(pending.pageNumber);
    }
    if (pending.visible !== lensVisibleRef.current) {
      lensVisibleRef.current = pending.visible;
      setLensVisible(pending.visible);
    }
  }, []);

  const queueLensPoint = useCallback((next: LensPendingPoint) => {
    pendingLensPointRef.current = next;
    if (lensRafRef.current !== null) {
      return;
    }
    lensRafRef.current = window.requestAnimationFrame(() => {
      lensRafRef.current = null;
      applyLensPoint();
    });
  }, [applyLensPoint]);

  const hideLens = useCallback((pageNumber?: number) => {
    queueLensPoint({
      ...pendingLensPointRef.current,
      visible: false,
      pageNumber: pageNumber ?? pendingLensPointRef.current.pageNumber,
    });
  }, [queueLensPoint]);

  useEffect(() => {
    return () => {
      if (lensRafRef.current !== null) {
        window.cancelAnimationFrame(lensRafRef.current);
      }
    };
  }, []);

  return {
    lensViewportRef,
    lensContentRef,
    pendingLensPointRef,
    lensVisible,
    lensPage,
    queueLensPoint,
    hideLens,
  };
}
