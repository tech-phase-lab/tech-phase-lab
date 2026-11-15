// Katakana / hiragana company names matched against English issuer names (owner, Nov 15: 「アービュータス」 must find ABUS).
// The kana is read as Hepburn-like romaji, both sides are reduced to a loose spelling (l=r, v=b, c=k, th=s, no doubled letters, no
// epenthetic vowels such as the final "u" of ス), and a company matches when the consonant outline of the first word(s) of its name is the
// same and the remaining spelling differs by only a few letters. The outline is a hash key, so a query costs one lookup over the directory.

const digraphs: Record<string, string> = {
  キャ: "kya", キュ: "kyu", キョ: "kyo", シャ: "sha", シュ: "shu", シェ: "she", ショ: "sho", チャ: "cha", チュ: "chu", チェ: "che", チョ: "cho",
  ニャ: "nya", ニュ: "nyu", ニョ: "nyo", ヒャ: "hya", ヒュ: "hyu", ヒョ: "hyo", ミャ: "mya", ミュ: "myu", ミョ: "myo", リャ: "rya", リュ: "ryu",
  リョ: "ryo", ギャ: "gya", ギュ: "gyu", ギョ: "gyo", ジャ: "ja", ジュ: "ju", ジェ: "je", ジョ: "jo", ビャ: "bya", ビュ: "byu", ビョ: "byo",
  ピャ: "pya", ピュ: "pyu", ピョ: "pyo", ティ: "ti", ディ: "di", テュ: "tyu", デュ: "dyu", トゥ: "tu", ドゥ: "du", ファ: "fa", フィ: "fi",
  フェ: "fe", フォ: "fo", フュ: "fyu", ウィ: "wi", ウェ: "we", ウォ: "wo", ヴァ: "va", ヴィ: "vi", ヴェ: "ve", ヴォ: "vo", ヴュ: "vyu",
  クァ: "kwa", クィ: "kwi", クェ: "kwe", クォ: "kwo", グァ: "gwa", ツァ: "tsa", ツィ: "tsi", ツェ: "tse", ツォ: "tso", イェ: "ye", スィ: "si", ズィ: "zi",
};
const monographs: Record<string, string> = {
  ア: "a", イ: "i", ウ: "u", エ: "e", オ: "o", カ: "ka", キ: "ki", ク: "ku", ケ: "ke", コ: "ko", ガ: "ga", ギ: "gi", グ: "gu", ゲ: "ge", ゴ: "go",
  サ: "sa", シ: "shi", ス: "su", セ: "se", ソ: "so", ザ: "za", ジ: "ji", ズ: "zu", ゼ: "ze", ゾ: "zo", タ: "ta", チ: "chi", ツ: "tsu", テ: "te",
  ト: "to", ダ: "da", ヂ: "ji", ヅ: "zu", デ: "de", ド: "do", ナ: "na", ニ: "ni", ヌ: "nu", ネ: "ne", ノ: "no", ハ: "ha", ヒ: "hi", フ: "fu",
  ヘ: "he", ホ: "ho", バ: "ba", ビ: "bi", ブ: "bu", ベ: "be", ボ: "bo", パ: "pa", ピ: "pi", プ: "pu", ペ: "pe", ポ: "po", マ: "ma", ミ: "mi",
  ム: "mu", メ: "me", モ: "mo", ヤ: "ya", ユ: "yu", ヨ: "yo", ラ: "ra", リ: "ri", ル: "ru", レ: "re", ロ: "ro", ワ: "wa", ヮ: "wa", ヰ: "i",
  ヱ: "e", ヲ: "o", ン: "n", ヴ: "vu", ァ: "a", ィ: "i", ゥ: "u", ェ: "e", ォ: "o", ャ: "ya", ュ: "yu", ョ: "yo", ヵ: "ka", ヶ: "ke",
  // The small ッ only doubles the next consonant and ー only lengthens a vowel; doubled letters are merged below, so both are dropped.
  ッ: "", ー: "",
};

/** Katakana (after hiragana and half-width forms are folded to it) to Hepburn-like romaji; null when the text is not all kana. */
export function kanaToRomaji(value: string): string | null {
  const kana = value.normalize("NFKC").replace(/[ぁ-ゖ]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60)).replace(/[\s・･＝=-]/g, "");
  if (!kana || !/^[ァ-ヶー]+$/.test(kana)) return null;
  let out = "";
  for (let i = 0; i < kana.length; i++) {
    const pair = digraphs[kana.slice(i, i + 2)];
    if (pair !== undefined) { out += pair; i++; continue; }
    out += monographs[kana[i]] ?? "";
  }
  return out;
}

/** Number of kana letters that carry sound (ー and ッ do not), used to ignore very short inputs. */
export const kanaLength = (value: string) => [...value.normalize("NFKC").replace(/[^ぁ-ゖァ-ヺ]/g, "")].filter(ch => !/[ッっ]/.test(ch)).length;

const vowels = /[aeiou]/g;
function loosen(text: string) {
  return text.replace(/sh/g, "s").replace(/ch/g, "c").replace(/ts/g, "s").replace(/l/g, "r").replace(/v/g, "b").replace(/z/g, "s").replace(/j/g, "s")
    .replace(/([^aeiou])h/g, "$1").replace(/(.)\1+/g, "$1");
}
/** The loose spelling of romaji read from kana: palatal y and the vowels added after a final or clustered consonant are removed. */
export function looseKana(romaji: string) {
  // The epenthetic vowels go first, so the "u" of ビュ (byu) is kept while the "u" of ブ before a consonant is not.
  return loosen(romaji.replace(/(sh|ch|ts|[bkgsfmpzj])u(?=[^aeiouy]|$)/g, "$1").replace(/([td])o(?=[^aeiouy]|$)/g, "$1")
    .replace(/([^aeiouy])y(?=[aeiou])/g, "$1"));
}
/** The loose spelling of an English word: ph=f, th=s, ck=k, soft c=s, x=ks, y=i, and an r after a vowel is silent before a consonant or at the end. */
export function looseEnglish(word: string) {
  return loosen(word.toLowerCase().replace(/[^a-z]/g, "").replace(/ph/g, "f").replace(/th/g, "s").replace(/ck/g, "k").replace(/qu/g, "ku").replace(/q/g, "k")
    .replace(/x/g, "ks").replace(/c(?=[eiy])/g, "s").replace(/c(?!h)/g, "k").replace(/(?!^)y|y(?![aeiou])/g, "i")
    .replace(/([aeiou])r+(?=[^aeiou]|$)/g, "$1"));
}
export const skeleton = (loose: string) => loose.replace(vowels, "");

function editDistance(a: string, b: string, limit: number) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, current[j]);
    }
    if (best > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

// Legal forms and descriptors that a Japanese name usually leaves out.
const dropWords = new Set(["inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited", "llc", "lp", "plc", "sa", "nv", "ag", "se",
  "the", "and", "holdings", "holding", "group", "biopharma", "de", "md", "nj", "ny", "ca"]);
/** The ways a Japanese reader may write a company: its first word, first two or first three words joined. */
export function nameKeys(name: string): string[] {
  const words = name.toLowerCase().replace(/\/.*$/, "").replace(/&/g, " and ").split(/[^a-z0-9]+/).filter(word => word && !dropWords.has(word));
  const keys = new Set<string>();
  for (let n = 1; n <= Math.min(3, words.length); n++) {
    if (words.slice(0, n).some(word => /\d/.test(word))) break;
    keys.add(looseEnglish(words.slice(0, n).join("")));
  }
  return [...keys].filter(key => skeleton(key).length >= 2);
}

type FuzzyIndex = Map<string, { position: number; key: string }[]>;
// The directory is parsed afresh on each request, so the index is kept by the content of the list (names and tickers), not by the array.
let cachedIndex: { signature: string; index: FuzzyIndex } | null = null;
function signatureOf(entries: { name: string; ticker?: string }[]) {
  let hash = 2166136261;
  for (const entry of entries) {
    const text = `${entry.ticker ?? ""}\u0000${entry.name}\u0001`;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  }
  return `${entries.length}:${hash >>> 0}`;
}
function indexOf(entries: { name: string; ticker?: string }[]): FuzzyIndex {
  const signature = signatureOf(entries);
  if (cachedIndex?.signature === signature) return cachedIndex.index;
  const index: FuzzyIndex = new Map();
  entries.forEach((entry, position) => {
    for (const key of nameKeys(entry.name)) {
      const outline = skeleton(key);
      const bucket = index.get(outline);
      if (bucket) bucket.push({ position, key }); else index.set(outline, [{ position, key }]);
    }
  });
  cachedIndex = { signature, index };
  return index;
}

/** Entries whose English name sounds like the kana query, with the number of letters that differ (smaller is closer). At least three kana. */
export function kanaNameMatches<T extends { name: string; ticker?: string }>(entries: T[], query: string): Map<T, number> {
  const found = new Map<T, number>();
  const romaji = kanaToRomaji(query);
  if (!romaji || kanaLength(query) < 3) return found;
  const loose = looseKana(romaji), outline = skeleton(loose);
  if (outline.length < 2) return found;
  // Two consonants (SoFi) allow one differing letter; longer names about one in three.
  const limit = outline.length <= 2 ? 1 : Math.max(1, Math.floor(loose.length / 3));
  for (const { position, key } of indexOf(entries).get(outline) ?? []) {
    const entry = entries[position], distance = editDistance(loose, key, limit);
    if (distance <= limit && distance < (found.get(entry) ?? Infinity)) found.set(entry, distance);
  }
  return found;
}
