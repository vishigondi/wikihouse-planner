// Look-render prompt builder.
//
// Turns a plan's REAL geometry + a named "look" into an image-generation prompt
// for the ChatGPT browser handoff lane. The render this produces is an
// ILLUSTRATIVE marketing concept — never a measured drawing — so the prompt
// always carries the "not to scale" framing and an originality guard (style is
// described in words; we never reference a competitor's photo or brand).
//
// Dependency-free so Node can import it directly for the offline gate.

export type LookId = 'dark' | 'bright' | 'earthy' | 'bold' | 'classic' | 'natural' | 'rustic';

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
 * The render must track THIS design, not a generic cabin: the prompt names the
 * roof style, footprint, ridge/eave, openings, and loft so the illustration
 * reflects the actual plan. Ends with the illustrative framing + originality
 * guard that keep this lane honest and clear of competitor imagery.
 */
export function buildLookRenderPrompt(spec: LookRenderSpec, look: LookId): string {
  const style = LOOKS[look].style;
  const openings: string[] = [];
  if (spec.gableDoors) openings.push(`${spec.gableDoors} entry door${spec.gableDoors === 1 ? '' : 's'}`);
  if (spec.gableWindows) openings.push(`${spec.gableWindows} window${spec.gableWindows === 1 ? '' : 's'}`);
  if (spec.loftWindow) openings.push('a small loft window high in the gable peak');
  const gableFace = openings.length ? `front gable facade with ${openings.join(', ')}` : 'clean front gable facade';
  const loft = spec.hasLoft ? ' with an interior loft level' : '';
  return [
    `Exterior architectural illustration of a ${spec.roofStyle} cabin${loft}.`,
    `Form: about ${spec.widthFt} ft wide by ${spec.depthFt} ft deep, ~${Math.round(spec.ridgeFt)} ft ridge peak, ~${Math.round(spec.eaveFt)} ft eave; ${gableFace}.`,
    `Look: ${style}.`,
    'Render it as a soft, hand-rendered architectural illustration (premium house-plan marketing art), set in a wooded clearing with gentle landscaping; not photoreal.',
    'This is an illustrative concept render — not to scale, not a construction drawing.',
    'Original design: do not replicate any specific real building, brand, or photograph.',
  ].join(' ');
}

/** Derive a spec from a compiled paired artifact (used by the gate and import). */
export function lookRenderSpecFromArtifact(artifact: {
  planId?: string;
  footprint?: { widthFt?: number; depthFt?: number; levels?: number };
  roof?: { style?: string; ridgeHeightFt?: number; eaveHeightFt?: number; ridgeAxis?: string };
  windows?: Array<{ floor?: number; levelIndex?: number; span?: { z1?: number; z2?: number; x1?: number; x2?: number } }>;
  doors?: Array<{ openingType?: string; span?: { z1?: number; z2?: number; x1?: number; x2?: number } }>;
}): LookRenderSpec {
  const widthFt = artifact.footprint?.widthFt ?? 0;
  const depthFt = artifact.footprint?.depthFt ?? 0;
  const ridgeAlongZ = (artifact.roof?.ridgeAxis ?? 'z') === 'z';
  // The gable face is the z=0 end for ridge-along-z, x=0 for ridge-along-x.
  const onGable = (span?: { z1?: number; z2?: number; x1?: number; x2?: number }) => {
    if (!span) return false;
    return ridgeAlongZ
      ? Math.max(Math.abs(span.z1 ?? 9), Math.abs(span.z2 ?? 9)) < 1
      : Math.max(Math.abs(span.x1 ?? 9), Math.abs(span.x2 ?? 9)) < 1;
  };
  const gableWindowsGround = (artifact.windows ?? []).filter((w) => (w.floor ?? w.levelIndex ?? 0) === 0 && onGable(w.span)).length;
  const gableDoors = (artifact.doors ?? []).filter((d) => d.openingType === 'exteriorDoor' && onGable(d.span)).length;
  const loftWindow = (artifact.windows ?? []).some((w) => (w.floor ?? w.levelIndex ?? 0) >= 1);
  return {
    planId: artifact.planId ?? 'plan',
    roofStyle: artifact.roof?.style ?? 'a-frame',
    widthFt,
    depthFt,
    ridgeFt: artifact.roof?.ridgeHeightFt ?? 0,
    eaveFt: artifact.roof?.eaveHeightFt ?? 0,
    hasLoft: (artifact.footprint?.levels ?? 1) > 1,
    gableDoors,
    gableWindows: gableWindowsGround,
    loftWindow,
  };
}
