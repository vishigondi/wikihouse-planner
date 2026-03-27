/**
 * Auto-improve loop — screenshot each plan, score with vision, fix issues.
 *
 * Uses Claude-in-Chrome to take screenshots, then scores against a checklist.
 * Outputs TSV scores for each plan so the loop can track progress.
 *
 * Run: npx tsx scripts/auto-improve.ts
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCORES_FILE = resolve(__dirname, '../scores.tsv');
const SCREENSHOTS_DIR = resolve(__dirname, '../screenshots');

interface PlanScore {
  planId: string;
  planName: string;
  sqft: number;
  wallsVisible: boolean;
  doorsVisible: boolean;
  roofCorrect: boolean;
  roomLabelsMatch: boolean;
  loftCorrect: boolean;
  overallScore: number;
  issues: string[];
}

/**
 * Score a plan by calling Claude with the screenshot.
 * Uses `claude -p --model sonnet` for vision scoring.
 */
function scorePlan(screenshotPath: string, planName: string, planInfo: string): PlanScore {
  const prompt = `You are scoring a 3D architectural render of "${planName}" (${planInfo}).

Look at this screenshot and answer each question with YES or NO, then list specific issues.

1. WALLS_VISIBLE: Are exterior walls clearly visible as solid surfaces (not just floor tiles)?
2. DOORS_VISIBLE: Can you see door openings (gaps in walls where doors should be)?
3. ROOF_CORRECT: If roof is enabled, does it look like a proper roof shape (gable/a-frame/shed)?
4. ROOM_LABELS_MATCH: Do the room labels in 3D match the floor plan below?
5. LOFT_CORRECT: If there's a loft/upper level, is it shown correctly in both 3D and plan views?

Respond EXACTLY in this format:
WALLS_VISIBLE: YES or NO
DOORS_VISIBLE: YES or NO
ROOF_CORRECT: YES or NO
ROOM_LABELS_MATCH: YES or NO
LOFT_CORRECT: YES or NO
ISSUES: comma-separated list of specific problems, or "none"`;

  try {
    const result = execFileSync('claude', ['-p', '--model', 'sonnet'], {
      input: prompt,
      encoding: 'utf-8',
      timeout: 90_000,
      maxBuffer: 2 * 1024 * 1024,
    });

    // Parse response
    const lines = result.trim().split('\n');
    const get = (key: string) => {
      const line = lines.find(l => l.startsWith(key));
      return line?.includes('YES') ?? false;
    };
    const issuesLine = lines.find(l => l.startsWith('ISSUES:'));
    const issues = issuesLine?.replace('ISSUES:', '').trim().split(',').map(s => s.trim()).filter(s => s && s !== 'none') ?? [];

    const wallsVisible = get('WALLS_VISIBLE');
    const doorsVisible = get('DOORS_VISIBLE');
    const roofCorrect = get('ROOF_CORRECT');
    const roomLabelsMatch = get('ROOM_LABELS_MATCH');
    const loftCorrect = get('LOFT_CORRECT');

    const score = [wallsVisible, doorsVisible, roofCorrect, roomLabelsMatch, loftCorrect]
      .filter(Boolean).length / 5;

    return {
      planId: planName,
      planName,
      sqft: 0,
      wallsVisible, doorsVisible, roofCorrect, roomLabelsMatch, loftCorrect,
      overallScore: score,
      issues,
    };
  } catch {
    return {
      planId: planName,
      planName,
      sqft: 0,
      wallsVisible: false, doorsVisible: false, roofCorrect: false,
      roomLabelsMatch: false, loftCorrect: false,
      overallScore: 0,
      issues: ['scoring failed'],
    };
  }
}

function writeScores(scores: PlanScore[]) {
  const header = 'plan_id\tsqft\twalls\tdoors\troof\tlabels\tloft\tscore\tissues';
  const rows = scores.map(s =>
    `${s.planId}\t${s.sqft}\t${s.wallsVisible ? 1 : 0}\t${s.doorsVisible ? 1 : 0}\t${s.roofCorrect ? 1 : 0}\t${s.roomLabelsMatch ? 1 : 0}\t${s.loftCorrect ? 1 : 0}\t${s.overallScore.toFixed(2)}\t${s.issues.join('; ')}`
  );
  writeFileSync(SCORES_FILE, [header, ...rows].join('\n') + '\n');
  console.log(`Scores written to ${SCORES_FILE}`);
}

// ── Main ────────────────────────────────────────────────────────────────────

mkdirSync(SCREENSHOTS_DIR, { recursive: true });

console.log('Auto-improve loop');
console.log('This script is designed to be called from Claude Code with chrome screenshot access.');
console.log('');
console.log('Usage from Claude Code:');
console.log('1. Navigate to http://localhost:3000/');
console.log('2. For each plan: select it, take screenshot, save to screenshots/');
console.log('3. Run scorer: claude -p --model sonnet < screenshot');
console.log('4. Fix issues found');
console.log('5. Repeat');
console.log('');
console.log('The scoring checklist:');
console.log('  - WALLS_VISIBLE: exterior walls as solid surfaces');
console.log('  - DOORS_VISIBLE: gaps in walls where doors are');
console.log('  - ROOF_CORRECT: proper roof shape');
console.log('  - ROOM_LABELS_MATCH: 3D labels match floor plan');
console.log('  - LOFT_CORRECT: upper level shown correctly');
