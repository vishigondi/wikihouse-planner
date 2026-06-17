#!/usr/bin/env node
/**
 * Browser screenshot QA for the promoted paired floorplans.
 *
 * This is intentionally a browser-level harness: it captures the views a buyer
 * would see and emits a small report that can be attached to Brochure Quality
 * issues or GPT repair prompts. It does not mutate plans.
 */

import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = resolve(ROOT, 'artifacts/brochure-qa');
const LOOP_ROOT = resolve(ROOT, 'public/data/den-image-loop');
const MANIFEST_PATH = resolve(LOOP_ROOT, 'proposal-manifest.json');
const BASE_URL = process.env.BROCHURE_QA_URL ?? 'http://127.0.0.1:3000';
const PLANS = (process.env.BROCHURE_QA_PLANS ?? 'a-frame-bunk,a-frame-22,outpost-medium,gen-001')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const PRIMITIVE_LAYERS = ['wall', 'ladder', 'door', 'window', 'dashedVoid', 'dimension', 'fixture'];
const RELEASE_BLOCKING_REPAIR_LAYERS = new Set([
  'drawing style profile',
  'source primitives',
  'source primitive overrides',
  'semantic rebuild',
  'level frames',
  'walls',
  'openings',
  'doors',
  'windows',
  'fixtures',
  'furniture',
  'stairs',
  'void/open-to-below',
  'labels',
  'dimensions',
  'roof/elevation',
]);

const ROOT_BLOCKED_PATHS = [
  '/id',
  '/model',
  '/sqft',
  '/bedBath',
  '/footprint',
  '/pairedArtifactInfo',
  '/pairedArtifact',
  '/pairedProposalId',
  '/componentsUsed',
  '/buildValidation',
];

const REPAIR_LAYER_PATHS = {
  'drawing style profile': {
    allowed: ['/rules', '/validation', '/source', '/profileId', '/generatedAt'],
    blocked: ['/schemaVersion', '/planId', '/proposalId'],
  },
  'source primitives': {
    allowed: ['/sourceAnchors', '/floorPanels'],
    blocked: [...ROOT_BLOCKED_PATHS, '/rooms', '/sourceWalls', '/exteriorWalls', '/interiorWalls', '/sourceOpenings', '/openings', '/doors', '/windows', '/fixtures', '/connections', '/roofSemantics'],
  },
  'source primitive overrides': {
    allowed: ['/sourceWalls', '/sourceOpenings'],
    blocked: [...ROOT_BLOCKED_PATHS, '/rooms', '/sourceAnchors', '/floorPanels', '/exteriorWalls', '/interiorWalls', '/openings', '/doors', '/windows', '/fixtures', '/connections', '/roofSemantics'],
  },
  'semantic rebuild': {
    allowed: [
      '/coordinateSystem',
      '/coordinateMode',
      '/dimensionFrame',
      '/floorPanels',
      '/rooms',
      '/spaceFaces',
      '/exteriorWalls',
      '/interiorWalls',
      '/sourceWalls',
      '/sourceOpenings',
      '/openings',
      '/doors',
      '/windows',
      '/fixtures',
      '/connections',
      '/dimensionLines',
      '/sourceAnchors',
    ],
    blocked: [...ROOT_BLOCKED_PATHS, '/roofSemantics', '/roof', '/elevations'],
  },
  'level frames': {
    allowed: ['/dimensionFrame', '/rooms', '/spaceFaces', '/floorPanels'],
    blocked: [...ROOT_BLOCKED_PATHS, '/sourceWalls', '/sourceOpenings', '/connections', '/roofSemantics'],
  },
  walls: {
    allowed: ['/sourceWalls', '/exteriorWalls', '/interiorWalls'],
    blocked: [...ROOT_BLOCKED_PATHS, '/rooms', '/sourceOpenings', '/openings', '/doors', '/windows', '/connections', '/roofSemantics'],
  },
  openings: {
    allowed: ['/openings', '/doors', '/windows', '/connections'],
    blocked: [...ROOT_BLOCKED_PATHS, '/rooms', '/sourceWalls', '/exteriorWalls', '/interiorWalls', '/roofSemantics'],
  },
  doors: {
    allowed: ['/openings', '/doors', '/connections'],
    blocked: [...ROOT_BLOCKED_PATHS, '/rooms', '/sourceWalls', '/sourceOpenings', '/exteriorWalls', '/interiorWalls', '/roofSemantics'],
  },
  windows: {
    allowed: ['/openings', '/windows'],
    blocked: [...ROOT_BLOCKED_PATHS, '/rooms', '/sourceWalls', '/sourceOpenings', '/exteriorWalls', '/interiorWalls', '/connections', '/roofSemantics'],
  },
  fixtures: {
    allowed: ['/rooms', '/fixtures'],
    blocked: [...ROOT_BLOCKED_PATHS, '/sourceWalls', '/exteriorWalls', '/interiorWalls', '/sourceOpenings', '/openings', '/doors', '/windows', '/connections', '/roofSemantics'],
  },
  furniture: {
    allowed: ['/rooms', '/fixtures'],
    blocked: [...ROOT_BLOCKED_PATHS, '/sourceWalls', '/exteriorWalls', '/interiorWalls', '/sourceOpenings', '/openings', '/doors', '/windows', '/connections', '/roofSemantics'],
  },
  stairs: {
    allowed: ['/rooms', '/fixtures', '/connections', '/openings'],
    blocked: [...ROOT_BLOCKED_PATHS, '/sourceWalls', '/exteriorWalls', '/interiorWalls', '/roofSemantics'],
  },
  'void/open-to-below': {
    allowed: ['/rooms', '/spaceFaces', '/exteriorWalls', '/interiorWalls'],
    blocked: [...ROOT_BLOCKED_PATHS, '/sourceWalls', '/sourceOpenings', '/openings', '/doors', '/windows', '/connections', '/roofSemantics'],
  },
  labels: {
    allowed: ['/rooms'],
    blocked: [...ROOT_BLOCKED_PATHS, '/sourceWalls', '/exteriorWalls', '/interiorWalls', '/sourceOpenings', '/openings', '/doors', '/windows', '/connections', '/roofSemantics'],
  },
  dimensions: {
    allowed: ['/dimensionFrame', '/dimensionLines', '/floorPanels'],
    blocked: [...ROOT_BLOCKED_PATHS, '/sourceWalls', '/exteriorWalls', '/interiorWalls', '/sourceOpenings', '/openings', '/doors', '/windows', '/connections', '/roofSemantics'],
  },
  'roof/elevation': {
    allowed: ['/roof', '/roofSemantics', '/elevations', '/height', '/roofStyle'],
    blocked: [...ROOT_BLOCKED_PATHS.filter((path) => path !== '/footprint'), '/rooms', '/sourceWalls', '/exteriorWalls', '/interiorWalls', '/sourceOpenings', '/openings', '/doors', '/windows', '/connections'],
  },
};

const VIEW_BUTTONS = [
  ['product3d', 'BIM 3D'],
  ['cutaway', 'Cutaway'],
  ['front', 'Front'],
  ['side', 'Side'],
  ['plantop', 'Plan Top'],
];

const REVIEW_TABS = [
  ['compare', 'Compare'],
  ['overlay', 'Overlay'],
  ['semantic', 'Semantic'],
];

const VALIDATION_GROUP_LAYER = {
  source: 'level frames',
  json: 'walls',
  geometry: 'level frames',
  openings: 'openings',
  fixtures: 'fixtures',
  'visual-drift': 'walls',
  standards: 'fixtures',
  bim: 'void/open-to-below',
  roof: 'roof/elevation',
  'presentation-drift': 'roof/elevation',
  'brochure-quality': 'roof/elevation',
  build: 'walls',
  export: 'dimensions',
  accessibility: 'level frames',
  codeAdvisory: 'level frames',
};

const VIEWPORTS = [
  { id: 'desktop', width: 1440, height: 1000 },
  { id: 'laptop', width: 1280, height: 860 },
];

async function clickVisibleText(page, text, bounds = {}) {
  const candidates = page.getByText(text, { exact: true });
  const count = await candidates.count();
  if (count === 0) throw new Error(`missing control: ${text}`);
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    const box = await candidate.boundingBox();
    const inBounds = box
      && (bounds.minX === undefined || box.x >= bounds.minX)
      && (bounds.maxX === undefined || box.x <= bounds.maxX)
      && (bounds.minY === undefined || box.y >= bounds.minY)
      && (bounds.maxY === undefined || box.y <= bounds.maxY);
    if (await candidate.isVisible() && inBounds) {
      await candidate.click();
      return;
    }
  }
  throw new Error(`control is hidden or out of bounds: ${text}`);
}

async function waitForCanvas(page) {
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    return Boolean(canvas && canvas.clientWidth > 200 && canvas.clientHeight > 160);
  }, undefined, { timeout: 10_000 });
}

async function productCanvasMetrics(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const rect = canvas?.getBoundingClientRect();
    const renderedCategoryCounts = canvas?.dataset?.bimRenderedCategoryCounts
      ? JSON.parse(canvas.dataset.bimRenderedCategoryCounts)
      : {};
    const text = document.body.innerText;
    const statusLine = text.split('\n').find((line) => line.includes('Design') && line.includes('Brochure')) ?? '';
    return {
      canvas: rect ? {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      } : null,
      bimElementCount: Number(canvas?.dataset?.bimElementCount ?? 0),
      bimRenderedElementCount: Number(canvas?.dataset?.bimRenderedElementCount ?? 0),
      renderedCategoryCounts,
      statusLine,
      hasBrochureBlocked: /Brochure blocked/i.test(statusLine) || text.includes('BROCHURE QUALITY') && text.includes('BLOCKED'),
      hasDesignBlocked: /Design blocked/i.test(statusLine),
      hasPresentationBlocked: /Presentation blocked/i.test(statusLine),
      hasDesignPass: /Design pass/i.test(statusLine),
      hasDebugLeakText: /selected bim element|source anchor|debug guide|validation outline/i.test(text),
      hasHarnessRailLeak: /PAIRED GPT STATUS|PROMPT TO PLAN|QUEUE PROGRESS|COMPONENTS \(/i.test(text),
    };
  });
}

async function pageReviewSignals(page) {
  return page.evaluate(() => {
    const text = document.body.innerText;
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const validationGroups = Array.from(document.querySelectorAll('[data-validation-group]')).map((element) => ({
      id: element.getAttribute('data-validation-group') ?? '',
      label: element.getAttribute('data-validation-label') ?? '',
      lane: element.getAttribute('data-validation-lane') ?? '',
      status: element.getAttribute('data-validation-status') ?? '',
      blockers: (element.getAttribute('data-validation-blockers') ?? '').split('\n').map((item) => item.trim()).filter(Boolean),
      warnings: (element.getAttribute('data-validation-warnings') ?? '').split('\n').map((item) => item.trim()).filter(Boolean),
      action: element.getAttribute('data-validation-action') ?? '',
    }));
    return {
      workflowLine: lines.find((line) => /Design .*Presentation .*Brochure/i.test(line)) ?? '',
      blockedLines: lines.filter((line) => /blocked|warning|drift|fixture|door|opening|roof|presentation|brochure/i.test(line)).slice(0, 80),
      validationGroups,
    };
  });
}

async function drawingStyleReviewMetrics(page, storedDeterministicSvgUrl = '') {
  return page.evaluate(async (storedDeterministicSvgUrl) => {
    const scratchNodes = [];
    const mountProfiledSvgText = (svgText) => {
      if (!svgText || !svgText.includes('data-drawing-style-schema')) return [];
      const holder = document.createElement('div');
      holder.style.position = 'fixed';
      holder.style.left = '-30000px';
      holder.style.top = '0';
      holder.style.width = '1px';
      holder.style.height = '1px';
      holder.style.pointerEvents = 'none';
      holder.setAttribute('data-qa-inline-stored-render', 'true');
      holder.innerHTML = svgText;
      for (const svg of Array.from(holder.querySelectorAll('svg'))) {
        const width = Number(svg.getAttribute('width')) || 1200;
        const height = Number(svg.getAttribute('height')) || 1200;
        svg.style.width = `${width}px`;
        svg.style.height = `${height}px`;
        holder.style.width = `${Math.max(Number.parseFloat(holder.style.width) || 1, width)}px`;
        holder.style.height = `${Math.max(Number.parseFloat(holder.style.height) || 1, height)}px`;
      }
      document.body.appendChild(holder);
      scratchNodes.push(holder);
      return Array.from(holder.querySelectorAll('svg[data-drawing-style-schema]'));
    };
    const visibleDeterministicImage = Array.from(document.querySelectorAll('img'))
      .filter((img) => /deterministic render/i.test(img.alt ?? ''))
      .map((img) => ({ img, rect: img.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 20 && rect.height > 20)
      .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height))[0]?.img;
    let profiledSvgs = [];
    if (storedDeterministicSvgUrl) {
      try {
        const svgText = await fetch(storedDeterministicSvgUrl).then((response) => response.ok ? response.text() : '');
        profiledSvgs = mountProfiledSvgText(svgText);
      } catch {
        profiledSvgs = [];
      }
    }
    if (visibleDeterministicImage?.src && /\.svg(?:$|\?)/i.test(visibleDeterministicImage.src)) {
      try {
        const svgText = await fetch(visibleDeterministicImage.src).then((response) => response.ok ? response.text() : '');
        const imageSvgs = mountProfiledSvgText(svgText);
        if (imageSvgs.length) {
          profiledSvgs = imageSvgs;
        }
      } catch {
        // Keep the stored deterministic SVG if it was provided by the QA harness.
      }
    }
    if (!profiledSvgs.length) {
      profiledSvgs = Array.from(document.querySelectorAll('svg[data-drawing-style-schema]'));
    }
    const selectAll = (selector) => profiledSvgs.flatMap((svg) => Array.from(svg.querySelectorAll(selector)));
    const styleText = profiledSvgs
      .map((svg) => Array.from(svg.querySelectorAll('style')).map((style) => style.textContent ?? '').join('\n'))
      .join('\n');
    const text = document.body.innerText;
    const primitiveLayers = ['wall', 'ladder', 'door', 'window', 'dashedVoid', 'dimension', 'fixture'];
    const parseSourceTargetBox = (element) => {
      const raw = element.getAttribute('data-source-target-box');
      if (!raw) return null;
      try {
        const box = JSON.parse(raw);
        const x = Number(box.x);
        const y = Number(box.y);
        const width = Number(box.width);
        const height = Number(box.height);
        if ([x, y, width, height].every(Number.isFinite)) {
          return {
            x: Number(x.toFixed(2)),
            y: Number(y.toFixed(2)),
            width: Number(width.toFixed(2)),
            height: Number(height.toFixed(2)),
          };
        }
      } catch {
        return null;
      }
      return null;
    };
    const renderedPrimitives = selectAll('[data-drawing-layer]')
      .filter((element) => element.getAttribute('display') !== 'none')
      .filter((element) => element.getAttribute('data-source-exact-overlay-replaced') !== 'true')
      .map((element, index) => {
      let bbox = null;
      let bboxSvg = null;
      try {
        const sourceTargetBox = parseSourceTargetBox(element);
        if (typeof element.getBBox === 'function') {
          const box = element.getBBox();
          bbox = {
            x: Number(box.x.toFixed(2)),
            y: Number(box.y.toFixed(2)),
            width: Number(box.width.toFixed(2)),
            height: Number(box.height.toFixed(2)),
          };
          const matrix = element.getCTM?.();
          if (matrix) {
            const points = [
              new DOMPoint(box.x, box.y).matrixTransform(matrix),
              new DOMPoint(box.x + box.width, box.y).matrixTransform(matrix),
              new DOMPoint(box.x, box.y + box.height).matrixTransform(matrix),
              new DOMPoint(box.x + box.width, box.y + box.height).matrixTransform(matrix),
            ];
            const xs = points.map((point) => point.x);
            const ys = points.map((point) => point.y);
            const x = Math.min(...xs);
            const y = Math.min(...ys);
            const maxX = Math.max(...xs);
            const maxY = Math.max(...ys);
            bboxSvg = {
              x: Number(x.toFixed(2)),
              y: Number(y.toFixed(2)),
              width: Number((maxX - x).toFixed(2)),
              height: Number((maxY - y).toFixed(2)),
            };
          }
        }
        if (sourceTargetBox && element.getAttribute('data-source-primitive-aligned') === 'true') {
          bboxSvg = sourceTargetBox;
        }
      } catch {
        bbox = null;
        bboxSvg = null;
      }
      const childTagCounts = {};
      for (const child of Array.from(element.querySelectorAll('*'))) {
        const tag = child.tagName.toLowerCase();
        childTagCounts[tag] = (childTagCounts[tag] ?? 0) + 1;
      }
      return {
        index,
        layer: element.getAttribute('data-drawing-layer') ?? '',
        role: element.getAttribute('data-role') ?? '',
        sourceId: element.getAttribute('data-source-id') ?? '',
        sourceKind: element.getAttribute('data-source-kind') ?? '',
        floor: element.getAttribute('data-source-floor') ?? '',
        tag: element.tagName.toLowerCase(),
        bbox,
        bboxSvg,
        childTagCounts,
        display: element.getAttribute('display') ?? '',
        exactOverlay: element.getAttribute('data-source-exact-overlay') === 'true',
      };
    });
    const renderedPrimitiveCounts = Object.fromEntries(primitiveLayers.map((layer) => [
      layer,
      renderedPrimitives.filter((primitive) => primitive.layer === layer).length,
    ]));
    const result = {
      profiledSvgCount: profiledSvgs.length,
      schemas: profiledSvgs.map((svg) => svg.getAttribute('data-drawing-style-schema') ?? '').filter(Boolean),
      profileIds: profiledSvgs.map((svg) => svg.getAttribute('data-drawing-style-profile') ?? '').filter(Boolean),
      exteriorWallRoles: selectAll('[data-role="exterior-wall"]').length,
      interiorWallRoles: selectAll('[data-role="interior-wall"]').length,
      doorRoles: selectAll('[data-role="door"]').length,
      windowRoles: selectAll('[data-role="window"]').length,
      fixtureRoles: selectAll('[data-role="fixture"], [data-role="stair-symbol"]').length,
      sourceWallIds: new Set(selectAll('[data-role="exterior-wall"][data-source-id], [data-role="interior-wall"][data-source-id]').map((element) => element.getAttribute('data-source-id'))).size,
      sourceOpeningIds: new Set(selectAll('[data-role="door"][data-source-id], [data-role="window"][data-source-id]').map((element) => element.getAttribute('data-source-id'))).size,
      sourceFixtureIds: new Set(selectAll('[data-role="fixture"][data-source-id], [data-role="stair-symbol"][data-source-id]').map((element) => element.getAttribute('data-source-id'))).size,
      renderedPrimitiveCounts,
      renderedPrimitives,
      hasExteriorRule: styleText.includes('[data-role="exterior-wall"]'),
      hasDoorRule: styleText.includes('[data-role="door"]'),
      hasWindowRule: styleText.includes('[data-role="window"]'),
      hasFixtureRule: styleText.includes('[data-role="fixture"]'),
      semanticMentionsStyleProfile: text.includes('"drawingStyleProfile"') && text.includes('"drawing_style_profile_v1"'),
    };
    scratchNodes.forEach((node) => node.remove());
    return result;
  }, storedDeterministicSvgUrl);
}

function validationBlockersFromSignals(signals) {
  // Only lane blockers gate release. Lane warnings (including all visual
  // drift vs the GPT proposal image) are advisory repair hints, not gates.
  const releaseBlockingLanes = new Set(['design', 'presentation', 'brochure']);
  return (signals?.validationGroups ?? [])
    .filter((group) => releaseBlockingLanes.has(group.lane) && group.status === 'blocked')
    .flatMap((group) => {
      const messages = [...(group.blockers ?? [])];
      if (!messages.length) return [`${group.label || group.id}: ${group.status}`];
      return messages.map((message) => `${group.label || group.id}: ${message}`);
    });
}

function primitiveDriftLayersFromMessage(messages) {
  const layers = [];
  const text = String(messages ?? '');
  const hasPrimitiveEdgeDrift = /primitive edge drift|Compare\/Overlay primitive edge drift|source\/render primitive drift|primitive geometry drift/i.test(text);
  if (!hasPrimitiveEdgeDrift) return layers;
  if (/wall primitive (?:edge|geometry) drift|wall\s+[a-z0-9_:.-]+.*source\/render primitive drift/i.test(text)) layers.push('walls');
  if (/door primitive (?:edge|geometry) drift|door\s+[a-z0-9_:.-]+.*source\/render primitive drift/i.test(text)) layers.push('doors');
  if (/window primitive (?:edge|geometry) drift|window\s+[a-z0-9_:.-]+.*source\/render primitive drift/i.test(text)) layers.push('windows');
  if (/fixture primitive (?:edge|geometry) drift|fixture\s+[a-z0-9_:.-]+.*source\/render primitive drift/i.test(text)) layers.push('fixtures');
  if (/(?:ladder|stair) primitive (?:edge|geometry) drift|(?:ladder|stair)\s+[a-z0-9_:.-]+.*source\/render primitive drift/i.test(text)) layers.push('stairs');
  if (/dashedVoid primitive (?:edge|geometry) drift|void primitive (?:edge|geometry) drift|open-to-below primitive (?:edge|geometry) drift|open to below primitive (?:edge|geometry) drift/i.test(text)) {
    layers.push('void/open-to-below');
  } else {
    const voidLines = text
      .split('\n')
      .filter((line) => /dashedVoid\s+[a-z0-9_:.-]+.*source\/render primitive drift/i.test(line));
    const hasVoidEdgeDrift = voidLines.some((line) => {
      const match = /edge miss\s+([0-9.]+)%,\s+edge extra\s+([0-9.]+)%/i.exec(line);
      if (!match) return true;
      const edgeMiss = Number(match[1]) / 100;
      const edgeExtra = Number(match[2]) / 100;
      const threshold = primitiveLayerThreshold('dashedVoid');
      return edgeMiss > threshold.edgeSourceMissRate || edgeExtra > threshold.edgeRenderExtraRate;
    });
    if (hasVoidEdgeDrift) layers.push('void/open-to-below');
  }
  if (/dimension primitive (?:edge|geometry) drift|dimension\s+[a-z0-9_:.-]+.*source\/render primitive drift/i.test(text)) layers.push('dimensions');
  return layers;
}

function validationLayersFromResults(planResults) {
  const repairBlockingLanes = new Set(['design', 'presentation', 'brochure']);
  const layers = [];
  for (const result of planResults) {
    for (const group of result.pageSignals?.validationGroups ?? []) {
      if (group.status !== 'blocked' && group.status !== 'warning') continue;
      if (!repairBlockingLanes.has(group.lane)) continue;
      const messages = [...(group.blockers ?? []), ...(group.warnings ?? [])].join('\n');
      if (group.id === 'visual-drift') {
        if (/missing source-image spans|source spans are extracted|source-image primitive/i.test(messages)) {
          layers.push('source primitives');
          continue;
        }
        const primitiveLayers = primitiveDriftLayersFromMessage(messages);
        if (primitiveLayers.length) {
          layers.push('source primitives');
          layers.push(...primitiveLayers);
          if (/drawing-language|full source miss|full render extra|style|caps|corners|drawing rhythm/i.test(messages)) {
            layers.push('drawing style profile');
          }
          continue;
        }
        if (/primitives are aligned enough|drawing-language|full source miss|full render extra|style|caps|corners|drawing rhythm/i.test(messages)) {
          layers.push('drawing style profile');
          continue;
        }
        layers.push('walls', 'openings', 'doors', 'windows', 'fixtures', 'furniture', 'stairs', 'void/open-to-below', 'labels', 'dimensions', 'level frames');
      } else if (group.id === 'brochure-quality') {
        const primitiveLayers = primitiveDriftLayersFromMessage(messages);
        if (primitiveLayers.length) {
          layers.push('source primitives');
          layers.push(...primitiveLayers);
          if (/drawing-language|full source miss|full render extra|style|caps|corners|drawing rhythm/i.test(messages)) {
            layers.push('drawing style profile');
          }
          continue;
        }
        const before = layers.length;
        if (/roof|eave|ridge|gable|panel|cutaway|plane|intersection/i.test(messages)) layers.push('roof/elevation');
        if (/fixture|furniture|sales|visualization/i.test(messages)) layers.push('fixtures', 'furniture');
        if (/window|opening|door/i.test(messages)) layers.push('openings');
        if (/compare|overlay|drift|wall|style|caps|corners|drawing-language/i.test(messages)) layers.push('drawing style profile');
        if (layers.length === before) layers.push(VALIDATION_GROUP_LAYER[group.id] ?? 'walls');
      } else if (group.id === 'presentation-drift' && /downstream of Semantic Drift/i.test(messages)) {
        continue;
      } else if (group.id === 'bim' && /A-frame wall role map/i.test(messages) && !(group.blockers ?? []).length) {
        // The role-map line is an informational BIM coverage warning. It
        // should not create a release-blocking semantic repair packet by
        // being routed through the generic BIM -> void/open-to-below mapping.
        continue;
      } else if (group.id === 'standards' && /source proposal.*deterministic render drift|drawing-language|full source miss|full render extra/i.test(messages)) {
        const primitiveLayers = primitiveDriftLayersFromMessage(messages);
        if (primitiveLayers.length) layers.push(...primitiveLayers);
        else layers.push('drawing style profile');
      } else {
        layers.push(VALIDATION_GROUP_LAYER[group.id] ?? 'walls');
      }
    }
  }
  return [...new Set(layers)];
}

async function saveViewport(page, planId, viewportId, viewId, selector = null) {
  const file = resolve(OUT_DIR, `${planId}-${viewportId}-${viewId}.png`);
  if (selector) {
    const target = page.locator(selector).first();
    await target.screenshot({ path: file });
  } else {
    await page.screenshot({ path: file, fullPage: false });
  }
  return file;
}

async function saveCanvasExport(page, planId, viewportId, viewId) {
  const file = resolve(OUT_DIR, `${planId}-${viewportId}-${viewId}-canvas.png`);
  const dataUrl = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return '';
    try {
      return canvas.toDataURL('image/png');
    } catch {
      return '';
    }
  });
  if (!dataUrl.startsWith('data:image/png;base64,')) return null;
  await writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return file;
}

async function saveOrbitCanvasExport(page, planId, viewportId, viewId) {
  const canvasBox = await page.locator('canvas').boundingBox();
  if (!canvasBox) return null;
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.58, canvasBox.y + canvasBox.height * 0.44);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.32, canvasBox.y + canvasBox.height * 0.56, { steps: 18 });
  await page.mouse.up();
  await page.waitForTimeout(450);
  return saveCanvasExport(page, planId, viewportId, `${viewId}-orbit`);
}

async function launchBrowser() {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    return chromium.launch({ headless: true });
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function promotedOption(manifest, planId) {
  const options = manifest.plans?.[planId] ?? [];
  return options.find((option) => option.promotionEligible === true)
    ?? options.find((option) => option.latestPairedArtifact === true && option.pairedArtifact === true)
    ?? options.find((option) => option.latestGptPairedArtifact === true && option.pairedArtifact === true)
    ?? options.find((option) => option.pairedArtifact === true)
    ?? null;
}

function planArtifactPaths(manifest, planId) {
  const option = promotedOption(manifest, planId);
  if (!option) return null;
  const pairedJson = option.pairedJsonUrl ? resolve(LOOP_ROOT, planId, option.pairedJsonUrl) : null;
  const drawingStyleProfile = option.pairedDrawingStyleProfileUrl
    ? resolve(LOOP_ROOT, planId, option.pairedDrawingStyleProfileUrl)
    : option.pairedJsonUrl
      ? resolve(LOOP_ROOT, planId, option.pairedJsonUrl.replace(/\.paired\.json$/i, '.drawing-style.json'))
      : null;
  const visualDrift = option.pairedVisualDriftUrl ? resolve(LOOP_ROOT, planId, option.pairedVisualDriftUrl) : null;
  const deterministicRender = option.deterministicRenderUrl ? resolve(LOOP_ROOT, planId, option.deterministicRenderUrl) : null;
  return { option, pairedJson, drawingStyleProfile, visualDrift, deterministicRender };
}

function emptyPrimitiveCounts() {
  return Object.fromEntries(PRIMITIVE_LAYERS.map((layer) => [layer, 0]));
}

function hasSpan(item) {
  const span = item?.span;
  return typeof span?.x1 === 'number' && typeof span?.z1 === 'number' && typeof span?.x2 === 'number' && typeof span?.z2 === 'number';
}

function breakSpan(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    const [from, to] = value;
    if (Array.isArray(from) && Array.isArray(to)) return { x1: from[0], z1: from[1], x2: to[0], z2: to[1] };
    return null;
  }
  if (value.span && hasSpan(value)) return value.span;
  if (value.from && value.to) return { x1: value.from[0], z1: value.from[1], x2: value.to[0], z2: value.to[1] };
  return hasSpan({ span: value }) ? value : null;
}

function collinearInterval(wall, gap, tolerance = 0.35) {
  const horizontal = Math.abs(wall.x2 - wall.x1) >= Math.abs(wall.z2 - wall.z1);
  const wallMin = horizontal ? Math.min(wall.x1, wall.x2) : Math.min(wall.z1, wall.z2);
  const wallMax = horizontal ? Math.max(wall.x1, wall.x2) : Math.max(wall.z1, wall.z2);
  const wallLine = horizontal ? (wall.z1 + wall.z2) / 2 : (wall.x1 + wall.x2) / 2;
  const gapLine = horizontal ? (gap.z1 + gap.z2) / 2 : (gap.x1 + gap.x2) / 2;
  if (Math.abs(wallLine - gapLine) > tolerance) return null;
  const gapStart = horizontal ? Math.min(gap.x1, gap.x2) : Math.min(gap.z1, gap.z2);
  const gapEnd = horizontal ? Math.max(gap.x1, gap.x2) : Math.max(gap.z1, gap.z2);
  const start = Math.max(wallMin, gapStart);
  const end = Math.min(wallMax, gapEnd);
  return end - start > 0.05 ? { start, end } : null;
}

function splitWallByGaps(wall, gaps) {
  const horizontal = Math.abs(wall.x2 - wall.x1) >= Math.abs(wall.z2 - wall.z1);
  const wallStart = horizontal ? Math.min(wall.x1, wall.x2) : Math.min(wall.z1, wall.z2);
  const wallEnd = horizontal ? Math.max(wall.x1, wall.x2) : Math.max(wall.z1, wall.z2);
  const intervals = gaps
    .map((gap) => collinearInterval(wall, gap))
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
  if (!intervals.length) return [wall];
  const merged = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (previous && interval.start <= previous.end + 0.05) previous.end = Math.max(previous.end, interval.end);
    else merged.push({ ...interval });
  }
  const line = horizontal ? (wall.z1 + wall.z2) / 2 : (wall.x1 + wall.x2) / 2;
  const segments = [];
  let cursor = wallStart;
  for (const interval of merged) {
    if (interval.start - cursor > 0.05) {
      segments.push(horizontal
        ? { x1: cursor, z1: line, x2: interval.start, z2: line }
        : { x1: line, z1: cursor, x2: line, z2: interval.start });
    }
    cursor = Math.max(cursor, interval.end);
  }
  if (wallEnd - cursor > 0.05) {
    segments.push(horizontal
      ? { x1: cursor, z1: line, x2: wallEnd, z2: line }
      : { x1: line, z1: cursor, x2: line, z2: wallEnd });
  }
  return segments.length ? segments : [wall];
}

function normalizePrimitiveSourceId(id) {
  return String(id ?? '').replace(/^src-/, '');
}

function unionSpans(spans) {
  const valid = spans.filter((span) => span
    && typeof span.x1 === 'number'
    && typeof span.z1 === 'number'
    && typeof span.x2 === 'number'
    && typeof span.z2 === 'number');
  if (!valid.length) return null;
  const xs = valid.flatMap((span) => [span.x1, span.x2]);
  const zs = valid.flatMap((span) => [span.z1, span.z2]);
  return {
    x1: Math.min(...xs),
    z1: Math.min(...zs),
    x2: Math.max(...xs),
    z2: Math.max(...zs),
  };
}

function sourceFrameSpanFromAnchor(anchor) {
  if (!anchor || typeof anchor !== 'object') return null;
  const span = anchor.span ?? anchor.pixelBounds ?? anchor.planBounds ?? anchor.bounds ?? anchor;
  if (Array.isArray(span) && span.length >= 4) {
    const [x1, z1, x2, z2] = span.map(Number);
    if ([x1, z1, x2, z2].every(Number.isFinite)) return { x1, z1, x2, z2 };
  }
  const direct = typeof span.x1 === 'number' && typeof span.z1 === 'number' && typeof span.x2 === 'number' && typeof span.z2 === 'number';
  if (direct) return span;
  const x = Number(span.x);
  const z = Number(span.z ?? span.y);
  const w = Number(span.w ?? span.width);
  const d = Number(span.d ?? span.h ?? span.height);
  if ([x, z, w, d].every(Number.isFinite)) return { x1: x, z1: z, x2: x + w, z2: z + d };
  return null;
}

function sourceGridFrame(artifact, floor) {
  const fallbackFootprint = artifact?.footprint ?? {};
  const floorPanels = (artifact?.floorPanels ?? []).filter((item) => String(item?.floor ?? item?.levelIndex ?? 0) === String(floor));
  const panel = floorPanels.find((item) => (item?.sourceAnchors ?? []).some((anchor) => sourceFrameSpanFromAnchor(anchor)))
    ?? floorPanels[0];
  const footprint = panel?.footprint ?? fallbackFootprint;
  const widthFt = Number(footprint?.widthFt ?? footprint?.width ?? footprint?.w ?? fallbackFootprint.widthFt ?? fallbackFootprint.width);
  const depthFt = Number(footprint?.depthFt ?? footprint?.depth ?? footprint?.d ?? fallbackFootprint.depthFt ?? fallbackFootprint.depth);
  const xFt = Number(footprint?.x ?? fallbackFootprint.x ?? 0);
  const zFt = Number(footprint?.z ?? fallbackFootprint.z ?? 0);
  const anchor = (panel?.sourceAnchors ?? []).find((item) => /footprint|levelFootprint/i.test(`${item?.kind ?? ''} ${item?.id ?? ''}`))
    ?? (panel?.sourceAnchors ?? []).find((item) => /levelFrame|buildingFrame/i.test(`${item?.kind ?? ''} ${item?.id ?? ''}`))
    ?? (panel?.sourceAnchors ?? []).find((item) => sourceFrameSpanFromAnchor(item))
    ?? fallbackFootprint.sourceAnchor
    ?? artifact?.coordinateSystem?.planPixelBounds;
  const sourceFrame = sourceFrameSpanFromAnchor(anchor);
  if (![widthFt, depthFt, xFt, zFt].every(Number.isFinite) || widthFt <= 0 || depthFt <= 0 || !sourceFrame) return null;
  return {
    sourceFrame,
    xGrid: xFt / 4,
    zGrid: zFt / 4,
    widthGrid: widthFt / 4,
    depthGrid: depthFt / 4,
  };
}

function mapGridPointToSource(point, frame) {
  const widthPx = frame.sourceFrame.x2 - frame.sourceFrame.x1;
  const depthPx = frame.sourceFrame.z2 - frame.sourceFrame.z1;
  if (Math.abs(widthPx) < 0.001 || Math.abs(depthPx) < 0.001 || frame.widthGrid <= 0 || frame.depthGrid <= 0) return null;
  return {
    x: frame.sourceFrame.x1 + ((point.x - frame.xGrid) / frame.widthGrid) * widthPx,
    z: frame.sourceFrame.z1 + ((point.z - frame.zGrid) / frame.depthGrid) * depthPx,
  };
}

function sourcePrimitiveOverrideSpan(item, artifact) {
  if (item?.source !== 'source-image-primitive-override') return null;
  const floor = item?.floor ?? item?.levelIndex ?? item?.floorIndex ?? 0;
  const frame = sourceGridFrame(artifact, floor);
  if (!frame) return null;
  const span = sourceFrameSpanFromAnchor(item?.sourceBounds)
    ?? sourceFrameSpanFromAnchor(item?.bounds)
    ?? sourceFrameSpanFromAnchor(item?.sourcePixelBounds)
    ?? sourceFrameSpanFromAnchor(item?.pixelBounds)
    ?? sourceFrameSpanFromAnchor(item?.span)
    ?? sourceFrameSpanFromAnchor(item);
  if (!span) return null;
  const a = mapGridPointToSource({ x: span.x1, z: span.z1 }, frame);
  const b = mapGridPointToSource({ x: span.x2, z: span.z2 }, frame);
  if (!a || !b) return null;
  return { x1: a.x, z1: a.z, x2: b.x, z2: b.z };
}

function exactAnchorIsStaleForOverride(item, anchor) {
  if (item?.source !== 'source-image-primitive-override' || !anchor) return false;
  const sourceKind = String(anchor?.extraction?.sourceKind ?? anchor?.sourceKind ?? '').trim();
  return sourceKind.length === 0;
}

function sourcePrimitiveCounts(artifact) {
  const counts = emptyPrimitiveCounts();
  if (!artifact || typeof artifact !== 'object') return counts;
  for (const primitive of sourceDrawingPrimitives(artifact)) counts[primitive.layer] += 1;
  return counts;
}

function sourceDrawingPrimitives(artifact) {
  const primitives = [];
  if (!artifact || typeof artifact !== 'object') return primitives;

  const spanFromValue = (value) => {
    if (!value || typeof value !== 'object') return null;
    if (Array.isArray(value) && value.length >= 4) {
      const [x1, z1, x2, z2] = value.map(Number);
      if ([x1, z1, x2, z2].every(Number.isFinite)) return { x1, z1, x2, z2 };
    }
    const directSpan = typeof value.x1 === 'number' && typeof value.z1 === 'number' && typeof value.x2 === 'number' && typeof value.z2 === 'number';
    if (directSpan) return value;
    if (hasSpan(value)) return value.span;
    {
      const x = Number(value.x);
      const z = Number(value.z ?? value.y);
      const w = Number(value.w ?? value.width);
      const d = Number(value.d ?? value.h ?? value.height);
      if ([x, z, w, d].every(Number.isFinite)) return { x1: x, z1: z, x2: x + w, z2: z + d };
    }
    if (value.bounds && typeof value.bounds === 'object') {
      const x = Number(value.bounds.x);
      const z = Number(value.bounds.z ?? value.bounds.y);
      const w = Number(value.bounds.w ?? value.bounds.width);
      const d = Number(value.bounds.d ?? value.bounds.h ?? value.bounds.height);
      if ([x, z, w, d].every(Number.isFinite)) return { x1: x, z1: z, x2: x + w, z2: z + d };
    }
    if (value.pixelBounds && typeof value.pixelBounds === 'object') return spanFromValue(value.pixelBounds);
    if (value.planBounds && typeof value.planBounds === 'object') return spanFromValue(value.planBounds);
    return null;
  };

  const sourceAnchorSpan = (item) => {
    const overrideSpan = sourcePrimitiveOverrideSpan(item, artifact);
    const direct = spanFromValue(item?.sourceAnchor);
    const itemSourceSpan = spanFromValue(item?.sourcePixelBounds)
      ?? spanFromValue(item?.pixelBounds)
      ?? spanFromValue(item?.bounds)
      ?? spanFromValue(item?.span);
    const text = `${item?.id ?? ''} ${item?.kind ?? ''} ${item?.dimensionKind ?? ''} ${item?.type ?? ''} ${item?.fixtureKind ?? ''} ${item?.symbolVariant ?? ''}`;
    const itemId = typeof item?.id === 'string' ? item.id : '';
    const areaText = `${itemId} ${item?.sourceAnchorId ?? ''} ${text}`.toLowerCase();
    if (/door|ladder|stair/i.test(text) && direct) return direct;
    if (/fixture|furn|bed|sofa|chair|table|sink|toilet|tub|shower|range|washer|dryer|counter/.test(areaText) && direct) return direct;
    const anchorId = item?.sourceAnchorId ?? item?.sourceAnchor?.id ?? item?.id;
    const candidates = [
      ...(artifact.sourceAnchors ?? []),
      ...(artifact.floorPanels ?? []).flatMap((panel) => panel?.sourceAnchors ?? []),
    ];
    if (itemId && /door|window|glaz|ladder|stair|fixture|furn|bed|sofa|chair|table|sink|toilet|tub|shower|range|washer|dryer|counter/.test(areaText)) {
      const richer = candidates
        .filter((anchor) => {
          const ids = [anchor?.id, anchor?.sourceAnchorId, anchor?.elementId, anchor?.targetId].filter(Boolean).map(String);
          return ids.includes(itemId) || ids.some((id) => id === `${itemId}-anchor` || id.endsWith(`-${itemId}-anchor`));
        })
        .map((anchor) => spanFromValue(anchor))
        .filter(Boolean)
        .sort((a, b) => Math.abs(b.x2 - b.x1) * Math.abs(b.z2 - b.z1) - Math.abs(a.x2 - a.x1) * Math.abs(a.z2 - a.z1))[0];
      if (richer) return richer;
    }
    if (anchorId) {
      const exact = candidates.find((anchor) => {
        const id = anchor?.id ?? anchor?.sourceAnchorId ?? anchor?.elementId;
        return id === anchorId;
      });
      const found = exact ?? candidates.find((anchor) => {
        const id = anchor?.id ?? anchor?.sourceAnchorId ?? anchor?.elementId;
        return `${id}:seg-1` === anchorId || `${id}:seg-2` === anchorId || `${id}:seg-3` === anchorId || String(anchorId).startsWith(`${id}:seg-`);
      });
      const foundSpan = spanFromValue(found);
      if (foundSpan && !exactAnchorIsStaleForOverride(item, found)) return foundSpan;
      const segmentSpans = candidates
        .filter((anchor) => {
          const id = anchor?.id ?? anchor?.sourceAnchorId ?? anchor?.elementId;
          return typeof id === 'string' && id.startsWith(`${anchorId}:seg-`);
        })
        .map((anchor) => spanFromValue(anchor))
        .filter(Boolean);
      const union = unionSpans(segmentSpans);
      if (union) return union;
    }
    return direct ?? overrideSpan ?? (/dimension/i.test(text) ? itemSourceSpan : null);
  };

  const sourceSpanForWallSegment = (wall, segment) => {
    const segmentId = segment?.sourceAnchorId ?? segment?.id;
    if (segmentId && wall?.id && segmentId === wall.id) {
      const full = sourceAnchorSpan(wall);
      if (full) return full;
    }
    if (segmentId) {
      const candidates = [
        ...(artifact.sourceAnchors ?? []),
        ...(artifact.floorPanels ?? []).flatMap((panel) => panel?.sourceAnchors ?? []),
      ];
      const exactSegmentAnchor = candidates.some((anchor) => {
        const id = anchor?.id ?? anchor?.sourceAnchorId ?? anchor?.elementId;
        return id === segmentId;
      });
      if (exactSegmentAnchor || !/:seg-\d+$/i.test(String(segmentId))) {
        const direct = sourceAnchorSpan({ id: segmentId, sourceAnchorId: segmentId, floor: wall?.floor });
        if (direct) return direct;
      }
    }
    const full = sourceAnchorSpan(wall);
    if (!full || !wall?.span || !segment) return full;
    const horizontal = Math.abs(wall.span.x2 - wall.span.x1) >= Math.abs(wall.span.z2 - wall.span.z1);
    const wallStart = horizontal ? Math.min(wall.span.x1, wall.span.x2) : Math.min(wall.span.z1, wall.span.z2);
    const wallEnd = horizontal ? Math.max(wall.span.x1, wall.span.x2) : Math.max(wall.span.z1, wall.span.z2);
    const segmentStart = horizontal ? Math.min(segment.x1, segment.x2) : Math.min(segment.z1, segment.z2);
    const segmentEnd = horizontal ? Math.max(segment.x1, segment.x2) : Math.max(segment.z1, segment.z2);
    const length = wallEnd - wallStart;
    if (!Number.isFinite(length) || length <= 0.001) return full;
    const t1 = Math.max(0, Math.min(1, (segmentStart - wallStart) / length));
    const t2 = Math.max(0, Math.min(1, (segmentEnd - wallStart) / length));
    return {
      x1: full.x1 + (full.x2 - full.x1) * t1,
      z1: full.z1 + (full.z2 - full.z1) * t1,
      x2: full.x1 + (full.x2 - full.x1) * t2,
      z2: full.z1 + (full.z2 - full.z1) * t2,
    };
  };

  const sourceSpanToBox = (span) => {
    if (!span) return null;
    const x = Math.min(span.x1, span.x2);
    const y = Math.min(span.z1, span.z2);
    const width = Math.abs(span.x2 - span.x1);
    const height = Math.abs(span.z2 - span.z1);
    return { x, y, width, height };
  };

  const sourceDimensionVisibleSpan = (item) => {
    const lineSpan = sourceAnchorSpan(item);
    const lineBox = sourceSpanToBox(lineSpan);
    if (!lineBox) return null;
    const labelSpan = spanFromValue(item?.labelBounds) ?? spanFromValue(item?.sourceAnchor?.labelBounds);
    const labelBox = sourceSpanToBox(labelSpan);
    const witnessSpans = (item?.witnessLines ?? [])
      .map((witness) => spanFromValue(witness?.span ?? witness))
      .filter(Boolean);
    const tickSpans = (item?.tickLines ?? item?.sourceAnchor?.tickLines ?? [])
      .map((tick) => spanFromValue(tick?.span ?? tick))
      .filter(Boolean);
    const boxes = [lineBox, labelBox, ...witnessSpans.map(sourceSpanToBox), ...tickSpans.map(sourceSpanToBox)].filter(Boolean);
    const xs = boxes.flatMap((box) => [box.x, box.x + box.width]);
    const ys = boxes.flatMap((box) => [box.y, box.y + box.height]);
    return { x1: Math.min(...xs), z1: Math.min(...ys), x2: Math.max(...xs), z2: Math.max(...ys) };
  };

  const add = (layer, item, origin, index, sourceSpanOverride = null) => {
    const sourceId = item?.sourceAnchorId ?? item?.sourceAnchor?.id ?? item?.id ?? '';
    const sourceSpan = sourceSpanOverride ?? sourceAnchorSpan(item);
    primitives.push({
      key: `${layer}:${origin}:${item?.id ?? item?.sourceAnchorId ?? index}`,
      layer,
      origin,
      id: item?.id ?? '',
      sourceId,
      normalizedSourceId: normalizePrimitiveSourceId(sourceId),
      sourceKind: item?.wallKind ?? item?.openingKind ?? item?.fixtureKind ?? item?.kind ?? item?.type ?? item?.category ?? '',
      floor: item?.floor ?? item?.level ?? item?.levelId ?? '',
      sourceSpanPx: sourceSpanToBox(sourceSpan),
    });
  };
  const wallLayer = (wall) => {
    const text = `${wall.id ?? ''} ${wall.wallKind ?? ''} ${wall.kind ?? ''} ${wall.type ?? ''}`;
    if (/glaz|window/i.test(text)) return 'window';
    if (/guard|rail/i.test(text)) return 'wall';
    if (/partition|interior-wall|exterior-wall|a-frame-wall|entry-low-wall/i.test(`${wall.wallKind ?? ''} ${wall.kind ?? ''} ${wall.type ?? ''}`)) return 'wall';
    if (/dashed|void|open.to.below|overhead/i.test(text)) return 'dashedVoid';
    return 'wall';
  };
  const gridSpan = (item, scale = 4) => {
    const x1 = Number(item?.x1);
    const z1 = Number(item?.z1);
    const x2 = Number(item?.x2);
    const z2 = Number(item?.z2);
    if (![x1, z1, x2, z2].every(Number.isFinite)) return null;
    return { x1: x1 * scale, z1: z1 * scale, x2: x2 * scale, z2: z2 * scale };
  };
  const overrideLayer = (item) => {
    const text = `${item?.id ?? ''} ${item?.wallKind ?? ''} ${item?.kind ?? ''} ${item?.openingType ?? ''} ${item?.type ?? ''}`;
    const semanticText = `${item?.wallKind ?? ''} ${item?.kind ?? ''} ${item?.type ?? ''}`;
    if (/window|glaz/i.test(text)) return 'window';
    if (/guard|rail|partition|interior-wall|exterior-wall|a-frame-wall|entry-low-wall/i.test(semanticText)) return 'wall';
    if (/door|bifold|sliding|pocket|exterior|interior/i.test(text)) return 'door';
    if (/dashed|void|open.to.below|open-to-below|overhead/i.test(text)) return 'dashedVoid';
    return 'wall';
  };
  const isDashedVoid = (item) => /dashed|void|open.to.below|open-to-below|open_to_below|overhead|cross/i.test(
    `${item?.id ?? ''} ${item?.kind ?? ''} ${item?.type ?? ''} ${item?.symbolVariant ?? ''} ${item?.sourceKind ?? ''} ${item?.elementType ?? ''}`,
  );
  const sourceWallOverrides = (artifact.sourceWalls ?? []).filter(Boolean);
  const sourceOpeningOverrides = (artifact.sourceOpenings ?? []).filter(Boolean);
  sourceWallOverrides.forEach((wall, index) => {
    const span = gridSpan(wall);
    if (!span) return;
    const layer = overrideLayer(wall);
    add(layer === 'door' ? 'wall' : layer, { ...wall, span }, 'sourceWall', index);
  });
  sourceOpeningOverrides.forEach((opening, index) => {
    const span = gridSpan(opening) ?? spanFromValue(opening?.span);
    if (!span) return;
    const layer = overrideLayer(opening);
    if (layer !== 'door' && layer !== 'window') return;
    add(layer, { ...opening, span }, 'sourceOpening', index);
  });
  if (!sourceWallOverrides.length) [...(artifact.exteriorWalls ?? []), ...(artifact.interiorWalls ?? [])].forEach((wall, index) => {
    if (!hasSpan(wall)) return;
    const layer = wallLayer(wall);
    const gaps = layer === 'window' ? [] : [
      ...(wall.breaks ?? []).map(breakSpan).filter(Boolean),
      ...(artifact.doors ?? []).filter((opening) => opening.wallId === wall.id && hasSpan(opening)).map((opening) => opening.span),
      ...(artifact.openings ?? []).filter((opening) => opening.wallId === wall.id && hasSpan(opening)).map((opening) => opening.span),
      ...(artifact.windows ?? []).filter((opening) => opening.wallId === wall.id && hasSpan(opening)).map((opening) => opening.span),
    ];
    const segments = splitWallByGaps(wall.span, gaps);
    segments.forEach((segment, segmentIndex) => {
      const id = segments.length > 1 ? `${wall.id ?? 'wall'}:seg-${segmentIndex + 1}` : wall.id;
      add(layer, { ...wall, id, sourceAnchorId: id, span: segment }, 'wall', index + segmentIndex, sourceSpanForWallSegment(wall, { ...segment, id, sourceAnchorId: id }));
    });
  });
  if (!sourceOpeningOverrides.length) (artifact.openings ?? []).forEach((opening, index) => {
    if (!hasSpan(opening)) return;
    const text = `${opening.id ?? ''} ${opening.openingKind ?? ''} ${opening.type ?? ''}`;
    const matchesSemanticDoor = (artifact.doors ?? []).some((door) => door.wallId === opening.wallId && JSON.stringify(door.span) === JSON.stringify(opening.span));
    if (matchesSemanticDoor || /travel|clearance|swing.trace/i.test(text)) return;
    if (/window|glass|glaz/i.test(text)) add('window', opening, 'opening', index);
    else if (/door/i.test(text)) add('door', opening, 'opening', index);
  });
  if (!sourceOpeningOverrides.length) (artifact.doors ?? []).forEach((door, index) => {
    if (hasSpan(door)) add('door', door, 'door', index);
  });
  if (!sourceOpeningOverrides.length) (artifact.windows ?? []).forEach((window, index) => {
    if (hasSpan(window)) add('window', window, 'window', index);
  });
  (artifact.spaceFaces ?? []).forEach((spaceFace, index) => {
    if (isDashedVoid(spaceFace)) add('dashedVoid', spaceFace, 'spaceFace', index);
  });
  (artifact.rooms ?? []).forEach((room, index) => {
    if (!isDashedVoid(room)) return;
    const hasSpaceFace = (artifact.spaceFaces ?? []).some((spaceFace) => String(spaceFace?.roomId ?? '') === String(room?.id ?? ''));
    if (!hasSpaceFace) add('dashedVoid', room, 'room', index);
  });
  (artifact.fixtures ?? []).forEach((fixture, index) => {
    const text = `${fixture?.id ?? ''} ${fixture?.fixtureKind ?? ''} ${fixture?.type ?? ''} ${fixture?.symbolVariant ?? ''}`;
    if (/exterior[_\s-]*stoop|deck|porch|patio/i.test(text)) return;
    if (isDashedVoid(fixture)) return;
    const layer = /ladder|stair/i.test(text)
      ? 'ladder'
      : 'fixture';
    add(layer, fixture, 'fixture', index);
  });
  if (!(artifact.dimensionLines ?? []).length) {
    (artifact.floorPanels ?? []).forEach((panel, panelIndex) => {
      (panel?.sourceAnchors ?? []).forEach((anchor, anchorIndex) => {
        if (/dimension/i.test(`${anchor?.kind ?? ''} ${anchor?.id ?? ''}`)) {
          add('dimension', { ...anchor, floor: panel.floor ?? panel.level, id: anchor?.id ?? `dimension-${panelIndex}-${anchorIndex}` }, 'sourceAnchor', anchorIndex);
        }
      });
    });
  }
  (artifact.dimensionLines ?? []).forEach((dimension, index) => {
    add('dimension', dimension, 'dimensionLine', index, sourceDimensionVisibleSpan(dimension));
  });
  return primitives;
}

function primitiveDiffBlockers(expected, rendered, label) {
  const blockers = [];
  const tolerances = { wall: 1, dashedVoid: 1, fixture: 2 };
  for (const layer of PRIMITIVE_LAYERS) {
    const expectedCount = expected?.[layer] ?? 0;
    const renderedCount = rendered?.[layer] ?? 0;
    const tolerance = tolerances[layer] ?? 0;
    if (expectedCount > 0 && renderedCount + tolerance < expectedCount) {
      blockers.push(`${label}: ${layer} primitive mismatch, expected ${expectedCount}, rendered ${renderedCount}`);
    }
  }
  return blockers;
}

function primitiveLayerDiffs(expectedPrimitives, renderedPrimitives, label) {
  const diffs = [];
  const tolerances = { wall: 1, dashedVoid: 1, fixture: 2 };
  for (const layer of PRIMITIVE_LAYERS) {
    const expectedLayer = expectedPrimitives.filter((primitive) => primitive.layer === layer);
    const renderedLayer = renderedPrimitives
      .filter((primitive) => primitive.layer === layer)
      .map((primitive) => ({
        ...primitive,
        normalizedSourceId: normalizePrimitiveSourceId(primitive.sourceId),
      }));
    const expectedSourceIds = [...new Set(expectedLayer.map((primitive) => primitive.sourceId).filter(Boolean))];
    const renderedSourceIds = [...new Set(renderedLayer.map((primitive) => primitive.sourceId).filter(Boolean))];
    const expectedNormalizedIds = [...new Set(expectedLayer.map((primitive) => primitive.normalizedSourceId ?? normalizePrimitiveSourceId(primitive.sourceId)).filter(Boolean))];
    const renderedNormalizedIds = [...new Set(renderedLayer.map((primitive) => primitive.normalizedSourceId).filter(Boolean))];
    const renderedSourceIdSet = new Set(renderedNormalizedIds);
    const expectedSourceIdSet = new Set(expectedNormalizedIds);
    const missingNormalizedIds = expectedNormalizedIds.filter((id) => !renderedSourceIdSet.has(id));
    const extraNormalizedIds = renderedNormalizedIds.filter((id) => !expectedSourceIdSet.has(id));
    const missingSourceIds = expectedSourceIds.filter((id) => missingNormalizedIds.includes(normalizePrimitiveSourceId(id)));
    const extraSourceIds = renderedSourceIds.filter((id) => extraNormalizedIds.includes(normalizePrimitiveSourceId(id)));
    const tolerance = tolerances[layer] ?? 0;
    const missingCount = Math.max(0, expectedLayer.length - renderedLayer.length);
    const extraCount = Math.max(0, renderedLayer.length - expectedLayer.length);
    const missingIsBlocking = ['wall', 'ladder', 'door', 'window', 'dashedVoid'].includes(layer);
    const countBlocked = expectedLayer.length > 0 && renderedLayer.length + tolerance < expectedLayer.length;
    const sourceBlocked = missingIsBlocking && missingSourceIds.length > tolerance;
    const severity = countBlocked || sourceBlocked ? 'blocked' : (missingCount > 0 || extraCount > tolerance || missingSourceIds.length > 0 || extraSourceIds.length > tolerance ? 'warning' : 'pass');
    diffs.push({
      label,
      layer,
      severity,
      expectedCount: expectedLayer.length,
      renderedCount: renderedLayer.length,
      missingCount,
      extraCount,
      expectedSourceIds,
      renderedSourceIds,
      missingSourceIds,
      extraSourceIds,
      sourcePrimitives: expectedLayer,
      renderedPrimitives: renderedLayer,
    });
  }
  return diffs;
}

function boxCenter(box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function boxDistance(a, b) {
  const ac = boxCenter(a);
  const bc = boxCenter(b);
  return Math.hypot(ac.x - bc.x, ac.y - bc.y);
}

function boxSizeDelta(a, b) {
  return Math.max(Math.abs(a.width - b.width), Math.abs(a.height - b.height));
}

function primitiveGeometryTolerancePx(layer) {
  if (layer === 'wall') return 18;
  if (layer === 'dashedVoid') return 18;
  if (layer === 'window') return 22;
  if (layer === 'door') return 28;
  if (layer === 'ladder') return 24;
  if (layer === 'fixture') return 30;
  return 42;
}

function primitiveGeometryDiffs(expectedPrimitives, renderedPrimitives, label) {
  const diffs = [];
  const renderedByKey = new Map();
  for (const primitive of renderedPrimitives) {
    const key = `${primitive.layer}:${normalizePrimitiveSourceId(primitive.sourceId)}`;
    if (!renderedByKey.has(key)) renderedByKey.set(key, []);
    renderedByKey.get(key).push(primitive);
  }

  for (const expected of expectedPrimitives) {
    if (!expected.sourceSpanPx || !expected.normalizedSourceId) continue;
    const key = `${expected.layer}:${expected.normalizedSourceId}`;
    const candidates = renderedByKey.get(key) ?? [];
    if (!candidates.length) continue;
    const expectedBox = expected.sourceSpanPx;
    const candidate = candidates
      .filter((item) => item.bboxSvg || item.bbox)
      .map((item) => {
        const box = item.bboxSvg ?? item.bbox;
        return {
          item,
          box,
          centerDriftPx: boxDistance(expectedBox, box),
          sizeDriftPx: boxSizeDelta(expectedBox, box),
        };
      })
      .sort((a, b) => Math.max(a.centerDriftPx, a.sizeDriftPx) - Math.max(b.centerDriftPx, b.sizeDriftPx))[0];
    if (!candidate) continue;
    const tolerance = primitiveGeometryTolerancePx(expected.layer);
    const drift = Math.max(candidate.centerDriftPx, candidate.sizeDriftPx);
    const severity = drift > tolerance * 2
      ? 'blocked'
      : drift > tolerance
        ? 'warning'
        : 'pass';
    if (severity === 'pass') continue;
    diffs.push({
      label,
      layer: expected.layer,
      severity,
      sourceId: expected.sourceId,
      sourceKind: expected.sourceKind,
      expectedBox,
      renderedBox: candidate.box,
      centerDriftPx: Number(candidate.centerDriftPx.toFixed(1)),
      sizeDriftPx: Number(candidate.sizeDriftPx.toFixed(1)),
      tolerancePx: tolerance,
    });
  }
  return diffs;
}

function primitiveDiffMessage(diff) {
  const countText = `expected ${diff.expectedCount}, rendered ${diff.renderedCount}`;
  const missingText = diff.missingSourceIds.length ? `, missing source IDs: ${diff.missingSourceIds.join(', ')}` : '';
  const extraText = diff.extraSourceIds.length ? `, extra rendered source IDs: ${diff.extraSourceIds.join(', ')}` : '';
  return `${diff.label}: ${diff.layer} primitive mismatch (${countText}${missingText}${extraText})`;
}

function primitiveGeometryDiffMessage(diff) {
  return `${diff.label}: ${diff.layer} primitive geometry drift for ${diff.sourceId} (center ${diff.centerDriftPx}px, size ${diff.sizeDriftPx}px, tolerance ${diff.tolerancePx}px)`;
}

function primitiveLayerRepairLayer(layer) {
  if (layer === 'wall') return 'walls';
  if (layer === 'door') return 'doors';
  if (layer === 'window') return 'windows';
  if (layer === 'fixture') return 'fixtures';
  if (layer === 'ladder') return 'stairs';
  if (layer === 'dashedVoid') return 'void/open-to-below';
  if (layer === 'dimension') return 'dimensions';
  return layer;
}

function primitiveLayerThreshold(layer) {
  return layer === 'wall'
    ? { edgeSourceMissRate: 0.08, edgeRenderExtraRate: 0.055, sourceMissRate: 0.22, renderExtraRate: 0.18 }
    : { edgeSourceMissRate: 0.12, edgeRenderExtraRate: 0.08, sourceMissRate: 0.36, renderExtraRate: 0.36 };
}

function isSparseLineworkLayer(layer) {
  return ['dashedVoid', 'dimension'].includes(layer);
}

function primitiveLayerDriftItems(drift) {
  const metrics = drift?.metrics ?? {};
  return Object.entries(metrics.primitiveLayerDrift ?? {})
    .filter(([, value]) => value && typeof value === 'object')
    .map(([layer, value]) => ({
      layer,
      repairLayer: primitiveLayerRepairLayer(layer),
      sourceMissRate: value.sourceMissRate ?? 0,
      renderExtraRate: value.renderExtraRate ?? 0,
      edgeSourceMissRate: value.edgeSourceMissRate ?? 0,
      edgeRenderExtraRate: value.edgeRenderExtraRate ?? 0,
    }));
}

function layerDriftScore(item) {
  const threshold = primitiveLayerThreshold(item.layer);
  return Math.max(
    item.edgeSourceMissRate / threshold.edgeSourceMissRate,
    item.edgeRenderExtraRate / threshold.edgeRenderExtraRate,
    item.sourceMissRate / Math.max(threshold.sourceMissRate, 0.001),
    item.renderExtraRate / Math.max(threshold.renderExtraRate, 0.001),
  );
}

function primitiveRegionDriftScore(region) {
  if (!region?.layer) return 0;
  const threshold = primitiveLayerThreshold(region.layer);
  if (isSparseLineworkLayer(region.layer)) {
    return Math.max(
      (region.edgeSourceMissRate ?? 0) / threshold.edgeSourceMissRate,
      (region.edgeRenderExtraRate ?? 0) / threshold.edgeRenderExtraRate,
    );
  }
  return Math.max(
    (region.edgeSourceMissRate ?? 0) / threshold.edgeSourceMissRate,
    (region.edgeRenderExtraRate ?? 0) / threshold.edgeRenderExtraRate,
    (region.sourceMissRate ?? 0) / Math.max(threshold.sourceMissRate, 0.001),
    (region.renderExtraRate ?? 0) / Math.max(threshold.renderExtraRate, 0.001),
  );
}

function primitiveRegionIsSemanticDrift(region) {
  if (!region?.layer) return false;
  const threshold = primitiveLayerThreshold(region.layer);
  const edgeDrift = (
    (region.edgeSourceMissRate ?? 0) > threshold.edgeSourceMissRate ||
    (region.edgeRenderExtraRate ?? 0) > threshold.edgeRenderExtraRate
  );
  if (['wall', 'door', 'window', 'dashedVoid', 'dimension'].includes(String(region.layer)) && !edgeDrift) {
    // If source/render edges align but the dark/fill pixels do not, the
    // primitive is not asking for a semantic coordinate patch. That is a
    // drawing-style/presentation mismatch and should not be sent to GPT as a
    // wall/opening/void geometry repair.
    return false;
  }
  return (
    edgeDrift ||
    (region.sourceMissRate ?? 0) > threshold.sourceMissRate ||
    (region.renderExtraRate ?? 0) > threshold.renderExtraRate
  );
}

function primitiveRegionHasEdgeGeometryDrift(region) {
  if (!region?.layer) return false;
  const threshold = primitiveLayerThreshold(region.layer);
  return (
    (region.edgeSourceMissRate ?? 0) > threshold.edgeSourceMissRate ||
    (region.edgeRenderExtraRate ?? 0) > threshold.edgeRenderExtraRate
  );
}

function repairLayerDriftScores(drift) {
  const scores = new Map();
  for (const item of primitiveLayerDriftItems(drift)) {
    const score = layerDriftScore(item);
    scores.set(item.repairLayer, Math.max(scores.get(item.repairLayer) ?? 0, score));
  }
  for (const region of drift?.metrics?.primitiveRegionDrift ?? []) {
    if (!region?.layer) continue;
    const repairLayer = primitiveLayerRepairLayer(region.layer);
    const score = primitiveRegionDriftScore(region);
    scores.set(repairLayer, Math.max(scores.get(repairLayer) ?? 0, score));
  }
  return scores;
}

function sortRepairLayersByDrift(layers, drift) {
  const scores = repairLayerDriftScores(drift);
  const metrics = drift?.metrics ?? {};
  const wholeArtifactDrift = Math.max(
    metrics.sourceMissRate ?? 0,
    metrics.renderExtraRate ?? 0,
    metrics.primitiveEdgeSourceMissRate ?? metrics.edgeSourceMissRate ?? 0,
    metrics.primitiveEdgeRenderExtraRate ?? metrics.edgeRenderExtraRate ?? 0,
  );
  const needsSemanticRebuild = layers.includes('semantic rebuild') || (
    wholeArtifactDrift > 0.28
    && [...scores.entries()].filter(([, score]) => score > 1).length >= 3
  );
  const hasMeasuredSemanticDrift = [...scores.values()].some((score) => score > 1);
  const structuralLayers = new Set(['source primitives', 'source primitive overrides', 'level frames', 'walls', 'openings', 'doors', 'windows', 'fixtures', 'furniture', 'stairs', 'void/open-to-below']);
  const hasStructuralDrift = [...scores.entries()].some(([layer, score]) => structuralLayers.has(layer) && score > 1);
  const fallbackOrder = [
    'semantic rebuild',
    'source primitives',
    'source primitive overrides',
    'level frames',
    'walls',
    'openings',
    'doors',
    'windows',
    'fixtures',
    'furniture',
    'stairs',
    'void/open-to-below',
    'dimensions',
    'labels',
    'roof/elevation',
    'drawing style profile',
  ];
  const fallbackRank = new Map(fallbackOrder.map((layer, index) => [layer, index]));
  return [...new Set(layers)].sort((a, b) => {
    const pinned = (layer) => {
      if (layer === 'semantic rebuild') return needsSemanticRebuild ? 20_000 : 0;
      if (layer === 'source primitive overrides') return 11_000;
      if (layer === 'source primitives') return 10_000;
      if (layer === 'drawing style profile') return hasMeasuredSemanticDrift ? 10 : 8_000;
      // Annotation drift is often downstream of the drawing frame. Repair it
      // after source primitives, otherwise the loop spends its first patch on
      // dimension lines while the wall/void/stair basis is still wrong.
      if (layer === 'dimensions' && hasStructuralDrift) return 50;
      const score = scores.get(layer) ?? 0;
      return score > 1 ? 1_000 + score : score;
    };
    const scoreDiff = pinned(b) - pinned(a);
    if (Math.abs(scoreDiff) > 0.0001) return scoreDiff;
    return (fallbackRank.get(a) ?? 999) - (fallbackRank.get(b) ?? 999);
  });
}

function highDriftLayers(drift) {
  if (drift?.passed === true) return [];
  const metrics = drift?.metrics ?? {};
  const sourceMissRate = metrics.sourceMissRate ?? 1;
  const renderExtraRate = metrics.renderExtraRate ?? 1;
  const edgeSourceMissRate = metrics.primitiveEdgeSourceMissRate ?? metrics.edgeSourceMissRate ?? 1;
  const edgeRenderExtraRate = metrics.primitiveEdgeRenderExtraRate ?? metrics.edgeRenderExtraRate ?? 1;
  const layerDrift = primitiveLayerDriftItems(drift);
  const severelyDriftedLayerCount = layerDrift.filter((item) => layerDriftScore(item) > 1).length;
  if (
    (sourceMissRate > 0.36 || renderExtraRate > 0.36)
    && severelyDriftedLayerCount >= 3
  ) {
    return ['semantic rebuild'];
  }
  const semanticLayers = layerDrift
    .filter((item) => {
      const threshold = primitiveLayerThreshold(item.layer);
      return (
        item.edgeSourceMissRate > threshold.edgeSourceMissRate ||
        item.edgeRenderExtraRate > threshold.edgeRenderExtraRate ||
        item.sourceMissRate > threshold.sourceMissRate ||
        item.renderExtraRate > threshold.renderExtraRate
      );
    })
    .sort((a, b) => layerDriftScore(b) - layerDriftScore(a))
    .map((item) => item.repairLayer);
  const semanticRegionLayers = (metrics.primitiveRegionDrift ?? [])
    .filter((region) => primitiveRegionIsSemanticDrift(region))
    .sort((a, b) => primitiveRegionDriftScore(b) - primitiveRegionDriftScore(a))
    .map((region) => primitiveLayerRepairLayer(region.layer));
  const presentationLayers = layerDrift
    .filter((item) => {
      const threshold = primitiveLayerThreshold(item.layer);
      if (isSparseLineworkLayer(item.layer)) return false;
      if (item.layer === 'dimension') {
        return (
          item.edgeSourceMissRate <= threshold.edgeSourceMissRate &&
          (
            item.edgeRenderExtraRate > threshold.edgeRenderExtraRate ||
            item.sourceMissRate > threshold.sourceMissRate ||
            item.renderExtraRate > threshold.renderExtraRate
          )
        );
      }
      return (
        item.edgeSourceMissRate <= threshold.edgeSourceMissRate &&
        item.edgeRenderExtraRate <= threshold.edgeRenderExtraRate &&
        (item.sourceMissRate > threshold.sourceMissRate || item.renderExtraRate > threshold.renderExtraRate)
      );
    });
  if (
    sourceMissRate <= 0.18 &&
    renderExtraRate <= 0.18 &&
    edgeSourceMissRate <= 0.055 &&
    edgeRenderExtraRate <= 0.055 &&
    !semanticLayers.length &&
    !presentationLayers.length
  ) {
    return [];
  }
  if (semanticLayers.length || presentationLayers.length) {
    return [...new Set([
      ...semanticRegionLayers,
      ...semanticLayers,
      ...(presentationLayers.length ? ['drawing style profile'] : []),
    ])];
  }
  if (edgeSourceMissRate <= 0.12 && edgeRenderExtraRate <= 0.08 && (sourceMissRate > 0.3 || renderExtraRate > 0.3)) {
    return ['drawing style profile'];
  }
  return [
    'walls',
    'openings',
    'doors',
    'windows',
    'fixtures',
    'furniture',
    'stairs',
    'void/open-to-below',
    'labels',
    'dimensions',
    'level frames',
  ];
}

function sourceOverrideDriftLayers(drift, artifact) {
  if (!artifact?.sourceWalls?.length && !artifact?.sourceOpenings?.length) return [];
  const overrideIds = new Set([
    ...(artifact.sourceWalls ?? []).map((item) => item?.id).filter(Boolean),
    ...(artifact.sourceOpenings ?? []).map((item) => item?.id).filter(Boolean),
  ].map(String));
  const hasOverrideRegion = (drift?.metrics?.primitiveRegionDrift ?? []).some((region) => {
    if (!['wall', 'door', 'window'].includes(String(region?.layer ?? ''))) return false;
    if (!primitiveRegionIsSemanticDrift(region)) return false;
    const id = String(region?.id ?? '');
    const parentId = id.replace(/:seg-\d+$/i, '');
    return overrideIds.has(id) || overrideIds.has(parentId) || /:seg-\d+$/i.test(id);
  });
  return hasOverrideRegion ? ['source primitive overrides'] : [];
}

function productViewLayers(planResults) {
  const text = planResults
    .flatMap((result) => result.blockers)
    .filter((line) => /^(product3d|cutaway|front|side|plantop):/i.test(line))
    .filter((line) => !/app reports (Brochure Quality|Design Quality) blocked/i.test(line))
    .join('\n');
  const layers = new Set();
  if (/roof|panel|gable|ridge|eave|intersect|floating/i.test(text)) layers.add('roof/elevation');
  if (/fixture|furniture|sales visualization/i.test(text)) {
    layers.add('fixtures');
    layers.add('furniture');
  }
  if (/door|opening|window/i.test(text)) layers.add('openings');
  return [...layers];
}

function layerSection(artifact, layer, drawingStyleProfile = null) {
  if (layer === 'drawing style profile') return drawingStyleProfile;
  if (!artifact) return null;
  if (layer === 'semantic rebuild') {
    return {
      coordinateSystem: artifact.coordinateSystem,
      coordinateMode: artifact.coordinateMode,
      dimensionFrame: artifact.dimensionFrame ?? null,
      floorPanels: artifact.floorPanels ?? [],
      rooms: artifact.rooms ?? [],
      spaceFaces: artifact.spaceFaces ?? [],
      exteriorWalls: artifact.exteriorWalls ?? [],
      interiorWalls: artifact.interiorWalls ?? [],
      sourceWalls: artifact.sourceWalls ?? [],
      sourceOpenings: artifact.sourceOpenings ?? [],
      openings: artifact.openings ?? [],
      doors: artifact.doors ?? [],
      windows: artifact.windows ?? [],
      fixtures: artifact.fixtures ?? [],
      connections: artifact.connections ?? [],
      dimensionLines: artifact.dimensionLines ?? [],
      sourceAnchors: artifact.sourceAnchors ?? [],
    };
  }
  if (layer === 'walls') {
    return {
      exteriorWalls: artifact.exteriorWalls ?? [],
      interiorWalls: artifact.interiorWalls ?? [],
      sourceWalls: artifact.sourceWalls ?? [],
      floorPanels: artifact.floorPanels ?? [],
    };
  }
  if (layer === 'source primitives') {
    return {
      sourceAnchors: artifact.sourceAnchors ?? [],
      floorPanels: artifact.floorPanels ?? [],
      dimensionFrame: artifact.dimensionFrame ?? null,
      dimensionLines: artifact.dimensionLines ?? [],
      sourceWalls: artifact.sourceWalls ?? [],
      exteriorWalls: artifact.exteriorWalls ?? [],
      interiorWalls: artifact.interiorWalls ?? [],
      sourceOpenings: artifact.sourceOpenings ?? [],
      openings: artifact.openings ?? [],
      doors: artifact.doors ?? [],
      windows: artifact.windows ?? [],
      rooms: artifact.rooms ?? [],
      fixtures: artifact.fixtures ?? [],
      spaceFaces: artifact.spaceFaces ?? [],
    };
  }
  if (layer === 'source primitive overrides') {
    return {
      sourceWalls: artifact.sourceWalls ?? [],
      sourceOpenings: artifact.sourceOpenings ?? [],
    };
  }
  if (['openings', 'doors', 'windows'].includes(layer)) {
    return {
      openings: artifact.openings ?? [],
      doors: artifact.doors ?? [],
      windows: artifact.windows ?? [],
      sourceOpenings: artifact.sourceOpenings ?? [],
    };
  }
  if (layer === 'void/open-to-below') {
    return {
      rooms: artifact.rooms ?? [],
      spaceFaces: artifact.spaceFaces ?? [],
      floorPanels: artifact.floorPanels ?? [],
      sourceAnchors: artifact.sourceAnchors ?? [],
      exteriorWalls: artifact.exteriorWalls ?? [],
      interiorWalls: artifact.interiorWalls ?? [],
    };
  }
  if (layer === 'stairs') {
    return {
      rooms: artifact.rooms ?? [],
      fixtures: artifact.fixtures ?? [],
      connections: artifact.connections ?? [],
      openings: artifact.openings ?? [],
      sourceAnchors: artifact.sourceAnchors ?? [],
      floorPanels: artifact.floorPanels ?? [],
    };
  }
  if (['fixtures', 'furniture', 'labels'].includes(layer)) {
    return {
      rooms: artifact.rooms ?? [],
      fixtures: artifact.fixtures ?? [],
      sourceAnchors: artifact.sourceAnchors ?? [],
    };
  }
  if (layer === 'dimensions' || layer === 'level frames') {
    return {
      floorPanels: artifact.floorPanels ?? [],
      dimensionLines: artifact.dimensionLines ?? [],
      footprint: artifact.footprint,
      coordinateSystem: artifact.coordinateSystem,
      coordinateMode: artifact.coordinateMode,
    };
  }
  if (layer === 'roof/elevation') {
    return {
      roof: artifact.roof ?? null,
      elevations: artifact.elevations ?? [],
      roofElevationArtifact: artifact.roofElevationArtifact ?? null,
    };
  }
  return artifact;
}

function elementSummary(value) {
  if (!value || typeof value !== 'object') return {};
  return {
    id: value.id ?? value.fixtureId ?? value.openingId ?? value.wallId ?? value.sourceAnchorId,
    type: value.type ?? value.kind ?? value.category ?? value.roomType ?? value.label,
    label: value.label ?? value.name,
    roomId: value.roomId,
    wallId: value.wallId ?? value.anchorWallId,
    sourceAnchorId: value.sourceAnchorId ?? value.sourceAnchor?.id,
    elementId: value.elementId ?? value.targetId,
    targetId: value.targetId,
    elementType: value.elementType,
  };
}

function primitiveIdCandidates(id) {
  const normalized = normalizePrimitiveSourceId(id);
  const parent = normalized.replace(/:seg-\d+$/i, '');
  return [...new Set([id, normalized, parent, `src-${normalized}`, `src-${parent}`].filter(Boolean).map(String))];
}

function indexEntryMatchesPrimitive(entry, primitiveId) {
  if (!entry || !primitiveId) return false;
  const wanted = new Set(primitiveIdCandidates(primitiveId));
  const entryIds = [
    entry.id,
    entry.sourceAnchorId,
    entry.elementId,
    entry.targetId,
    entry.wallId,
    entry.openingId,
    entry.fixtureId,
  ]
    .filter(Boolean)
    .flatMap((id) => primitiveIdCandidates(id));
  return entryIds.some((id) => wanted.has(id));
}

function parsePrimitiveRepairEvidence(description, repairLayer) {
  const evidence = [];
  const matchesRepairLayer = (primitiveLayer) => (
    repairLayer === 'source primitives'
    || primitiveLayerRepairLayer(primitiveLayer) === repairLayer
    || (repairLayer === 'source primitive overrides' && ['wall', 'door', 'window'].includes(String(primitiveLayer)))
  );
  for (const line of String(description ?? '').split('\n').map((item) => item.trim()).filter(Boolean)) {
    const geometry = /(?:^|:\s+)(wall|ladder|door|window|dashedVoid|dimension|fixture) primitive geometry drift for ([^\s(]+)/i.exec(line);
    if (geometry) {
      const primitiveLayer = geometry[1];
      if (matchesRepairLayer(primitiveLayer)) {
        evidence.push({
          primitiveLayer,
          sourceId: geometry[2],
          evidence: line,
          reason: 'geometry drift',
        });
      }
      continue;
    }

    const semantic = /(?:^|:\s+)(wall|ladder|door|window|dashedVoid|dimension|fixture)\s+([^\s]+)\s+source\/render primitive drift/i.exec(line);
    if (semantic) {
      const primitiveLayer = semantic[1];
      if (matchesRepairLayer(primitiveLayer)) {
        evidence.push({
          primitiveLayer,
          sourceId: semantic[2],
          evidence: line,
          reason: 'source/render primitive drift',
        });
      }
      continue;
    }

    const mismatch = /(?:^|:\s+)(wall|ladder|door|window|dashedVoid|dimension|fixture) primitive mismatch \([^)]*missing source IDs:\s*([^)]+)/i.exec(line);
    if (mismatch) {
      const primitiveLayer = mismatch[1];
      if (matchesRepairLayer(primitiveLayer)) {
        const ids = mismatch[2]
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
          .slice(0, 5);
        for (const id of ids) {
          evidence.push({
            primitiveLayer,
            sourceId: id,
            evidence: line,
            reason: 'missing source primitive',
          });
        }
      }
    }
  }
  return evidence;
}

function inferredPrimitiveRepairEvidence(report) {
  const evidence = [];
  const sourceAnchors = report.layerSection?.sourceAnchors ?? [];
  const pushAnchor = (anchor, primitiveLayer, reason) => {
    for (const id of [anchor?.id, anchor?.sourceAnchorId, anchor?.elementId, anchor?.targetId].filter(Boolean)) {
      evidence.push({
        primitiveLayer,
        sourceId: id,
        evidence: `inferred ${primitiveLayer} primitive target from source anchor ${anchor.id ?? id}`,
        reason,
      });
    }
  };

  if (report.layer === 'void/open-to-below') {
    for (const anchor of sourceAnchors) {
      const type = String(anchor.elementType ?? anchor.type ?? anchor.kind ?? '').toLowerCase();
      if (type.includes('dashedvoid') || type === 'void' || type.includes('open-to-below') || type.includes('open_to_below')) {
        pushAnchor(anchor, 'dashedVoid', 'inferred void/open-to-below target');
      }
    }
  }

  if (report.layer === 'stairs') {
    for (const anchor of sourceAnchors) {
      const type = String(anchor.elementType ?? anchor.type ?? anchor.kind ?? '').toLowerCase();
      if (type.includes('ladder') || type === 'stair' || type.includes('stairfixture')) {
        pushAnchor(anchor, 'ladder', 'inferred stair/ladder target');
      }
    }
  }

  return evidence;
}

function primitiveRepairTargets(report) {
  const patchIndex = report.patchPathIndex ?? [];
  const targets = [];
  const seen = new Set();
  const layerAllowsRooms = (report.allowedPatchPaths ?? []).some((path) => path === '/rooms' || String(path).startsWith('/rooms/'));
  const evidence = [
    ...parsePrimitiveRepairEvidence(report.description, report.layer),
    ...inferredPrimitiveRepairEvidence(report),
  ];
  for (const item of evidence) {
    const jsonPointers = patchIndex
      .filter((entry) => indexEntryMatchesPrimitive(entry, item.sourceId))
      .map((entry) => entry.path)
      .filter((path) => {
        if (report.layer === 'source primitives') return true;
        return !String(path).startsWith('/sourceAnchors') && !/^\/floorPanels\/(?:\d+|-)\/sourceAnchors(?:\/|$)/.test(String(path));
      })
      .filter(Boolean);
    if (layerAllowsRooms && ['fixture', 'furniture'].includes(String(item.primitiveLayer))) {
      const matchedFixtures = patchIndex
        .filter((entry) => indexEntryMatchesPrimitive(entry, item.sourceId))
        .filter((entry) => String(entry.path ?? '').startsWith('/fixtures/'));
      const roomIds = new Set(matchedFixtures.map((entry) => entry.roomId).filter(Boolean).map(String));
      for (const roomId of roomIds) {
        const roomPointer = patchIndex.find((entry) => String(entry.path ?? '').startsWith('/rooms/') && entry.id === roomId)?.path;
        if (roomPointer && !jsonPointers.includes(roomPointer)) jsonPointers.push(roomPointer);
      }
    }
    if (!jsonPointers.length) continue;
    const key = `${item.primitiveLayer}:${item.sourceId}:${jsonPointers.join('|')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({
      primitiveLayer: item.primitiveLayer,
      sourceId: item.sourceId,
      normalizedSourceId: normalizePrimitiveSourceId(item.sourceId),
      repairLayer: report.layer,
      jsonPointers,
      reason: item.reason,
      evidence: item.evidence,
    });
  }
  return targets;
}

function indexedArray(artifact, path) {
  const parts = path.slice(1).split('/');
  let current = artifact;
  for (const part of parts) current = current?.[part];
  if (!Array.isArray(current)) return [];
  return current.map((value, index) => ({ path: `${path}/${index}`, ...elementSummary(value) }));
}

function patchPathIndex(artifact, layer) {
  if (layer === 'drawing style profile') {
    return [
      { path: '/rules', type: 'drawingStyleRules' },
      { path: '/validation', type: 'drawingStyleValidation' },
      { path: '/source', type: 'drawingStyleSource' },
    ];
  }
  if (!artifact) return [];
  if (layer === 'semantic rebuild') {
    return [
      { path: '/coordinateSystem', type: 'coordinateSystem' },
      { path: '/coordinateMode', type: 'coordinateMode' },
      { path: '/dimensionFrame', type: 'dimensionFrame' },
      ...indexedArray(artifact, '/floorPanels'),
      ...indexedArray(artifact, '/rooms'),
      ...indexedArray(artifact, '/spaceFaces'),
      ...indexedArray(artifact, '/exteriorWalls'),
      ...indexedArray(artifact, '/interiorWalls'),
      ...indexedArray(artifact, '/sourceWalls'),
      ...indexedArray(artifact, '/sourceOpenings'),
      ...indexedArray(artifact, '/openings'),
      ...indexedArray(artifact, '/doors'),
      ...indexedArray(artifact, '/windows'),
      ...indexedArray(artifact, '/fixtures'),
      ...indexedArray(artifact, '/connections'),
      ...indexedArray(artifact, '/dimensionLines'),
      ...indexedArray(artifact, '/sourceAnchors'),
    ];
  }
  if (layer === 'source primitives') {
    return [
      ...indexedArray(artifact, '/sourceAnchors'),
      ...indexedArray(artifact, '/floorPanels'),
    ];
  }
  if (layer === 'source primitive overrides') {
    return [
      { path: '/sourceWalls', type: 'sourceWallPrimitiveOverrideArray' },
      ...indexedArray(artifact, '/sourceWalls'),
      { path: '/sourceOpenings', type: 'sourceOpeningPrimitiveOverrideArray' },
      ...indexedArray(artifact, '/sourceOpenings'),
    ];
  }
  if (layer === 'walls') {
    return [
      ...indexedArray(artifact, '/sourceWalls'),
      ...indexedArray(artifact, '/exteriorWalls'),
      ...indexedArray(artifact, '/interiorWalls'),
    ];
  }
  if (['openings', 'doors', 'windows'].includes(layer)) {
    return [
      { path: '/openings', type: 'rawOpeningArray' },
      ...indexedArray(artifact, '/openings'),
      { path: '/doors', type: 'rawDoorArray' },
      ...indexedArray(artifact, '/doors'),
      { path: '/windows', type: 'rawWindowArray' },
      ...indexedArray(artifact, '/windows'),
      ...indexedArray(artifact, '/connections'),
    ];
  }
  if (layer === 'void/open-to-below') {
    return [
      ...indexedArray(artifact, '/rooms'),
      ...indexedArray(artifact, '/spaceFaces'),
      ...indexedArray(artifact, '/exteriorWalls'),
      ...indexedArray(artifact, '/interiorWalls'),
    ];
  }
  if (layer === 'stairs') {
    const roomPointers = indexedArray(artifact, '/rooms');
    const nestedFixtures = (artifact.rooms ?? []).flatMap((room, roomIndex) => (
      (room.fixtures ?? []).map((fixture, fixtureIndex) => ({
        path: `/rooms/${roomIndex}/fixtures/${fixtureIndex}`,
        parentPath: `/rooms/${roomIndex}`,
        parentId: room.id,
        ...elementSummary(fixture),
      }))
    ));
    return [
      ...roomPointers,
      ...nestedFixtures,
      ...indexedArray(artifact, '/fixtures'),
      ...indexedArray(artifact, '/connections'),
      ...indexedArray(artifact, '/openings'),
    ];
  }
  if (['fixtures', 'furniture', 'labels'].includes(layer)) {
    const roomPointers = indexedArray(artifact, '/rooms');
    const nestedFixtures = (artifact.rooms ?? []).flatMap((room, roomIndex) => (
      (room.fixtures ?? []).map((fixture, fixtureIndex) => ({
        path: `/rooms/${roomIndex}/fixtures/${fixtureIndex}`,
        parentPath: `/rooms/${roomIndex}`,
        parentId: room.id,
        ...elementSummary(fixture),
      }))
    ));
    return [
      ...roomPointers,
      ...nestedFixtures,
      ...indexedArray(artifact, '/fixtures'),
    ];
  }
  if (layer === 'dimensions') {
    return [
      { path: '/dimensionFrame', type: 'dimensionFrame' },
      ...indexedArray(artifact, '/floorPanels'),
      ...indexedArray(artifact, '/dimensionLines'),
    ];
  }
  if (layer === 'level frames') {
    return [
      { path: '/dimensionFrame', type: 'dimensionFrame' },
      ...indexedArray(artifact, '/floorPanels'),
      ...indexedArray(artifact, '/rooms'),
      ...indexedArray(artifact, '/spaceFaces'),
    ];
  }
  if (layer === 'roof/elevation') {
    return [
      { path: '/roof', type: 'roof' },
      { path: '/roofElevationArtifact', type: 'roofElevationArtifact' },
      ...indexedArray(artifact, '/elevations'),
      ...((artifact.roof?.planes ?? []).map((plane, index) => ({ path: `/roof/planes/${index}`, ...elementSummary(plane) }))),
    ];
  }
  return [];
}

function primitiveRegionsForRepairLayer(drift, repairLayer) {
  const regions = drift?.metrics?.primitiveRegionDrift;
  if (!Array.isArray(regions)) return [];
  if (repairLayer === 'drawing style profile') {
    const presentationLayers = new Set(primitiveLayerDriftItems(drift)
      .filter((item) => {
        const threshold = primitiveLayerThreshold(item.layer);
        if (item.layer === 'dimension') {
          return (
            item.edgeSourceMissRate <= threshold.edgeSourceMissRate &&
            (
              item.edgeRenderExtraRate > threshold.edgeRenderExtraRate ||
              item.sourceMissRate > threshold.sourceMissRate ||
              item.renderExtraRate > threshold.renderExtraRate
            )
          );
        }
        return (
          item.edgeSourceMissRate <= threshold.edgeSourceMissRate &&
          item.edgeRenderExtraRate <= threshold.edgeRenderExtraRate &&
          (item.sourceMissRate > threshold.sourceMissRate || item.renderExtraRate > threshold.renderExtraRate)
        );
      })
      .map((item) => item.layer));
    return regions
      .filter((region) => presentationLayers.has(region?.layer))
      .slice(0, 12)
      .map((region) => ({
        id: region.id,
        layer: region.layer,
        sourceMissRate: region.sourceMissRate ?? 0,
        renderExtraRate: region.renderExtraRate ?? 0,
        edgeSourceMissRate: region.edgeSourceMissRate ?? 0,
        edgeRenderExtraRate: region.edgeRenderExtraRate ?? 0,
        box: region.box,
      }));
  }
  return regions
    .filter((region) => {
      if (!region?.layer) return false;
      if (repairLayer === 'semantic rebuild') return true;
      if (repairLayer === 'source primitives') return primitiveRegionIsSemanticDrift(region);
      if (repairLayer === 'source primitive overrides') {
        return ['wall', 'door', 'window'].includes(String(region.layer))
          && primitiveRegionHasEdgeGeometryDrift(region);
      }
      return primitiveLayerRepairLayer(region.layer) === repairLayer;
    })
    .slice(0, repairLayer === 'semantic rebuild' ? 20 : 10)
    .map((region) => ({
      id: region.id,
      layer: region.layer,
      sourceMissRate: region.sourceMissRate ?? 0,
      renderExtraRate: region.renderExtraRate ?? 0,
      edgeSourceMissRate: region.edgeSourceMissRate ?? 0,
      edgeRenderExtraRate: region.edgeRenderExtraRate ?? 0,
      box: region.box,
    }));
}

function primitiveEvidenceLines(regions) {
  return regions.map((region) => {
    const pct = (value) => `${((value ?? 0) * 100).toFixed(1)}%`;
    return `${region.layer} ${region.id} source/render primitive drift: source miss ${pct(region.sourceMissRate)}, render extra ${pct(region.renderExtraRate)}, edge miss ${pct(region.edgeSourceMissRate)}, edge extra ${pct(region.edgeRenderExtraRate)}, source box ${JSON.stringify(region.box)}.`;
  });
}

function driftReport(planId, proposalId, layer, messages, drift = null) {
  const paths = REPAIR_LAYER_PATHS[layer];
  const messageText = messages.join('\n');
  let topPrimitives = primitiveRegionsForRepairLayer(drift, layer);
  if (layer === 'source primitives' || layer === 'source primitive overrides') {
    const mentionedLayers = /wall primitive (?:edge|geometry) drift|Brochure wall primitive/i.test(messageText)
      ? ['wall']
      : PRIMITIVE_LAYERS.filter((primitiveLayer) => new RegExp(`\\b${primitiveLayer}\\b`, 'i').test(messageText));
    if (mentionedLayers.length) {
      const focused = topPrimitives.filter((region) => mentionedLayers.includes(String(region.layer)));
      if (focused.length) topPrimitives = focused;
    }
  }
  const primitiveLines = primitiveEvidenceLines(topPrimitives);
  const semanticElementIds = topPrimitives.map((region) => region.id).filter(Boolean);
  return {
    layer,
    severity: messages.some((message) => /blocked|missing|not aligned|outside|overlap|requires|too high/i.test(message)) ? 'blocked' : 'warning',
    sourceAnchorIds: semanticElementIds,
    semanticElementIds,
    topPrimitives,
    description: [
      ...messages,
      ...(primitiveLines.length ? ['Top primitive drift targets:', ...primitiveLines] : []),
    ].join('\n'),
    expectedFromSource: 'Match the GPT proposal image exactly for this selected layer. Preserve all unrelated layers.',
    currentInJson: `Current paired JSON has likely ${layer} drift or missing renderer metadata. Use only the allowed paths below.`,
    allowedPatchPaths: paths.allowed,
    blockedPatchPaths: paths.blocked,
    planId,
    proposalId,
  };
}

function targetedPrompt(packet, report) {
  const reportForPrompt = { ...report };
  delete reportForPrompt.layerSection;
  delete reportForPrompt.patchPathIndex;
  const focusTarget = report.primitiveRepairTargets?.[0] ?? null;
  const primitiveTargetGuidance = focusTarget
    ? [
        '',
        'Primitive-specific repair requirement:',
        '- Repair exactly one primitive target in this pass. Do not repair the whole layer.',
        `- Target primitive layer: ${focusTarget.primitiveLayer}`,
        `- Target source id: ${focusTarget.sourceId}`,
        `- Target evidence: ${focusTarget.evidence}`,
        '- Allowed JSON pointer roots for this pass:',
        ...focusTarget.jsonPointers.map((path) => `  - ${path}`),
        focusTarget.primitiveLayer === 'fixture'
          ? [
              '- Preserve the existing roomId unless the source image clearly proves the fixture belongs to a different visible room.',
              '- Keep the fixture inside its owning room. If the owning room is an open-zone whose semantic bounds are too tight for the visible source fixture, and `/rooms` is an allowed pointer root for this layer, patch only that owning room bounds/polygon enough to contain the fixture without changing unrelated rooms.',
              '- If neither the fixture nor the owning open-zone can be repaired confidently from source evidence, return [].',
            ].join('\n')
          : '',
        '- Return [] if the attached images do not let you confidently repair this exact primitive.',
        '- Do not touch sibling walls/openings/fixtures or broader layer arrays unless the allowed pointer root is that exact array item.',
      ].join('\n')
    : '';
  const drawingStyleGuidance = report.layer === 'drawing style profile'
    ? [
        '',
        'Drawing style profile repair requirement:',
        '- Patch the drawing_style_profile_v1 sidecar, not the paired semantic JSON.',
        '- Change only `/rules`, `/validation`, `/source`, `/profileId`, or `/generatedAt`.',
        '- Use this only for renderer drawing-language drift: wall thickness, caps/corners, window symbols, door arc style, fixture stroke/fill, dashed void rhythm, dimensions, callouts, labels, and grid/background.',
        '- Do not pass by hiding visible layers: do not set dimensions, floor titles, labels, fixtures, doors, windows, walls, stairs, or callouts to transparent/zero opacity unless the source image truly lacks that layer.',
        '- Preserve visible source primitives and tune their stroke/fill/dash rhythm instead of masking them away.',
        '- If the visual mismatch is caused by wrong semantic geometry, return [] so the semantic layer can be repaired instead.',
      ].join('\n')
    : '';
  const semanticRebuildGuidance = report.layer === 'semantic rebuild'
    ? [
        '',
        'Semantic rebuild requirement:',
        '- Use this lane only because the paired JSON is too far from the source image for one-primitive patches.',
        '- Repair the semantic JSON so the deterministic render matches the GPT proposal at the primitive level.',
        '- You may patch floor frames, rooms, space faces, wall segments, openings, doors, windows, fixtures, connections, dimensions, and source anchors.',
        '- Keep plan id, proposal id, footprint, square footage, prompt metadata, roof/elevation metadata, and unrelated product metadata unchanged.',
        '- This must be an interdependent repair, not a partial local tweak. Do not return a patch that only moves one fixture or one room while the level frame, wall graph, openings, voids, and dimensions remain inconsistent.',
        '- If floor frames or wall graphs are wrong, replace the affected complete arrays together: `/floorPanels`, `/rooms`, `/spaceFaces`, `/exteriorWalls`, `/interiorWalls`, `/openings`, `/doors`, `/windows`, `/fixtures`, `/dimensionLines`, and `/sourceAnchors` as needed.',
        '- Prefer replacing complete arrays for a layer when many individual entries are wrong; do not emit hundreds of tiny operations if one array replacement is clearer.',
        '- A semantic rebuild patch must improve the whole Compare/Overlay, not only one primitive. If you cannot confidently repair all dependent layers from the evidence, return [] only.',
        '- Every visible source wall/opening/door/window/fixture/ladder/void/dimension must have a semantic counterpart and sourceAnchorId.',
        '- Every JSON element you add must be visible in the source proposal image.',
        '- Do not invent new design intent. Preserve the source proposal layout, levels, proportions, doors, fixtures, labels, dimensions, and open-to-below geometry.',
        '- Return [] if the attached evidence is insufficient to rebuild this plan safely.',
      ].join('\n')
    : '';
  const missingSourcePrimitiveGuidance = /missing source-image spans|source spans are extracted|source-image primitive/i.test(report.description)
    ? [
        '',
        'Source primitive extraction requirement:',
        '- If current `sourceAnchors` are tagged `deterministic-plan-bounds`, do not treat them as source-image evidence.',
        '- Add or replace only `/sourceAnchors` or `/floorPanels/*/sourceAnchors` with true source-image `pixelBounds` derived from the attached GPT proposal image.',
        '- Keep source anchor ids aligned with the semantic element ids or existing `sourceAnchorId` references so the primitive extractor can resolve them.',
        '- Use `anchorKind` such as `source-image-primitive` or `gpt-proposal-primitive`, not `deterministic-plan-bounds`.',
        '- Do not edit semantic geometry in this layer. If the source anchors prove semantic geometry is wrong, return [] for source primitives and repair the specific semantic layer next.',
      ].join('\n')
    : '';
  const sourcePrimitiveOverrideGuidance = ['openings', 'doors', 'windows', 'walls', 'source primitive overrides'].includes(report.layer)
    ? [
        '',
        'Source primitive override requirement:',
        '- The app validates and renders the derived source primitive channels: `/sourceWalls` and `/sourceOpenings`.',
        '- Wall drift may patch `/sourceWalls` because trace-mode Compare/Overlay renders materialized source wall primitives.',
        '- For doors/windows/openings drift, patch the semantic layer (`/doors`, `/openings`, `/windows`) unless the report layer is exactly `source primitive overrides`.',
        '- Coordinates in `/sourceWalls` and `/sourceOpenings` are deterministic grid units where 1 grid unit = 4 feet.',
        '- A `/sourceOpenings` item must include id, wallId, floor, kind, openingType, x1, z1, x2, z2, span, widthFt, sourceAnchorId, and door swing metadata for doors.',
        '- A `/sourceWalls` item must include id, floor, x1, z1, x2, z2, exterior, wallKind, and sourceAnchorId.',
        '- If a `/sourceWalls` id contains `:seg-`, `sourceAnchorId` must equal that full segment id, not the parent wall id.',
        '- If validation is failing on source primitive alignment but this report is not `source primitive overrides`, return [] and let the orchestrator queue that dedicated layer.',
      ].join('\n')
    : '';
  const dimensionGuidance = report.layer === 'dimensions'
    ? [
        '',
        'Dimension repair requirement:',
        '- Dimension lines are visible brochure content. Do not remove `/dimensionLines` and do not replace it with `[]`.',
        '- Repair only the dimension line spans, offsets, labels, or floor association needed to match the GPT proposal image.',
        '- Do not return patches that only change `/dimensionLines/*/sourceAnchor` or `pixelBounds`; those only change evidence and do not change the deterministic render.',
        '- If you patch a dimension sourceAnchor, also patch the same `/dimensionLines/*` rendered geometry such as `span`, `from`, `to`, `textAnchor`, `label`, `value`, or `orientation`.',
        '- Keep the source-visible overall width/depth dimension lines. If a dimension is extra, replace its span/label with the source-matching dimension instead of hiding the whole layer.',
        '- If dimension drift is purely renderer typography or stroke style, return [] so the drawing style profile layer can be repaired.',
      ].join('\n')
    : '';
  return [
    '# Targeted paired floorplan JSON repair',
    '',
    'You are repairing one semantic layer of a paired floorplan artifact. Do not regenerate the whole plan.',
    'Return RFC 6902 JSON Patch only. No markdown. No explanation.',
    '',
    `Plan: ${packet.planId}`,
    `Proposal: ${packet.proposalId}`,
    `Repair layer: ${report.layer}`,
    `Severity: ${report.severity}`,
    '',
    'Required visual attachments:',
    '- Attach the source GPT proposal image.',
    '- Attach the current deterministic render image.',
    '- Attach the Compare and Overlay screenshots from Browser QA for this plan.',
    '- Treat local paths below as identifiers only. If the images are not attached or visible to you, return [] instead of guessing.',
    '',
    'Source GPT proposal image:',
    packet.sourceImage ?? 'missing source image path',
    '',
    'Current deterministic render image:',
    packet.deterministicRender ?? 'missing deterministic render path',
    '',
    'Browser QA screenshots:',
    ...packet.browserEvidence.map((item) => `- ${item.kind}: ${item.path}`),
    '',
    'Drift report:',
    JSON.stringify(reportForPrompt, null, 2),
    drawingStyleGuidance,
    semanticRebuildGuidance,
    missingSourcePrimitiveGuidance,
    sourcePrimitiveOverrideGuidance,
    dimensionGuidance,
    '',
    'Current paired artifact JSON section for this layer:',
    'See current-layer-section.json in the repair bundle. The complete source artifact is current-paired-json-*.paired.json.',
    '',
    'JSON Patch path index for this layer:',
    'See patch-path-index.json in the repair bundle. Use only paths allowed by the drift report and patch path index.',
    primitiveTargetGuidance,
    '',
    'Hard rules:',
    '- Patch only the selected repair layer.',
    '- Do not patch `/sourceAnchors`, `/floorPanels`, `/sourceWalls`, or `/sourceOpenings` unless this prompt explicitly names one of those paths as allowed for the selected repair layer.',
    '- Do not change footprint, scale, proposal metadata, unrelated room geometry, unrelated walls, or unrelated fixtures.',
    '- Do not delete whole rooms, whole plans, or unrelated elements.',
    '- Preserve the source design intent. Do not rectangle-pack or simplify the plan.',
    '- If this is renderer-only presentation drift, return [] and do not alter semantic JSON.',
    '- If this is the drawing style profile layer, patch only the style sidecar rules; do not patch semantic JSON.',
    '- Do not patch embedded `sourceAnchor` evidence by itself for doors/openings/windows/fixtures/furniture; if you adjust an embedded sourceAnchor, also adjust the same element\'s rendered semantic geometry such as bounds, span, rotation, facing, or fixture dimensions.',
    '- Door patches must preserve or add opening type, wallId, fromRoomId, toRoomId, span, hingePoint, leafClosedEnd, leafOpenEnd, swingDirection, swingArcDeg, opensIntoRoomId, widthFt, heightFt, and sourceAnchorId.',
    '- Fixture/furniture patches must preserve or add category, type, roomId, bounds, rotationDeg, facingDirection, anchorWallId, wallSide, clearance, sourceAnchorId, bimClass, and symbolVariant.',
    '',
    'Return only a JSON Patch array.',
  ].join('\n');
}

async function writeRepairPackets(results) {
  const manifest = await readJson(MANIFEST_PATH);
  const packetSummaries = [];
  for (const planId of PLANS) {
    const paths = planArtifactPaths(manifest, planId);
    const planResults = results.filter((result) => result.planId === planId);
    if (!paths || planResults.length === 0) continue;
    const artifact = paths.pairedJson ? await readJson(paths.pairedJson) : null;
    let drawingStyleProfile = null;
    try {
      drawingStyleProfile = paths.drawingStyleProfile ? await readJson(paths.drawingStyleProfile) : null;
    } catch {
      drawingStyleProfile = null;
    }
    const drift = paths.visualDrift ? await readJson(paths.visualDrift) : null;
    const sourceImage = drift?.sourceImage ?? artifact?.sourceImage ?? null;
    const browserEvidence = planResults.flatMap((result) => [
      ...Object.entries(result.views).map(([kind, value]) => ({ viewport: result.viewport, kind, path: value.screenshot })),
      ...Object.entries(result.review).map(([kind, value]) => ({ viewport: result.viewport, kind: `review-${kind}`, path: value.screenshot })),
    ]);
    const blockerText = planResults.flatMap((result) => result.blockers.map((blocker) => `${result.viewport}: ${blocker}`));
    const validationLayers = validationLayersFromResults(planResults);
    const browserPrimitiveLayers = primitiveDriftLayersFromMessage(blockerText.join('\n'));
    const semanticLayers = [...sourceOverrideDriftLayers(drift, artifact), ...highDriftLayers(drift)];
    const presentationLayers = productViewLayers(planResults);
    const layers = sortRepairLayersByDrift([...validationLayers, ...browserPrimitiveLayers, ...semanticLayers, ...presentationLayers], drift);
    const pageSignals = planResults.map((result) => result.pageSignals).filter(Boolean);
    const reports = layers.map((layer) => {
      const report = driftReport(planId, paths.option.id, layer, [
        ...blockerText,
        ...(drift?.metrics ? [`Visual drift metrics: source miss ${(drift.metrics.sourceMissRate * 100).toFixed(1)}%, render extra ${(drift.metrics.renderExtraRate * 100).toFixed(1)}%, edge miss ${(drift.metrics.edgeSourceMissRate * 100).toFixed(1)}%, edge extra ${(drift.metrics.edgeRenderExtraRate * 100).toFixed(1)}%.`] : []),
        `Repair ${layer} only if Compare/Overlay evidence proves this layer differs from the GPT proposal.`,
      ], drift);
      report.layerSection = layerSection(artifact, layer, drawingStyleProfile);
      report.patchPathIndex = patchPathIndex(artifact, layer);
      report.primitiveRepairTargets = primitiveRepairTargets(report);
      if (report.primitiveRepairTargets.length) {
        report.allowedPrimitivePatchPaths = report.primitiveRepairTargets[0].jsonPointers;
        report.description = [
          `First primitive target: ${report.primitiveRepairTargets[0].sourceId} (${report.primitiveRepairTargets[0].primitiveLayer}).`,
          report.description,
        ].join('\n');
      }
      return report;
    }).filter((report) => {
      if (report.layer !== 'source primitives') return true;
      if (report.primitiveRepairTargets?.length) return true;
      return /missing source-image spans|source spans are extracted|source-image primitive/i.test(report.description);
    });
    const filteredLayers = reports.map((report) => report.layer);
    const packet = {
      artifactVersion: 'brochure_repair_packet_v1',
      generatedAt: new Date().toISOString(),
      planId,
      proposalId: paths.option.id,
      status: blockerText.length ? 'blocked' : (filteredLayers.length ? 'review' : 'pass'),
      sourceImage,
      deterministicRender: paths.deterministicRender,
      pairedJson: paths.pairedJson,
      drawingStyleProfile: paths.drawingStyleProfile,
      visualDrift: drift,
      browserEvidence,
      blockers: blockerText,
      pageSignals,
      recommendedSequence: filteredLayers,
      reports,
    };
    packet.prompts = packet.reports.map((report) => ({
      layer: report.layer,
      prompt: targetedPrompt(packet, report),
    }));
    const jsonPath = resolve(OUT_DIR, `${planId}-brochure-repair-packet.json`);
    const mdPath = resolve(OUT_DIR, `${planId}-brochure-repair-packet.md`);
    await writeFile(jsonPath, `${JSON.stringify(packet, null, 2)}\n`);
    await writeFile(mdPath, [
      `# Brochure Repair Packet: ${planId}`,
      '',
      `Proposal: ${paths.option.id}`,
      `Status: ${packet.status}`,
      `Source image: ${sourceImage ?? 'missing'}`,
      `Deterministic render: ${paths.deterministicRender ?? 'missing'}`,
      '',
      '## Recommended Sequence',
      ...filteredLayers.map((layer, index) => `${index + 1}. ${layer}`),
      '',
      '## Blockers',
      ...(blockerText.length ? blockerText.map((line) => `- ${line}`) : ['- none']),
      '',
      '## Prompt Files',
      `Use the JSON packet at ${jsonPath}. Each prompt is in \`prompts[].prompt\` and is scoped to one layer.`,
      '',
    ].join('\n'));
    packetSummaries.push({ planId, proposalId: paths.option.id, path: jsonPath, markdown: mdPath, status: packet.status, layers: filteredLayers });
  }
  return packetSummaries;
}

function releaseBlockingRepairPackets(repairPackets) {
  return repairPackets.filter((packet) => (
    packet.status === 'blocked'
    && Array.isArray(packet.blockers)
    && packet.blockers.length > 0
    && packet.layers.some((layer) => RELEASE_BLOCKING_REPAIR_LAYERS.has(layer))
  ));
}

function appendRepairPacketBlockers(results, repairPackets) {
  const blockingPackets = releaseBlockingRepairPackets(repairPackets);
  for (const packet of blockingPackets) {
    const layers = packet.layers.filter((layer) => RELEASE_BLOCKING_REPAIR_LAYERS.has(layer));
    const blocker = `brochure QA: unresolved ${packet.status} repair packet for ${packet.planId}/${packet.proposalId}: ${layers.join(', ')}`;
    for (const result of results) {
      if (result.planId === packet.planId && !result.blockers.includes(blocker)) {
        result.blockers.push(blocker);
      }
    }
  }
  return blockingPackets;
}

async function run() {
  await mkdir(OUT_DIR, { recursive: true });
  const manifest = await readJson(MANIFEST_PATH);
  const browser = await launchBrowser();
  const results = [];

  try {
    for (const viewport of VIEWPORTS) {
      const page = await browser.newPage({ viewport, acceptDownloads: true });
      const galleryResult = {
        planId: 'gallery',
        viewport: viewport.id,
        url: BASE_URL,
        views: {},
        review: {},
        blockers: [],
      };
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.body.innerText.toLowerCase().includes('prompt-to-plan studio'), undefined, { timeout: 10_000 });
      const galleryScreenshot = await saveViewport(page, 'gallery', viewport.id, 'product-gallery');
      const gallerySignals = await page.evaluate(() => {
        const text = document.body.innerText;
        const normalizedText = text.toLowerCase();
        // The home page is now a social feed: each plan is a [data-feed-card].
        const planCards = document.querySelectorAll('[data-feed-card]').length;
        const controls = Array.from(document.querySelectorAll('input,select,button')).map((item) => item.textContent || item.getAttribute('placeholder') || '').join('\n').toLowerCase();
        const cardButtons = Array.from(document.querySelectorAll('[data-feed-card] button')).map((b) => (b.textContent || '').trim().toLowerCase());
        return {
          planCards,
          hasSearch: controls.includes('search plans'),
          hasBedFilter: normalizedText.includes('all bed/bath'),
          hasBathFilter: normalizedText.includes('all baths'),
          hasSqftFilter: normalizedText.includes('all square feet'),
          hasLevelFilter: normalizedText.includes('all levels'),
          hasRoofFilter: normalizedText.includes('all roof types'),
          hasStatusFilter: normalizedText.includes('all statuses'),
          hasNewPlan: normalizedText.includes('new plan'),
          // New feed-card invariants: every card labels its concept render, shows
          // the dimensioned plan as source of truth, and keeps a repair + open path.
          hasConceptLabel: document.querySelectorAll('[data-feed-card] [data-feed-concept-label]').length > 0,
          hasSourceOfTruth: normalizedText.includes('dimensioned source of truth'),
          hasRepairAction: cardButtons.includes('repair'),
          hasOpenPlan: cardButtons.includes('open plan'),
          hasEngagement: document.querySelectorAll('[data-feed-card] [data-feed-engagement]').length > 0,
          hasHarnessLeak: /paired gpt status|component catalog|select a component/i.test(text),
        };
      });
      galleryResult.views.gallery = { screenshot: galleryScreenshot, metrics: gallerySignals };
      if (gallerySignals.planCards < 1) galleryResult.blockers.push('gallery: no plan feed cards rendered');
      if (!gallerySignals.hasSearch) galleryResult.blockers.push('gallery: search control missing');
      if (!gallerySignals.hasBedFilter || !gallerySignals.hasBathFilter || !gallerySignals.hasSqftFilter || !gallerySignals.hasLevelFilter || !gallerySignals.hasRoofFilter || !gallerySignals.hasStatusFilter) {
        galleryResult.blockers.push('gallery: product filters missing');
      }
      if (!gallerySignals.hasNewPlan) galleryResult.blockers.push('gallery: New Plan handoff action missing');
      if (!gallerySignals.hasConceptLabel) galleryResult.blockers.push('gallery: feed cards do not label the concept render');
      if (!gallerySignals.hasSourceOfTruth) galleryResult.blockers.push('gallery: feed cards do not show the dimensioned plan as source of truth');
      if (!gallerySignals.hasRepairAction) galleryResult.blockers.push('gallery: feed cards do not expose a Repair action');
      if (!gallerySignals.hasOpenPlan) galleryResult.blockers.push('gallery: feed cards do not expose an Open Plan action');
      if (!gallerySignals.hasEngagement) galleryResult.blockers.push('gallery: feed cards do not show the engagement bar');
      if (gallerySignals.hasHarnessLeak) galleryResult.blockers.push('gallery: harness/debug panel leaked into product landing page');
      const newPlanHandoffButtons = page.getByText('New Plan Handoff', { exact: true });
      const newPlanHandoffCount = await newPlanHandoffButtons.count();
      if (newPlanHandoffCount < 1) {
        galleryResult.blockers.push('gallery: no clickable New Plan Handoff action found');
      } else {
        await newPlanHandoffButtons.first().click();
        await page.waitForFunction(() => document.body.innerText.includes('GENERATED GPT PROMPT PREVIEW'), undefined, { timeout: 10_000 });
        const handoffScreenshot = await saveViewport(page, 'gallery', viewport.id, 'new-plan-handoff-modal');
        const handoffSignals = await page.evaluate(() => {
          const text = document.body.innerText.toLowerCase();
          return {
            hasPromptPreview: text.includes('generated gpt prompt preview'),
            hasReferencePlan: text.includes('reference plan'),
            hasDownloadPacket: text.includes('download handoff packet'),
          };
        });
        galleryResult.views.newPlanHandoff = { screenshot: handoffScreenshot, metrics: handoffSignals };
        if (!handoffSignals.hasPromptPreview || !handoffSignals.hasReferencePlan || !handoffSignals.hasDownloadPacket) {
          galleryResult.blockers.push('gallery: New Plan handoff modal is missing prompt preview, reference plan, or download packet action');
        }
        await page.getByText('Close', { exact: true }).first().click();
      }
      const repairPromptButtons = page.locator('[data-feed-card] button', { hasText: /^Repair$/ });
      const repairPromptCount = await repairPromptButtons.count();
      if (repairPromptCount < 1) {
        galleryResult.blockers.push('gallery: no clickable Repair actions found on feed cards');
      } else {
        await repairPromptButtons.first().click();
        await page.waitForFunction(() => document.body.innerText.includes('Repair With GPT'), undefined, { timeout: 10_000 });
        const repairScreenshot = await saveViewport(page, 'gallery', viewport.id, 'repair-prompt-modal');
        const repairSignals = await page.evaluate(() => {
          const text = document.body.innerText.toLowerCase();
          return {
            url: window.location.href,
            hasRepairDialog: text.includes('repair with gpt'),
            hasJsonPatchInstruction: text.includes('json patch'),
            hasDriftLayer: text.includes('drift layer'),
          };
        });
        galleryResult.views.repairPrompt = { screenshot: repairScreenshot, metrics: repairSignals };
        if (!repairSignals.hasRepairDialog || !repairSignals.hasJsonPatchInstruction || !repairSignals.hasDriftLayer) {
          galleryResult.blockers.push('gallery: Repair Prompt action does not open the scoped GPT repair workflow');
        }
      }
      results.push(galleryResult);

      for (const planId of PLANS) {
        const paths = planArtifactPaths(manifest, planId);
        const pairedArtifact = paths?.pairedJson ? await readJson(paths.pairedJson) : null;
        const deterministicSvgUrl = paths?.option?.deterministicRenderUrl
          ? `${BASE_URL.replace(/\/$/, '')}/data/den-image-loop/${encodeURIComponent(planId)}/${paths.option.deterministicRenderUrl.split('/').map((part) => encodeURIComponent(part)).join('/')}`
          : '';
        const expectedPrimitives = sourceDrawingPrimitives(pairedArtifact);
        const expectedPrimitiveCounts = pairedArtifact ? sourcePrimitiveCounts(pairedArtifact) : emptyPrimitiveCounts();
        const planResult = {
          planId,
          viewport: viewport.id,
          url: `${BASE_URL}/?home=${encodeURIComponent(planId)}`,
          views: {},
          review: {},
          expectedPrimitives,
          expectedPrimitiveCounts,
          blockers: [],
        };

        await page.goto(planResult.url, { waitUntil: 'networkidle' });
        await waitForCanvas(page);
        planResult.pageSignals = await pageReviewSignals(page);
        for (const blocker of validationBlockersFromSignals(planResult.pageSignals)) {
          planResult.blockers.push(`validation: ${blocker}`);
        }

        for (const [viewId, label] of VIEW_BUTTONS) {
          await clickVisibleText(page, label, { maxX: 700 });
          await waitForCanvas(page);
          const screenshot = await saveViewport(page, planId, viewport.id, viewId);
          const canvasExport = await saveCanvasExport(page, planId, viewport.id, viewId);
          const metrics = await productCanvasMetrics(page);
          planResult.views[viewId] = { screenshot, canvasExport, metrics };

          if (!metrics.canvas) planResult.blockers.push(`${viewId}: missing WebGL canvas`);
          if (!canvasExport) planResult.blockers.push(`${viewId}: WebGL canvas could not export a product image`);
          if (metrics.canvas && (metrics.canvas.width < 420 || metrics.canvas.height < 320)) {
            planResult.blockers.push(`${viewId}: canvas too small for brochure review`);
          }
          if (metrics.hasBrochureBlocked) {
            planResult.blockers.push(`${viewId}: app reports Brochure Quality blocked`);
          }
          if (metrics.hasDesignBlocked) {
            planResult.blockers.push(`${viewId}: app reports Design Quality blocked`);
          }
          if (metrics.hasPresentationBlocked) {
            planResult.blockers.push(`${viewId}: app reports Presentation Quality blocked`);
          }
          if (viewId !== 'plantop' && metrics.hasDebugLeakText) {
            planResult.blockers.push(`${viewId}: debug text is visible in product context`);
          }
          if (metrics.hasHarnessRailLeak) {
            planResult.blockers.push(`${viewId}: harness review rail is visible in default product detail`);
          }
          if (viewId === 'product3d') {
            const orbitCanvasExport = await saveOrbitCanvasExport(page, planId, viewport.id, viewId);
            planResult.views[viewId].orbitCanvasExport = orbitCanvasExport;
            if (!orbitCanvasExport) {
              planResult.blockers.push(`${viewId}: orbit-drag canvas export failed, so rotated 3D cannot be reviewed`);
            }
            const counts = metrics.renderedCategoryCounts ?? {};
            if (!metrics.bimRenderedElementCount) {
              planResult.blockers.push(`${viewId}: BIM product view rendered zero elements`);
            }
            if ((counts.productFootprintSlab ?? 0) !== 1) {
              planResult.blockers.push(`${viewId}: BIM product view must render exactly one clean footprint slab`);
            }
            if ((counts.productEnvelopeWall ?? 0) < 4) {
              planResult.blockers.push(`${viewId}: BIM product view has too few derived product envelope wall elements`);
            }
            if ((counts.roofPlane ?? 0) < 1) {
              planResult.blockers.push(`${viewId}: BIM product view has no roof planes while roof view is enabled`);
            }
            const productDetailCount = (
              (counts.wall ?? 0) +
              (counts.door ?? 0) +
              (counts.window ?? 0) +
              (counts.opening ?? 0) +
              (counts.stair ?? 0) +
              (counts.sanitaryTerminal ?? 0) +
              (counts.furniture ?? 0) +
              (counts.equipment ?? 0) +
              (counts.fixtureProxy ?? 0)
            );
            if (productDetailCount < 4) {
              planResult.blockers.push(`${viewId}: BIM product view has too little readable semantic detail after shell cleanup`);
            }
            for (const category of ['slab', 'space', 'openZone', 'void']) {
              if ((counts[category] ?? 0) > 0) {
                planResult.blockers.push(`${viewId}: BIM product view leaked ${counts[category]} ${category} debug/plan-surface element(s)`);
              }
            }
          }
        }

        await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
        const jsonOnlyLane = paths?.option?.sourceKind === 'constrained_json';
        for (const [tabId, label] of REVIEW_TABS) {
          if (tabId === 'overlay' && jsonOnlyLane) {
            // JSON-only plans have no GPT image to overlay; the tab must be
            // hidden for them. Present means the lane leaked — block it.
            const overlayCount = await page.getByText('Overlay', { exact: true }).count();
            if (overlayCount > 0) {
              planResult.blockers.push('review-overlay: JSON-only plan still exposes the GPT Overlay tab');
            }
            continue;
          }
          await clickVisibleText(page, label, { minX: 900 });
          const screenshot = await saveViewport(page, planId, viewport.id, `review-${tabId}`);
          const metrics = await drawingStyleReviewMetrics(page, deterministicSvgUrl);
          const primitiveDiffs = primitiveLayerDiffs(expectedPrimitives, metrics.renderedPrimitives ?? [], `review-${tabId}`);
          const primitiveGeometry = primitiveGeometryDiffs(expectedPrimitives, metrics.renderedPrimitives ?? [], `review-${tabId}`);
          planResult.review[tabId] = { screenshot, metrics, primitiveDiffs, primitiveGeometry };
          if (tabId === 'compare' || tabId === 'overlay') {
            if (!metrics.profiledSvgCount || !metrics.schemas.includes('drawing_style_profile_v1')) {
              planResult.blockers.push(`review-${tabId}: deterministic render is missing drawing_style_profile_v1 metadata`);
            }
            if (!metrics.hasExteriorRule || !metrics.hasDoorRule || !metrics.hasWindowRule || !metrics.hasFixtureRule) {
              planResult.blockers.push(`review-${tabId}: deterministic render is missing extracted drawing style role rules`);
            }
            if (metrics.exteriorWallRoles < 1) {
              planResult.blockers.push(`review-${tabId}: profiled deterministic render has no exterior wall role geometry`);
            }
            if (metrics.sourceWallIds < 4) {
              planResult.blockers.push(`review-${tabId}: profiled deterministic render has too few source-anchored wall primitives`);
            }
            if (metrics.sourceOpeningIds < 1) {
              planResult.blockers.push(`review-${tabId}: profiled deterministic render has no source-anchored opening primitives`);
            }
            for (const diff of primitiveDiffs) {
              if (diff.severity === 'blocked') {
                planResult.blockers.push(primitiveDiffMessage(diff));
              }
            }
            for (const diff of primitiveGeometry) {
              if (diff.severity === 'blocked') {
                planResult.blockers.push(primitiveGeometryDiffMessage(diff));
              }
            }
            for (const blocker of primitiveDiffBlockers(expectedPrimitiveCounts, metrics.renderedPrimitiveCounts, `review-${tabId}`)) {
              if (!planResult.blockers.includes(blocker)) planResult.blockers.push(blocker);
            }
          }
          // JSON-only plans (sourceKind constrained_json) have no extracted
          // drawing style profile by design - the deterministic render is the
          // canonical drawing language for that lane.
          if (tabId === 'semantic' && !metrics.semanticMentionsStyleProfile && paths?.option?.sourceKind !== 'constrained_json') {
            planResult.blockers.push('review-semantic: semantic review does not expose drawing_style_profile_v1');
          }
        }

        const exportButtons = page.locator('button').filter({ hasText: /^Export$/ });
        const exportButtonCount = await exportButtons.count();
        if (exportButtonCount < 1) {
          planResult.blockers.push('export: product export button is missing');
        } else {
          try {
            await exportButtons.first().click();
            await page.waitForFunction(() => document.body.innerText.includes('Export Plan'), undefined, { timeout: 10_000 });
            const exportPacketButtons = page.getByText('Export Brochure Packet JSON', { exact: true });
            const exportPacketButtonCount = await exportPacketButtons.count();
            if (exportPacketButtonCount < 1) {
              throw new Error('Export modal opened without an Export Brochure Packet JSON action');
            }
            const [download] = await Promise.all([
              page.waitForEvent('download', { timeout: 10_000 }),
              exportPacketButtons.first().click(),
            ]);
            const exportPath = resolve(OUT_DIR, `${planId}-${viewport.id}-${download.suggestedFilename()}`);
            await download.saveAs(exportPath);
            const exportText = await readFile(exportPath, 'utf8');
            planResult.export = {
              path: exportPath,
              filename: download.suggestedFilename(),
              hasProductPacket: exportText.includes('paired_floorplan_product_packet'),
              hasSemanticPlan: exportText.includes('"semanticPlan"'),
              hasValidation: exportText.includes('"validation"'),
              hasBrochureHtml: exportText.includes('"brochureHtml"'),
            };
            if (!planResult.export.hasProductPacket || !planResult.export.hasSemanticPlan || !planResult.export.hasValidation || !planResult.export.hasBrochureHtml) {
              planResult.blockers.push('export: product packet is missing semantic plan, validation, or brochure HTML');
            }
          } catch (error) {
            planResult.blockers.push(`export: Export button did not produce a downloadable packet (${error instanceof Error ? error.message : 'unknown error'})`);
          }
        }

        results.push(planResult);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }

  const repairPackets = await writeRepairPackets(results);
  const releaseBlockingPackets = appendRepairPacketBlockers(results, repairPackets);
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    outputDir: OUT_DIR,
    plans: PLANS,
    viewports: VIEWPORTS,
    results,
    repairPackets,
    releaseBlockingPackets,
    passed: results.every((result) => result.blockers.length === 0),
  };
  const firstBlockedRepair = releaseBlockingPackets.find((packet) => packet.layers.length)
    ?? repairPackets.find((packet) => packet.status === 'blocked' && packet.layers.length);
  const nextRepairPacket = firstBlockedRepair?.path ?? 'artifacts/brochure-qa/a-frame-bunk-brochure-repair-packet.json';
  const nextRepairLayer = firstBlockedRepair?.layers?.[0] ?? 'walls';
  const nextRepairBundle = firstBlockedRepair
    ? `artifacts/brochure-qa/repair-bundles-all/${firstBlockedRepair.planId}-${firstBlockedRepair.proposalId}-${String(nextRepairLayer).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()}`
    : 'artifacts/brochure-qa/repair-bundles-all/a-frame-bunk-proposal-paired-v1-walls';
  await writeFile(resolve(OUT_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(resolve(OUT_DIR, 'summary.md'), [
    '# Brochure QA Summary',
    '',
    `Generated: ${report.generatedAt}`,
    `Base URL: ${BASE_URL}`,
    `Overall: ${report.passed ? 'pass' : 'blocked'}`,
    '',
    '## Results',
    ...results.map((result) => [
      `### ${result.planId} / ${result.viewport}`,
      '',
      result.blockers.length ? 'Status: blocked' : 'Status: pass',
      '',
      result.blockers.length
        ? ['Blockers:', ...result.blockers.map((blocker) => `- ${blocker}`)].join('\n')
        : 'Blockers: none',
      result.export?.path ? `\nExport packet: ${result.export.path}` : '',
    ].filter(Boolean).join('\n')),
    '',
    '## Repair Packets',
    ...repairPackets.map((packet) => [
      `- ${packet.planId}: ${packet.status}`,
      `  - JSON: ${packet.path}`,
      `  - Markdown: ${packet.markdown}`,
      `  - Layers: ${packet.layers.join(', ') || 'none'}`,
    ].join('\n')),
    '',
    '## Next Commands',
    '',
    '```bash',
    'npm run repair:queue -- --out artifacts/brochure-qa/next-repair-prompts-all.md --bundle-dir artifacts/brochure-qa/repair-bundles-all --zip --all',
    `npm run repair:prompt -- --packet ${nextRepairPacket} --layer "${nextRepairLayer}"`,
    `npm run repair:gpt -- --bundle ${nextRepairBundle} --model "$OPENAI_REPAIR_MODEL" --yes`,
    `npm run repair:apply -- --bundle ${nextRepairBundle} --patch ${nextRepairBundle}/patch.json`,
    'npm run qa:brochure',
    '```',
    '',
  ].join('\n'));

  for (const result of results) {
    const prefix = result.blockers.length ? 'blocked' : 'pass';
    console.log(`${prefix}: ${result.planId}/${result.viewport}`);
    for (const blocker of result.blockers) console.log(`  - ${blocker}`);
  }
  console.log(`brochure QA report: ${resolve(OUT_DIR, 'report.json')}`);

  if (!report.passed) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
