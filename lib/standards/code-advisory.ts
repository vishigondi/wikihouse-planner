// Deterministic dimensional constraint engine ("Code Advisory").
//
// Evaluates a normalized plan against cited rules: room minimums, egress,
// setbacks, lot coverage, and panel-grid compliance. Every finding carries
// the rule it comes from, and rules that cannot be evaluated with the data
// available report `not-evaluated` instead of guessing.
//
// This module is intentionally dependency-free (type-only imports erased at
// compile time) so Node can execute it directly for offline checks.
// Legal note: findings are advisory; the app does not claim code compliance
// without a jurisdiction-specific rule pack and professional review.

export const CODE_ADVISORY_REPORT_VERSION = 'code_advisory_v1';

export type CodeAdvisoryCategory =
  | 'room-minimums'
  | 'egress'
  | 'setbacks'
  | 'lot-coverage'
  | 'grid-compliance';

export type CodeAdvisoryStatus = 'pass' | 'fail' | 'not-evaluated';

export interface CodeAdvisoryRule {
  ruleId: string;
  citation: string;
  category: CodeAdvisoryCategory;
}

export const CODE_ADVISORY_RULES: CodeAdvisoryRule[] = [
  {
    ruleId: 'IRC-R304.1',
    citation: 'IRC §R304.1 — Habitable rooms shall have a floor area of not less than 70 sq ft.',
    category: 'room-minimums',
  },
  {
    ruleId: 'IRC-R304.2',
    citation: 'IRC §R304.2 — Habitable rooms shall be not less than 7 ft in any horizontal dimension (kitchens exempt).',
    category: 'room-minimums',
  },
  {
    ruleId: 'IRC-R310.1',
    citation: 'IRC §R310.1 — Every sleeping room shall have at least one emergency escape and rescue opening (egress window or exterior door).',
    category: 'egress',
  },
  {
    ruleId: 'WH-GRID-4FT',
    citation: 'WikiHouse panel system — room boundaries should align to the 4 ft structural grid.',
    category: 'grid-compliance',
  },
  {
    ruleId: 'ZON-SETBACK',
    citation: 'Zoning (parameterized per lot) — building footprint must fit inside the lot minus required setbacks.',
    category: 'setbacks',
  },
  {
    ruleId: 'ZON-COVERAGE',
    citation: 'Zoning (parameterized per lot) — building footprint must not exceed the maximum lot coverage ratio.',
    category: 'lot-coverage',
  },
];

const RULE_BY_ID = new Map(CODE_ADVISORY_RULES.map((rule) => [rule.ruleId, rule]));

// --- Jurisdiction packs -------------------------------------------------------
// Every citation override and site advisory must trace to a primary source;
// anything not verifiable from one becomes a "verify with the authority"
// advisory rather than an invented number.

export interface JurisdictionSiteAdvisory {
  ruleId: string;
  category: CodeAdvisoryCategory;
  citation: string;
  detail: string;
}

export interface JurisdictionPack {
  id: string;
  label: string;
  /** Human-readable in-force code edition line for the report header. */
  codeEdition: string;
  transitionNote?: string;
  /** ruleId -> jurisdiction-specific citation text. */
  citationByRule: Record<string, string>;
  /** Standing site checks that cannot be decided from plan JSON. */
  siteAdvisories: JurisdictionSiteAdvisory[];
  /** Replaces the generic "no lot specified" detail for ZON rules. */
  zoningStatus?: string;
}

export const JURISDICTION_PACKS: JurisdictionPack[] = [
  {
    id: 'model-irc',
    label: 'Model IRC (jurisdiction-neutral)',
    codeEdition: 'International Residential Code (model text)',
    citationByRule: {},
    siteAdvisories: [],
  },
  {
    id: 'nc-cherokee-county',
    label: 'Cherokee County, NC (unincorporated)',
    // Primary sources, retrieved 2026-06-11: NC OSFM "Codes - Current and Past"
    // (2018 Residential Code effective Jan 1 2019); NCRC 2018 (IRC 2015 base).
    codeEdition: '2018 North Carolina Residential Code (IRC 2015 base), in force since Jan 1, 2019',
    transitionNote:
      'The 2024 NC State Building Code adoption was delayed past April 2026 (Disaster Recovery Act of 2025). Confirm the in-force edition with Cherokee County Building Code Enforcement (828-837-5527) before permitting.',
    citationByRule: {
      'IRC-R304.1': 'NCRC 2018 §R304.1 — Habitable rooms shall have a floor area of not less than 70 sq ft (kitchens excepted).',
      'IRC-R304.2': 'NCRC 2018 §R304.2 — Habitable rooms shall be not less than 7 ft in any horizontal dimension (kitchens excepted).',
      'IRC-R305.1': 'NCRC 2018 §R305.1 — Habitable space ceiling height not less than 7 ft; bathrooms/laundry 6 ft 8 in; sloped ceilings: not less than 50% of the required floor area at 7 ft or more, and no portion below 5 ft counts toward required area.',
      'IRC-R310.1': 'NCRC 2018 §R310.1 — Sleeping rooms require an emergency escape and rescue opening (model base: 5.7 sq ft net clear opening, 5.0 sq ft at grade floor; minimum 24 in height, 20 in width; sill height max 44 in).',
      'ZON-SETBACK': 'Cherokee County, NC has no county-wide zoning ordinance (county Ordinances & Plans page, retrieved 2026-06-11). Evaluated against user-supplied lot setbacks only.',
      'ZON-COVERAGE': 'Cherokee County, NC has no county-wide zoning ordinance; coverage limits apply only if user-supplied (e.g. covenants or watershed rules).',
    },
    zoningStatus:
      'Cherokee County has no county-wide zoning ordinance (adopted county ordinances: Animal Control 2021, Comprehensive Plan 2023, Facilities Use Policy). Setbacks are typically driven by septic permitting (15A NCAC 18E), NCDOT driveway/right-of-way rules, watershed/flood regulations, and private covenants. Verify with Cherokee County Planning, 828-837-5527.',
    siteAdvisories: [
      {
        ruleId: 'NC-SEPTIC-18E',
        category: 'setbacks',
        citation: '15A NCAC 18E — NC on-site wastewater rules (septic/well separations).',
        detail: 'Septic system siting and separations from wells, streams, and property lines are not derivable from the plan JSON. Verify with Cherokee County Environmental Health.',
      },
      {
        ruleId: 'NC-FLOOD-SFHA',
        category: 'setbacks',
        citation: 'NFIP / county flood damage prevention regulations.',
        detail: 'If the parcel lies in a Special Flood Hazard Area, elevation and permitting requirements apply. Check the effective FIRM panel for the parcel.',
      },
      {
        ruleId: 'NC-TOWN-LIMITS',
        category: 'setbacks',
        citation: 'Municipal zoning (Murphy / Andrews) where applicable.',
        detail: 'Parcels inside town limits or extraterritorial jurisdiction fall under municipal zoning with their own setbacks. Confirm the parcel jurisdiction.',
      },
    ],
  },
];

const PACK_BY_ID = new Map(JURISDICTION_PACKS.map((pack) => [pack.id, pack]));

export function jurisdictionPack(id: string | undefined): JurisdictionPack {
  return (id && PACK_BY_ID.get(id)) || PACK_BY_ID.get('model-irc')!;
}

export interface CodeAdvisoryRoom {
  id: string;
  label?: string;
  type?: string;
  floor?: number;
  /** Rectangular extent in feet; omit when the source has no geometry. */
  widthFt?: number;
  depthFt?: number;
  areaSqFt?: number;
  /** Sub-rectangles in feet for non-rectangular rooms. */
  parts?: Array<{ widthFt: number; depthFt: number }>;
  /** Original grid-space coords for grid-compliance (unitFt = feet per grid unit). */
  grid?: { gx: number; gz: number; gw: number; gd: number; unitFt: number };
  physicalBoundary?: boolean;
  semanticZone?: boolean;
}

export interface CodeAdvisoryOpening {
  id?: string;
  kind?: string;
  openingType?: string;
  roomIds?: Array<string | null | undefined>;
  fromRoomId?: string | null;
  toRoomId?: string | null;
  opensIntoRoomId?: string | null;
}

export interface CodeAdvisoryLot {
  widthFt: number;
  depthFt: number;
  setbacksFt?: { front?: number; rear?: number; left?: number; right?: number };
  /** Default 0.35 when omitted. */
  maxCoverageRatio?: number;
}

export interface CodeAdvisoryInput {
  planId?: string;
  jurisdictionId?: string;
  footprintWidthFt?: number;
  footprintDepthFt?: number;
  rooms: CodeAdvisoryRoom[];
  openings: CodeAdvisoryOpening[];
  lot?: CodeAdvisoryLot | null;
}

export interface CodeAdvisoryFinding {
  ruleId: string;
  citation: string;
  category: CodeAdvisoryCategory;
  status: CodeAdvisoryStatus;
  subjectId?: string;
  subjectLabel?: string;
  detail: string;
}

export interface CodeAdvisoryReport {
  reportVersion: typeof CODE_ADVISORY_REPORT_VERSION;
  planId?: string;
  jurisdiction: { id: string; label: string; codeEdition: string; transitionNote?: string };
  findings: CodeAdvisoryFinding[];
  summary: { pass: number; fail: number; notEvaluated: number };
}

const HABITABLE_PATTERN = /bed|living|dining|kitchen|family|den\b|office|studio|great\s*room|loft|bunk|sleep/i;
const NON_HABITABLE_PATTERN = /bath|closet|storage|hall|entry|porch|deck|mech|utility|laundry|stair|landing|void|open.?to.?below|wc\b|toilet|mud/i;
const SLEEPING_PATTERN = /bed(?!\s*bath)|bunk|sleep/i;
const KITCHEN_PATTERN = /kitchen/i;
const EXTERIOR_PATTERN = /exterior|outside|outdoor|deck|porch|patio|yard/i;

const MIN_HABITABLE_AREA_SQFT = 70;
const MIN_HABITABLE_DIMENSION_FT = 7;
const DEFAULT_MAX_COVERAGE_RATIO = 0.35;
const GRID_TOLERANCE_FT = 0.05;
const SETBACK_TOLERANCE_FT = 0.05;

function roomText(room: CodeAdvisoryRoom): string {
  return `${room.type ?? ''} ${room.label ?? ''}`;
}

export function isHabitableRoom(room: CodeAdvisoryRoom): boolean {
  const text = roomText(room);
  if (NON_HABITABLE_PATTERN.test(text)) return false;
  return HABITABLE_PATTERN.test(text);
}

export function isSleepingRoom(room: CodeAdvisoryRoom): boolean {
  const text = roomText(room);
  if (NON_HABITABLE_PATTERN.test(text)) return false;
  return SLEEPING_PATTERN.test(text);
}

function roomAreaSqFt(room: CodeAdvisoryRoom): number | undefined {
  if (Number.isFinite(room.areaSqFt)) return room.areaSqFt;
  if (room.parts?.length) {
    let total = 0;
    for (const part of room.parts) {
      if (!Number.isFinite(part.widthFt) || !Number.isFinite(part.depthFt)) return undefined;
      total += part.widthFt * part.depthFt;
    }
    return total;
  }
  if (Number.isFinite(room.widthFt) && Number.isFinite(room.depthFt)) {
    return (room.widthFt as number) * (room.depthFt as number);
  }
  return undefined;
}

function roomMinDimensionFt(room: CodeAdvisoryRoom): number | undefined {
  // For non-rectangular rooms approximate with the most generous part: the
  // room satisfies the rule if at least one part offers the min dimension.
  if (room.parts?.length) {
    const candidates = room.parts
      .filter((part) => Number.isFinite(part.widthFt) && Number.isFinite(part.depthFt))
      .map((part) => Math.min(part.widthFt, part.depthFt));
    if (!candidates.length) return undefined;
    return Math.max(...candidates);
  }
  if (Number.isFinite(room.widthFt) && Number.isFinite(room.depthFt)) {
    return Math.min(room.widthFt as number, room.depthFt as number);
  }
  return undefined;
}

function referencesRoom(opening: CodeAdvisoryOpening, roomId: string): boolean {
  if (opening.fromRoomId === roomId || opening.toRoomId === roomId || opening.opensIntoRoomId === roomId) return true;
  return (opening.roomIds ?? []).some((id) => id === roomId);
}

function isEgressCandidate(opening: CodeAdvisoryOpening): boolean {
  const kind = opening.kind ?? '';
  const openingType = opening.openingType ?? '';
  if (/window/i.test(kind) || /window/i.test(openingType)) return true;
  if (/exteriorDoor|slidingDoor/i.test(openingType)) return true;
  if (/door/i.test(kind)) {
    const sides = [opening.fromRoomId, opening.toRoomId, ...(opening.roomIds ?? [])];
    return sides.some((side) => side && EXTERIOR_PATTERN.test(side));
  }
  return false;
}

function makeFinding(
  pack: JurisdictionPack,
  ruleId: string,
  status: CodeAdvisoryStatus,
  detail: string,
  subject?: { id?: string; label?: string },
): CodeAdvisoryFinding {
  const rule = RULE_BY_ID.get(ruleId);
  if (!rule) throw new Error(`Unknown code advisory rule: ${ruleId}`);
  return {
    ruleId,
    citation: pack.citationByRule[ruleId] ?? rule.citation,
    category: rule.category,
    status,
    subjectId: subject?.id,
    subjectLabel: subject?.label,
    detail,
  };
}

function offGridDistanceFt(value: number, unitFt: number): number {
  const ft = value * unitFt;
  const nearest = Math.round(ft / 4) * 4;
  return Math.abs(ft - nearest);
}

export function codeAdvisoryReport(input: CodeAdvisoryInput): CodeAdvisoryReport {
  const pack = jurisdictionPack(input.jurisdictionId);
  const findings: CodeAdvisoryFinding[] = [];
  const finding = (
    ruleId: string,
    status: CodeAdvisoryStatus,
    detail: string,
    subject?: { id?: string; label?: string },
  ) => makeFinding(pack, ruleId, status, detail, subject);
  const subject = (room: CodeAdvisoryRoom) => ({ id: room.id, label: room.label ?? room.id });

  // --- Room minimums (IRC R304) ---
  const habitable = input.rooms.filter(isHabitableRoom);
  for (const room of habitable) {
    const area = roomAreaSqFt(room);
    if (area === undefined) {
      findings.push(finding('IRC-R304.1', 'not-evaluated', 'Room has no usable geometry in the semantic JSON.', subject(room)));
    } else if (area + 1e-6 < MIN_HABITABLE_AREA_SQFT) {
      findings.push(finding('IRC-R304.1', 'fail', `Floor area ${area.toFixed(1)} sq ft is below the ${MIN_HABITABLE_AREA_SQFT} sq ft minimum.`, subject(room)));
    } else {
      findings.push(finding('IRC-R304.1', 'pass', `Floor area ${area.toFixed(1)} sq ft meets the ${MIN_HABITABLE_AREA_SQFT} sq ft minimum.`, subject(room)));
    }

    if (KITCHEN_PATTERN.test(roomText(room))) continue;
    const minDim = roomMinDimensionFt(room);
    if (minDim === undefined) {
      findings.push(finding('IRC-R304.2', 'not-evaluated', 'Room has no usable geometry in the semantic JSON.', subject(room)));
    } else if (minDim + 1e-6 < MIN_HABITABLE_DIMENSION_FT) {
      findings.push(finding('IRC-R304.2', 'fail', `Minimum horizontal dimension ${minDim.toFixed(1)} ft is below the ${MIN_HABITABLE_DIMENSION_FT} ft minimum.`, subject(room)));
    } else {
      findings.push(finding('IRC-R304.2', 'pass', `Minimum horizontal dimension ${minDim.toFixed(1)} ft meets the ${MIN_HABITABLE_DIMENSION_FT} ft minimum.`, subject(room)));
    }
  }

  // --- Egress (IRC R310) ---
  const sleeping = input.rooms.filter(isSleepingRoom);
  const hasRoomReference = (opening: CodeAdvisoryOpening) =>
    Boolean(opening.fromRoomId || opening.toRoomId || opening.opensIntoRoomId || (opening.roomIds ?? []).some(Boolean));
  const unattributedEgress = input.openings.filter(
    (opening) => isEgressCandidate(opening) && !hasRoomReference(opening),
  );
  for (const room of sleeping) {
    const referencing = input.openings.filter((opening) => referencesRoom(opening, room.id));
    if (!input.openings.length) {
      findings.push(finding('IRC-R310.1', 'not-evaluated', 'Semantic JSON has no openings to evaluate.', subject(room)));
      continue;
    }
    const egress = referencing.filter(isEgressCandidate);
    if (egress.length) {
      const ids = egress.map((opening) => opening.id ?? opening.kind ?? 'opening').slice(0, 3).join(', ');
      findings.push(finding('IRC-R310.1', 'pass', `Sleeping room has ${egress.length} egress candidate(s): ${ids}.`, subject(room)));
    } else if (unattributedEgress.length) {
      // Windows/exterior doors exist but carry no room references, so the
      // rule cannot be decided honestly. Repairing attribution unlocks it.
      findings.push(finding('IRC-R310.1', 'not-evaluated', `${unattributedEgress.length} egress candidate(s) carry no room references in the semantic JSON; attribute windows/exterior doors to rooms to evaluate this rule.`, subject(room)));
    } else {
      findings.push(finding('IRC-R310.1', 'fail', 'Sleeping room has no egress window or exterior door in the semantic JSON.', subject(room)));
    }
  }

  // --- Grid compliance (one finding per plan) ---
  const gridRooms = input.rooms.filter((room) => room.grid && room.physicalBoundary !== false && !room.semanticZone);
  if (!gridRooms.length) {
    findings.push(finding('WH-GRID-4FT', 'not-evaluated', 'No physical rooms carry grid coordinates.'));
  } else {
    const offGrid = gridRooms.filter((room) => {
      const grid = room.grid as NonNullable<CodeAdvisoryRoom['grid']>;
      return (
        offGridDistanceFt(grid.gx, grid.unitFt) > GRID_TOLERANCE_FT ||
        offGridDistanceFt(grid.gz, grid.unitFt) > GRID_TOLERANCE_FT ||
        offGridDistanceFt(grid.gw, grid.unitFt) > GRID_TOLERANCE_FT ||
        offGridDistanceFt(grid.gd, grid.unitFt) > GRID_TOLERANCE_FT
      );
    });
    if (!offGrid.length) {
      findings.push(finding('WH-GRID-4FT', 'pass', `All ${gridRooms.length} physical room(s) align to the 4 ft panel grid.`));
    } else {
      const names = offGrid.slice(0, 5).map((room) => room.label ?? room.id).join(', ');
      findings.push(finding('WH-GRID-4FT', 'fail', `${offGrid.length} of ${gridRooms.length} physical room(s) are off the 4 ft panel grid (e.g. ${names}). Panelization may require adjustment.`));
    }
  }

  // --- Lot rules (require a lot spec) ---
  const lot = input.lot ?? null;
  const footprintW = input.footprintWidthFt;
  const footprintD = input.footprintDepthFt;
  if (!lot) {
    const zoningDetail = pack.zoningStatus
      ?? 'No lot specified. Attach lot { widthFt, depthFt, setbacksFt } to evaluate setbacks.';
    findings.push(finding('ZON-SETBACK', 'not-evaluated', zoningDetail));
    findings.push(finding('ZON-COVERAGE', 'not-evaluated', pack.zoningStatus
      ?? 'No lot specified. Attach lot { widthFt, depthFt, maxCoverageRatio } to evaluate coverage.'));
  } else if (!Number.isFinite(footprintW) || !Number.isFinite(footprintD) || !footprintW || !footprintD) {
    findings.push(finding('ZON-SETBACK', 'not-evaluated', 'Plan has no footprint dimensions to compare against the lot.'));
    findings.push(finding('ZON-COVERAGE', 'not-evaluated', 'Plan has no footprint dimensions to compare against the lot.'));
  } else {
    const setbacks = lot.setbacksFt ?? {};
    const front = setbacks.front ?? 0;
    const rear = setbacks.rear ?? 0;
    const left = setbacks.left ?? 0;
    const right = setbacks.right ?? 0;
    const availableW = lot.widthFt - left - right;
    const availableD = lot.depthFt - front - rear;
    if (footprintW <= availableW + SETBACK_TOLERANCE_FT && footprintD <= availableD + SETBACK_TOLERANCE_FT) {
      findings.push(finding('ZON-SETBACK', 'pass', `Footprint ${footprintW.toFixed(1)}×${footprintD.toFixed(1)} ft fits the buildable envelope ${availableW.toFixed(1)}×${availableD.toFixed(1)} ft (lot ${lot.widthFt}×${lot.depthFt} ft minus setbacks F${front}/R${rear}/L${left}/R${right}).`));
    } else {
      findings.push(finding('ZON-SETBACK', 'fail', `Footprint ${footprintW.toFixed(1)}×${footprintD.toFixed(1)} ft exceeds the buildable envelope ${availableW.toFixed(1)}×${availableD.toFixed(1)} ft (lot ${lot.widthFt}×${lot.depthFt} ft minus setbacks F${front}/R${rear}/L${left}/R${right}).`));
    }

    const maxRatio = lot.maxCoverageRatio ?? DEFAULT_MAX_COVERAGE_RATIO;
    const coverage = (footprintW * footprintD) / (lot.widthFt * lot.depthFt);
    if (coverage <= maxRatio + 1e-6) {
      findings.push(finding('ZON-COVERAGE', 'pass', `Lot coverage ${(coverage * 100).toFixed(1)}% is within the ${(maxRatio * 100).toFixed(0)}% maximum.`));
    } else {
      findings.push(finding('ZON-COVERAGE', 'fail', `Lot coverage ${(coverage * 100).toFixed(1)}% exceeds the ${(maxRatio * 100).toFixed(0)}% maximum.`));
    }
  }

  // --- Jurisdiction site advisories (never decidable from plan JSON) ---
  for (const advisory of pack.siteAdvisories) {
    findings.push({
      ruleId: advisory.ruleId,
      citation: advisory.citation,
      category: advisory.category,
      status: 'not-evaluated',
      detail: advisory.detail,
    });
  }

  const summary = {
    pass: findings.filter((item) => item.status === 'pass').length,
    fail: findings.filter((item) => item.status === 'fail').length,
    notEvaluated: findings.filter((item) => item.status === 'not-evaluated').length,
  };

  return {
    reportVersion: CODE_ADVISORY_REPORT_VERSION,
    planId: input.planId,
    jurisdiction: {
      id: pack.id,
      label: pack.label,
      codeEdition: pack.codeEdition,
      transitionNote: pack.transitionNote,
    },
    findings,
    summary,
  };
}
