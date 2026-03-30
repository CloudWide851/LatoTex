type TabButtonEvent = {
  preventDefault?: () => void;
  stopPropagation?: () => void;
};

export function swallowTabButtonEvent(event: TabButtonEvent) {
  event.preventDefault?.();
  event.stopPropagation?.();
}

export function runTabButtonAction(
  event: TabButtonEvent,
  action: () => void,
) {
  swallowTabButtonEvent(event);
  action();
}
