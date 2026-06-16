// Look-render prompt builder.
//
// Turns a plan's REAL geometry + a named "look" into an image-generation prompt
// for the ChatGPT browser handoff lane. The render this produces is an
// ILLUSTRATIVE marketing concept — never a measured drawing — so the prompt
// always carries the "not to scale" framing and an originality guard (style is
// described in words; we never reference a competitor's photo or brand).
//
// Imports only the (also import-free) elevation builder so Node can still load
// it directly for the offline gate — no React/Three/Next dependencies.

import { buildElevationModel } from './elevations.ts';

export type LookId = 'dark' | 'bright' | 'earthy' | 'bold' | 'classic' | 'natural' | 'rustic';

/**
 * How the look render is drawn. 'illustration' is the original hand-rendered
 * marketing art; 'photoreal' is a photorealistic architectural visualization
 * (the social-feed look). Either way the result is a CONCEPT render — never a
 * measured drawing and, for photoreal, explicitly not a photo of a real home.
 */
export type LookRenderMode = 'illustration' | 'photoreal';

export function isLookRenderMode(value: string): value is LookRenderMode {
  return value === 'illustration' || value === 'photoreal';
}

export const LOOKS: Record<LookId, { label: string; style: string }> = {
  dark: { label: 'Dark', style: 'moody charcoal and blackened-timber palette, matte dark roof, dusk light, deep shadows' },
  bright: { label: 'Bright', style: 'airy white-and-pale-timber palette, crisp daylight, clear blue sky, fresh and light' },
  earthy: { label: 'Earthy', style: 'warm cedar and clay tones, natural stone base, soft autumn light, grounded and organic' },
  bold: { label: 'Bold', style: 'high-contrast black trim against warm wood, confident lines, dramatic side light' },
  classic: { label: 'Classic', style: 'timeless white siding with muted slate roof, balanced symmetry, gentle midday light' },
  natural: { label: 'Natural', style: 'raw timber and greenery, mossy surroundings, diffuse overcast light, understated' },
  rustic: { label: 'Rustic', style: 'weathered barnwood and rough stone, hand-hewn texture, golden-hour warmth, cabin-in-the-woods feel' },
};

export interface LookRenderSpec {
  planId: string;
  roofStyle: string;
  widthFt: number;
  depthFt: number;
  ridgeFt: number;
  eaveFt: number;
  hasLoft: boolean;
  gableDoors: number;
  gableWindows: number;
  loftWindow: boolean;
}

export function isLookId(value: string): value is LookId {
  return Object.prototype.hasOwnProperty.call(LOOKS, value);
}

/**
 * The structural facts an illustration must AGREE with to be "consistent" — the
 * checkable subset of the compiled geometry the deterministic 3D/elevations are
 * drawn from. This is the consistency contract (roof style, footprint aspect,
 * gable openings, loft presence), NOT a pixel/dimensional drift metric: an
 * exterior render is never compared pixel-for-pixel against the 2D plan.
 */
export interface ExpectedStructure {
  roofStyle: string;
  widthFt: number;
  depthFt: number;
  aspectRatio: number;
  gableDoors: number;
  gableWindows: number;
  hasLoft: boolean;
}

/**
 * Project a spec onto its structural facts. Pure: every field comes straight
 * from the spec (which is itself derived from the plan's compiled geometry), so
 * a recorded expectedStructure can never claim a structure the plan doesn't have.
 */
export function expectedStructureFromSpec(spec: LookRenderSpec): ExpectedStructure {
  const aspectRatio = spec.depthFt ? Math.round((spec.widthFt / spec.depthFt) * 100) / 100 : 0;
  return {
    roofStyle: spec.roofStyle,
    widthFt: spec.widthFt,
    depthFt: spec.depthFt,
    aspectRatio,
    gableDoors: spec.gableDoors,
    gableWindows: spec.gableWindows,
    hasLoft: spec.hasLoft,
  };
}

/**
 * The render must track THIS design, not a generic cabin: the prompt names the
 * roof style, footprint, ridge/eave, openings, and loft so the render reflects
 * the actual plan. Ends with the concept-render framing + originality guard that
 * keep this lane honest and clear of competitor imagery — for photoreal renders
 * the framing explicitly states it is NOT a photo of a real home (a photoreal
 * concept could otherwise be mistaken for one).
 */
export function buildLookRenderPrompt(spec: LookRenderSpec, look: LookId, mode: LookRenderMode = 'illustration'): string {
  const style = LOOKS[look].style;
  // Describe exactly the gable openings the checklist records (gableWindows
  // already includes any loft-level glazing on the gable face), so the prompt
  // and the consistency checklist cannot disagree.
  const openings: string[] = [];
  if (spec.gableDoors) openings.push(`${spec.gableDoors} entry door${spec.gableDoors === 1 ? '' : 's'}`);
  if (spec.gableWindows) openings.push(`${spec.gableWindows} window${spec.gableWindows === 1 ? '' : 's'}`);
  const gableFace = openings.length ? `front gable facade with ${openings.join(', ')}` : 'clean front gable facade';
  const loft = spec.hasLoft ? ' with an interior loft level' : '';
  const article = /^[aeiou]/i.test(spec.roofStyle) ? 'an' : 'a';
  const photoreal = mode === 'photoreal';
  const noun = photoreal ? 'visualization' : 'illustration';
  const renderLine = photoreal
    ? 'Render it as a photorealistic architectural visualization — realistic materials, natural daylight, accurate shadows, professional exterior rendering — set on a gently landscaped cleared lot.'
    : 'Render it as a soft, hand-rendered architectural illustration (premium house-plan marketing art), set in a wooded clearing with gentle landscaping; not photoreal.';
  const conceptLine = photoreal
    ? 'This is a concept render — not a photo of a real home, not to scale, not a construction drawing.'
    : 'This is an illustrative concept render — not to scale, not a construction drawing.';
  return [
    `Exterior architectural ${noun} of ${article} ${spec.roofStyle} cabin${loft}.`,
    `Form: about ${spec.widthFt} ft wide by ${spec.depthFt} ft deep, ~${Math.round(spec.ridgeFt)} ft ridge peak, ~${Math.round(spec.eaveFt)} ft eave; ${gableFace}.`,
    `Look: ${style}.`,
    renderLine,
    conceptLine,
    'Original design: do not replicate any specific real building, brand, or photograph.',
  ].join(' ');
}

/**
 * Where a look render is stored, relative to the plan's image-loop dir. The
 * extension follows the actual image bytes (JPEG for photographic marketing
 * renders — far smaller than PNG; defaults to png for the validation dry-run).
 */
export function lookRenderAssetPath(planId: string, look: LookId, ext: string = 'png'): string {
  const clean = ext.replace(/^\./, '').toLowerCase();
  return `look-render/${planId}-${look}.${clean}`;
}

/**
 * The manifest fields the import ADDS for a look render — always flagged
 * illustrative, and always carrying the expectedStructure the illustration is
 * meant to depict. The importer spreads these onto the plan option and touches
 * nothing else, so the deterministic render/JSON stay the source of truth.
 */
export function lookRenderManifestFields(look: LookId, relUrl: string, expected: ExpectedStructure): {
  lookRenderUrl: string;
  lookRenderLook: LookId;
  lookRenderIllustrative: true;
  lookRenderExpectedStructure: ExpectedStructure;
} {
  return { lookRenderUrl: relUrl, lookRenderLook: look, lookRenderIllustrative: true, lookRenderExpectedStructure: expected };
}

/**
 * Derive a spec from a compiled or traced paired artifact (used by the gate,
 * the import, and the app's handoff prompt).
 *
 * The gable door/window counts come from the SAME deterministic elevation the
 * consistency panel shows — the gable-facing view (front for ridge-along-z, side
 * for ridge-along-x) — so the structural facts match the drawing by construction
 * (one source of truth) and honor its headroom filtering. A hand-rolled
 * positional guess would over-count openings the steep roof actually clips, and
 * would miss the gable entirely on ridge-along-x plans (the a-frame-22 bug).
 */
export function lookRenderSpecFromArtifact(artifact: {
  planId?: string;
  footprint?: { widthFt?: number; depthFt?: number; levels?: number; appliesTo?: unknown[] };
  roof?: { style?: string; ridgeHeightFt?: number; eaveHeightFt?: number; ridgeAxis?: string; overhangFt?: number; planes?: unknown };
  windows?: Array<{ floor?: number; levelIndex?: number; span?: { z1?: number; z2?: number; x1?: number; x2?: number } }>;
  doors?: Array<{ openingType?: string; floor?: number; levelIndex?: number; span?: { z1?: number; z2?: number; x1?: number; x2?: number } }>;
}): LookRenderSpec {
  const widthFt = artifact.footprint?.widthFt ?? 0;
  const depthFt = artifact.footprint?.depthFt ?? 0;
  const ridgeAlongZ = (artifact.roof?.ridgeAxis ?? 'z') === 'z';

  // A loft is present when the footprint spans a loft level, the level count is
  // >1, OR any opening lives on level >= 1 (traced footprints record the loft
  // via appliesTo/floor rather than a `levels` count — relying on `levels` alone
  // wrongly read a-frame-22 as single-storey).
  const appliesLoft = Array.isArray(artifact.footprint?.appliesTo)
    && artifact.footprint.appliesTo.some((entry) => /loft/i.test(String(entry)));
  const upperOpening = [...(artifact.windows ?? []), ...(artifact.doors ?? [])]
    .some((opening) => (opening.floor ?? opening.levelIndex ?? 0) >= 1);
  const hasLoft = (artifact.footprint?.levels ?? 1) > 1 || appliesLoft || upperOpening;

  // Count gable-face openings off the deterministic gable elevation.
  const gableSide = ridgeAlongZ ? 'front' : 'side';
  const elevationInput = {
    planId: artifact.planId ?? 'plan',
    footprint: { widthFt, depthFt },
    roof: {
      style: artifact.roof?.style ?? 'a-frame',
      ridgeAxis: ridgeAlongZ ? 'z' : 'x',
      ridgeHeightFt: artifact.roof?.ridgeHeightFt ?? 0,
      eaveHeightFt: artifact.roof?.eaveHeightFt ?? 0,
      overhangFt: artifact.roof?.overhangFt ?? 1,
      planes: artifact.roof?.planes,
    },
    windows: artifact.windows,
    doors: artifact.doors,
  } as Parameters<typeof buildElevationModel>[0];
  const gable = buildElevationModel(elevationInput, gableSide);
  const gableDoors = gable.openings.filter((o) => o.kind === 'door').length;
  const gableWindows = gable.openings.filter((o) => o.kind === 'window').length;

  return {
    planId: artifact.planId ?? 'plan',
    roofStyle: artifact.roof?.style ?? 'a-frame',
    widthFt,
    depthFt,
    ridgeFt: artifact.roof?.ridgeHeightFt ?? 0,
    eaveFt: artifact.roof?.eaveHeightFt ?? 0,
    hasLoft,
    gableDoors,
    gableWindows,
    loftWindow: upperOpening,
  };
}
