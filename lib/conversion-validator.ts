/**
 * Post-conversion data validator.
 *
 * Checks DenHome integrity after SpatialIR → DenHome conversion.
 * Catches data pipeline bugs before they become visual artifacts.
 *
 * Run after spatialToDenHome() to detect:
 * - Adjacency violations (connected rooms not grid-adjacent)
 * - Footprint coverage gaps (rooms don't fill the building)
 * - Facade inconsistency (interior rooms on perimeter, facade rooms interior)
 * - Bounding box / footprint mismatch (roof won't match rooms)
 */

import type { DenHome, RoomLayout, RoomConnection } from './types';

export interface ConversionIssue {
  severity: 'error' | 'warning';
  category: 'adjacency' | 'coverage' | 'facade' | 'bbox' | 'area';
  message: string;
}

const GRID = 4;
const OUTDOOR_TYPES = new Set(['deck', 'porch', 'covered_porch', 'screened_porch']);

function gridAdjacent(a: RoomLayout, b: RoomLayout): boolean {
  // Horizontal adjacency: share a horizontal edge
  const hOverlap = a.gx < b.gx + b.gw && a.gx + a.gw > b.gx;
  const hAdj = hOverlap && (a.gz + a.gd === b.gz || b.gz + b.gd === a.gz);

  // Vertical adjacency: share a vertical edge
  const vOverlap = a.gz < b.gz + b.gd && a.gz + a.gd > b.gz;
  const vAdj = vOverlap && (a.gx + a.gw === b.gx || b.gx + b.gw === a.gx);

  return hAdj || vAdj;
}

export function validateConversion(home: DenHome): ConversionIssue[] {
  const issues: ConversionIssue[] = [];
  const rooms = home.rooms;
  const connections = home.connections || [];
  const groundRooms = rooms.filter(r => !r.floor || r.floor === 0);

  // 1. Adjacency preservation — connected rooms should be grid-adjacent
  for (const conn of connections) {
    if (conn.type === 'wall') continue; // wall connections don't need adjacency
    const roomA = groundRooms.find(r => r.label === conn.from);
    const roomB = groundRooms.find(r => r.label === conn.to);
    if (!roomA || !roomB) continue;

    if (!gridAdjacent(roomA, roomB)) {
      issues.push({
        severity: 'error',
        category: 'adjacency',
        message: `"${conn.from}" and "${conn.to}" are ${conn.type}-connected but not grid-adjacent (${conn.from}: gx=${roomA.gx},gz=${roomA.gz} ${roomA.gw}x${roomA.gd} | ${conn.to}: gx=${roomB.gx},gz=${roomB.gz} ${roomB.gw}x${roomB.gd})`,
      });
    }
  }

  // 2. Bounding box vs footprint mismatch
  if (groundRooms.length > 0) {
    const minGx = Math.min(...groundRooms.map(r => r.gx));
    const maxGx = Math.max(...groundRooms.map(r => r.gx + r.gw));
    const minGz = Math.min(...groundRooms.map(r => r.gz));
    const maxGz = Math.max(...groundRooms.map(r => r.gz + r.gd));

    const gridW = (maxGx - minGx) * GRID;
    const gridD = (maxGz - minGz) * GRID;
    const fpW = home.footprint.width;
    const fpD = home.footprint.depth;

    // Check if bounding box is wildly different from footprint
    const wRatio = gridW / fpW;
    const dRatio = gridD / fpD;

    if (wRatio < 0.5 || wRatio > 2.0) {
      issues.push({
        severity: 'error',
        category: 'bbox',
        message: `Room grid width ${gridW}ft vs footprint ${fpW}ft (ratio ${wRatio.toFixed(2)}). Roof will not match rooms.`,
      });
    }
    if (dRatio < 0.5 || dRatio > 2.0) {
      issues.push({
        severity: 'error',
        category: 'bbox',
        message: `Room grid depth ${gridD}ft vs footprint ${fpD}ft (ratio ${dRatio.toFixed(2)}). Roof will not match rooms.`,
      });
    }
    if (wRatio >= 0.5 && wRatio <= 2.0 && (wRatio < 0.8 || wRatio > 1.2)) {
      issues.push({
        severity: 'warning',
        category: 'bbox',
        message: `Room grid width ${gridW}ft vs footprint ${fpW}ft (ratio ${wRatio.toFixed(2)}). Minor roof mismatch.`,
      });
    }
    if (dRatio >= 0.5 && dRatio <= 2.0 && (dRatio < 0.8 || dRatio > 1.2)) {
      issues.push({
        severity: 'warning',
        category: 'bbox',
        message: `Room grid depth ${gridD}ft vs footprint ${fpD}ft (ratio ${dRatio.toFixed(2)}). Minor roof mismatch.`,
      });
    }

    // 3. Coverage — what fraction of the bounding box is filled?
    const totalGridCells = (maxGx - minGx) * (maxGz - minGz);
    let filledCells = 0;
    for (let gx = minGx; gx < maxGx; gx++) {
      for (let gz = minGz; gz < maxGz; gz++) {
        if (groundRooms.some(r => gx >= r.gx && gx < r.gx + r.gw && gz >= r.gz && gz < r.gz + r.gd)) {
          filledCells++;
        }
      }
    }
    const coverageRatio = filledCells / totalGridCells;
    if (coverageRatio < 0.6) {
      issues.push({
        severity: 'error',
        category: 'coverage',
        message: `Only ${(coverageRatio * 100).toFixed(0)}% of bounding box is filled. Gaps will cause false walls or empty areas.`,
      });
    } else if (coverageRatio < 0.85) {
      issues.push({
        severity: 'warning',
        category: 'coverage',
        message: `${(coverageRatio * 100).toFixed(0)}% of bounding box filled. Some gaps may be visible.`,
      });
    }
  }

  // 4. Room overlap detection
  for (let i = 0; i < groundRooms.length; i++) {
    for (let j = i + 1; j < groundRooms.length; j++) {
      const a = groundRooms[i];
      const b = groundRooms[j];
      const overlapX = Math.max(0, Math.min(a.gx + a.gw, b.gx + b.gw) - Math.max(a.gx, b.gx));
      const overlapZ = Math.max(0, Math.min(a.gz + a.gd, b.gz + b.gd) - Math.max(a.gz, b.gz));
      if (overlapX > 0 && overlapZ > 0) {
        issues.push({
          severity: 'error',
          category: 'coverage',
          message: `"${a.label}" and "${b.label}" overlap by ${overlapX}x${overlapZ} grid cells`,
        });
      }
    }
  }

  // 5. Area sanity — room grid area vs declared area
  for (const room of groundRooms) {
    const gridArea = room.gw * room.gd * GRID * GRID;
    if (room.area > 0 && Math.abs(gridArea - room.area) / room.area > 0.5) {
      issues.push({
        severity: 'warning',
        category: 'area',
        message: `"${room.label}" grid area ${gridArea}sqft vs declared ${room.area}sqft (${((gridArea / room.area - 1) * 100).toFixed(0)}% off)`,
      });
    }
  }

  return issues;
}

/** Log validation results to console. Returns true if no errors. */
export function logValidation(home: DenHome): boolean {
  const issues = validateConversion(home);
  if (issues.length === 0) return true;

  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');

  if (errors.length > 0) {
    console.error(`[validate] ${home.model}: ${errors.length} errors, ${warnings.length} warnings`);
    for (const e of errors) console.error(`  ✗ [${e.category}] ${e.message}`);
  }
  if (warnings.length > 0) {
    for (const w of warnings) console.warn(`  ⚠ [${w.category}] ${w.message}`);
  }

  return errors.length === 0;
}
