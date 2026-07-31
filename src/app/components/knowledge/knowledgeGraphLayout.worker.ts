type LayoutNode = {
  id: string;
  label: string;
  kind: string;
};

type LayoutPoint = LayoutNode & {
  x: number;
  y: number;
};

type LayoutInput = {
  nodes: LayoutNode[];
  edges: Array<{ source: string; target: string }>;
  width: number;
  height: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

self.onmessage = (event: MessageEvent<LayoutInput>) => {
  const { nodes, edges, width, height } = event.data;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.max(24, Math.min(width, height) * 0.38);
  const points = nodes.map<LayoutPoint>((node, index) => {
    const ring = 1 + Math.floor(Math.sqrt(index));
    const angle = index * 2.399963229728653;
    const distance = radius * Math.min(1, ring / Math.max(1, Math.sqrt(nodes.length)));
    return {
      ...node,
      x: centerX + Math.cos(angle) * distance,
      y: centerY + Math.sin(angle) * distance,
    };
  });
  const byId = new Map(points.map((point, index) => [point.id, index]));
  const indexedEdges = edges
    .map((edge) => [byId.get(edge.source), byId.get(edge.target)] as const)
    .filter((edge): edge is readonly [number, number] => (
      edge[0] !== undefined && edge[1] !== undefined && edge[0] !== edge[1]
    ));
  const padding = 10;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const movement = points.map(() => ({ x: 0, y: 0 }));
    for (const [sourceIndex, targetIndex] of indexedEdges) {
      const source = points[sourceIndex];
      const target = points[targetIndex];
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const pull = (distance - 54) * 0.018;
      const moveX = (dx / distance) * pull;
      const moveY = (dy / distance) * pull;
      movement[sourceIndex].x += moveX;
      movement[sourceIndex].y += moveY;
      movement[targetIndex].x -= moveX;
      movement[targetIndex].y -= moveY;
    }
    const cooling = 1 - iteration / 32;
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const centeringX = (centerX - point.x) * 0.003;
      const centeringY = (centerY - point.y) * 0.003;
      point.x = clamp(
        point.x + (movement[index].x + centeringX) * cooling,
        padding,
        width - padding,
      );
      point.y = clamp(
        point.y + (movement[index].y + centeringY) * cooling,
        padding,
        height - padding,
      );
    }
  }
  self.postMessage({ points });
};

export {};
