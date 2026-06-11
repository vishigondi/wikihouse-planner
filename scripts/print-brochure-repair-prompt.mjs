#!/usr/bin/env node
/**
 * Print one scoped GPT repair prompt from a brochure QA packet.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function usage() {
  console.error([
    'usage:',
    '  node scripts/print-brochure-repair-prompt.mjs --packet artifacts/brochure-qa/a-frame-bunk-brochure-repair-packet.json --layer walls',
    '',
    'options:',
    '  --packet <path>   brochure_repair_packet_v1 JSON from npm run qa:brochure',
    '  --layer <name>    repair layer from packet.prompts[].layer',
    '  --out <path>      write prompt to a file instead of stdout',
  ].join('\n'));
  process.exit(2);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--packet') args.packet = argv[++index];
    else if (arg === '--layer') args.layer = argv[++index];
    else if (arg === '--out') args.out = argv[++index];
    else usage();
  }
  if (!args.packet || !args.layer) usage();
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const packetPath = resolve(args.packet);
  const packet = JSON.parse(await readFile(packetPath, 'utf8'));
  if (packet.artifactVersion !== 'brochure_repair_packet_v1') throw new Error(`Unsupported packet version: ${packet.artifactVersion}`);
  const prompt = packet.prompts?.find((item) => item.layer === args.layer);
  if (!prompt) {
    const layers = (packet.prompts ?? []).map((item) => item.layer).join(', ');
    throw new Error(`Layer "${args.layer}" was not found. Available layers: ${layers}`);
  }
  if (args.out) {
    const outputPath = resolve(args.out);
    await writeFile(outputPath, `${prompt.prompt}\n`);
    console.log(outputPath);
  } else {
    process.stdout.write(`${prompt.prompt}\n`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
