// Le famiglie dei caratteri di un disegno (formato della scena, testo): come
// si legge un `font-family`, quali famiglie sono di Fub, e quale faccia di un
// carattere del vault serve per un peso e uno stile.
//
// - **Come l'export.** L'export legge `font-family` con `svgtypes` e sceglie
//   le facce con `fonts.rs` di `fub-features`: questo modulo fa le stesse due
//   cose allo stesso modo, anche dove `svgtypes` sbaglia, perché la
//   superficie mostri ciò che l'export scrive. I vettori di
//   `__fixtures__/scene-fonts/choose.json` provano la scelta da tutte e due
//   le parti.
// - **Le famiglie di Fub** sono Inter, Literata e JetBrains Mono, i caratteri
//   che l'app porta. Le famiglie generiche diventano una di loro: `serif` e
//   `cursive` Literata, `sans-serif` e `fantasy` Inter, `monospace`
//   JetBrains Mono. Un carattere del vault col nome di una famiglia di Fub
//   non conta.
// - **Due nomi sono la stessa famiglia** senza badare a maiuscole e
//   minuscole, ma soltanto nell'ASCII, come nei browser e nell'export.

/// Lo stile di una faccia, come lo dicono i CSS.
export type FontStyle = "normal" | "italic" | "oblique";

/// Le famiglie generiche di `font-family`.
export type Generic = "serif" | "sans-serif" | "monospace" | "cursive" | "fantasy";

/// Un asse di un carattere variabile, nei valori del file.
export interface FaceAxis {
  readonly tag: string;
  readonly min: number;
  readonly default: number;
  readonly max: number;
}

/// Un punto su un asse.
export interface Coordinate {
  readonly tag: string;
  readonly value: number;
}

/// Uno stile che una faccia sa dare, coi punti degli assi che lo danno.
export interface FaceSlot {
  readonly style: FontStyle;
  readonly fixed: readonly Coordinate[];
}

/// Una faccia di un file di caratteri, come la descrive l'host.
export interface FaceInfo {
  /// La posizione della faccia nel file: 0, se il file non è una collezione.
  readonly index: number;
  /// Il nome della famiglia in inglese, quello del menu.
  readonly family: string;
  /// Tutti i nomi della famiglia, in ogni lingua del file.
  readonly names: readonly string[];
  readonly generic: Generic;
  /// I pesi che dà, da… a.
  readonly weight: readonly [number, number];
  /// Le larghezze che dà, in percentuale.
  readonly stretch: readonly [number, number];
  readonly styles: readonly FaceSlot[];
  /// Gli assi; nessuno per una faccia statica.
  readonly axes: readonly FaceAxis[];
}

/// Che faccia si cerca: il peso da 1 a 1000, lo stile e la larghezza in
/// percentuale.
export interface FontRequest {
  readonly weight: number;
  readonly style: FontStyle;
  readonly stretch: number;
}

/// Il tondo normale: è la faccia che dice la famiglia generica.
export const REGULAR: FontRequest = { weight: 400, style: "normal", stretch: 100 };

/// La faccia scelta: il file, la faccia nella lista del file e i punti degli
/// assi.
export interface FaceChoice {
  readonly file: number;
  readonly face: number;
  readonly coordinates: readonly Coordinate[];
}

export const SANS = "Inter";
export const SERIF = "Literata";
export const MONO = "JetBrains Mono";

/// Le famiglie di Fub, nell'ordine in cui l'export cerca un carattere che
/// manca.
export const FUB_FAMILIES: readonly string[] = [SERIF, SANS, MONO];

/// La famiglia di Fub di ogni famiglia generica.
export const GENERIC_FAMILY: Readonly<Record<Generic, string>> = {
  serif: SERIF,
  cursive: SERIF,
  "sans-serif": SANS,
  fantasy: SANS,
  monospace: MONO,
};

const GENERICS: ReadonlySet<string> = new Set(Object.keys(GENERIC_FAMILY));

/// Il file più grande che si legge: un carattere CJK con tutti i suoi glifi ci
/// sta. Gemello di `MAX_FONT_BYTES` in `fonts.rs`.
export const MAX_FONT_BYTES = 64 * 1024 * 1024;

/// Le estensioni dei caratteri del vault, quelle che l'anagrafe dei file dice
/// caratteri (`mime_of` in `fub-abi`).
const FONT_EXTENSIONS: ReadonlySet<string> = new Set(["ttf", "otf", "woff", "woff2"]);

/// Vero se il file `id` del vault è un carattere, dall'estensione.
export function isFontFile(id: string): boolean {
  const base = id.slice(id.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 && FONT_EXTENSIONS.has(asciiLower(base.slice(dot + 1)));
}

/// `text` con le sole lettere ASCII in minuscolo.
function asciiLower(text: string): string {
  return text.replace(/[A-Z]+/g, (upper) => upper.toLowerCase());
}

/// La chiave di una famiglia: due nomi con la stessa chiave sono la stessa
/// famiglia.
export function familyKey(name: string): string {
  return asciiLower(name);
}

/// Se due nomi sono la stessa famiglia.
export function sameFamily(a: string, b: string): boolean {
  return a.length === b.length && asciiLower(a) === asciiLower(b);
}

/// La famiglia di Fub che `name` nomina, scritta come la scrive Fub.
export function fubFamily(name: string): string | null {
  return FUB_FAMILIES.find((fub) => sameFamily(fub, name)) ?? null;
}

/// Se la faccia è della famiglia `name`.
export function isCalled(face: FaceInfo, name: string): boolean {
  return face.names.some((each) => sameFamily(each, name));
}

/// Se il nome della faccia è di una famiglia di Fub, che vince.
export function isReserved(face: FaceInfo): boolean {
  return FUB_FAMILIES.some((name) => isCalled(face, name));
}

// --- leggere font-family -------------------------------------------------------

/// Una famiglia di `font-family`: una generica, o un nome.
export type Family = { readonly generic: Generic } | { readonly name: string };

/// Gli spazi che `svgtypes` salta.
const isSpace = (char: string | undefined): boolean => char === " " || char === "\t" || char === "\n" || char === "\r";

/// Se `code` può cominciare un identificatore, per `svgtypes`: anche ogni
/// carattere oltre U+00ED, ma nessuno fra U+0080 e U+00ED.
const nameStart = (code: number): boolean => code === 0x5f || (code >= 0x61 && code <= 0x7a) || (code >= 0x41 && code <= 0x5a) || code > 237;

const nameChar = (code: number): boolean => nameStart(code) || (code >= 0x30 && code <= 0x39) || code === 0x2d;

/// Le famiglie di `text`, come le legge l'export (`parse_font_families` di
/// `svgtypes`): nomi fra virgolette, così come sono, o parole unite da uno
/// spazio, che sono una famiglia generica soltanto scritte in minuscolo.
/// `null` se il valore non si legge: allora l'export usa Literata.
export function parseFamilies(text: string): Family[] | null {
  let pos = 0;
  const skip = (): void => {
    while (pos < text.length && isSpace(text[pos])) pos++;
  };
  const ident = (): string | null => {
    const start = pos;
    if (text[pos] === "-") pos++;
    const first = text.codePointAt(pos);
    if (first !== undefined) {
      if (!nameStart(first)) return null;
      pos += first > 0xffff ? 2 : 1;
    }
    for (;;) {
      const code = text.codePointAt(pos);
      if (code === undefined || !nameChar(code)) break;
      pos += code > 0xffff ? 2 : 1;
    }
    return pos === start ? null : text.slice(start, pos);
  };
  const families: Family[] = [];
  while (pos < text.length) {
    skip();
    const char = text[pos];
    if (char === undefined) return null;
    if (char === "'" || char === '"') {
      let prev = char;
      pos++;
      const start = pos;
      while (pos < text.length) {
        const current = text[pos]!;
        if (current === char && prev !== "\\") break;
        prev = current;
        pos++;
      }
      if (text[pos] !== char) return null;
      families.push({ name: text.slice(start, pos) });
      pos++;
    } else {
      const words: string[] = [];
      while (pos < text.length && text[pos] !== ",") {
        const word = ident();
        if (word === null) return null;
        words.push(word);
        skip();
      }
      const joined = words.join(" ");
      families.push(GENERICS.has(joined) ? { generic: joined as Generic } : { name: joined });
    }
    if (pos < text.length) {
      if (text[pos] !== ",") break;
      pos++;
    }
  }
  skip();
  if (pos < text.length) return null;
  return families.filter((family) => !("name" in family) || family.name !== "");
}

/// Gli spazi che `str::trim` di Rust toglie: quelli di Unicode.
const RUST_TRIM = /^[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g;

/// Il nome di una famiglia senza gli spazi ai bordi, come lo cerca l'export.
export function familyName(family: { readonly name: string }): string {
  return family.name.replace(RUST_TRIM, "");
}

/// I nomi delle famiglie di `value` che non sono di Fub: quelli da cercare
/// nel vault.
export function vaultNames(value: string): string[] {
  const out: string[] = [];
  for (const family of parseFamilies(value) ?? []) {
    if ("generic" in family) continue;
    const name = familyName(family);
    if (name !== "" && fubFamily(name) === null && !out.some((each) => sameFamily(each, name))) out.push(name);
  }
  return out;
}

/// Una famiglia scritta per i CSS: fra virgolette, se non è una parola sola.
export function cssFamily(name: string): string {
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(name) ? name : `"${name.replace(/["\\]/g, "\\$&")}"`;
}

/// La famiglia `name` scritta in un `font-family` che il browser e l'export
/// rileggono uguale: com'è, se è una parola, se no fra virgolette. `null` se
/// nessuna scrittura la rilegge, come un nome con una barra, un carattere di
/// controllo o le due virgolette.
export function writtenFamily(name: string): string | null {
  if (name === "" || name !== familyName({ name }) || /[\\\u0000-\u001f\u007f]/.test(name)) return null;
  for (const written of [cssFamily(name), `"${name}"`, `'${name}'`]) {
    const read = parseFamilies(written);
    if (read !== null && read.length === 1 && "name" in read[0]! && read[0].name === name) return written;
  }
  return null;
}

/// Una stringa dei CSS che si scrive dentro un foglio di stile XML: le
/// virgolette, la barra e i caratteri che il markup legge sono sequenze di
/// escape.
export function cssString(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&").replace(/[\u0000-\u001f<>&]/g, (char) => `\\${char.charCodeAt(0).toString(16)} `)}"`;
}

/// La `font-family` da dare al browser per `value`: le famiglie che l'export
/// userebbe, nello stesso ordine, e dopo quelle di Fub, come l'export cerca
/// un carattere che manca. Una famiglia generica è quella di Fub che le
/// corrisponde; una del vault è il nome che `vault` dà, `null` se non c'è o
/// non si può usare; ogni altra si salta. Così il browser non usa mai un
/// carattere del sistema.
export function liveFamily(value: string, vault: (name: string) => string | null = () => null): string {
  const out: string[] = [];
  const add = (name: string): void => {
    if (!out.includes(name)) out.push(name);
  };
  for (const family of parseFamilies(value) ?? []) {
    if ("generic" in family) {
      add(GENERIC_FAMILY[family.generic]);
      continue;
    }
    const name = familyName(family);
    const fub = fubFamily(name);
    if (fub !== null) {
      add(fub);
      continue;
    }
    const live = name === "" ? null : vault(name);
    if (live !== null) add(live);
  }
  for (const fub of FUB_FAMILIES) add(fub);
  return out.map(cssFamily).join(", ");
}

/// La famiglia con cui si vede un testo di `value`: la prima della sua
/// famiglia viva, una del vault col nome scritto. `vault` dà il nome di una
/// famiglia del vault che si vede, `null` se no; senza, è la prima famiglia
/// di Fub, quella che un testo trova se le famiglie del vault prima di lei
/// non ci sono.
export function shownFamily(value: string, vault: (name: string) => string | null = () => null): string {
  for (const family of parseFamilies(value) ?? []) {
    if ("generic" in family) return GENERIC_FAMILY[family.generic];
    const name = familyName(family);
    const fub = fubFamily(name);
    if (fub !== null) return fub;
    const shown = name === "" ? null : vault(name);
    if (shown !== null) return shown;
  }
  return FUB_FAMILIES[0]!;
}

/// Le famiglie vive già date dalle sole famiglie di Fub.
const fubLive = new Map<string, string>();

/// La famiglia viva di `value` con le sole famiglie di Fub, dove un disegno
/// non ha caratteri del vault: la stessa per ogni superficie, e si ricorda.
export function fubLiveFamily(value: string): string {
  let live = fubLive.get(value);
  if (live === undefined) {
    if (fubLive.size >= 256) fubLive.clear();
    live = liveFamily(value);
    fubLive.set(value, live);
  }
  return live;
}

// --- scegliere una faccia -------------------------------------------------------

/// Una faccia possibile: una faccia con uno dei suoi stili.
interface Candidate {
  readonly file: number;
  readonly face: number;
  readonly item: FaceInfo;
  readonly slot: FaceSlot;
}

type Key = readonly [rank: number, distance: number];

/// Tiene i candidati con la chiave più piccola, nell'ordine in cui erano.
function keepBest(candidates: Candidate[], key: (each: Candidate) => Key): Candidate[] {
  if (candidates.length === 0) return candidates;
  const keys = candidates.map(key);
  let best = keys[0]!;
  for (const each of keys) if (compareKeys(each, best) < 0) best = each;
  return candidates.filter((_, i) => compareKeys(keys[i]!, best) === 0);
}

function compareKeys(a: Key, b: Key): number {
  return a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
}

/// Quanto un intervallo di larghezze è lontano da quella chiesta: fino al 100%
/// prima le più strette, dalla più vicina, poi le più larghe; oltre, il
/// contrario.
function stretchKey([low, high]: readonly [number, number], wanted: number): Key {
  if (low <= wanted && wanted <= high) return [0, 0];
  if (wanted <= 100) return high < wanted ? [1, wanted - high] : [2, low - wanted];
  return low > wanted ? [1, low - wanted] : [2, wanted - high];
}

/// Quanto uno stile è lontano da quello chiesto: il corsivo cerca il corsivo,
/// poi l'obliquo, poi il tondo; il tondo il tondo, poi l'obliquo, poi il
/// corsivo; l'obliquo l'obliquo, poi il corsivo, poi il tondo.
function styleRank(style: FontStyle, wanted: FontStyle): number {
  const order: readonly FontStyle[] =
    wanted === "italic" ? ["italic", "oblique", "normal"] : wanted === "normal" ? ["normal", "oblique", "italic"] : ["oblique", "italic", "normal"];
  const at = order.indexOf(style);
  return at < 0 ? 3 : at;
}

/// Quanto un intervallo di pesi è lontano da quello chiesto: fra 400 e 500
/// prima i più neri fino a 500, poi i più chiari, poi i più neri oltre 500;
/// sotto 400 prima i più chiari; sopra 500 prima i più neri.
function weightKey([low, high]: readonly [number, number], wanted: number): Key {
  if (low <= wanted && wanted <= high) return [0, 0];
  if (wanted >= 400 && wanted <= 500) {
    if (low > wanted && low <= 500) return [1, low - wanted];
    if (high < wanted) return [2, wanted - high];
    return [3, low - wanted];
  }
  if (wanted < 400) return high < wanted ? [1, wanted - high] : [2, low - wanted];
  return low > wanted ? [1, low - wanted] : [2, wanted - high];
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/// Sceglie fra le facce di `files`, nell'ordine dato, quella della famiglia
/// `family` che i CSS sceglierebbero per `request` (CSS Fonts 4, §5.2): prima
/// la larghezza, poi lo stile, poi il peso, con un carattere variabile che
/// vale per tutto l'intervallo dei suoi assi. A pari merito vince una faccia
/// statica, poi l'ordine dei file e delle facce. Le famiglie di Fub non si
/// scelgono qui. `null` se la famiglia non c'è.
export function choose(files: readonly (readonly FaceInfo[])[], family: string, request: FontRequest): FaceChoice | null {
  let candidates: Candidate[] = [];
  files.forEach((faces, file) => {
    faces.forEach((item, face) => {
      if (!isCalled(item, family) || isReserved(item)) return;
      for (const slot of item.styles) candidates.push({ file, face, item, slot });
    });
  });
  candidates = keepBest(candidates, (each) => stretchKey(each.item.stretch, request.stretch));
  candidates = keepBest(candidates, (each) => [styleRank(each.slot.style, request.style), 0]);
  candidates = keepBest(candidates, (each) => weightKey(each.item.weight, request.weight));
  const best = candidates.find((each) => each.item.axes.length === 0) ?? candidates[0];
  if (best === undefined) return null;
  const coordinates: Coordinate[] = [];
  for (const axis of best.item.axes) {
    const value =
      axis.tag === "wght" ? clamp(request.weight, axis.min, axis.max)
      : axis.tag === "wdth" ? clamp(request.stretch, axis.min, axis.max)
      : best.slot.fixed.find((each) => each.tag === axis.tag)?.value;
    if (value !== undefined) coordinates.push({ tag: axis.tag, value });
  }
  return { file: best.file, face: best.face, coordinates };
}

/// La famiglia generica di una famiglia del vault: quella del suo tondo
/// normale, o della faccia che lo sostituisce. È quella che un disegno scrive
/// dopo la famiglia.
export function familyGeneric(files: readonly (readonly FaceInfo[])[], family: string): Generic | null {
  const choice = choose(files, family, REGULAR);
  return choice === null ? null : files[choice.file]![choice.face]!.generic;
}
