// Honest elevations derived from the paired artifact — the single source for
// the in-app elevation views, the export SVGs, and the client packet.
//
// Every opening drawn comes from the artifact's windows/doors on that facade,
// at its true position, with sill/head heights clamped under the roof using
// the same ceiling-plane math the 3D renderer clips with (lib/bim/envelope-clip).
// The roof profile is ridge-axis aware: a facade that ends the ridge is a
// gable face; a facade along the ridge is a low wall under the visible slope.
//
// Dependency-free so node batteries can import it directly.

// Plane fit + height lookup duplicated from lib/bim/envelope-clip so this
// module stays import-free (node batteries import it directly without a
// bundler; envelope-clip's battery covers the shared math).
interface CeilingPlane { a: number; b: number; c: number }

function ceilingPlanesFromRoofPoints(
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

function ceilingHeightAt(planes: CeilingPlane[], x: number, z: number): number {
  let height = Infinity;
  for (const plane of planes) {
    height = Math.min(height, plane.a * x + plane.b * z + plane.c);
  }
  return height;
}

export interface ElevationArtifactInput {
  planId?: string;
  footprint: { widthFt: number; depthFt: number };
  roof: {
    style?: string;
    ridgeAxis?: 'x' | 'z' | string;
    ridgeHeightFt: number;
    eaveHeightFt: number;
    overhangFt?: number;
    planes?: Array<{ points?: Array<{ x: number; y: number; z: number }> }>;
  };
  windows?: Array<{ id?: string; span?: { x1: number; z1: number; x2: number; z2: number } }>;
  doors?: Array<{ id?: string; openingType?: string; span?: { x1: number; z1: number; x2: number; z2: number } }>;
}

export interface ElevationOpening {
  id: string;
  kind: 'door' | 'window';
  /** Center along the facade, feet from the facade's left end. */
  center: number;
  widthFt: number;
  sillFt: number;
  headFt: number;
}

export interface ElevationModel {
  planId: string;
  side: 'front' | 'side';
  spanFt: number;
  eaveFt: number;
  ridgeFt: number;
  overhangFt: number;
  /** True when this facade is a gable end (the ridge meets it). */
  gableFacing: boolean;
  /** Wall height at the facade when it is NOT a gable face. */
  facadeWallFt: number;
  /** True for a shed (mono-pitch) roof: the across-slope face is a single slope,
   * not a centered gable apex. */
  monoPitch: boolean;
  /** For a mono-pitch across-slope face: true when the high (ridge) edge is at
   * the start of the span (left), the low (eave) edge at the end. */
  monoPitchHighAtStart: boolean;
  /** For a hip roof's long-side face: the ridge runs from ridgeStartFt to
   * ridgeEndFt along the span (eave-to-ridge-to-eave trapezoid). Null otherwise.
   * On a square footprint start == end -> the trapezoid collapses to a triangle
   * (pyramid). */
  hipTrapezoid: { ridgeStartFt: number; ridgeEndFt: number } | null;
  /** For a gambrel roof's gable-end face: the two-pitch silhouette breaks at a
   * knuckle (knuckleHeightFt) located knuckleStartFt / knuckleEndFt along the
   * span; the ridge is at the center. Null otherwise. */
  gambrel: { knuckleStartFt: number; knuckleEndFt: number; knuckleHeightFt: number } | null;
  /** For a barn (gambrel-hip) — BOTH faces: a two-pitch HIPPED silhouette. The
   * knuckle sits knuckleInsetFt from each end at knuckleHeightFt; the ridge runs
   * from ridgeStartFt to ridgeEndFt (a peak when start == end). Null otherwise. */
  barnHip: { knuckleInsetFt: number; knuckleHeightFt: number; ridgeStartFt: number; ridgeEndFt: number } | null;
  openings: ElevationOpening[];
}

// Traced artifacts inset openings up to ~1.2 ft from the footprint line
// (wall thickness); compiled artifacts sit exactly on it.
const FACADE_TOLERANCE_FT = 1.6;

function facadeCeiling(planes: CeilingPlane[], side: 'front' | 'side', coord: number, fallback: number): number {
  if (!planes.length) return fallback;
  const [x, z] = side === 'front' ? [coord, 0.05] : [0.05, coord];
  const height = ceilingHeightAt(planes, x, z);
  return Number.isFinite(height) ? height : fallback;
}

/** Roof limit sampled at the opening's true position (not the facade plane). */
function limitAtSpan(
  planes: CeilingPlane[],
  span: { x1: number; z1: number; x2: number; z2: number },
  fallback: number,
): number {
  if (!planes.length) return fallback;
  let limit = Infinity;
  for (const [px, pz] of [
    [span.x1, span.z1],
    [span.x2, span.z2],
    [(span.x1 + span.x2) / 2, (span.z1 + span.z2) / 2],
  ] as Array<[number, number]>) {
    const height = ceilingHeightAt(planes, px, pz);
    if (Number.isFinite(height)) limit = Math.min(limit, height);
  }
  return Number.isFinite(limit) ? limit : fallback;
}

/** Storey base: loft openings draw at loft height, not the ground sill. */
function openingFloorBase(opening: { levelIndex?: number; floor?: number; levelFrameId?: string; id?: string }): number {
  const level = opening.levelIndex
    ?? opening.floor
    ?? (typeof opening.levelFrameId === 'string' && /1/.test(opening.levelFrameId) ? 1 : undefined)
    ?? (typeof opening.id === 'string' && /^(?:win|door)-l1\b|^(?:win|door)-l1-/.test(opening.id) ? 1 : 0);
  return level >= 1 ? 8 : 0;
}

export function buildElevationModel(artifact: ElevationArtifactInput, side: 'front' | 'side'): ElevationModel {
  const { widthFt, depthFt } = artifact.footprint;
  const roof = artifact.roof;
  const ridgeAxis = roof.ridgeAxis === 'x' ? 'x' : 'z';
  const spanFt = side === 'front' ? widthFt : depthFt;
  // Ridge along z meets the z=0 (front) facade head-on -> front is a gable
  // face. Ridge along x makes the x=0 (side) facade the gable face.
  const gableFacing = side === 'front' ? ridgeAxis === 'z' : ridgeAxis === 'x';
  const planes = ceilingPlanesFromRoofPoints(roof.planes ?? []);
  const eaveFt = roof.eaveHeightFt;
  const ridgeFt = roof.ridgeHeightFt;
  const facadeWallFt = gableFacing
    ? ridgeFt
    : Math.max(0.6, facadeCeiling(planes, side, spanFt / 2, eaveFt));

  const openings: ElevationOpening[] = [];
  const onFacade = (span?: { x1: number; z1: number; x2: number; z2: number }) => {
    if (!span) return false;
    return side === 'front'
      ? Math.max(Math.abs(span.z1), Math.abs(span.z2)) < FACADE_TOLERANCE_FT
      : Math.max(Math.abs(span.x1), Math.abs(span.x2)) < FACADE_TOLERANCE_FT;
  };
  const alongCoords = (span: { x1: number; z1: number; x2: number; z2: number }): [number, number] =>
    side === 'front' ? [span.x1, span.x2] : [span.z1, span.z2];

  for (const door of artifact.doors ?? []) {
    // Compiled artifacts mark exterior doors; traced artifacts often omit
    // openingType — facade position is the honest signal there.
    const doorRecord = door as { openingType?: string | null };
    if (!(doorRecord.openingType === 'exteriorDoor' || doorRecord.openingType == null)) continue;
    if (!onFacade(door.span)) continue;
    const [a, b] = alongCoords(door.span!);
    const center = (a + b) / 2;
    const base = openingFloorBase(door as Record<string, never>);
    const limit = limitAtSpan(planes, door.span!, ridgeFt);
    const headFt = Math.min(base + 6.8, limit - 0.3);
    if (headFt - base < 4) continue; // no honest door fits under this roof line
    openings.push({
      id: door.id ?? 'door',
      kind: 'door',
      center,
      widthFt: Math.abs(b - a),
      sillFt: base,
      headFt,
    });
  }

  for (const window of artifact.windows ?? []) {
    if (!onFacade(window.span)) continue;
    const [a, b] = alongCoords(window.span!);
    const center = (a + b) / 2;
    const base = openingFloorBase(window as Record<string, never>);
    const limit = limitAtSpan(planes, window.span!, ridgeFt);
    // Same policy as the 3D glazing clamp: nominal sill 3.15 above the
    // storey base with a ~2.4 ft pane; on low walls the sill slides down;
    // below half a foot of viable pane, nothing is drawn.
    let sill = base + 3.15;
    const maxHead = limit - 0.15;
    let head = Math.min(sill + 2.4, maxHead);
    if (head - sill < 1.0) sill = Math.max(base + 0.3, head - 2.4);
    if (head - sill < 0.5) continue;
    openings.push({
      id: window.id ?? 'window',
      kind: 'window',
      center,
      widthFt: Math.abs(b - a),
      sillFt: sill,
      headFt: head,
    });
  }

  // A shed roof's across-slope face is a single slope, not a centered apex.
  // Sample the roof at both ends of the span to learn which edge is high.
  const monoPitch = roof.style === 'shed';
  const startCeil = facadeCeiling(planes, side, 0.05, eaveFt);
  const endCeil = facadeCeiling(planes, side, Math.max(0.05, spanFt - 0.05), eaveFt);
  const monoPitchHighAtStart = startCeil >= endCeil;

  // A hip roof's long-side face is a trapezoid: the ridge runs only between the
  // inset points (half the shorter dimension from each end), sloping down to the
  // eave at both ends. The hip-END face stays a centered triangle (the existing
  // gable render). On a square footprint the inset == half-span -> the ridge is a
  // point (pyramid) and both faces are triangles.
  const hipInset = Math.min(widthFt, depthFt) / 2;
  const hipTrapezoid = roof.style === 'hip' && !gableFacing
    ? { ridgeStartFt: hipInset, ridgeEndFt: Math.max(hipInset, spanFt - hipInset) }
    : null;
  // A gambrel's gable end is a two-pitch silhouette: the knuckle sits a quarter
  // of the span in from each side, three-quarters up from eave to ridge.
  const gambrel = roof.style === 'gambrel' && gableFacing
    ? { knuckleStartFt: spanFt / 4, knuckleEndFt: (spanFt * 3) / 4, knuckleHeightFt: eaveFt + (ridgeFt - eaveFt) * 0.75 }
    : null;
  // A barn (gambrel hip) is two stacked hips, so BOTH faces show a two-pitch
  // hipped silhouette: the ridge is inset by half the shorter dimension, the
  // knuckle by 40% of that. Matches the compiler's barn plane geometry.
  const barnRidgeInset = Math.min(widthFt, depthFt) / 2;
  const barnHip = roof.style === 'barn'
    ? {
      knuckleInsetFt: barnRidgeInset * 0.4,
      knuckleHeightFt: eaveFt + (ridgeFt - eaveFt) * 0.65,
      ridgeStartFt: barnRidgeInset,
      ridgeEndFt: Math.max(barnRidgeInset, spanFt - barnRidgeInset),
    }
    : null;

  openings.sort((lhs, rhs) => lhs.center - rhs.center);
  return {
    planId: artifact.planId ?? 'plan',
    side,
    spanFt,
    eaveFt,
    ridgeFt,
    overhangFt: roof.overhangFt ?? 1,
    gableFacing,
    facadeWallFt,
    monoPitch,
    monoPitchHighAtStart,
    hipTrapezoid,
    gambrel,
    barnHip,
    openings,
  };
}

/** Render the model as a standalone elevation SVG (architectural line drawing). */
export function elevationSvgString(model: ElevationModel): string {
  const pad = 26;
  const width = 760;
  const height = 330;
  const ov = model.overhangFt;
  const scaleX = (width - pad * 2) / (model.spanFt + ov * 2);
  const scaleY = (height - pad * 2 - 22) / Math.max(model.ridgeFt + 1.5, 10);
  const scale = Math.min(scaleX, scaleY);
  const x0 = (width - model.spanFt * scale) / 2;
  const x1 = x0 + model.spanFt * scale;
  const yBase = height - pad - 14;
  const X = (ft: number) => x0 + ft * scale;
  const Y = (ft: number) => yBase - ft * scale;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="monospace">`);
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#fbfaf6"/>`);
  parts.push(`<text x="${pad}" y="16" font-size="11" fill="#8a8178">${model.planId} — ${model.side} elevation — ${model.spanFt}&#39; span — ${Math.round(model.ridgeFt)}&#39; ridge</text>`);

  if (model.monoPitch && model.gableFacing) {
    // Shed (mono-pitch) across-slope face: a single slope from the high (ridge)
    // edge to the low (eave) edge — no centered apex.
    const leftY = model.monoPitchHighAtStart ? model.ridgeFt : model.eaveFt;
    const rightY = model.monoPitchHighAtStart ? model.eaveFt : model.ridgeFt;
    const slope = (rightY - leftY) / model.spanFt;
    parts.push(`<polygon points="${X(0)},${Y(0)} ${X(0)},${Y(leftY)} ${X(model.spanFt)},${Y(rightY)} ${X(model.spanFt)},${Y(0)}" fill="#f2eee7" stroke="#3d3933" stroke-width="1.4"/>`);
    parts.push(`<polyline points="${X(-ov)},${Y(leftY - slope * ov)} ${X(model.spanFt + ov)},${Y(rightY + slope * ov)}" fill="none" stroke="#26231f" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round"/>`);
  } else if (model.hipTrapezoid) {
    // Hip long side: walls to the eave all across, then the roofline rises from
    // the eave at each end to the inset ridge and runs flat between the inset
    // points. A square footprint makes start == end -> a centered apex (pyramid).
    const rs = model.hipTrapezoid.ridgeStartFt;
    const re = model.hipTrapezoid.ridgeEndFt;
    parts.push(`<polygon points="${X(0)},${Y(0)} ${X(model.spanFt)},${Y(0)} ${X(model.spanFt)},${Y(model.eaveFt)} ${X(re)},${Y(model.ridgeFt)} ${X(rs)},${Y(model.ridgeFt)} ${X(0)},${Y(model.eaveFt)}" fill="#f2eee7" stroke="#3d3933" stroke-width="1.4"/>`);
    parts.push(`<polyline points="${X(-ov)},${Y(model.eaveFt)} ${X(rs)},${Y(model.ridgeFt)} ${X(re)},${Y(model.ridgeFt)} ${X(model.spanFt + ov)},${Y(model.eaveFt)}" fill="none" stroke="#26231f" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round"/>`);
  } else if (model.barnHip) {
    // Barn (gambrel hip): two-pitch HIPPED silhouette — eave -> steep to the
    // inset knuckle -> shallow to the inset ridge -> flat ridge -> mirror.
    const ki = model.barnHip.knuckleInsetFt;
    const kh = model.barnHip.knuckleHeightFt;
    const rs = model.barnHip.ridgeStartFt;
    const re = model.barnHip.ridgeEndFt;
    const sp = model.spanFt;
    parts.push(`<polygon points="${X(0)},${Y(0)} ${X(sp)},${Y(0)} ${X(sp)},${Y(model.eaveFt)} ${X(sp - ki)},${Y(kh)} ${X(re)},${Y(model.ridgeFt)} ${X(rs)},${Y(model.ridgeFt)} ${X(ki)},${Y(kh)} ${X(0)},${Y(model.eaveFt)}" fill="#f2eee7" stroke="#3d3933" stroke-width="1.4"/>`);
    parts.push(`<polyline points="${X(-ov)},${Y(model.eaveFt)} ${X(ki)},${Y(kh)} ${X(rs)},${Y(model.ridgeFt)} ${X(re)},${Y(model.ridgeFt)} ${X(sp - ki)},${Y(kh)} ${X(sp + ov)},${Y(model.eaveFt)}" fill="none" stroke="#26231f" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round"/>`);
  } else if (model.gambrel) {
    // Gambrel gable end: two-pitch silhouette — eave -> knuckle -> ridge ->
    // knuckle -> eave (steep lower slope, shallow upper slope).
    const ks = model.gambrel.knuckleStartFt;
    const ke = model.gambrel.knuckleEndFt;
    const kh = model.gambrel.knuckleHeightFt;
    const apexX = X(model.spanFt / 2);
    parts.push(`<polygon points="${X(0)},${Y(0)} ${X(model.spanFt)},${Y(0)} ${X(model.spanFt)},${Y(model.eaveFt)} ${X(ke)},${Y(kh)} ${apexX},${Y(model.ridgeFt)} ${X(ks)},${Y(kh)} ${X(0)},${Y(model.eaveFt)}" fill="#f2eee7" stroke="#3d3933" stroke-width="1.4"/>`);
    parts.push(`<polyline points="${X(-ov)},${Y(model.eaveFt)} ${X(ks)},${Y(kh)} ${apexX},${Y(model.ridgeFt)} ${X(ke)},${Y(kh)} ${X(model.spanFt + ov)},${Y(model.eaveFt)}" fill="none" stroke="#26231f" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round"/>`);
  } else if (model.gableFacing) {
    // Gable face: wall polygon rises to the ridge; roof edge with overhang.
    const apexX = X(model.spanFt / 2);
    parts.push(`<polygon points="${X(0)},${Y(0)} ${X(model.spanFt)},${Y(0)} ${X(model.spanFt)},${Y(model.eaveFt)} ${apexX},${Y(model.ridgeFt)} ${X(0)},${Y(model.eaveFt)}" fill="#f2eee7" stroke="#3d3933" stroke-width="1.4"/>`);
    parts.push(`<polyline points="${X(-ov)},${Y(model.eaveFt) + (model.eaveFt > 2 ? 0 : 0)} ${X(-ov)},${Y(model.eaveFt)} ${apexX},${Y(model.ridgeFt)} ${X(model.spanFt + ov)},${Y(model.eaveFt)}" fill="none" stroke="#26231f" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round"/>`);
  } else {
    // Facade along the ridge: low wall, then the visible roof slope face up
    // to the ridge line, overhanging the gable ends.
    parts.push(`<rect x="${X(0)}" y="${Y(model.facadeWallFt)}" width="${x1 - x0}" height="${yBase - Y(model.facadeWallFt)}" fill="#f2eee7" stroke="#3d3933" stroke-width="1.4"/>`);
    parts.push(`<polygon points="${X(-ov)},${Y(model.facadeWallFt)} ${X(model.spanFt + ov)},${Y(model.facadeWallFt)} ${X(model.spanFt + ov)},${Y(model.ridgeFt)} ${X(-ov)},${Y(model.ridgeFt)}" fill="#efe9df" stroke="none" opacity="0.55"/>`);
    parts.push(`<line x1="${X(-ov)}" y1="${Y(model.ridgeFt)}" x2="${X(model.spanFt + ov)}" y2="${Y(model.ridgeFt)}" stroke="#26231f" stroke-width="3.4" stroke-linecap="round"/>`);
    parts.push(`<line x1="${X(-ov)}" y1="${Y(model.facadeWallFt)}" x2="${X(model.spanFt + ov)}" y2="${Y(model.facadeWallFt)}" stroke="#26231f" stroke-width="2"/>`);
    parts.push(`<line x1="${X(-ov)}" y1="${Y(model.ridgeFt)}" x2="${X(-ov)}" y2="${Y(model.facadeWallFt)}" stroke="#5c554b" stroke-width="1.6"/>`);
    parts.push(`<line x1="${X(model.spanFt + ov)}" y1="${Y(model.ridgeFt)}" x2="${X(model.spanFt + ov)}" y2="${Y(model.facadeWallFt)}" stroke="#5c554b" stroke-width="1.6"/>`);
  }

  for (const opening of model.openings) {
    const ox = X(opening.center - opening.widthFt / 2);
    const ow = opening.widthFt * scale;
    const oy = Y(opening.headFt);
    const oh = (opening.headFt - opening.sillFt) * scale;
    if (opening.kind === 'door') {
      parts.push(`<rect x="${ox}" y="${oy}" width="${ow}" height="${oh}" fill="#e9e2d6" stroke="#3d3933" stroke-width="1.6"/>`);
      parts.push(`<line x1="${ox + ow * 0.5}" y1="${oy + 4}" x2="${ox + ow * 0.5}" y2="${Y(opening.sillFt) - 4}" stroke="#7a7164" stroke-width="0.9"/>`);
    } else {
      parts.push(`<rect x="${ox}" y="${oy}" width="${ow}" height="${oh}" fill="#eef4f4" stroke="#3d3933" stroke-width="1.4"/>`);
      parts.push(`<line x1="${ox}" y1="${oy + oh / 2}" x2="${ox + ow}" y2="${oy + oh / 2}" stroke="#8fa6ad" stroke-width="0.9"/>`);
      parts.push(`<line x1="${ox + ow / 2}" y1="${oy}" x2="${ox + ow / 2}" y2="${oy + oh}" stroke="#8fa6ad" stroke-width="0.9"/>`);
      parts.push(`<line x1="${ox - 3}" y1="${Y(opening.sillFt)}" x2="${ox + ow + 3}" y2="${Y(opening.sillFt)}" stroke="#3d3933" stroke-width="1.8"/>`);
    }
  }

  // Grade line + overall span dimension.
  parts.push(`<line x1="${X(-ov - 1)}" y1="${yBase}" x2="${X(model.spanFt + ov + 1)}" y2="${yBase}" stroke="#26231f" stroke-width="2.6"/>`);
  const dimY = yBase + 13;
  parts.push(`<line x1="${X(0)}" y1="${dimY}" x2="${X(model.spanFt)}" y2="${dimY}" stroke="#8a8178" stroke-width="0.9"/>`);
  parts.push(`<line x1="${X(0)}" y1="${dimY - 4}" x2="${X(0)}" y2="${dimY + 4}" stroke="#8a8178" stroke-width="0.9"/>`);
  parts.push(`<line x1="${X(model.spanFt)}" y1="${dimY - 4}" x2="${X(model.spanFt)}" y2="${dimY + 4}" stroke="#8a8178" stroke-width="0.9"/>`);
  parts.push(`<text x="${(X(0) + X(model.spanFt)) / 2}" y="${dimY - 3}" text-anchor="middle" font-size="10" fill="#6f675c">${model.spanFt}&#39;-0&#34;</text>`);
  parts.push('</svg>');
  return parts.join('');
}
