// Constructive envelope clipping: the single source of 3D geometric truth.
//
// Every rendered solid is a vertical prism (convex footprint extruded from
// y0 to y1) clipped against the roof envelope — the pointwise minimum of the
// roof ceiling planes (same plane fit the constraint engine uses for R305).
// Gable-end triangles, eave knee wedges, ridge-straddling partitions, and
// window glazing all come out of ONE function. No per-case heuristics.
//
// Construction is exact, not sampled: the footprint polygon is split by the
// lines where the active ceiling plane changes (plane-pair equality lines,
// i.e. ridges and cap intersections) and where a plane crosses the floor
// (h = y0). Inside each region exactly one plane is active, so the top face
// is planar and side walls have straight top edges.
//
// Dependency-free so node can run the battery (scripts/check-envelope-clip.mjs)
// without a bundler.

export interface CeilingPlane {
  /** Ceiling height at (x, z) is a*x + b*z + c. */
  a: number;
  b: number;
  c: number;
}

export interface Point2 {
  x: number;
  z: number;
}

export interface ClippedSolid {
  /** Flat triangle soup: x,y,z per vertex, 9 numbers per triangle. */
  positions: number[];
  /** Highest vertex in the solid (NaN when empty). */
  maxY: number;
  /** Lowest top-face vertex (NaN when empty). */
  minTopY: number;
  empty: boolean;
}

const EPS = 1e-7;

/**
 * Fit ceiling planes from roof plane point loops (>= 3 non-collinear points
 * each), exactly like the constraint engine's roofPlaneEquation.
 */
export function ceilingPlanesFromRoofPoints(
  roofPlanes: Array<{ points?: Array<{ x: number; y: number; z: number }> }>,
): CeilingPlane[] {
  const planes: CeilingPlane[] = [];
  for (const roofPlane of roofPlanes) {
    const pts = roofPlane.points ?? [];
    if (pts.length < 3) continue;
    for (let i = 0; i + 2 < pts.length; i += 1) {
      const [p, q, r] = [pts[i], pts[i + 1], pts[i + 2]];
      const det = (q.x - p.x) * (r.z - p.z) - (r.x - p.x) * (q.z - p.z);
      if (Math.abs(det) < 1e-9) continue;
      const a = ((q.y - p.y) * (r.z - p.z) - (r.y - p.y) * (q.z - p.z)) / det;
      const b = ((q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y)) / det;
      planes.push({ a, b, c: p.y - a * p.x - b * p.z });
      break;
    }
  }
  return planes;
}

export function ceilingHeightAt(planes: CeilingPlane[], x: number, z: number): number {
  let height = Infinity;
  for (const plane of planes) {
    height = Math.min(height, plane.a * x + plane.b * z + plane.c);
  }
  return height;
}

interface SplitLine {
  /** Signed distance nx*x + nz*z - d; the line is the zero set. */
  nx: number;
  nz: number;
  d: number;
}

function splitConvex(poly: Point2[], line: SplitLine): Point2[][] {
  const dist = poly.map((p) => line.nx * p.x + line.nz * p.z - line.d);
  const hasNeg = dist.some((v) => v < -EPS);
  const hasPos = dist.some((v) => v > EPS);
  if (!hasNeg || !hasPos) return [poly];
  const sideA: Point2[] = [];
  const sideB: Point2[] = [];
  for (let i = 0; i < poly.length; i += 1) {
    const j = (i + 1) % poly.length;
    const pi = poly[i];
    const pj = poly[j];
    const di = dist[i];
    const dj = dist[j];
    if (di >= -EPS) sideA.push(pi);
    if (di <= EPS) sideB.push(pi);
    if ((di > EPS && dj < -EPS) || (di < -EPS && dj > EPS)) {
      const t = di / (di - dj);
      const cut = { x: pi.x + (pj.x - pi.x) * t, z: pi.z + (pj.z - pi.z) * t };
      sideA.push(cut);
      sideB.push(cut);
    }
  }
  const area = (p: Point2[]) => {
    let total = 0;
    for (let i = 0; i < p.length; i += 1) {
      const j = (i + 1) % p.length;
      total += p[i].x * p[j].z - p[j].x * p[i].z;
    }
    return Math.abs(total) / 2;
  };
  const out: Point2[][] = [];
  if (sideA.length >= 3 && area(sideA) > 1e-6) out.push(sideA);
  if (sideB.length >= 3 && area(sideB) > 1e-6) out.push(sideB);
  return out.length ? out : [poly];
}

function centroid(poly: Point2[]): Point2 {
  let x = 0;
  let z = 0;
  for (const p of poly) {
    x += p.x;
    z += p.z;
  }
  return { x: x / poly.length, z: z / poly.length };
}

function onSegment(p: Point2, a: Point2, b: Point2): boolean {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  if (len2 < EPS) return false;
  const t = ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2;
  if (t < -1e-4 || t > 1 + 1e-4) return false;
  const px = a.x + abx * t;
  const pz = a.z + abz * t;
  return Math.hypot(p.x - px, p.z - pz) < 1e-4;
}

/**
 * Clip the vertical prism (footprint x [y0, y1]) to the ceiling envelope.
 * The y1 cap participates as one more ceiling plane, so a flat-topped wall
 * and a roof-following gable are the same call with different y1.
 *
 * Triangles are emitted for top, bottom, and original-boundary side faces;
 * internal region borders (ridge lines) emit nothing. Render with a
 * double-sided material: winding is not guaranteed globally consistent.
 */
export function clipPrismToCeiling(
  footprint: Point2[],
  y0: number,
  y1: number,
  ceilingPlanes: CeilingPlane[],
): ClippedSolid {
  const planes: CeilingPlane[] = [...ceilingPlanes, { a: 0, b: 0, c: y1 }];
  const lines: SplitLine[] = [];
  for (let i = 0; i < planes.length; i += 1) {
    for (let j = i + 1; j < planes.length; j += 1) {
      const nx = planes[i].a - planes[j].a;
      const nz = planes[i].b - planes[j].b;
      if (Math.abs(nx) < EPS && Math.abs(nz) < EPS) continue;
      lines.push({ nx, nz, d: planes[j].c - planes[i].c });
    }
    // Floor crossing of plane i: h(x,z) = y0.
    if (Math.abs(planes[i].a) > EPS || Math.abs(planes[i].b) > EPS) {
      lines.push({ nx: planes[i].a, nz: planes[i].b, d: y0 - planes[i].c });
    }
  }

  let regions: Point2[][] = [footprint];
  for (const line of lines) {
    regions = regions.flatMap((region) => splitConvex(region, line));
  }

  const heightAt = (x: number, z: number) => ceilingHeightAt(planes, x, z);
  const positions: number[] = [];
  let maxY = -Infinity;
  let minTopY = Infinity;
  const pushTri = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
  ) => {
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  };

  for (const region of regions) {
    const mid = centroid(region);
    if (heightAt(mid.x, mid.z) <= y0 + EPS) continue; // fully clipped away
    const top = region.map((p) => ({ x: p.x, y: Math.max(y0, heightAt(p.x, p.z)), z: p.z }));
    for (const v of top) {
      maxY = Math.max(maxY, v.y);
      minTopY = Math.min(minTopY, v.y);
    }
    // Top + bottom fans.
    for (let i = 1; i + 1 < region.length; i += 1) {
      pushTri(top[0].x, top[0].y, top[0].z, top[i].x, top[i].y, top[i].z, top[i + 1].x, top[i + 1].y, top[i + 1].z);
      pushTri(region[0].x, y0, region[0].z, region[i + 1].x, y0, region[i + 1].z, region[i].x, y0, region[i].z);
    }
    // Side faces, only along the original footprint boundary.
    for (let i = 0; i < region.length; i += 1) {
      const j = (i + 1) % region.length;
      const a = region[i];
      const b = region[j];
      const mid2 = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      let boundary = false;
      for (let k = 0; k < footprint.length; k += 1) {
        if (onSegment(mid2, footprint[k], footprint[(k + 1) % footprint.length])) {
          boundary = true;
          break;
        }
      }
      if (!boundary) continue;
      pushTri(a.x, y0, a.z, b.x, y0, b.z, top[j].x, top[j].y, top[j].z);
      pushTri(a.x, y0, a.z, top[j].x, top[j].y, top[j].z, top[i].x, top[i].y, top[i].z);
    }
  }

  const empty = positions.length === 0;
  return {
    positions,
    maxY: empty ? Number.NaN : maxY,
    minTopY: empty ? Number.NaN : minTopY,
    empty,
  };
}

/** Convenience: axis-aligned rectangle footprint. */
export function rectFootprint(x: number, z: number, w: number, d: number): Point2[] {
  return [
    { x, z },
    { x: x + w, z },
    { x: x + w, z: z + d },
    { x, z: z + d },
  ];
}

export interface WallOpeningSpec {
  /** Span along the wall run, in feet from the wall's first endpoint. */
  start: number;
  end: number;
  /** Vertical extent of the hole (absolute Y, feet). */
  bottomY: number;
  topY: number;
}

/**
 * A wall segment with door/window holes subtracted, still clipped to the
 * ceiling envelope. The run is split at each opening edge; solid intervals
 * become full prisms, opening intervals become a sill piece below the hole
 * (windows) and a header piece above it — and every piece passes through
 * clipPrismToCeiling, so a header that would sit above a low roof simply
 * does not exist (a door hole in a knee wall degenerates honestly).
 */
export function clipWallSegmentWithOpenings(
  a: Point2,
  b: Point2,
  thickness: number,
  y0: number,
  capY: number,
  ceilingPlanes: CeilingPlane[],
  openings: WallOpeningSpec[],
): ClippedSolid {
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  if (length < 0.05) return { positions: [], maxY: Number.NaN, minTopY: Number.NaN, empty: true };
  const ux = (b.x - a.x) / length;
  const uz = (b.z - a.z) / length;
  const px = (-uz * thickness) / 2;
  const pz = (ux * thickness) / 2;
  const footprintAt = (s: number, e: number): Point2[] => [
    { x: a.x + ux * s + px, z: a.z + uz * s + pz },
    { x: a.x + ux * e + px, z: a.z + uz * e + pz },
    { x: a.x + ux * e - px, z: a.z + uz * e - pz },
    { x: a.x + ux * s - px, z: a.z + uz * s - pz },
  ];

  // Clamp, sort, and merge overlapping spans so intervals alternate cleanly.
  const spans = openings
    .map((opening) => ({
      start: Math.max(0, Math.min(length, Math.min(opening.start, opening.end))),
      end: Math.max(0, Math.min(length, Math.max(opening.start, opening.end))),
      bottomY: Math.min(opening.bottomY, opening.topY),
      topY: Math.max(opening.bottomY, opening.topY),
    }))
    .filter((opening) => opening.end - opening.start > 0.05)
    .sort((lhs, rhs) => lhs.start - rhs.start);
  const merged: typeof spans = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start < last.end + 0.01) {
      last.end = Math.max(last.end, span.end);
      last.bottomY = Math.min(last.bottomY, span.bottomY);
      last.topY = Math.max(last.topY, span.topY);
    } else {
      merged.push({ ...span });
    }
  }

  const pieces: ClippedSolid[] = [];
  let cursor = 0;
  const pushPiece = (s: number, e: number, bottom: number, top: number) => {
    if (e - s < 0.02 || top - bottom < 0.02) return;
    pieces.push(clipPrismToCeiling(footprintAt(s, e), bottom, top, ceilingPlanes));
  };
  for (const span of merged) {
    pushPiece(cursor, span.start, y0, capY);
    if (span.bottomY > y0 + 0.02) pushPiece(span.start, span.end, y0, Math.min(span.bottomY, capY));
    if (span.topY < capY - 0.02) pushPiece(span.start, span.end, span.topY, capY);
    cursor = span.end;
  }
  pushPiece(cursor, length, y0, capY);

  const positions: number[] = [];
  let maxY = -Infinity;
  let minTopY = Infinity;
  for (const piece of pieces) {
    if (piece.empty) continue;
    positions.push(...piece.positions);
    maxY = Math.max(maxY, piece.maxY);
    minTopY = Math.min(minTopY, piece.minTopY);
  }
  const empty = positions.length === 0;
  return {
    positions,
    maxY: empty ? Number.NaN : maxY,
    minTopY: empty ? Number.NaN : minTopY,
    empty,
  };
}
