import type { RoomPart } from './types';

export type GridPoint = { gx: number; gz: number };

type Edge = {
  from: GridPoint;
  to: GridPoint;
  key: string;
  reverseKey: string;
};

function pointKey(point: GridPoint): string {
  return `${Number(point.gx.toFixed(4))}:${Number(point.gz.toFixed(4))}`;
}

function edgeKey(from: GridPoint, to: GridPoint): string {
  return `${pointKey(from)}>${pointKey(to)}`;
}

function makeEdge(from: GridPoint, to: GridPoint): Edge {
  return {
    from,
    to,
    key: edgeKey(from, to),
    reverseKey: edgeKey(to, from),
  };
}

function partEdges(part: RoomPart): Edge[] {
  const left = part.gx;
  const top = part.gz;
  const right = part.gx + part.gw;
  const bottom = part.gz + part.gd;
  const nw = { gx: left, gz: top };
  const ne = { gx: right, gz: top };
  const se = { gx: right, gz: bottom };
  const sw = { gx: left, gz: bottom };
  return [
    makeEdge(nw, ne),
    makeEdge(ne, se),
    makeEdge(se, sw),
    makeEdge(sw, nw),
  ];
}

export function roomPartOutlineLoops(parts: RoomPart[]): GridPoint[][] {
  const edges = new Map<string, Edge>();
  for (const part of parts) {
    for (const edge of partEdges(part)) {
      if (edges.has(edge.reverseKey)) edges.delete(edge.reverseKey);
      else edges.set(edge.key, edge);
    }
  }

  const byStart = new Map<string, Edge[]>();
  for (const edge of edges.values()) {
    const key = pointKey(edge.from);
    byStart.set(key, [...(byStart.get(key) ?? []), edge]);
  }

  const used = new Set<string>();
  const loops: GridPoint[][] = [];
  for (const first of edges.values()) {
    if (used.has(first.key)) continue;
    const loop: GridPoint[] = [first.from];
    let current = first;
    while (!used.has(current.key)) {
      used.add(current.key);
      loop.push(current.to);
      const startKey = pointKey(current.to);
      const next = (byStart.get(startKey) ?? []).find((edge) => !used.has(edge.key));
      if (!next) break;
      current = next;
    }
    if (loop.length >= 4 && pointKey(loop[0]) === pointKey(loop[loop.length - 1])) {
      loops.push(loop.slice(0, -1));
    }
  }
  return loops;
}

export function roomPartPath(
  parts: RoomPart[],
  project: (point: GridPoint) => { x: number; y: number },
): string {
  return roomPartOutlineLoops(parts)
    .map((loop) => {
      const [first, ...rest] = loop;
      if (!first) return '';
      const start = project(first);
      const commands = [`M ${start.x} ${start.y}`];
      for (const point of rest) {
        const next = project(point);
        commands.push(`L ${next.x} ${next.y}`);
      }
      commands.push('Z');
      return commands.join(' ');
    })
    .filter(Boolean)
    .join(' ');
}
