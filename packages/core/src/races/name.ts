/**
 * Display names for FEC candidate-master names (`CAND_NAME`).
 *
 * The FEC files "LAST, FIRST MIDDLE SUFFIX" in upper case, with whatever extras the filer
 * typed: honorifics ("MR.", "THE HON"), ranks, credentials, nicknames in quotes or
 * parentheses, even phone numbers. `formatFecName` returns the name in reading order and
 * mixed case. It never invents a word; the as-filed string is always kept next to the
 * result by the capability. Rules (DECISIONS A91), all deterministic and conservative:
 * when a name does not fit them, only the case is fixed and the order is left as filed.
 *
 * - Split at the first comma: surname part, then the given-names part. With no comma the
 *   name cannot be ordered, so it is only re-cased.
 * - In the given-names part, a run of special words at the start and a run at the end are
 *   taken out: courtesy and office words (MR, MRS, MS, MISS, HON, THE HON, REP, SEN) are
 *   dropped; titles and ranks (DR, REV, COL, LT COL, ...) go in front of the name;
 *   generational suffixes (JR, SR, II, III, IV), credentials (MD, ED.D., OD, ...) and
 *   service qualifiers (USN, RET) go after it, in the order filed; repeats are removed.
 *   If a special word sits between ordinary name words ("... REV DR TRUSTE"), the name is
 *   not reordered.
 * - Nothing is stripped from the surname part except a trailing generational suffix
 *   ("WHALEN III, JOHN"): "MISS, LUCY" keeps its surname.
 * - Mc is capitalized (McBride); Mac only for a short list (MacDonald, but Machado and Mace
 *   stay as spelled). O'/D'/L'/N'/De' prefixes and each part of a hyphenated name are
 *   capitalized; other apostrophes ("KA'AHUMANU") are not. Intercaps such as DeLauro are
 *   not recoverable from upper case and are not guessed.
 * - A lone middle initial in the given names gets a period ("Stephen A. Womack"); nothing
 *   is added in the surname. "J.D." style initialisms stay upper case.
 * - Nicknames in quotes or parentheses are kept; those of two letters or fewer, or with no
 *   vowel ("(DMB)", "'AJ'"), stay as filed. Runs of 7 or more digits (phone numbers) go.
 */

const DROPPED = new Set([
  'MR',
  'MRS',
  'MS',
  'MISS',
  'MX',
  'HON',
  'HONORABLE',
  'REP',
  'SEN',
  'REPRESENTATIVE',
  'SENATOR',
]);

/** Titles and ranks shown before the name. */
const TITLES: Record<string, string> = {
  DR: 'Dr.',
  REV: 'Rev.',
  REVEREND: 'Reverend',
  PROF: 'Prof.',
  PROFESSOR: 'Professor',
  JUDGE: 'Judge',
  PASTOR: 'Pastor',
  COLONEL: 'Colonel',
  COL: 'Col.',
  LTC: 'LTC',
  LT: 'Lt.',
  MAJ: 'Maj.',
  CAPTAIN: 'Captain',
  CAPT: 'Capt.',
  CPT: 'Cpt.',
  COMMANDER: 'Commander',
  CDR: 'Cdr.',
  CMDR: 'Cmdr.',
  CMR: 'Cmr.',
  SERGEANT: 'Sergeant',
  SGT: 'Sgt.',
  PFC: 'PFC',
  GENERAL: 'General',
  GEN: 'Gen.',
  ADM: 'Adm.',
};

/** Generational suffixes, credentials and service qualifiers, shown after the name. */
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
  EDD: 'Ed.D.',
  DDS: 'DDS',
  DVM: 'DVM',
  OD: 'OD',
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

/** Generational suffixes only (what may follow a surname: "WHALEN III"). */
const GENERATIONAL = new Set(['JR', 'SR', 'II', 'III', 'IV']);

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

/** Prefixes before an apostrophe after which the next letter is capitalized (O'Brien). */
const APOSTROPHE_PREFIXES = new Set(['O', 'D', 'L', 'N', 'DE', 'DI', 'LA', 'LE', 'DA']);

const OPENERS = /^["'(“‘[]/u;

const letters = (token: string) => token.replace(/[^\p{L}]/gu, '');

/** "J.D.", "V.C." style initialisms. */
const isInitialism = (token: string) => /^(?:\p{L}\.){2,}\p{L}?\.?$/u.test(token);

type Kind = 'dropped' | 'title' | 'suffix';
interface Special {
  kind: Kind;
  shown: string | null;
  key: string;
}

/**
 * Classifies a bare word ("DR.", "MR", "ED.D.", "(RET)") as a special word. Quoted or
 * parenthesised words are nicknames, except "(RET)".
 */
function special(token: string): Special | null {
  const retired = /^\(?RET\.?\)?,?$/iu.test(token);
  if (!retired && /[^\p{L}.,]/u.test(token)) return null;
  const key = letters(token).toUpperCase();
  if (key === '') return null;
  if (DROPPED.has(key)) return { kind: 'dropped', shown: null, key };
  const title = TITLES[key];
  if (title) return { kind: 'title', shown: title, key };
  const suffix = SUFFIXES[key];
  if (suffix) return { kind: 'suffix', shown: suffix, key };
  return null;
}

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
  else if (MAC_SURNAMES.has(letters(word).toUpperCase())) out = upperAt(out, first + 3);
  // O'Brien, D'Angelo, De'Angelo: the letter after an apostrophe, after a known prefix only.
  return out.replace(
    /(?<!\p{L})(\p{L}{1,2})(['’])(\p{L}{2,})/gu,
    (m, a: string, q: string, b: string) =>
      APOSTROPHE_PREFIXES.has(a.toUpperCase())
        ? `${a}${q}${b.charAt(0).toUpperCase()}${b.slice(1)}`
        : m,
  );
}

/** Re-cases one whitespace-delimited token; hyphenated parts are cased separately. */
function caseToken(token: string): string {
  if (isInitialism(token)) return token.toUpperCase();
  if (OPENERS.test(token)) {
    // A nickname without a vowel or of two letters or fewer is as likely an initialism.
    const key = letters(token);
    if (key.length <= 2 || !/[AEIOUY]/iu.test(key)) return token;
  }
  return token.split('-').map(capitalizeWord).join('-');
}

const words = (text: string) => text.split(/[\s,]+/u).filter((t) => t !== '');

/** Case-only fallback: the order, commas and every word stay as filed. */
function recase(text: string): string {
  return text
    .split(/\s+/u)
    .map((t) => caseToken(t))
    .join(' ');
}

const unique = (items: string[]) => [...new Set(items)];

interface Peeled {
  titles: string[];
  suffixes: string[];
  core: string[];
}

/**
 * Takes the run of special words at the start and the run at the end out of the given
 * names. Returns null when a special word is left inside the ordinary words.
 */
function peel(tokens: string[]): Peeled | null {
  const marks = tokens.map((t, i) => {
    // "THE HON": the article goes with the honorific that follows it.
    if (/^THE$/iu.test(t) && special(tokens[i + 1] ?? '')?.kind === 'dropped') {
      return { kind: 'dropped' as const, shown: null, key: 'THE' };
    }
    return special(t);
  });
  // FEC filers often put a credential first ("RAZACK, MD JD, NIZAM"), but a dotted initialism
  // at the start ("SCHOLTEN, J.D. ROBERT") is the given name, not the J.D. degree.
  if (marks[0]?.kind === 'suffix' && isInitialism(tokens[0] ?? '')) marks[0] = null;
  let from = 0;
  while (from < tokens.length && marks[from]) from++;
  let to = tokens.length;
  while (to > from && marks[to - 1]) to--;
  if (marks.slice(from, to).some((m) => m !== null)) return null;
  const run = [...marks.slice(0, from), ...marks.slice(to)];
  return {
    titles: unique(run.flatMap((m) => (m?.kind === 'title' && m.shown ? [m.shown] : []))),
    suffixes: unique(run.flatMap((m) => (m?.kind === 'suffix' && m.shown ? [m.shown] : []))),
    core: tokens.slice(from, to),
  };
}

/** One given-name word: a lone letter gets a period; "JD", "TJ" (no vowel) stay initials. */
function givenToken(token: string): string {
  if (/^\p{Lu}{2,3}$/u.test(token) && !/[AEIOUY]/u.test(token)) return token;
  const cased = caseToken(token);
  return /^\p{L}$/u.test(token) ? `${cased}.` : cased;
}

export function formatFecName(asFiled: string): string {
  const cleaned = asFiled
    .replace(/\b\d{7,}\b/g, ' ') // phone numbers typed into the name
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned === '') return '';
  const comma = cleaned.indexOf(',');

  if (comma < 0) {
    // No surname marker: only the case can be fixed.
    return recase(cleaned);
  }

  const surnameTokens = words(cleaned.slice(0, comma));
  const given = peel(words(cleaned.slice(comma + 1)));
  if (!given || surnameTokens.length === 0) return recase(cleaned);
  const givenTokens = words(cleaned.slice(comma + 1));
  if (given.core.length === 0 && givenTokens.length > 0) {
    // Nothing left of the given names ("LAM, HON", "NGUYEN, SEN", "SCHOLTEN, JD"): the word may
    // be the name, so keep the filed order and every word, and fix only the case.
    const surnameAsFiled = surnameTokens.map((t) => caseToken(t)).join(' ');
    return `${surnameAsFiled}, ${givenTokens.map(givenToken).join(' ')}`;
  }

  // A generational suffix after the surname ("WHALEN III") moves to the end; nothing else
  // is taken out of the surname.
  const surnameSuffixes: string[] = [];
  while (surnameTokens.length > 1) {
    const last = surnameTokens[surnameTokens.length - 1] ?? '';
    const s = special(last);
    if (s?.kind === 'suffix' && GENERATIONAL.has(s.key) && s.shown) {
      surnameSuffixes.unshift(s.shown);
      surnameTokens.pop();
    } else break;
  }

  const givenShown = given.core.map(givenToken);
  const surname = surnameTokens.map((t) => caseToken(t));
  return [
    ...given.titles,
    ...givenShown,
    ...surname,
    ...unique([...surnameSuffixes, ...given.suffixes]),
  ].join(' ');
}
