import type { SwarmEvent } from "../../shared/types/app";

const DEFAULT_MAX_EVENTS = 220;
const DEFAULT_MAX_BYTES = 260_000;
const DEFAULT_MIN_EVENTS = 80;
const PAYLOAD_STRING_LIMIT = 1_400;
const PAYLOAD_ARRAY_LIMIT = 80;
const PAYLOAD_OBJECT_LIMIT = 80;

type BudgetOptions = {
  maxEvents?: number;
  maxBytes?: number;
  minEvents?: number;
};

function truncateString(value: string, limit = PAYLOAD_STRING_LIMIT): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}...[truncated]`;
}

function compactPayloadValue(value: unknown, depth = 0): unknown {
  if (value == null) {
    return value;
  }
  if (typeof value === "string") {
    return truncateString(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (depth >= 3) {
    return "[trimmed]";
  }
  if (Array.isArray(value)) {
    const sliced = value
      .slice(0, PAYLOAD_ARRAY_LIMIT)
      .map((item) => compactPayloadValue(item, depth + 1));
    if (value.length > PAYLOAD_ARRAY_LIMIT) {
      sliced.push(`[+${value.length - PAYLOAD_ARRAY_LIMIT} more]`);
    }
    return sliced;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, PAYLOAD_OBJECT_LIMIT);
    const next: Record<string, unknown> = {};
    for (const [key, item] of entries) {
      next[key] = compactPayloadValue(item, depth + 1);
    }
    const count = Object.keys(value as Record<string, unknown>).length;
    if (count > PAYLOAD_OBJECT_LIMIT) {
      next.__trimmedKeys = count - PAYLOAD_OBJECT_LIMIT;
    }
    return next;
  }
  return String(value);
}

function compactEvent(event: SwarmEvent): SwarmEvent {
  return {
    ...event,
    payload: compactPayloadValue(event.payload ?? {}) as Record<string, unknown>,
  };
}

function estimateEventBytes(event: SwarmEvent): number {
  let payloadBytes = 0;
  try {
    payloadBytes = JSON.stringify(event.payload ?? {}).length;
  } catch {
    payloadBytes = 2_048;
  }
  return (
    (event.id?.length ?? 0)
    + (event.runId?.length ?? 0)
    + (event.projectId?.length ?? 0)
    + (event.role?.length ?? 0)
    + (event.kind?.length ?? 0)
    + (event.createdAt?.length ?? 0)
    + payloadBytes
    + 56
  );
}

function trimToBudget(events: SwarmEvent[], options?: BudgetOptions): SwarmEvent[] {
  const maxEvents = options?.maxEvents ?? DEFAULT_MAX_EVENTS;
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
  const minEvents = Math.max(1, options?.minEvents ?? DEFAULT_MIN_EVENTS);
  let next = events;
  if (next.length > maxEvents) {
    next = next.slice(next.length - maxEvents);
  }
  let bytes = 0;
  for (const item of next) {
    bytes += estimateEventBytes(item);
  }
  while (next.length > minEvents && bytes > maxBytes) {
    const dropped = next[0];
    next = next.slice(1);
    bytes -= estimateEventBytes(dropped);
  }
  return next;
}

export function appendEventsWithBudget(
  previous: SwarmEvent[],
  incoming: SwarmEvent[],
  options?: BudgetOptions,
): SwarmEvent[] {
  if (incoming.length === 0) {
    return trimToBudget(previous, options);
  }
  const compactIncoming = incoming.map((item) => compactEvent(item));
  return trimToBudget([...previous, ...compactIncoming], options);
}

export function trimEventsForMemoryPressure(
  previous: SwarmEvent[],
  options?: BudgetOptions,
): SwarmEvent[] {
  return trimToBudget(previous, options);
}

