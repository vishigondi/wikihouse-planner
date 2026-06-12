// Deterministic natural-language brief parser.
//
// Turns a one-line brief like "2-bed A-frame, <=800 sqft, 40x60 lot, 5 ft
// side setbacks" into structured program + lot values. Pure regex
// extraction — no model call, same input always gives the same output.
// Fields the brief does not mention come back undefined; callers keep
// their existing defaults for those.
//
// Dependency-free so Node can execute it directly for offline checks.

export interface ParsedLot {
  widthFt: number;
  depthFt: number;
  setbacksFt?: { front?: number; rear?: number; left?: number; right?: number };
  maxCoverageRatio?: number;
}

export interface ParsedBrief {
  bedrooms?: number;
  baths?: number;
  maxSqft?: number;
  roofStyle?: string;
  levels?: number;
  footprintWidthFt?: number;
  footprintDepthFt?: number;
  lot?: ParsedLot;
  /** Words the parser could not interpret; surfaced so nothing is silently dropped. */
  unparsed: string[];
}

const ROOF_STYLES = ['a-frame', 'gable', 'hip', 'flat', 'shed', 'barn', 'gambrel'];

function num(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

const WORD_NUMBERS: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6' };

/**
 * "one bedroom" -> "1 bedroom" so the digit patterns match. Replacements are
 * padded to the original word length, keeping every character offset stable
 * for the consumed-range bookkeeping that feeds `unparsed`.
 */
function normalizeWordNumbers(text: string): string {
  return text.replace(/\b(one|two|three|four|five|six)\b/g, (word) => WORD_NUMBERS[word] + ' '.repeat(word.length - 1));
}

export function parseBrief(text: string): ParsedBrief {
  const brief = text.trim();
  const lower = normalizeWordNumbers(brief.toLowerCase());
  const consumed: Array<[number, number]> = [];
  const take = (match: RegExpMatchArray | null): RegExpMatchArray | null => {
    if (match?.index !== undefined) consumed.push([match.index, match.index + match[0].length]);
    return match;
  };

  const result: ParsedBrief = { unparsed: [] };

  // "2-bed", "2 bedroom", "3br", "2bd"
  const bed = take(lower.match(/(\d+)\s*[- ]?\s*(?:bed(?:room)?s?|br\b|bd\b)/));
  if (bed) result.bedrooms = num(bed[1]);

  // "1 bath", "1.5 baths", "2ba"
  const bath = take(lower.match(/(\d+(?:\.\d+)?)\s*[- ]?\s*(?:bath(?:room)?s?|ba\b)/));
  if (bath) result.baths = num(bath[1]);

  // "<=800 sqft", "under 800 sq ft", "max 800sf", "1,400 square feet"
  const sqft = take(lower.match(/(?:<=|≤|under|max(?:imum)?|up to)?\s*(\d{1,2},\d{3}|\d{3,5})\s*(?:sq\.?\s*ft|sqft|sf\b|square\s+feet)/));
  if (sqft) result.maxSqft = num(sqft[1]);

  // roof style keywords
  for (const style of ROOF_STYLES) {
    const match = take(lower.match(new RegExp(style.replace('-', '[\\s-]?'))));
    if (match) {
      result.roofStyle = style;
      break;
    }
  }

  // "2 stories", "two-story", "single level", "1 level"
  const levels = take(lower.match(/(\d+|one|two|single)\s*[- ]?\s*(?:stor(?:y|ies|ey|eys)|levels?|floors?)\b/));
  if (levels) {
    const word = levels[1];
    result.levels = word === 'one' || word === 'single' ? 1 : word === 'two' ? 2 : num(word);
  }

  // Lot: "40x60 lot", "lot 40 x 60", "40' x 60' lot"
  const lot = take(
    lower.match(/(\d{2,3})\s*['′]?\s*[x×]\s*(\d{2,3})\s*['′]?\s*(?:ft\s*)?lot/)
      ?? lower.match(/lot\s*(?:of\s*|is\s*)?(\d{2,3})\s*['′]?\s*[x×]\s*(\d{2,3})/),
  );
  if (lot) {
    const widthFt = num(lot[1]);
    const depthFt = num(lot[2]);
    if (widthFt && depthFt) result.lot = { widthFt, depthFt };
  }

  // Footprint: "24x28 footprint", "footprint 24 x 28" (distinct from lot)
  const footprint = take(
    lower.match(/(\d{2,3})\s*['′]?\s*[x×]\s*(\d{2,3})\s*['′]?\s*(?:ft\s*)?footprint/)
      ?? lower.match(/footprint\s*(?:of\s*|is\s*)?(\d{2,3})\s*['′]?\s*[x×]\s*(\d{2,3})/),
  );
  if (footprint) {
    result.footprintWidthFt = num(footprint[1]);
    result.footprintDepthFt = num(footprint[2]);
  }

  // Setbacks: "5 ft side setbacks", "setbacks: front 20, rear 5, sides 5",
  // "20 ft front setback". Uniform "5 ft setbacks" applies to all sides.
  const setbacks: NonNullable<ParsedLot['setbacksFt']> = {};
  const sidePattern = /(\d+(?:\.\d+)?)\s*(?:ft|feet|['′])?\s*(front|rear|back|side|sides)\s*setbacks?/g;
  const reversedPattern = /(front|rear|back|side|sides)\s*setbacks?\s*(?:of\s*)?(\d+(?:\.\d+)?)/g;
  for (const match of brief.toLowerCase().matchAll(sidePattern)) {
    take(match as unknown as RegExpMatchArray);
    const value = num(match[1]);
    if (value === undefined) continue;
    const side = match[2];
    if (side === 'front') setbacks.front = value;
    else if (side === 'rear' || side === 'back') setbacks.rear = value;
    else { setbacks.left = value; setbacks.right = value; }
  }
  for (const match of brief.toLowerCase().matchAll(reversedPattern)) {
    take(match as unknown as RegExpMatchArray);
    const value = num(match[2]);
    if (value === undefined) continue;
    const side = match[1];
    if (side === 'front') setbacks.front = value;
    else if (side === 'rear' || side === 'back') setbacks.rear = value;
    else { setbacks.left = value; setbacks.right = value; }
  }
  const uniform = take(lower.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|['′])?\s*setbacks?(?:\s+all\s+(?:around|sides))?/));
  if (uniform && !Object.keys(setbacks).length) {
    const value = num(uniform[1]);
    if (value !== undefined) {
      setbacks.front = value;
      setbacks.rear = value;
      setbacks.left = value;
      setbacks.right = value;
    }
  }
  if (Object.keys(setbacks).length && result.lot) result.lot.setbacksFt = setbacks;

  // "35% max coverage", "max lot coverage 35%"
  const coverage = take(lower.match(/(\d{1,2})\s*%\s*(?:max(?:imum)?\s*)?(?:lot\s*)?coverage/) ?? lower.match(/coverage\s*(?:of\s*)?(\d{1,2})\s*%/));
  if (coverage && result.lot) {
    const pct = num(coverage[1]);
    if (pct !== undefined && pct > 0 && pct <= 100) result.lot.maxCoverageRatio = pct / 100;
  }

  // Anything not consumed and not pure punctuation/fillers is surfaced.
  const segments = brief.split(/[,;]+/).map((segment) => segment.trim()).filter(Boolean);
  for (const segment of segments) {
    const start = brief.indexOf(segment);
    const end = start + segment.length;
    const covered = consumed.some(([from, to]) => from < end && to > start);
    if (!covered && !/^(with|and|on|a|an|the)$/i.test(segment)) result.unparsed.push(segment);
  }

  return result;
}

/** Render parsed values as PromptRequest field patches (only fields the brief set). */
export function briefToPromptFields(parsed: ParsedBrief): Partial<Record<'bedBath' | 'footprint' | 'levels' | 'roof' | 'constraints', string>> {
  const fields: Partial<Record<'bedBath' | 'footprint' | 'levels' | 'roof' | 'constraints', string>> = {};
  if (parsed.bedrooms !== undefined || parsed.baths !== undefined) {
    fields.bedBath = `${parsed.bedrooms ?? '?'} bed / ${parsed.baths ?? '?'} bath`;
  }
  if (parsed.footprintWidthFt && parsed.footprintDepthFt) {
    fields.footprint = `${parsed.footprintWidthFt} x ${parsed.footprintDepthFt} ft`;
  } else if (parsed.maxSqft) {
    fields.footprint = `up to ${parsed.maxSqft} sq ft total`;
  }
  if (parsed.levels !== undefined) fields.levels = String(parsed.levels);
  if (parsed.roofStyle) fields.roof = parsed.roofStyle;
  const constraints: string[] = [];
  if (parsed.maxSqft) constraints.push(`Total floor area must stay at or under ${parsed.maxSqft} sq ft.`);
  if (parsed.lot) {
    const setbacks = parsed.lot.setbacksFt;
    const setbackText = setbacks
      ? ` Setbacks ft: front ${setbacks.front ?? 0}, rear ${setbacks.rear ?? 0}, left ${setbacks.left ?? 0}, right ${setbacks.right ?? 0}.`
      : '';
    constraints.push(
      `Site is a ${parsed.lot.widthFt} x ${parsed.lot.depthFt} ft lot.${setbackText} Include this verbatim as top-level "lot" in the JSON: ${JSON.stringify(parsed.lot)}`,
    );
  }
  if (constraints.length) fields.constraints = constraints.join(' ');
  return fields;
}
