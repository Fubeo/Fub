// La tastiera di uno strumento del motore che scrive (piano K6, T16): il Testo
// di punto (`type`). Dopo il clic che crea la casella, i tasti, il testo e
// l'IME vanno al motore come `DrawingInput`; lui tiene il testo, il cursore e
// la selezione, e rimanda l'anteprima.
//
// - **Una casella nascosta.** I tasti arrivano a una `<textarea>` vuota e
//   invisibile, posata sul cursore del testo: così il sistema sa dove aprire la
//   finestra dell'IME, e un incolla arriva come testo. La casella non tiene
//   niente: ogni parola scritta parte e la casella torna vuota.
// - **Gli indici.** L'IME dice il pezzo attivo in unità di JavaScript (UTF-16);
//   il motore lo vuole in caratteri Unicode (`daUtf16`). Il motore conta i suoi
//   cursori in byte UTF-8 (`daUtf8` li porta a indici di JavaScript).
// - **Gli a capo.** Un testo incollato da Windows porta `\r\n`: il motore farebbe
//   di `\r` un altro a capo, e una riga vuota in più. Si manda `\n` (`righeUnix`).
// - **I tasti dell'editor.** Mentre si scrive, le lettere e i tasti di modifica
//   sono del testo: non arrivano alle scorciatoie del foglio (la `t`, Canc). Esc
//   esce dal testo; Ctrl+Z chiude il testo e annulla il passo, che è il testo
//   scritto; un'altra scorciatoia con Ctrl chiude il testo e passa.
// - **Il fuoco altrove** (un clic sul foglio o su un pannello) chiude il testo
//   com'è, in un passo.

import type { DrawingInput, DrawingKeyMods } from "../../../host/contract";
import { composingKey } from "../../../kit/ime";

/// Gli strumenti del motore che scrivono: al rilascio del clic il gesto resta
/// aperto (`busy`), e la tastiera va a lui finché il testo non si chiude.
export const STRUMENTI_CHE_SCRIVONO: ReadonlySet<string> = new Set(["type", "areaType", "typeOnPath", "verticalType"]);

/// I tasti che modificano il testo o ci si muovono dentro: vanno al motore
/// come tasti (`strumento.rs`, `tasto`). Le lettere arrivano come testo.
const TASTI_DEL_TESTO: ReadonlySet<string> = new Set([
  "Enter",
  "Backspace",
  "Delete",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "Tab",
]);

/// Le scorciatoie con Ctrl (⌘) che restano alla casella: incollare arriva come
/// testo, e copiare o tagliare una casella vuota non fa niente.
const APPUNTI: ReadonlySet<string> = new Set(["KeyC", "KeyX", "KeyV"]);

/// Che cosa la casella chiede a chi la monta.
export interface PortaScrittura {
  /// Gli ingressi da mandare al motore, nell'ordine in cui sono arrivati.
  manda(inputs: readonly DrawingInput[]): void;
  /// Esc: il testo si chiude e si esce dallo strumento.
  esci(): void;
  /// Il testo si chiude com'è: il fuoco è andato altrove, o una scorciatoia
  /// dell'app sta per passare.
  chiudi(): void;
  /// Ctrl+Z: il testo si chiude e il suo passo si annulla.
  annulla(): void;
}

/// L'indice in caratteri Unicode di `indice`, un indice UTF-16 di `testo`.
export function daUtf16(testo: string, indice: number): number {
  let caratteri = 0;
  for (let i = 0; i < Math.min(indice, testo.length); i++) {
    const unita = testo.charCodeAt(i);
    // La seconda metà di una coppia surrogata non è un carattere nuovo.
    if (unita >= 0xdc00 && unita <= 0xdfff && i > 0) {
      const prima = testo.charCodeAt(i - 1);
      if (prima >= 0xd800 && prima <= 0xdbff) continue;
    }
    caratteri++;
  }
  return caratteri;
}

/// L'indice UTF-16 di `byte`, un indice in byte UTF-8 di `testo` (come li conta
/// il motore). Un byte a metà di un carattere vale l'inizio del carattere;
/// oltre la fine, la fine.
export function daUtf8(testo: string, byte: number): number {
  let contati = 0;
  let i = 0;
  while (i < testo.length) {
    const punto = testo.codePointAt(i)!;
    const lungo = punto < 0x80 ? 1 : punto < 0x800 ? 2 : punto < 0x10000 ? 3 : 4;
    if (contati + lungo > byte) return i;
    contati += lungo;
    i += punto > 0xffff ? 2 : 1;
  }
  return testo.length;
}

/// `testo` con gli a capo di Windows e del vecchio Mac come `\n`.
export function righeUnix(testo: string): string {
  return testo.replace(/\r\n?/gu, "\n");
}

/// I modificatori di un tasto, come li legge il motore: Ctrl e ⌘ sono `cmd`,
/// come per le scorciatoie dell'app (`DrawingKeyMods`).
function modificatori(event: KeyboardEvent): DrawingKeyMods {
  return { shift: event.shiftKey, alt: event.altKey, cmd: event.ctrlKey || event.metaKey };
}

/// Il tasto del testo di `event` come ingresso del motore; `null` per un tasto
/// che non è del testo (una lettera arriva come testo, dall'`input`).
export function tastoDelTesto(event: KeyboardEvent): DrawingInput | null {
  if (!TASTI_DEL_TESTO.has(event.key)) return null;
  return { kind: "key", key: event.key, code: event.code, mods: modificatori(event), pressed: true };
}

/// La casella nascosta che prende la tastiera mentre si scrive. Una sola per
/// editor: `apri` la monta in `contenitore`, `chiudi` la toglie con i suoi
/// ascoltatori.
export class Scrittura {
  readonly #contenitore: HTMLElement;
  readonly #porta: PortaScrittura;
  #casella: HTMLTextAreaElement | null = null;
  #via: (() => void) | null = null;
  /// Un'IME sta componendo: i tasti sono suoi.
  #compone = false;

  constructor(contenitore: HTMLElement, porta: PortaScrittura) {
    this.#contenitore = contenitore;
    this.#porta = porta;
  }

  /// La casella è montata.
  get aperta(): boolean {
    return this.#casella !== null;
  }

  /// La casella, per i test e per chi la posa.
  get casella(): HTMLTextAreaElement | null {
    return this.#casella;
  }

  /// Monta la casella e le dà il fuoco; già montata, le ridà il fuoco.
  apri(etichetta: string): void {
    if (this.#casella !== null) {
      this.#casella.focus({ preventScroll: true });
      return;
    }
    const casella = document.createElement("textarea");
    casella.className = "draw-scrittura";
    casella.setAttribute("aria-label", etichetta);
    casella.setAttribute("autocomplete", "off");
    casella.setAttribute("autocorrect", "off");
    casella.setAttribute("autocapitalize", "off");
    casella.spellcheck = false;
    casella.rows = 1;
    this.#casella = casella;
    const ascolti: [string, EventListener][] = [
      ["keydown", (e) => this.#tasto(e as KeyboardEvent)],
      ["input", (e) => this.#scritto(e as InputEvent)],
      ["compositionstart", () => this.#componi("")],
      ["compositionupdate", (e) => this.#componi((e as CompositionEvent).data ?? "")],
      ["compositionend", (e) => this.#composto((e as CompositionEvent).data ?? "")],
      ["blur", () => this.#lasciata()],
    ];
    for (const [nome, ascolto] of ascolti) casella.addEventListener(nome, ascolto);
    this.#via = () => {
      for (const [nome, ascolto] of ascolti) casella.removeEventListener(nome, ascolto);
    };
    this.#contenitore.append(casella);
    casella.focus({ preventScroll: true });
  }

  /// Posa la casella sul cursore del testo: `x`, `y` in pixel del contenitore,
  /// in alto a sinistra, e l'altezza della riga.
  posa(x: number, y: number, altezza: number): void {
    const casella = this.#casella;
    if (casella === null) return;
    casella.style.transform = `translate(${x}px, ${y}px)`;
    casella.style.height = `${Math.max(1, altezza)}px`;
  }

  /// Toglie la casella e i suoi ascoltatori. Il fuoco, se l'aveva, va a
  /// `poi` (il foglio).
  chiudi(poi?: HTMLElement): void {
    const casella = this.#casella;
    if (casella === null) return;
    this.#casella = null;
    this.#compone = false;
    this.#via?.();
    this.#via = null;
    const aveva = document.activeElement === casella;
    casella.remove();
    if (aveva) poi?.focus({ preventScroll: true });
  }

  #tasto(event: KeyboardEvent): void {
    // L'IME tiene i tasti mentre compone (`Process`, o il 229 di alcuni sistemi).
    if (this.#compone || composingKey(event) || event.key === "Process") {
      event.stopPropagation();
      return;
    }
    const comando = event.ctrlKey || event.metaKey;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.#porta.esci();
      return;
    }
    if (comando && event.code === "KeyZ" && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      this.#porta.annulla();
      return;
    }
    const tasto = tastoDelTesto(event);
    if (tasto !== null) {
      event.preventDefault();
      event.stopPropagation();
      this.#porta.manda([tasto]);
      return;
    }
    if (comando && !APPUNTI.has(event.code)) {
      // Una scorciatoia dell'app (salva, cerca…): il testo si chiude, e il
      // tasto passa.
      this.#porta.chiudi();
      return;
    }
    // Una lettera, uno spazio, l'incolla: arrivano con `input`, e il foglio
    // non li vede.
    event.stopPropagation();
  }

  #scritto(event: InputEvent): void {
    const casella = this.#casella;
    if (casella === null || this.#compone || event.isComposing) return;
    const testo = righeUnix(casella.value);
    casella.value = "";
    if (testo !== "") this.#porta.manda([{ kind: "text", text: testo }]);
  }

  #componi(testo: string): void {
    this.#compone = true;
    const casella = this.#casella;
    // Il pezzo attivo: dove la casella tiene la selezione dentro la parola
    // composta, se la tiene; altrimenti nessuno.
    let attivo: [number, number] | null = null;
    if (casella !== null && testo !== "" && casella.selectionStart !== casella.selectionEnd) {
      const inizio = casella.value.length - testo.length;
      const da = casella.selectionStart - inizio;
      const a = casella.selectionEnd - inizio;
      if (da >= 0 && a <= testo.length) attivo = [daUtf16(testo, da), daUtf16(testo, a)];
    }
    this.#porta.manda([{ kind: "ime", preedit: testo, active: attivo }]);
  }

  #composto(testo: string): void {
    this.#compone = false;
    const casella = this.#casella;
    if (casella !== null) casella.value = "";
    // La parola composta prende il posto di quella segnata; vuota, la toglie.
    this.#porta.manda([{ kind: "text", text: righeUnix(testo) }]);
  }

  #lasciata(): void {
    if (this.#casella === null) return;
    this.#porta.chiudi();
  }
}
