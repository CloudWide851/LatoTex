export const WINDOW_TRANSITION_EVENT = "latotex.window.transition";

let transitionTimer: ReturnType<typeof setTimeout> | null = null;

export function signalWindowTransition(durationMs = 320) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  const safeDuration = Number.isFinite(durationMs) ? Math.max(120, durationMs) : 320;
  const endsAt = Date.now() + safeDuration;
  document.body.dataset.windowTransitioning = "true";
  window.dispatchEvent(
    new CustomEvent(WINDOW_TRANSITION_EVENT, {
      detail: { durationMs: safeDuration, endsAt },
    }),
  );
  if (transitionTimer) {
    clearTimeout(transitionTimer);
  }
  transitionTimer = setTimeout(() => {
    if (document.body.dataset.windowTransitioning === "true") {
      delete document.body.dataset.windowTransitioning;
    }
    transitionTimer = null;
  }, safeDuration);
}
