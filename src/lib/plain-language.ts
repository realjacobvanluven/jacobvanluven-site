/**
 * Rule-based plain-language checker. Pure functions, no network, no AI: the same text always gives the
 * same result, and every flag can be explained in one line.
 */

export type IssueKind = 'jargon' | 'passive' | 'weak' | 'acronym' | 'long';

export interface Issue {
  kind: IssueKind;
  /** Character offsets into the original text. */
  start: number;
  end: number;
  text: string;
  /** Why it was flagged. */
  message: string;
  /** A plainer option, where there is one. */
  suggestion?: string;
}

export interface Sentence {
  start: number;
  end: number;
  words: number;
  long: boolean;
}

export interface Report {
  words: number;
  sentences: Sentence[];
  issues: Issue[];
  avgSentenceLength: number;
  /** Flesch Reading Ease, 0–100+ (higher is easier). */
  readingEase: number;
  /** Flesch–Kincaid grade level. */
  grade: number;
  longSentenceLimit: number;
}

export const LONG_SENTENCE = 25;

/** Wordy or inflated phrase → plainer wording. Longest phrases first so they win over their parts. */
const REPLACEMENTS: Record<string, string> = {
  'at this point in time': 'now',
  'due to the fact that': 'because',
  'in light of the fact that': 'because',
  'for the purpose of': 'to / for',
  'in the event that': 'if',
  'with regard to': 'about',
  'with respect to': 'about',
  'in order to': 'to',
  'a number of': 'several',
  'the majority of': 'most',
  'is able to': 'can',
  'are able to': 'can',
  'has the ability to': 'can',
  'in close proximity to': 'near',
  'at the present time': 'now',
  'on a regular basis': 'regularly',
  'going forward': 'from now on',
  'circle back': 'follow up',
  'touch base': 'talk',
  'reach out': 'contact',
  'low-hanging fruit': 'easy wins',
  'move the needle': 'make a real difference',
  'deep dive': 'close look',
  'take offline': 'discuss separately',
  'value-add': 'benefit',
  'best-in-class': 'leading',
  'end-to-end': 'complete',
  'prior to': 'before',
  'subsequent to': 'after',
  'in addition to': 'besides',
  'utilization': 'use',
  'utilize': 'use',
  'utilizes': 'uses',
  'utilizing': 'using',
  'leverage': 'use',
  'leveraging': 'using',
  'facilitate': 'help',
  'facilitating': 'helping',
  'commence': 'start',
  'terminate': 'end',
  'endeavour': 'try',
  'endeavor': 'try',
  'ascertain': 'find out',
  'demonstrate': 'show',
  'implement': 'put in place',
  'optimize': 'improve',
  'streamline': 'simplify',
  'operationalize': 'put into practice',
  'actionable': 'practical',
  'robust': 'strong',
  'holistic': 'complete',
  'synergy': 'teamwork',
  'synergies': 'shared benefits',
  'paradigm': 'model',
  'ideate': 'brainstorm',
  'bandwidth': 'time',
  'learnings': 'lessons',
  'methodology': 'method',
  'functionality': 'features',
  'additional': 'more',
  'approximately': 'about',
  'sufficient': 'enough',
  'assistance': 'help',
  'purchase': 'buy',
  'requirements': 'needs',
  'regarding': 'about',
  'numerous': 'many',
  'subsequently': 'then',
  'therefore': 'so',
  'however': 'but',
};

const WEAK = ['very', 'really', 'basically', 'actually', 'just', 'quite', 'extremely', 'literally', 'simply', 'highly'];

/** Acronyms nobody needs spelled out. */
const KNOWN_ACRONYMS = new Set([
  'AM', 'PM', 'OK', 'ID', 'TV', 'PDF', 'URL', 'FAQ', 'USA', 'US', 'UK', 'CEO', 'HR', 'IT', 'AI', 'BC', 'CA', 'USD', 'CAD', 'ETA', 'ASAP',
]);

/** Irregular past participles, for passive-voice detection (regular ones end in "ed"). */
const PARTICIPLES = new Set([
  'been', 'begun', 'bought', 'built', 'brought', 'chosen', 'done', 'driven', 'eaten', 'fallen', 'felt', 'found', 'given', 'gone',
  'grown', 'held', 'hidden', 'kept', 'known', 'led', 'left', 'lost', 'made', 'met', 'paid', 'put', 'read', 'run', 'said', 'seen',
  'sent', 'set', 'shown', 'sold', 'spent', 'taken', 'taught', 'told', 'thought', 'understood', 'won', 'written', 'worn',
]);

const BE = '(?:am|is|are|was|were|be|been|being)';
const PASSIVE = new RegExp(`\\b${BE}\\s+(?:\\w+ly\\s+)?(?:not\\s+)?(\\w+)\\b`, 'gi');

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PHRASES = Object.keys(REPLACEMENTS).sort((a, b) => b.length - a.length);
const PHRASE_RE = new RegExp(`\\b(?:${PHRASES.map(escapeRe).join('|')})\\b`, 'gi');
const WEAK_RE = new RegExp(`\\b(?:${WEAK.join('|')})\\b`, 'gi');

export function countWords(text: string): number {
  return (text.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) ?? []).length;
}

/** Rough English syllable count: good enough for a readability score. */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const stripped = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = stripped.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Sentence spans with their offsets in the original text. Paragraph breaks also end a sentence. */
export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  // Abbreviations like "e.g." or "Dr." must not end a sentence.
  const abbreviation = /\b(?:e\.g|i\.e|etc|vs|Dr|Mr|Mrs|Ms|St|Inc|Ltd|No)\.$/;
  let start = 0;
  const flush = (end: number) => {
    const slice = text.slice(start, end);
    const words = countWords(slice);
    if (words > 0) out.push({ start, end, words, long: words > LONG_SENTENCE });
    start = end;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\n') {
      flush(i);
    } else if ((c === '.' || c === '!' || c === '?') && !/[.!?]/.test(text[i + 1] ?? '')) {
      const next = text[i + 1];
      const boundary = next === undefined || /\s/.test(next);
      if (boundary && !(c === '.' && abbreviation.test(text.slice(Math.max(0, i - 6), i + 1)))) flush(i + 1);
    }
  }
  flush(text.length);
  return out;
}

function addIssue(list: Issue[], issue: Issue) {
  list.push(issue);
}

export function analyze(text: string): Report {
  const issues: Issue[] = [];
  const sentences = splitSentences(text);
  const words = countWords(text);

  for (const m of text.matchAll(PHRASE_RE)) {
    const key = m[0].toLowerCase();
    const plain = REPLACEMENTS[key];
    addIssue(issues, {
      kind: 'jargon',
      start: m.index!,
      end: m.index! + m[0].length,
      text: m[0],
      message: 'Wordy or inflated: a plainer word does the same job.',
      suggestion: plain,
    });
  }

  for (const m of text.matchAll(PASSIVE)) {
    const participle = m[1].toLowerCase();
    const isParticiple = (participle.endsWith('ed') && participle.length > 3) || PARTICIPLES.has(participle);
    // "was tired", "is fixed price" are not passive; skip a few common adjective look-alikes.
    if (!isParticiple || ['need', 'speed', 'red', 'bed', 'hundred', 'sacred', 'tired', 'excited', 'interested', 'supposed'].includes(participle)) continue;
    addIssue(issues, {
      kind: 'passive',
      start: m.index!,
      end: m.index! + m[0].length,
      text: m[0],
      message: 'Passive voice hides who did it. Name the actor and lead with it.',
    });
  }

  for (const m of text.matchAll(WEAK_RE)) {
    addIssue(issues, {
      kind: 'weak',
      start: m.index!,
      end: m.index! + m[0].length,
      text: m[0],
      message: 'Filler word. Cut it, or pick a stronger word.',
    });
  }

  // Acronyms: flag the first use unless it is defined right there, e.g. "Business Continuity Planning (BCP)".
  const seen = new Set<string>();
  for (const m of text.matchAll(/\b[A-Z][A-Z0-9]{1,5}\b/g)) {
    const a = m[0];
    if (KNOWN_ACRONYMS.has(a) || seen.has(a)) continue;
    seen.add(a);
    const before = text.slice(Math.max(0, m.index! - 1), m.index!);
    const after = text.slice(m.index! + a.length, m.index! + a.length + 1);
    if (before === '(' && after === ')') continue; // the definition itself
    if (/^ \([A-Z][A-Za-z-]+(?: [A-Za-z-]+){1,6}\)/.test(text.slice(m.index! + a.length, m.index! + a.length + 80))) continue; // "BCP (Business Continuity Planning)"
    if (new RegExp(`\\(${a}\\)`).test(text) && text.indexOf(`(${a})`) < m.index!) continue; // defined earlier
    addIssue(issues, {
      kind: 'acronym',
      start: m.index!,
      end: m.index! + a.length,
      text: a,
      message: 'Acronym used without being spelled out. Write it in full on first use, then put the short form in brackets.',
    });
  }

  for (const s of sentences) {
    if (!s.long) continue;
    addIssue(issues, {
      kind: 'long',
      start: s.start,
      end: s.end,
      text: text.slice(s.start, s.end).trim(),
      message: `${s.words} words. Aim for ${LONG_SENTENCE} or fewer: split it, or cut what the reader doesn't need.`,
    });
  }

  issues.sort((a, b) => a.start - b.start || b.end - a.end);

  const syl = (text.match(/[A-Za-z][A-Za-z'’-]*/g) ?? []).reduce((n, w) => n + syllables(w), 0);
  const sentenceCount = Math.max(1, sentences.length);
  const wps = words / sentenceCount;
  const spw = words ? syl / words : 0;
  const readingEase = words ? 206.835 - 1.015 * wps - 84.6 * spw : 0;
  const grade = words ? 0.39 * wps + 11.8 * spw - 15.59 : 0;

  return {
    words,
    sentences,
    issues,
    avgSentenceLength: words ? Math.round(wps * 10) / 10 : 0,
    readingEase: Math.round(readingEase),
    grade: Math.max(0, Math.round(grade * 10) / 10),
    longSentenceLimit: LONG_SENTENCE,
  };
}

export function readingLabel(ease: number): string {
  if (ease >= 70) return 'Easy to read';
  if (ease >= 50) return 'Fairly easy: fine for most adults';
  if (ease >= 30) return 'Difficult: dense for a general reader';
  return 'Very difficult';
}
