// POST /api/generate-plan — one-click brief -> validated plan artifact.
//
// Pipeline: parseBrief -> generation intent (OpenAI structured output, or the
// deterministic mock template when no key / mock:true) -> compileIntent
// (deterministic geometry) -> structural validation -> write artifact +
// manifest entry into the review lane. Failed generations are saved to
// artifacts/generation-failures/ for review, never retried blindly.
//
// Budget: at most 5 live OpenAI calls (artifacts/generation-calls.json).

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { parseBrief } from '@/lib/brief';
import { compileIntent, mockIntentFromBrief, type GenerationIntent } from '@/lib/generate/compile-plan';

const LIVE_CALL_BUDGET = 5;

const INTENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'footprint', 'roof', 'rooms', 'doors', 'windows', 'openings'],
  properties: {
    name: { type: 'string' },
    footprint: {
      type: 'object', additionalProperties: false, required: ['widthFt', 'depthFt'],
      properties: { widthFt: { type: 'number' }, depthFt: { type: 'number' } },
    },
    roof: {
      type: 'object', additionalProperties: false, required: ['style', 'ridgeAxis', 'ridgeHeightFt', 'eaveHeightFt'],
      properties: {
        style: { type: 'string', enum: ['a-frame', 'gable'] },
        ridgeAxis: { type: 'string', enum: ['x', 'z'] },
        ridgeHeightFt: { type: 'number' },
        eaveHeightFt: { type: 'number' },
      },
    },
    rooms: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'label', 'type', 'x', 'z', 'w', 'd'],
        properties: {
          id: { type: 'string' }, label: { type: 'string' }, type: { type: 'string' },
          x: { type: 'number' }, z: { type: 'number' }, w: { type: 'number' }, d: { type: 'number' },
        },
      },
    },
    doors: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'fromRoomId', 'toRoomId', 'openingType', 'span'],
        properties: {
          id: { type: 'string' }, fromRoomId: { type: 'string' }, toRoomId: { type: 'string' },
          openingType: { type: 'string', enum: ['exteriorDoor', 'interiorDoor', 'slidingDoor', 'bifoldDoor'] },
          span: { $ref: '#/$defs/span' },
        },
      },
    },
    windows: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'roomId', 'span'],
        properties: { id: { type: 'string' }, roomId: { type: 'string' }, span: { $ref: '#/$defs/span' } },
      },
    },
    openings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'fromRoomId', 'toRoomId', 'span'],
        properties: { id: { type: 'string' }, fromRoomId: { type: 'string' }, toRoomId: { type: 'string' }, span: { $ref: '#/$defs/span' } },
      },
    },
  },
  $defs: {
    span: {
      type: 'object', additionalProperties: false, required: ['x1', 'z1', 'x2', 'z2'],
      properties: { x1: { type: 'number' }, z1: { type: 'number' }, x2: { type: 'number' }, z2: { type: 'number' } },
    },
  },
};

function generationPromptFor(brief: string, parsed: ReturnType<typeof parseBrief>): string {
  return [
    'Design a single-story floor plan as JSON intent. Hard rules:',
    '- All coordinates in FEET; origin top-left; x across width, z across depth.',
    '- Room rectangles MUST align to the 4 ft structural grid (x, z, w, d all multiples of 4).',
    '- Rooms must tile inside the footprint without overlapping. Include a hall if bedrooms need separation.',
    '- Habitable rooms need >= 70 sq ft and >= 7 ft in each dimension.',
    '- EVERY bedroom needs at least one window on an exterior wall (span lying exactly on the footprint edge).',
    '- Exactly one exteriorDoor from "exterior" into a living/entry space, span on the footprint edge.',
    '- Interior door spans must lie exactly on the shared edge between their two rooms.',
    '- For a-frame roofs keep baths/kitchens away from the low side edges (ceiling slopes from a center ridge).',
    '- Rooms are numbered 1..N in the order listed; any companion image must use the same callout numbers.',
    '',
    `Brief: ${brief}`,
    `Parsed program: ${JSON.stringify({ bedrooms: parsed.bedrooms, baths: parsed.baths, maxSqft: parsed.maxSqft, roofStyle: parsed.roofStyle, lot: parsed.lot })}`,
  ].join('\n');
}

async function liveIntent(brief: string, parsed: ReturnType<typeof parseBrief>, apiKey: string, model: string): Promise<GenerationIntent> {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      input: [
        { role: 'system', content: 'You are a residential floor plan generator that outputs only valid JSON intent.' },
        { role: 'user', content: generationPromptFor(brief, parsed) },
      ],
      text: { format: { type: 'json_schema', name: 'generation_intent', schema: INTENT_SCHEMA, strict: true } },
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 400)}`);
  }
  const body = await response.json();
  const text = body.output_text
    ?? body.output?.flatMap((item: { content?: Array<{ text?: string }> }) => item.content ?? [])
      .map((chunk: { text?: string }) => chunk.text ?? '')
      .join('');
  if (!text) throw new Error('OpenAI response contained no output text');
  const intent = JSON.parse(text) as GenerationIntent;
  intent.lot = parsed.lot ?? null;
  return intent;
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export async function GET() {
  return NextResponse.json({ hasKey: Boolean(process.env.OPENAI_API_KEY) });
}

export async function POST(request: Request) {
  const root = process.cwd();
  const body = await request.json().catch(() => ({}));
  const brief = typeof body.brief === 'string' ? body.brief.trim() : '';
  if (!brief) return NextResponse.json({ error: 'brief is required' }, { status: 400 });
  const parsed = parseBrief(brief);
  const apiKey = process.env.OPENAI_API_KEY;
  const useMock = body.mock === true || !apiKey;

  // Unique plan id in the image-loop dir.
  const loopDir = path.join(root, 'public', 'data', 'den-image-loop');
  const manifestPath = path.join(loopDir, 'proposal-manifest.json');
  const manifest = await readJsonFile<{ plans: Record<string, unknown[]> }>(manifestPath, { plans: {} });
  let serial = 1;
  while (manifest.plans[`gen-${String(serial).padStart(3, '0')}`]) serial += 1;
  const planId = `gen-${String(serial).padStart(3, '0')}`;

  let intent: GenerationIntent;
  if (useMock) {
    intent = mockIntentFromBrief(parsed);
  } else {
    const callsPath = path.join(root, 'artifacts', 'generation-calls.json');
    const calls = await readJsonFile<{ count: number }>(callsPath, { count: 0 });
    if (calls.count >= LIVE_CALL_BUDGET) {
      return NextResponse.json({ error: `live generation budget exhausted (${LIVE_CALL_BUDGET} calls)` }, { status: 429 });
    }
    await mkdir(path.dirname(callsPath), { recursive: true });
    await writeFile(callsPath, JSON.stringify({ count: calls.count + 1 }, null, 2));
    const model = process.env.OPENAI_REPAIR_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-4o-2024-08-06';
    try {
      intent = await liveIntent(brief, parsed, apiKey!, model);
    } catch (error) {
      return NextResponse.json({ error: `generation call failed: ${(error as Error).message}` }, { status: 502 });
    }
  }

  // Loft intent is honored on both paths; the compiler builds one only if the
  // roof gives headroom (otherwise it degrades to single-level honestly).
  intent.hasLoft = parsed.hasLoft;
  const compiled = compileIntent(intent, planId, brief);
  if (!compiled.ok || !compiled.artifact) {
    const failureDir = path.join(root, 'artifacts', 'generation-failures');
    await mkdir(failureDir, { recursive: true });
    const failurePath = path.join(failureDir, `${planId}-${Date.now()}.json`);
    await writeFile(failurePath, JSON.stringify({ brief, parsed, intent, errors: compiled.errors }, null, 2));
    return NextResponse.json({ error: 'generated intent failed validation', errors: compiled.errors, saved: failurePath }, { status: 422 });
  }

  const pairedDir = path.join(loopDir, planId, 'paired');
  await mkdir(pairedDir, { recursive: true });
  await writeFile(
    path.join(pairedDir, `${planId}-proposal-paired-v1.paired.json`),
    `${JSON.stringify(compiled.artifact, null, 2)}\n`,
  );
  manifest.plans[planId] = [{
    id: 'proposal-paired-v1',
    label: `paired v1 (${useMock ? 'mock' : 'generated'})`,
    hasImage: false,
    imageUrl: null,
    hasSeed: false,
    hasMatch: false,
    parserReady: false,
    promotionReady: false,
    artifactVersion: 'paired_gpt_floorplan_v1',
    sourceKind: 'constrained_json',
    gptSourceReady: false,
    pairedArtifact: true,
    latestPairedArtifact: true,
    latestGptPairedArtifact: false,
    pairedJsonUrl: `paired/${planId}-proposal-paired-v1.paired.json`,
    deterministicRenderUrl: `paired/${planId}-proposal-paired-v1.render.svg`,
    promotionEligible: false,
    legacyParserReady: false,
    archived: false,
    archiveReason: null,
    blockers: [],
    hasSemanticJson: false,
    hasSemanticSvg: false,
    reviewStatus: 'passed',
  }];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  // Store the deterministic 2D render asynchronously (Playwright capture of
  // the live renderer). The brochure packet uses this stored asset; the
  // Compare pane keeps rendering live. Fire-and-forget: generation must not
  // wait ~10s on a screenshot pipeline.
  try {
    // Never hand the renderer a Host-header-derived origin (SSRF vector):
    // only a configured internal origin or the loopback port we serve on.
    const requestUrl = new URL(request.url);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(requestUrl.hostname);
    const origin = process.env.INTERNAL_RENDER_ORIGIN
      ?? (loopback ? `http://127.0.0.1:${requestUrl.port || '3000'}` : null);
    if (origin) {
      const child = spawn(
        process.execPath,
        ['scripts/regenerate-paired-renders.mjs', '--plans', planId, '--url', origin],
        { cwd: root, detached: true, stdio: 'ignore' },
      );
      child.unref();
    }
  } catch {
    // Render backfill can be run manually via npm run render:paired.
  }

  // Surface any program reconciliation (e.g. a requested 2nd bath that didn't
  // fit) so success is honest — the brief was accommodated, not silently honored.
  return NextResponse.json({
    planId,
    mode: useMock ? 'mock' : 'live',
    url: `/?home=${planId}`,
    ...(compiled.notes?.length ? { notes: compiled.notes } : {}),
  });
}
