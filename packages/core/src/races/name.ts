/**
 * Display names for FEC candidate-master names (`CAND_NAME`).
 *
 * The FEC files "LAST, FIRST MIDDLE SUFFIX" in upper case, with whatever extras the filer
 * typed: honorifics ("MR.", "THE HON"), ranks, credentials, nicknames in quotes or
 * parentheses, even phone numbers. `formatFecName` returns the name in reading order and
 * mixed case. It never invents a word; the as-filed string is always kept next to the
 * result by the capability, and every rule below is deterministic (DECISIONS A72).
 *
 * - Split at the first comma: surname part, then the given-names part. With no comma the
 *   name cannot be ordered, so it is only re-cased.
 * - Courtesy honorifics (MR, MRS, MS, MISS, MX, HON, THE HON) are dropped. Earned or
 *   ceremonial titles and ranks (DR, REV, PROF, COLONEL, ...) move in front of the name.
 * - Generational suffixes (JR, SR, II, III, IV, ESQ), credentials (MD, PHD, FACS, ...) and
 *   service qualifiers (USN, RET, ...) follow the name, in the order filed. A bare "V"
 *   stays a middle initial: it cannot be told from a fifth-generation suffix.
 * - "Mc" is always capitalized (McBride). "Mac" only for a short list of unambiguous names
 *   (MacDonald, but Machado and Mace stay as spelled). O'/D'/L' prefixes and each part of
 *   a hyphenated name are capitalized.
 * - A lone middle initial gets a period; "J.D." style initialisms stay upper case.
 * - Nicknames in quotes or parentheses are kept and re-cased; vowel-less ones ("DMB")
 *   stay upper case. Runs of 7 or more digits (phone numbers) are removed.
 */

const DROPPED_HONORIFICS = new Set(['MR', 'MRS', 'MS', 'MISS', 'MX', 'HON', 'HONORABLE']);

/** Titles shown before the name. */
const TITLES: Record<string, string> = {
  DR: 'Dr.',
  REV: 'Rev.',
  REVEREND: 'Reverend',
  PROF: 'Prof.',
  PROFESSOR: 'Professor',
  COLONEL: 'Colonel',
  COL: 'Col.',
  COMMANDER: 'Commander',
  CDR: 'Cdr.',
  CMDR: 'Cmdr.',
  CAPTAIN: 'Captain',
  CAPT: 'Capt.',
  LTC: 'LTC',
  SGT: 'Sgt.',
  SERGEANT: 'Sergeant',
  JUDGE: 'Judge',
  PASTOR: 'Pastor',
};

/** Shown after the name, in the order filed. */
const SUFFIXES: Record<string, string> = {
  JR: 'Jr.',
  SR: 'Sr.',
  II: 'II',
  III: 'III',
  IV: 'IV',
  ESQ: 'Esq.',
  MD: 'MD',
  JD: 'JD',
  PHD: 'PhD',
  DDS: 'DDS',
  DVM: 'DVM',
  CPA: 'CPA',
  MBA: 'MBA',
  RN: 'RN',
  FACS: 'FACS',
  USN: 'USN',
  USA: 'USA',
  USMC: 'USMC',
  USAF: 'USAF',
  USAR: 'USAR',
  USCG: 'USCG',
  RET: '(Ret.)',
};

/** Unambiguous "Mac" surnames. Every other MAC... surname is just capitalized. */
const MAC_SURNAMES = new Set([
  'MACARTHUR',
  'MACDONALD',
  'MACDOUGALL',
  'MACGREGOR',
  'MACINTYRE',
  'MACKENZIE',
  'MACLEAN',
  'MACLEOD',
  'MACMILLAN',
  'MACNEIL',
  'MACPHERSON',
  'MACQUARRIE',
]);

const OPENERS = /^["'(“‘[]/u;

const letters = (token: string) => token.replace(/[^\p{L}]/gu, '');
const upperKey = (token: string) => letters(token).toUpperCase();

/** "J.D.", "V.C." style initialisms. */
const isInitialism = (token: string) => /^(?:\p{L}\.){2,}\p{L}?\.?$/u.test(token);

function upperAt(text: string, index: number): string {
  return text.slice(0, index) + text.charAt(index).toUpperCase() + text.slice(index + 1);
}

function capitalizeWord(word: string): string {
  const lower = word.toLowerCase();
  const first = lower.search(/\p{L}/u);
  if (first < 0) return word;
  let out = upperAt(lower, first);
  // Mc + at least two more letters: McBride. Mac only for the unambiguous list.
  if (/^mc\p{L}{2,}/u.test(lower.slice(first))) out = upperAt(out, first + 2);
  else if (MAC_SURNAMES.has(upperKey(word))) out = upperAt(out, first + 3);
  // O'Brien, D'Angelo, L'Heureux, De'Angelo: the letter after an apostrophe inside a word.
  return out.replace(
    /(\p{L})(['’])(\p{L}{2,})/gu,
    (_m, a: string, q: string, b: string) => `${a}${q}${b.charAt(0).toUpperCase()}${b.slice(1)}`,
  );
}

/** Re-cases one whitespace-delimited token; hyphenated parts are cased separately. */
function caseToken(token: string): string {
  if (isInitialism(token)) return token.toUpperCase();
  const key = upperKey(token);
  // A nickname without a vowel is an initialism ("(DMB)"), not a word.
  if (OPENERS.test(token) && key !== '' && !/[AEIOUY]/.test(key)) return token.toUpperCase();
  return token.split('-').map(capitalizeWord).join('-');
}

interface Collected {
  titles: string[];
  suffixes: string[];
}

/** Takes titles and suffixes out of one name part; returns the remaining words. */
function sift(tokens: string[], into: Collected, isSurname: boolean): string[] {
  const kept: string[] = [];
  tokens.forEach((token, i) => {
    const key = upperKey(token);
    const nextKey = upperKey(tokens[i + 1] ?? '');
    if (key === 'THE' && DROPPED_HONORIFICS.has(nextKey)) return;
    if (DROPPED_HONORIFICS.has(key)) return;
    const title = TITLES[key];
    if (title && !isSurname) {
      into.titles.push(title);
      return;
    }
    const suffix = SUFFIXES[key];
    // A suffix inside a surname part must follow a real word ("WHALEN III").
    const wholeWord = !OPENERS.test(token) || key === 'RET';
    if (suffix && wholeWord && (!isSurname || kept.length > 0)) {
      into.suffixes.push(suffix);
      return;
    }
    kept.push(token);
  });
  return kept;
}

/** Cases words and gives a lone initial its period ("Stephen A. Womack"). */
function render(tokens: string[]): string[] {
  return tokens.map((token) => {
    const cased = caseToken(token);
    return /^\p{L}$/u.test(token) ? `${cased}.` : cased;
  });
}

const words = (text: string) => text.split(/[\s,]+/u).filter((t) => t !== '');

export function formatFecName(asFiled: string): string {
  const cleaned = asFiled
    .replace(/\b\d{7,}\b/g, ' ') // phone numbers typed into the name
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned === '') return '';
  const into: Collected = { titles: [], suffixes: [] };
  const comma = cleaned.indexOf(',');
  if (comma < 0) {
    const kept = sift(words(cleaned), into, false);
    return [...into.titles, ...render(kept), ...into.suffixes].join(' ');
  }
  const surname = sift(words(cleaned.slice(0, comma)), into, true);
  const given = sift(words(cleaned.slice(comma + 1)), into, false);
  return [...into.titles, ...render(given), ...render(surname), ...into.suffixes].join(' ');
}
