// Il correttore della scrittura, lato shell: un solo client per ogni superficie
// che scrive prosa, qualunque sia il formato.
//
// Il motore sta di là dal confine (`fub.proof`, route `query_index` custom):
// qui si legge la configurazione, si chiede il controllo di **segmenti** di
// testo già estratti e si convertono gli offset. Non sa niente di CodeMirror,
// di Markdown o di DOCX: cosa sia prosa in un documento e dove stia lo decide
// l'adattatore del formato, che consegna i segmenti e rimappa le risposte.
//
// Tre regole valgono per ogni adattatore:
//
// - il motore risponde in byte UTF-8 dentro il segmento, e qui diventano code
//   unit UTF-16, la valuta della shell;
// - ciò che non è prosa diventa `PLACEHOLDER`, un carattere solo, che il motore
//   non segna e accanto a cui non segna;
// - senza la feature (`unserved`) il client risponde `null` e l'editor resta
//   com'era: nessun segno, nessun errore.
import { PROOF_NS, type ProofPorts } from "./proof-ports";

export { PROOF_NS, type ProofPorts };
/// Il comando che aggiunge una parola al dizionario personale del vault.
export const PROOF_WORD_ADD = "proof.word.add";
/// Il segnaposto di ciò che nell'estrazione non è prosa: un wikilink, un tag,
/// il codice in linea. Lo stesso carattere che `fub.proof` riconosce.
export const PLACEHOLDER = "\uFFFC";
/// Il valore dell'impostazione della lingua che segue l'interfaccia.
export const LANGUAGE_AUTO = "auto";

/// Gli stessi limiti della route: una richiesta oltre si spezza qui invece di
/// essere rifiutata di là.
const MAX_SEGMENTS = 512;
const MAX_SEGMENT_BYTES = 64 * 1024;
const MAX_REQUEST_BYTES = 1024 * 1024;
/// Quanti segmenti già controllati ricorda la cache condivisa. Una nota lunga
/// (30 KB) ne ha qualche centinaio: 8192 coprono le note di una sessione
/// normale, e chi torna su una linguetta non rimanda niente.
const CACHE_ENTRIES = 8192;
/// Quanti code unit di testo tiene in tutto la cache: vive quanto l'app, e
/// questo tetto (circa 4 MB di stringhe nel caso peggiore, due byte per unità)
/// la tiene piccola anche con paragrafi lunghi. Un segmento più lungo del tetto
/// non si ricorda.
const CACHE_UNITS = 2 * 1024 * 1024;
/// Quante configurazioni (lingua, opzioni, parole) si ricordano insieme: una
/// per lingua di nota, più quelle lasciate indietro da «Aggiungi al
/// dizionario». Quella dimenticata porta via i suoi segmenti.
const CACHE_SCOPES = 16;

export type ProofKind = "spelling" | "grammar";

/// Un rilievo, in code unit UTF-16 dentro il segmento.
export interface ProofIssue {
  readonly start: number;
  readonly end: number;
  readonly kind: ProofKind;
  readonly message: string;
  readonly suggestions: readonly string[];
}

/// Cosa sa fare il motore nella lingua del controllo.
export interface ProofLanguage {
  readonly code: string;
  readonly spelling: boolean;
  readonly grammar: boolean;
  /// Il dizionario Hunspell che darebbe l'ortografia, quando manca.
  readonly missingDictionary: string | null;
}

export interface ProofResult {
  readonly language: ProofLanguage;
  /// Un elenco per segmento, nell'ordine della richiesta.
  readonly segments: readonly (readonly ProofIssue[])[];
}

interface Config {
  readonly language: string;
  readonly options: {
    readonly grammar: boolean;
    readonly ignore_uppercase: boolean;
    readonly ignore_numbers: boolean;
  };
  readonly words: readonly string[];
}

interface WireIssue {
  start: number;
  end: number;
  kind: ProofKind;
  message: string;
  suggestions: string[];
}

interface WireResult {
  language: { code: string; spelling: boolean; grammar: boolean; missing_dictionary: string | null };
  segments: WireIssue[][];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function wireResult(value: unknown): WireResult {
  if (!isRecord(value) || !isRecord(value.language) || !Array.isArray(value.segments)) {
    throw new Error("proof: risposta malformata");
  }
  return value as unknown as WireResult;
}

function isUnserved(error: unknown): boolean {
  return isRecord(error) && error.kind === "unserved";
}

/// Da offset in byte UTF-8 a code unit UTF-16, per offset crescenti, in una
/// sola passata. Un offset dentro un carattere va al confine successivo.
export function utf8ToUtf16(text: string, bytes: readonly number[]): number[] {
  const order = bytes.map((byte, index) => ({ byte, index })).sort((a, b) => a.byte - b.byte);
  const out = new Array<number>(bytes.length);
  let unit = 0;
  let byte = 0;
  let next = 0;
  while (next < order.length) {
    if (order[next].byte <= byte || unit >= text.length) {
      out[order[next].index] = unit;
      next += 1;
      continue;
    }
    const code = text.codePointAt(unit)!;
    byte += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    unit += code < 0x10000 ? 1 : 2;
  }
  return out;
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

/// La lingua dichiarata da un documento, normalizzata al codice primario
/// (`it-IT` → `it`), o `null` se non ce n'è una con la forma di un tag.
export function primaryLanguage(tag: string | null | undefined): string | null {
  const match = /^\s*([A-Za-z]{2,3})(?:[-_][A-Za-z0-9]{1,8})*\s*$/.exec(tag ?? "");
  return match ? match[1].toLowerCase() : null;
}

/// Un tratto del segmento e da dove viene nel documento. Le posizioni nel
/// documento sono quelle della superficie (code unit del buffer per
/// CodeMirror, posizioni ProseMirror per la superficie ricca).
export interface ProsePiece {
  /// In code unit dentro il segmento.
  readonly start: number;
  readonly end: number;
  /// Nella valuta della superficie.
  readonly docFrom: number;
  readonly docTo: number;
  /// Il testo del pezzo è quello del documento, carattere per carattere.
  readonly verbatim: boolean;
}

/// Un blocco di prosa pronto per il motore.
export interface ProseSegment {
  readonly text: string;
  readonly from: number;
  readonly to: number;
  readonly pieces: readonly ProsePiece[];
}

/// Dove sta nel documento un intervallo del segmento. `exact` quando sta dentro
/// un pezzo verbatim: solo allora una sostituzione è sicura.
export interface ProseLocation {
  readonly from: number;
  readonly to: number;
  readonly exact: boolean;
}

function pieceAt(segment: ProseSegment, offset: number): ProsePiece | undefined {
  return segment.pieces.find((piece) => offset >= piece.start && offset < piece.end);
}

/// Dove sta nel documento `[start, end)` del segmento, o `null` per un
/// intervallo vuoto o fuori dal segmento.
export function locate(segment: ProseSegment, start: number, end: number): ProseLocation | null {
  if (end <= start) return null;
  const first = pieceAt(segment, start);
  const last = pieceAt(segment, end - 1);
  if (!first || !last) return null;
  if (first === last && first.verbatim) {
    return { from: first.docFrom + start - first.start, to: first.docFrom + end - first.start, exact: true };
  }
  const from = first.verbatim ? first.docFrom + start - first.start : first.docFrom;
  const to = last.verbatim ? last.docFrom + end - last.start : last.docTo;
  return { from, to, exact: false };
}

/// Cosa si ignora per la sessione: una parola, in ogni sua maiuscola, o un
/// rilievo di grammatica su quel testo.
export function ignoreKey(issue: ProofIssue, text: string): string {
  return issue.kind === "spelling" ? `s\u0000${text.toLocaleLowerCase()}` : `g\u0000${issue.message}\u0000${text}`;
}

/// Una configurazione del controllo nella cache: i segmenti si ricordano sotto
/// il suo `id`, e `language` è cosa il motore sa fare in quella lingua.
interface ProofScope {
  readonly id: number;
  language: ProofLanguage | null;
}

interface CachedSegment {
  readonly issues: readonly ProofIssue[];
  readonly units: number;
}

/// I segmenti già controllati, condivisi da tutti i client: una superficie che
/// si rimonta (un cambio di linguetta) o una seconda vista della stessa nota
/// non richiedono ciò che un'altra ha già chiesto.
///
/// La risposta del motore dipende soltanto da ciò che la richiesta porta (la
/// lingua, le opzioni, le parole del dizionario personale, il testo) e dai
/// dizionari della macchina: la chiave è l'impronta di quei campi più il testo
/// del segmento, e due vault con la stessa configurazione condividono i
/// risultati senza errore. Ogni avviso di `watch` (un'impostazione, la lingua,
/// un vault aperto) svuota comunque tutto e cambia `epoch`: un risultato
/// partito prima non entra più.
///
/// I dizionari della macchina non danno avvisi: una risposta che dice che il
/// dizionario della lingua manca (`missingDictionary`) non entra nella cache,
/// né i suoi rilievi né la sua lingua. Chi installa il dizionario con Fub
/// aperto lo vede appena la superficie si rimonta.
///
/// È una LRU con tre tetti, segmenti, testo e configurazioni, perché vive
/// quanto l'app.
export class ProofCache {
  private epochValue = 0;
  private units = 0;
  private nextScope = 0;
  private readonly entries = new Map<string, CachedSegment>();
  private readonly scopes = new Map<string, ProofScope>();

  constructor(
    private readonly maxEntries = CACHE_ENTRIES,
    private readonly maxUnits = CACHE_UNITS,
    private readonly maxScopes = CACHE_SCOPES,
  ) {}

  /// Cambia a ogni `clear`: chi ha cominciato prima non scrive più.
  get epoch(): number {
    return this.epochValue;
  }

  /// Quanti segmenti ricorda.
  get size(): number {
    return this.entries.size;
  }

  /// La configurazione con questa impronta, creata se manca.
  scope(fingerprint: string): ProofScope {
    let scope = this.scopes.get(fingerprint);
    if (scope) {
      this.scopes.delete(fingerprint);
    } else {
      scope = { id: this.nextScope++, language: null };
      if (this.scopes.size >= this.maxScopes) {
        const oldest = this.scopes.keys().next().value;
        if (oldest !== undefined) this.dropScope(oldest);
      }
    }
    this.scopes.set(fingerprint, scope);
    return scope;
  }

  get(scope: ProofScope, text: string): readonly ProofIssue[] | undefined {
    const key = `${scope.id}\u0000${text}`;
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.issues;
  }

  /// Ricorda i rilievi di `text`, se nessuno ha svuotato la cache da `epoch`.
  set(epoch: number, scope: ProofScope, text: string, issues: readonly ProofIssue[]): void {
    if (epoch !== this.epochValue || text.length > this.maxUnits) return;
    const key = `${scope.id}\u0000${text}`;
    this.remove(key);
    while (this.entries.size >= this.maxEntries || this.units + text.length > this.maxUnits) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.remove(oldest);
    }
    this.entries.set(key, { issues, units: text.length });
    this.units += text.length;
  }

  clear(): void {
    this.epochValue += 1;
    this.entries.clear();
    this.scopes.clear();
    this.units = 0;
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.units -= entry.units;
  }

  private dropScope(fingerprint: string): void {
    const scope = this.scopes.get(fingerprint);
    if (!scope) return;
    this.scopes.delete(fingerprint);
    const prefix = `${scope.id}\u0000`;
    for (const key of [...this.entries.keys()]) if (key.startsWith(prefix)) this.remove(key);
  }
}

/// La cache di tutti i client dell'app.
export const sharedProofCache = new ProofCache();

/// Il client del correttore per una superficie. Va chiuso con `dispose`, che
/// non tocca la cache condivisa.
export class ProofClient {
  private config: Promise<Config | null> | null = null;
  private available = true;
  private generation = 0;
  private readonly listeners = new Set<() => void>();
  private readonly stopWatching: () => void;
  private disposed = false;

  constructor(
    private readonly ports: ProofPorts,
    private readonly cache: ProofCache = sharedProofCache,
  ) {
    this.stopWatching = ports.watch(() => this.invalidate());
  }

  /// Chiama `listener` quando un controllo fatto prima potrebbe rispondere
  /// diversamente adesso. Torna come smettere.
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /// Controlla `segments` nella lingua del documento (`documentLanguage`, se ne
  /// dichiara una) o in quella delle impostazioni. `null` quando il correttore
  /// non c'è, o quando la configurazione è cambiata durante l'attesa: chi
  /// chiama non applica niente e aspetta il prossimo `onChange`.
  async check(segments: readonly string[], documentLanguage?: string | null): Promise<ProofResult | null> {
    if (this.disposed || !this.available) return null;
    const generation = this.generation;
    const epoch = this.cache.epoch;
    const config = await this.loadConfig();
    if (!config || generation !== this.generation || epoch !== this.cache.epoch || this.disposed) return null;
    const language = primaryLanguage(documentLanguage) ?? config.language;
    const options = { ...config.options, ignore_internet: true };
    // L'impronta è la richiesta senza i segmenti: ciò da cui la risposta dipende.
    const scope = this.cache.scope(JSON.stringify([language, options, config.words]));
    // I risultati di questa chiamata stanno qui e non solo nella cache: la LRU
    // può dimenticare un segmento prima che la chiamata finisca.
    const results = new Array<readonly ProofIssue[] | undefined>(segments.length);
    const pending: number[] = [];
    // Cosa sa fare il motore, secondo l'ultima risposta di questa chiamata.
    let answered: ProofLanguage | null = null;
    for (let i = 0; i < segments.length; i += 1) {
      results[i] = this.cache.get(scope, segments[i]);
      if (results[i]) continue;
      // Un segmento oltre il limite della route non si chiede: non ha rilievi.
      if (utf8Length(segments[i]) > MAX_SEGMENT_BYTES) results[i] = [];
      else pending.push(i);
    }
    try {
      for (const batch of this.batches(segments, pending)) {
        const response = await this.ports.queryIndex({
          kind: "custom",
          ns: PROOF_NS,
          query: {
            op: "check",
            version: 1,
            language,
            options,
            words: config.words,
            segments: batch.map((i) => segments[i]),
          },
        });
        if (generation !== this.generation || epoch !== this.cache.epoch || this.disposed) return null;
        if (response.kind !== "custom") throw new Error("proof: risposta fuori tema");
        const wire = wireResult(response.value);
        answered = {
          code: wire.language.code,
          spelling: wire.language.spelling,
          grammar: wire.language.grammar,
          missingDictionary: wire.language.missing_dictionary ?? null,
        };
        // Senza il dizionario della lingua la risposta vale solo per questa
        // chiamata: il dizionario può arrivare senza avvisi.
        const lasting = answered.missingDictionary === null;
        // Dopo un `clear` lo scope è staccato dalla cache: scriverci non tocca
        // le configurazioni nuove.
        if (lasting) scope.language = answered;
        batch.forEach((index, at) => {
          const issues = this.convert(segments[index], wire.segments[at] ?? []);
          results[index] = issues;
          if (lasting) this.cache.set(epoch, scope, segments[index], issues);
        });
      }
    } catch (error) {
      if (isUnserved(error)) {
        this.available = false;
        return null;
      }
      throw error;
    }
    return {
      language: answered ??
        scope.language ?? { code: language, spelling: false, grammar: false, missingDictionary: null },
      segments: results.map((issues) => issues ?? []),
    };
  }

  /// Aggiunge una parola al dizionario personale del vault, con il comando
  /// della feature. Torna l'avviso del comando.
  async addWord(word: string): Promise<string | null> {
    const outcome = await this.ports.invokeCommand(PROOF_WORD_ADD, { word });
    return outcome.notify ?? null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopWatching();
    this.listeners.clear();
  }

  private invalidate(): void {
    if (this.disposed) return;
    this.generation += 1;
    this.config = null;
    this.available = true;
    // L'avviso arriva a ogni client: svuotare più volte non costa, e il primo
    // che lo riceve chiude la porta ai risultati partiti prima.
    this.cache.clear();
    for (const listener of [...this.listeners]) listener();
  }

  private loadConfig(): Promise<Config | null> {
    this.config ??= this.ports.settings().then(
      (entries) => {
        const value = (key: string) => entries.find((entry) => entry.spec.key === key)?.value;
        // Senza impostazioni il correttore non è montato: si tace.
        if (!entries.some((entry) => entry.spec.key.startsWith("proof."))) return null;
        const flag = (key: string) => value(key) !== false;
        const chosen = value("proof.language");
        const language =
          (typeof chosen === "string" && chosen !== LANGUAGE_AUTO ? primaryLanguage(chosen) : null) ??
          primaryLanguage(this.ports.interfaceLanguage()) ??
          "en";
        const words = value("proof.words");
        return {
          language,
          options: {
            grammar: flag("proof.grammar"),
            ignore_uppercase: flag("proof.ignore-uppercase"),
            ignore_numbers: flag("proof.ignore-numbers"),
          },
          words: Array.isArray(words) ? words.filter((w): w is string => typeof w === "string") : [],
        };
      },
      () => null,
    );
    return this.config;
  }

  /// I segmenti da chiedere, in richieste entro i limiti della route.
  private *batches(segments: readonly string[], pending: readonly number[]): Generator<number[]> {
    let batch: number[] = [];
    let bytes = 0;
    for (const index of pending) {
      const size = utf8Length(segments[index]);
      if (batch.length >= MAX_SEGMENTS || bytes + size > MAX_REQUEST_BYTES) {
        yield batch;
        batch = [];
        bytes = 0;
      }
      batch.push(index);
      bytes += size;
    }
    if (batch.length > 0) yield batch;
  }

  private convert(segment: string, issues: readonly WireIssue[]): ProofIssue[] {
    const units = utf8ToUtf16(segment, issues.flatMap((issue) => [issue.start, issue.end]));
    return issues.map((issue, i) => ({
      start: units[2 * i],
      end: units[2 * i + 1],
      kind: issue.kind,
      message: issue.message,
      suggestions: [...issue.suggestions],
    }));
  }
}
