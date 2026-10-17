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
/// Quanti segmenti già controllati si ricordano: chi scrive cambia un paragrafo
/// alla volta, e gli altri non si richiedono.
const CACHE_ENTRIES = 4096;

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

/// Il client del correttore per una superficie. Va chiuso con `dispose`.
export class ProofClient {
  private config: Promise<Config | null> | null = null;
  private available = true;
  private generation = 0;
  private readonly cache = new Map<string, readonly ProofIssue[]>();
  private readonly languages = new Map<string, ProofLanguage>();
  private readonly listeners = new Set<() => void>();
  private readonly stopWatching: () => void;
  private disposed = false;

  constructor(private readonly ports: ProofPorts) {
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
    const config = await this.loadConfig();
    if (!config || generation !== this.generation || this.disposed) return null;
    const language = primaryLanguage(documentLanguage) ?? config.language;
    const keyOf = (text: string) => `${language}\u0000${text}`;
    const pending: number[] = [];
    for (let i = 0; i < segments.length; i += 1) {
      if (this.cache.has(keyOf(segments[i]))) continue;
      // Un segmento oltre il limite della route non si chiede: non ha rilievi.
      if (utf8Length(segments[i]) > MAX_SEGMENT_BYTES) this.remember(keyOf(segments[i]), []);
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
            options: { ...config.options, ignore_internet: true },
            words: config.words,
            segments: batch.map((i) => segments[i]),
          },
        });
        if (generation !== this.generation || this.disposed) return null;
        if (response.kind !== "custom") throw new Error("proof: risposta fuori tema");
        const wire = wireResult(response.value);
        this.languages.set(language, {
          code: wire.language.code,
          spelling: wire.language.spelling,
          grammar: wire.language.grammar,
          missingDictionary: wire.language.missing_dictionary ?? null,
        });
        batch.forEach((index, at) => {
          this.remember(keyOf(segments[index]), this.convert(segments[index], wire.segments[at] ?? []));
        });
      }
    } catch (error) {
      if (isUnserved(error)) {
        this.available = false;
        return null;
      }
      throw error;
    }
    const known = this.languages.get(language) ?? {
      code: language,
      spelling: false,
      grammar: false,
      missingDictionary: null,
    };
    return {
      language: known,
      segments: segments.map((segment) => this.cache.get(keyOf(segment)) ?? []),
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
    this.cache.clear();
  }

  private invalidate(): void {
    if (this.disposed) return;
    this.generation += 1;
    this.config = null;
    this.available = true;
    this.cache.clear();
    this.languages.clear();
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

  private remember(key: string, issues: readonly ProofIssue[]): void {
    if (this.cache.size >= CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, issues);
  }
}
