// POST /api/delete-plan — remove a generated plan (artifact dir + manifest
// entry). Only review-lane gen-NNN plans qualify: traced reference plans are
// not gen-*, and promoted plans are refused server-side regardless of what
// the UI shows.

import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

interface ManifestOption {
  promotionEligible?: boolean;
  reviewStatus?: string | null;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const planId = typeof body.planId === 'string' ? body.planId.trim() : '';
  if (!/^gen-\d{3}$/.test(planId)) {
    return NextResponse.json({ error: 'only generated gen-NNN plans can be deleted' }, { status: 400 });
  }

  const loopDir = path.join(process.cwd(), 'public', 'data', 'den-image-loop');
  const manifestPath = path.join(loopDir, 'proposal-manifest.json');
  let manifest: { plans?: Record<string, ManifestOption[]> };
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    return NextResponse.json({ error: 'manifest unavailable' }, { status: 500 });
  }
  const options = manifest.plans?.[planId];
  if (!options) {
    return NextResponse.json({ error: `${planId} not found` }, { status: 404 });
  }
  if (options.some((option) => option.promotionEligible === true || option.reviewStatus === 'promoted')) {
    return NextResponse.json({ error: 'promoted plans cannot be deleted' }, { status: 400 });
  }

  delete manifest.plans![planId];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await rm(path.join(loopDir, planId), { recursive: true, force: true });
  return NextResponse.json({ ok: true, planId });
}
