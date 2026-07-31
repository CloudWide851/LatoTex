import { useEffect, useRef, useState } from "react";
import type { KnowledgeGraphResponse } from "../../../shared/types/app";
import { recordKnowledgeRuntimeMetric } from "./knowledgeRuntimePerformance";

type TranslationFn = (key: any) => string;

type Point = {
  id: string;
  label: string;
  kind: string;
  x: number;
  y: number;
};

function fallbackPoints(
  nodes: KnowledgeGraphResponse["nodes"],
  width: number,
  height: number,
): Point[] {
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.max(24, Math.min(width, height) * 0.38);
  return nodes.map((node, index) => {
    const ring = 1 + Math.floor(Math.sqrt(index));
    const angle = index * 2.399963229728653;
    const distance = radius * Math.min(1, ring / Math.max(1, Math.sqrt(nodes.length)));
    return {
      id: node.id,
      label: node.label,
      kind: node.kind,
      x: centerX + Math.cos(angle) * distance,
      y: centerY + Math.sin(angle) * distance,
    };
  });
}

export function KnowledgeGraphCanvas(props: {
  graph: KnowledgeGraphResponse | null;
  maxVisibleNodes: number;
  showLabels: boolean;
  t: TranslationFn;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 320, height: 220 });
  const [points, setPoints] = useState<Point[]>([]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }
      setSize({
        width: Math.max(220, Math.floor(entry.contentRect.width)),
        height: Math.max(180, Math.floor(entry.contentRect.height)),
      });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const layoutStartedAt = performance.now();
    const nodes = props.graph?.nodes.slice(
      0,
      Math.max(1, Math.min(2_000, props.maxVisibleNodes)),
    ) ?? [];
    const edges = props.graph?.edges ?? [];
    if (nodes.length === 0) {
      setPoints([]);
      return;
    }
    const fallback = fallbackPoints(nodes, size.width, size.height);
    if (typeof Worker === "undefined") {
      setPoints(fallback);
      recordKnowledgeRuntimeMetric(
        "graph_stable",
        performance.now() - layoutStartedAt,
        fallback.length,
      );
      return;
    }
    let disposed = false;
    const worker = new Worker(
      new URL("./knowledgeGraphLayout.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (event: MessageEvent<{ points: Point[] }>) => {
      if (!disposed) {
        setPoints(event.data.points);
        recordKnowledgeRuntimeMetric(
          "graph_stable",
          performance.now() - layoutStartedAt,
          event.data.points.length,
        );
      }
    };
    worker.onerror = () => {
      if (!disposed) {
        setPoints(fallback);
        recordKnowledgeRuntimeMetric(
          "graph_stable",
          performance.now() - layoutStartedAt,
          fallback.length,
        );
      }
    };
    worker.postMessage({
      nodes: nodes.map(({ id, label, kind }) => ({ id, label, kind })),
      edges: edges.map(({ source, target }) => ({ source, target })),
      width: size.width,
      height: size.height,
    });
    return () => {
      disposed = true;
      worker.terminate();
    };
  }, [
    props.graph?.edges,
    props.graph?.nodes,
    props.maxVisibleNodes,
    size.height,
    size.width,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(size.width * ratio);
    canvas.height = Math.floor(size.height * ratio);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.scale(ratio, ratio);
    context.clearRect(0, 0, size.width, size.height);
    const byId = new Map(points.map((point) => [point.id, point]));
    context.lineWidth = 1;
    context.strokeStyle = "rgba(100, 116, 139, 0.26)";
    for (const edge of props.graph?.edges ?? []) {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (!source || !target) {
        continue;
      }
      context.beginPath();
      context.moveTo(source.x, source.y);
      context.lineTo(target.x, target.y);
      context.stroke();
    }
    for (const point of points) {
      context.beginPath();
      context.fillStyle = point.kind === "document"
        ? "rgb(14, 116, 144)"
        : point.kind === "citation"
          ? "rgb(124, 58, 237)"
          : "rgb(71, 85, 105)";
      context.arc(point.x, point.y, point.kind === "document" ? 4.5 : 3, 0, Math.PI * 2);
      context.fill();
    }
    if (props.showLabels) {
      const confidenceById = new Map(
        (props.graph?.nodes ?? []).map((node) => [node.id, node.confidence]),
      );
      const labelColor = getComputedStyle(canvas)
        .getPropertyValue("--editor-text")
        .trim() || "rgb(51, 65, 85)";
      context.fillStyle = labelColor;
      context.font = "10px system-ui, sans-serif";
      for (const point of [...points]
        .sort((left, right) => (
          (confidenceById.get(right.id) ?? 0) - (confidenceById.get(left.id) ?? 0)
        ))
        .slice(0, 24)) {
        context.fillText(point.label.slice(0, 32), point.x + 6, point.y - 4);
      }
    }
  }, [
    points,
    props.graph?.edges,
    props.graph?.nodes,
    props.showLabels,
    size.height,
    size.width,
  ]);

  return (
    <div
      ref={hostRef}
      className="relative h-56 min-h-44 overflow-hidden rounded-md border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-paper-bg)]"
    >
      {points.length > 0 ? (
        <canvas
          ref={canvasRef}
          className="block"
          role="img"
          aria-label={`${props.t("knowledge.graph")}: ${points.length}`}
        />
      ) : (
        <div className="flex h-full items-center justify-center px-4 text-center text-xs text-slate-500">
          {props.t("knowledge.graphEmpty")}
        </div>
      )}
    </div>
  );
}
