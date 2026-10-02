/// JSON senza perdita per i valori che il foglio non interpreta.
///
/// Il formato `.fubsheet` ammette proprietà JSON arbitrarie, e il lettore
/// nativo le conserva com'erano: `serde_json` tiene esatti gli interi a 64 bit.
/// `JSON.parse` le fa passare da `Number`, che arrotonda oltre 2^53, e una
/// modifica di cella riscriveva così anche ciò che l'utente non aveva toccato.
/// Qui i numeri dei sotto-alberi scelti restano il lessema con cui erano
/// scritti, e la scrittura lo rimette tale e quale; tutto il resto si legge come
/// `JSON.parse` e si scrive come `JSON.stringify(valore, null, 2)`.

/** Un numero JSON come era scritto, che nessuno ha letto come `Number`. */
export class JsonNumber {
  constructor(readonly raw: string) {}

  /** Per chi lo passasse comunque a `JSON.stringify`: un numero, non un oggetto. */
  toJSON(): number {
    return Number(this.raw);
  }
}

export type JsonPath = readonly (string | number)[];

/// Il limite di annidamento del lettore nativo: `serde_json` apre 127
/// contenitori uno dentro l'altro e rifiuta il centoventottesimo.
const MAX_DEPTH = 127;

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/**
 * Legge `text` come `JSON.parse`, ma i numeri sotto un membro per cui
 * `keepRaw` risponde sì diventano [`JsonNumber`]. `keepRaw` riceve il path del
 * membro, che vale soltanto durante la chiamata.
 */
export function parseJson(text: string, keepRaw: (path: JsonPath) => boolean): unknown {
  return new Reader(text, keepRaw).document();
}

/** Scrive dati JSON come `JSON.stringify(value, null, 2)`, con i [`JsonNumber`] come erano. */
export function stringifyJson(value: unknown): string {
  const text = stringify(value, "");
  if (text === undefined) throw new TypeError("valore senza forma JSON");
  return text;
}

function stringify(value: unknown, indent: string): string | undefined {
  if (value instanceof JsonNumber) return value.raw;
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    const items = value.map((item) => `${inner}${stringify(item, inner) ?? "null"}`);
    return `[\n${items.join(",\n")}\n${indent}]`;
  }
  const members = Object.keys(value).flatMap((key) => {
    const text = stringify((value as Record<string, unknown>)[key], inner);
    return text === undefined ? [] : [`${inner}${JSON.stringify(key)}: ${text}`];
  });
  return members.length ? `{\n${members.join(",\n")}\n${indent}}` : "{}";
}

class Reader {
  readonly #text: string;
  readonly #keepRaw: (path: JsonPath) => boolean;
  readonly #path: (string | number)[] = [];
  #at = 0;

  constructor(text: string, keepRaw: (path: JsonPath) => boolean) {
    this.#text = text;
    this.#keepRaw = keepRaw;
  }

  document(): unknown {
    const value = this.#value(false, 0);
    this.#space();
    if (this.#at !== this.#text.length) throw this.#error("testo dopo il documento");
    return value;
  }

  #error(what: string): SyntaxError {
    return new SyntaxError(`JSON non valido alla posizione ${this.#at}: ${what}`);
  }

  #space(): void {
    while (this.#at < this.#text.length) {
      const c = this.#text.charCodeAt(this.#at);
      if (c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return;
      this.#at += 1;
    }
  }

  #value(raw: boolean, depth: number): unknown {
    this.#space();
    switch (this.#text[this.#at]) {
      case "{": return this.#object(raw, depth + 1);
      case "[": return this.#array(raw, depth + 1);
      case '"': return this.#string();
      case "t": return this.#literal("true", true);
      case "f": return this.#literal("false", false);
      case "n": return this.#literal("null", null);
      default: return this.#number(raw);
    }
  }

  #object(raw: boolean, depth: number): Record<string, unknown> {
    if (depth > MAX_DEPTH) throw this.#error("annidamento oltre il limite");
    this.#at += 1;
    const out: Record<string, unknown> = {};
    this.#space();
    if (this.#text[this.#at] === "}") {
      this.#at += 1;
      return out;
    }
    for (;;) {
      this.#space();
      if (this.#text[this.#at] !== '"') throw this.#error("attesa una chiave");
      const key = this.#string();
      this.#space();
      if (this.#text[this.#at] !== ":") throw this.#error("attesi i due punti");
      this.#at += 1;
      this.#path.push(key);
      const value = this.#value(raw || this.#keepRaw(this.#path), depth);
      this.#path.pop();
      // Come `JSON.parse`: `__proto__` è una chiave e non il prototipo, e una
      // chiave ripetuta vale per l'ultima volta restando al posto della prima.
      Object.defineProperty(out, key, { value, writable: true, enumerable: true, configurable: true });
      this.#space();
      const next = this.#text[this.#at];
      this.#at += 1;
      if (next === "}") return out;
      if (next !== ",") throw this.#error("attesa una virgola o la fine dell'oggetto");
    }
  }

  #array(raw: boolean, depth: number): unknown[] {
    if (depth > MAX_DEPTH) throw this.#error("annidamento oltre il limite");
    this.#at += 1;
    const out: unknown[] = [];
    this.#space();
    if (this.#text[this.#at] === "]") {
      this.#at += 1;
      return out;
    }
    for (;;) {
      this.#path.push(out.length);
      out.push(this.#value(raw, depth));
      this.#path.pop();
      this.#space();
      const next = this.#text[this.#at];
      this.#at += 1;
      if (next === "]") return out;
      if (next !== ",") throw this.#error("attesa una virgola o la fine della lista");
    }
  }

  /// La fine della stringa si cerca a mano e la decodifica la fa `JSON.parse`:
  /// escape, surrogati e caratteri di controllo restano le sue regole.
  #string(): string {
    const start = this.#at;
    let from = start + 1;
    for (;;) {
      const quote = this.#text.indexOf('"', from);
      if (quote < 0) throw this.#error("stringa non chiusa");
      let slashes = 0;
      while (this.#text.charCodeAt(quote - 1 - slashes) === 0x5c) slashes += 1;
      from = quote + 1;
      if (slashes % 2 === 0) break;
    }
    this.#at = from;
    return JSON.parse(this.#text.slice(start, from)) as string;
  }

  #literal<T>(word: string, value: T): T {
    if (!this.#text.startsWith(word, this.#at)) throw this.#error("valore non valido");
    this.#at += word.length;
    return value;
  }

  #number(raw: boolean): number | JsonNumber {
    NUMBER.lastIndex = this.#at;
    const match = NUMBER.exec(this.#text);
    if (!match) throw this.#error("valore non valido");
    this.#at += match[0].length;
    return raw ? new JsonNumber(match[0]) : Number(match[0]);
  }
}
