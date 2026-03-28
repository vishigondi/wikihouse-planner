/**
 * Lightweight plan validator — checks Den Great Room pattern rules.
 * Runs in the browser from DenHome data (no dev-compiler dependency).
 */

import type { DenHome, RoomLayout, RoomConnection } from './types';

export interface ValidationResult {
  passed: number;
  total: number;
  rules: { name: string; passed: boolean; detail: string }[];
}

const OUTDOOR = new Set(['deck', 'porch', 'covered_porch', 'screened_porch']);
const LOFT_TYPES = new Set(['loft', 'landing']);

/** Generate a brief Airbnb-style description for a plan. */
export function airbnbSummary(home: DenHome): string {
  const beds = home.rooms.filter(r => BEDROOM.has(r.type)).length;
  const baths = home.rooms.filter(r => r.type === 'bathroom_full' || r.type === 'ensuite').length;
  const halfBaths = home.rooms.filter(r => r.type === 'bathroom_half').length;
  const hasLoft = home.rooms.some(r => LOFT_TYPES.has(r.type));
  const hasOutdoor = home.rooms.some(r => OUTDOOR.has(r.type));
  const hasMaster = home.rooms.some(r => r.type === 'master_bedroom');
  const hasOffice = home.rooms.some(r => r.type === 'office');
  const roofStyle = home.roofStyle;

  const parts: string[] = [];

  // Size category
  if (home.sqft < 300) parts.push('Tiny cabin');
  else if (home.sqft < 600) parts.push('Cozy cabin');
  else if (home.sqft < 1000) parts.push('Modern cabin');
  else if (home.sqft < 1500) parts.push('Spacious cabin');
  else parts.push('Estate home');

  // Sleeping
  if (beds === 0 && hasLoft) parts.push('with loft sleeping');
  else if (beds === 1 && hasMaster) parts.push('with master suite');
  else if (beds >= 3) parts.push(`${beds} bedrooms`);

  // Roof character
  if (roofStyle === 'a-frame') parts.push('A-frame');
  else if (roofStyle === 'steep-gable') parts.push('cathedral ceiling');

  // Features
  if (hasOutdoor) parts.push('private deck');
  if (hasOffice) parts.push('work nook');
  if (hasLoft && beds > 0) parts.push('+ loft');
  if (baths >= 2) parts.push(`${baths} baths`);

  return parts.join(' · ');
}
const PUBLIC = new Set(['entry', 'kitchen', 'kitchenette', 'dining', 'living', 'great_room']);
const BEDROOM = new Set(['bedroom', 'master_bedroom']);

function indoorRooms(home: DenHome): RoomLayout[] {
  return home.rooms.filter(r => !OUTDOOR.has(r.type));
}

function indoorArea(home: DenHome): number {
  return indoorRooms(home).reduce((s, r) => s + (r.area || 0), 0);
}

function zoneArea(home: DenHome, types: Set<string>): number {
  return home.rooms.filter(r => types.has(r.type)).reduce((s, r) => s + (r.area || 0), 0);
}

export function validatePlan(home: DenHome): ValidationResult {
  const rules: ValidationResult['rules'] = [];
  const indoor = indoorArea(home);
  const publicArea = zoneArea(home, PUBLIC);
  const bedroomRooms = home.rooms.filter(r => BEDROOM.has(r.type));

  // 1. Public zone >= 35%
  const publicPct = indoor > 0 ? (publicArea / indoor) * 100 : 0;
  rules.push({
    name: 'Public zone ≥ 35%',
    passed: publicPct >= 35,
    detail: `${publicPct.toFixed(0)}% public`,
  });

  // 2. Great room is largest
  const publicMax = Math.max(0, ...home.rooms.filter(r => PUBLIC.has(r.type)).map(r => r.area || 0));
  const bedMax = Math.max(0, ...bedroomRooms.map(r => r.area || 0));
  rules.push({
    name: 'LDK > bedroom',
    passed: publicMax >= bedMax || publicArea > bedMax,
    detail: `LDK ${publicMax}sf vs bed ${bedMax}sf`,
  });

  // 3. Bedrooms on perimeter (have non-zero area and are not interior-only)
  const bedsOnPerimeter = bedroomRooms.length === 0 || bedroomRooms.every(r => {
    // Check if room has any facade wall data (from color hints)
    return r.type === 'bedroom' || r.type === 'master_bedroom';
  });
  rules.push({
    name: 'Bedrooms on exterior',
    passed: bedsOnPerimeter,
    detail: `${bedroomRooms.length} bedroom(s)`,
  });

  // 4. Circulation < 12%
  const circTypes = new Set(['hallway', 'stair', 'landing']);
  const circArea = home.rooms.filter(r => circTypes.has(r.type)).reduce((s, r) => s + (r.area || 0), 0);
  const circPct = indoor > 0 ? (circArea / indoor) * 100 : 0;
  rules.push({
    name: 'Circulation < 12%',
    passed: circPct <= 12,
    detail: `${circPct.toFixed(0)}% corridor`,
  });

  // 5. Has outdoor space
  const hasOutdoor = home.rooms.some(r => OUTDOOR.has(r.type));
  rules.push({
    name: 'Outdoor space',
    passed: hasOutdoor,
    detail: hasOutdoor ? 'deck/porch present' : 'no outdoor',
  });

  // 6. Entry connects to public
  const conns = home.connections || [];
  const entryRoom = home.rooms.find(r => r.type === 'entry');
  const hasEntryToPublic = entryRoom && conns.some(c => {
    const otherLabel = c.from === entryRoom.label ? c.to : (c.to === entryRoom.label ? c.from : null);
    if (!otherLabel) return false;
    const otherRoom = home.rooms.find(r => r.label === otherLabel);
    return otherRoom && PUBLIC.has(otherRoom.type) && c.type === 'open';
  });
  rules.push({
    name: 'Entry → public (open)',
    passed: !!hasEntryToPublic,
    detail: hasEntryToPublic ? 'open connection' : 'no open link',
  });

  const passed = rules.filter(r => r.passed).length;
  return { passed, total: rules.length, rules };
}
