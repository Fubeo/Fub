// La formula che si modifica toccandola (T60, E27): il pezzo con il DOM. Di
// serie il codice non si vede: la formula resta una formula, disegnata da
// KaTeX coi segni del cursore (`caret.ts`), e il cursore lampeggia dentro di
// lei. I tasti li prende un campo nascosto (che ospita anche l'IME) e li passa
// alle regole senza DOM (`edit.ts`); il clic e le frecce su e giù li decide la
// geometria dei segni.
//
// Una formula che già non si legge (un errore nel file) si apre col suo
// LaTeX, in un campo a vista con la resa sopra: lì le regole non valgono,
// perché partono da una formula buona.
//
// Il disegno si rifà a ogni TeX nuovo, una volta per fotogramma; spostare il
// cursore non ridisegna, sposta soltanto il segno acceso.
import type katex from "katex";
import { resolvedLanguage } from "../../../../../i18n/strings";
import { openLifetime, type Lifetime } from "../../../../../ui/lifetime";
import { loadKatex, readOptions } from "../math";
import { liveStrings } from "../strings";
import { editOptions, instrument, markerElement, markersIn, nearestPoint, verticalPoint } from "./caret";
import * as rules from "./edit";
import type { MathState, Outcome } from "./edit";
import { holesOf, mapFormula, placeAt, type Place } from "./points";
import { commandName, propose, proposalsAddNothing, SYMBOLS, symbolName, type MathSymbol } from "./symbols";

/// Perché il cursore lascia la formula.
export type LeaveReason = "before" | "after" | "enter" | "escape" | "up" | "down";

/// Dove sta il cursore quando la formula si apre.
export type MathStart = "start" | "end" | { readonly x: number; readonly y: number };

export interface MathEditorOptions {
  readonly tex: string;
  /// A blocco (`$$`) o in riga.
  readonly display: boolean;
  readonly start?: MathStart;
  /// La formula sta in una riga di tabella (`|` non chiude la cella).
  readonly inTable?: boolean;
  /// Un TeX nuovo da scrivere nella nota. Non arriva a metà di un comando
  /// scritto per nome, che non si legge ancora.
  onChange(tex: string): void;
  onLeave(reason: LeaveReason): void;
  readonly lifetime: Lifetime;
}

const HISTORY_LIMIT = 200;
const CARET_CLASS = "cm-fub-mx-caret";
/// Gli id delle proposte: uno per riquadro, perché il campo li nomina.
let lists = 0;

export class MathEditor {
  readonly element: HTMLElement;
  private readonly surface: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly note: HTMLElement;
  private readonly status: HTMLElement;
  /// Le proposte dei simboli per il nome scritto dopo `\` (T61).
  private readonly list: HTMLElement;
  private proposals: readonly MathSymbol[] = [];
  private active = 0;
  /// Esc ha chiuso le proposte: tornano con la lettera dopo.
  private dismissed = false;
  private readonly life: Lifetime;
  private state: MathState;
  /// La `\` di un comando che si sta scrivendo per nome.
  private pending: number | null = null;
  private mode: "visual" | "latex" = "visual";
  private library: typeof katex | null = null;
  private frame = 0;
  private start: MathStart | null;
  private readonly undoStack: MathState[] = [];
  private readonly redoStack: MathState[] = [];
  private said = "";

  constructor(private readonly options: MathEditorOptions) {
    this.life = openLifetime();
    options.lifetime.add(() => this.life.close());
    this.state = { tex: options.tex, caret: options.tex.length };
    this.start = options.start ?? "end";

    this.element = document.createElement("div");
    this.element.className = "cm-fub-mx";
    this.element.dataset.display = options.display ? "block" : "inline";
    this.element.dataset.mode = "visual";

    this.surface = document.createElement("div");
    this.surface.className = "cm-fub-mx-surface";
    this.surface.dataset.state = "loading";

    this.input = document.createElement("textarea");
    this.input.className = "cm-fub-mx-input";
    this.input.rows = 1;
    // La formula fa parte del testo della nota, che è una fermata sola del
    // Tab: ci si entra col cursore (le frecce, il clic), e dentro Tab va da
    // uno spazio vuoto all'altro.
    this.input.tabIndex = -1;
    this.input.spellcheck = false;
    this.input.setAttribute("autocomplete", "off");
    this.input.setAttribute("autocapitalize", "off");
    this.input.setAttribute("aria-label", liveStrings.t("live.math.edit"));

    this.note = document.createElement("p");
    this.note.className = "cm-fub-mx-note";
    this.note.hidden = true;

    this.status = document.createElement("div");
    this.status.className = "sr-only";
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");

    this.list = document.createElement("div");
    this.list.className = "cm-fub-mx-symbols";
    this.list.id = `cm-fub-mx-symbols-${++lists}`;
    this.list.hidden = true;
    this.list.setAttribute("role", "listbox");
    this.list.setAttribute("aria-label", liveStrings.t("live.math.symbols"));
    this.input.setAttribute("aria-controls", this.list.id);

    this.element.append(this.surface, this.list, this.input, this.note, this.status);
    this.listen();
    this.life.add(() => cancelAnimationFrame(this.frame));

    void loadKatex().then((library) => {
      if (this.life.closed) return;
      this.library = library;
      if (!this.reads(this.state.tex)) this.toLatex();
      this.paint();
    }, () => {
      if (!this.life.closed) this.toLatex();
    });
  }

  /// Il TeX di adesso.
  get tex(): string {
    return this.state.tex;
  }

  focus(): void {
    this.input.focus({ preventScroll: true });
  }

  // ── Il disegno ─────────────────────────────────────────────────────────────

  private reads(tex: string): boolean {
    if (!this.library) return false;
    try {
      this.library.renderToString(tex, readOptions(this.options.display));
      return true;
    } catch {
      return false;
    }
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.paint();
    });
  }

  private paint(): void {
    const library = this.library;
    if (!library || this.life.closed) return;
    const { tex } = this.state;
    const staging = document.createElement(this.options.display ? "div" : "span");
    try {
      if (this.mode === "latex") {
        library.render(tex, staging, readOptions(this.options.display));
      } else {
        const pending = this.pending === null ? null : { from: this.pending, to: this.state.caret };
        library.render(instrument(tex, pending), staging, editOptions(this.options.display));
      }
    } catch {
      // L'ultima resa buona resta, attenuata; senza, il riquadro si toglie
      // finché il LaTeX non si legge.
      this.surface.dataset.state = this.surface.childElementCount > 0 ? "stale" : "empty";
      return;
    }
    const nodes: Node[] = [...staging.childNodes];
    if (this.mode === "visual" && tex.trim() === "") {
      const placeholder = document.createElement("span");
      placeholder.className = "cm-fub-mx-placeholder";
      placeholder.textContent = liveStrings.t("live.math.empty");
      nodes.push(placeholder);
    }
    this.surface.replaceChildren(...nodes);
    this.surface.dataset.state = "ready";
    this.showCaret();
    if (this.start !== null) {
      const start = this.start;
      this.start = null;
      if (typeof start === "object") {
        const at = nearestPoint(markersIn(this.surface), start.x, start.y);
        if (at !== null) this.moveTo(at);
      } else if (start === "start") {
        this.moveTo(mapFormula(tex).points[0]?.at ?? 0);
      }
    }
  }

  /// Accende il segno del cursore, senza ridisegnare.
  private showCaret(): void {
    for (const lit of this.surface.querySelectorAll(`.${CARET_CLASS}`)) lit.classList.remove(CARET_CLASS);
    if (this.mode !== "visual") return;
    markerElement(this.surface, this.state.caret)?.classList.add(CARET_CLASS);
  }

  // ── Lo stato ───────────────────────────────────────────────────────────────

  private moveTo(caret: number): void {
    this.state = { tex: this.state.tex, caret };
    this.showCaret();
    this.announce();
  }

  private commit(next: MathState, record = true): void {
    if (record && next.tex !== this.state.tex) {
      this.undoStack.push(this.state);
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
      this.redoStack.length = 0;
    }
    const changed = next.tex !== this.state.tex;
    this.state = next;
    if (changed && this.pending === null) this.options.onChange(next.tex);
    if (changed || this.pending !== null) this.schedule();
    else this.showCaret();
    this.offer();
    this.announce();
  }

  private apply(outcome: Outcome): void {
    switch (outcome.kind) {
      case "edit":
        this.commit(outcome.state);
        return;
      case "move":
        this.moveTo(outcome.caret);
        return;
      case "leave":
        this.options.onLeave(outcome.side);
        return;
      case "none":
        return;
    }
  }

  private history(dir: "undo" | "redo"): void {
    const from = dir === "undo" ? this.undoStack : this.redoStack;
    const to = dir === "undo" ? this.redoStack : this.undoStack;
    const next = from.pop();
    if (!next) return;
    to.push(this.state);
    this.pending = null;
    this.commit(next, false);
  }

  /// Dice dove si è, quando il posto cambia: «numeratore», «esponente di x».
  private announce(): void {
    if (this.mode !== "visual") return;
    const map = mapFormula(this.state.tex);
    const caret = this.state.caret;
    const points = map.points;
    let text = describe(placeAt(map, caret));
    if (placeAt(map, caret).role === "formula") {
      if (caret === points[0]?.at) text = liveStrings.t("live.math.place.start");
      else if (caret === points[points.length - 1]?.at) text = liveStrings.t("live.math.place.end");
    }
    if (holesOf(map).includes(caret)) text = liveStrings.t("live.math.place.hole", { place: text });
    if (text === this.said) return;
    this.said = text;
    this.status.textContent = text;
  }

  // ── Il LaTeX a vista, per una formula che non si legge ─────────────────────

  private toLatex(): void {
    this.mode = "latex";
    this.pending = null;
    this.element.dataset.mode = "latex";
    this.input.className = "cm-fub-mx-latex";
    this.input.value = this.state.tex;
    this.input.setAttribute("aria-label", liveStrings.t("live.math.source"));
    this.note.textContent = liveStrings.t("live.math.latex");
    this.note.hidden = false;
    this.showCaret();
    this.grow();
  }

  private grow(): void {
    this.input.rows = Math.min(8, Math.max(1, this.input.value.split("\n").length));
  }

  // ── I gesti ───────────────────────────────────────────────────────────────

  private listen(): void {
    const on = <K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, handler: (event: HTMLElementEventMap[K]) => void) => {
      target.addEventListener(type, handler as EventListener);
      this.life.add(() => target.removeEventListener(type, handler as EventListener));
    };
    on(this.input, "keydown", (event) => this.keydown(event));
    on(this.input, "beforeinput", (event) => {
      // In vista nessun tasto scrive da sé: lo fanno le regole. Resta l'IME,
      // che si raccoglie alla fine della composizione.
      if (this.mode === "visual" && !event.isComposing && event.inputType !== "insertCompositionText") event.preventDefault();
    });
    on(this.input, "compositionend", (event) => {
      if (this.mode !== "visual") return;
      this.input.value = "";
      for (const ch of event.data ?? "") this.type(ch);
    });
    on(this.input, "input", () => {
      if (this.mode === "latex") {
        this.grow();
        this.commit({ tex: this.input.value, caret: this.input.selectionStart });
      }
    });
    on(this.input, "paste", (event) => {
      if (this.mode !== "visual") return;
      event.preventDefault();
      this.finishPending();
      this.apply(rules.insertText(this.state, event.clipboardData?.getData("text/plain") ?? ""));
    });
    on(this.list, "mousedown", (event) => {
      // Il fuoco resta nel campo: il clic mette il simbolo.
      event.preventDefault();
      event.stopPropagation();
      const option = (event.target as Element | null)?.closest<HTMLElement>("[role=option]");
      const symbol = option ? this.proposals[Number(option.dataset.index)] : undefined;
      if (symbol) this.choose(symbol);
      this.focus();
    });
    on(this.surface, "mousedown", (event) => {
      if (event.button !== 0 || this.mode !== "visual") return;
      // Il fuoco resta nel campo: il clic porta soltanto il cursore.
      event.preventDefault();
      event.stopPropagation();
      this.finishPending(true);
      const at = nearestPoint(markersIn(this.surface), event.clientX, event.clientY);
      if (at !== null) this.moveTo(at);
      this.focus();
    });
  }

  private keydown(event: KeyboardEvent): void {
    if (event.isComposing || event.keyCode === 229) return;
    if (this.mode === "latex") {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        this.options.onLeave("enter");
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.options.onLeave("escape");
      }
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (mod && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === "z") {
        handled();
        this.history(event.shiftKey ? "redo" : "undo");
      } else if (key === "y") {
        handled();
        this.history("redo");
      } else if (key === "a" || key === "enter") {
        handled();
        if (key === "enter") this.leave("enter");
      }
      // Le altre scorciatoie (salva, cerca) restano dell'app.
      return;
    }
    if (event.altKey) return;
    if (!this.list.hidden && this.proposalKey(event.key)) {
      handled();
      return;
    }
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowRight": {
        handled();
        if (this.finishPending(true) !== "none") return;
        this.apply(rules.arrow(this.state, event.key === "ArrowLeft" ? -1 : 1));
        return;
      }
      case "ArrowUp":
      case "ArrowDown": {
        handled();
        this.finishPending(true);
        const dir = event.key === "ArrowUp" ? -1 : 1;
        // Fra numeratore e denominatore decide la frazione; altrove il disegno.
        const stacked = rules.stack(this.state, dir);
        if (stacked.kind === "move") {
          this.moveTo(stacked.caret);
          return;
        }
        const at = verticalPoint(markersIn(this.surface), this.state.caret, dir);
        if (at !== null) this.moveTo(at);
        else this.options.onLeave(dir < 0 ? "up" : "down");
        return;
      }
      case "Home":
      case "End":
        handled();
        this.finishPending(true);
        this.apply(rules.edge(this.state, event.key === "Home" ? -1 : 1));
        return;
      case "Tab":
        handled();
        if (this.finishPending() !== "none") return;
        this.apply(rules.tab(this.state, event.shiftKey));
        return;
      case "Enter":
        handled();
        if (this.finishPending() !== "none") return;
        this.leave("enter");
        return;
      case "Escape":
        handled();
        if (this.pending !== null) {
          // Prima chiude le proposte, poi toglie il nome.
          if (!this.list.hidden) {
            this.dismissed = true;
            this.offer();
            return;
          }
          this.dropPending();
          return;
        }
        this.leave("escape");
        return;
      case "Backspace":
        handled();
        if (this.pending !== null) {
          if (this.state.caret - this.pending <= 1) this.dropPending();
          else this.commit({ tex: this.state.tex.slice(0, this.state.caret - 1) + this.state.tex.slice(this.state.caret), caret: this.state.caret - 1 }, false);
          return;
        }
        this.apply(rules.backspace(this.state));
        return;
      case "Delete":
        handled();
        if (this.finishPending() !== "none") return;
        this.apply(rules.deleteForward(this.state));
        return;
      case " ":
        handled();
        if (this.finishPending() !== "none") return;
        this.apply(rules.space(this.state));
        return;
      default:
        if (event.key.length === 1) {
          handled();
          this.type(event.key);
        }
    }
  }

  // ── Le proposte dei simboli (T61) ─────────────────────────────────────────

  /// Un tasto con le proposte aperte: ↑ e ↓ scelgono, Invio, Tab e lo
  /// spazio mettono quella scelta. Gli altri passano.
  private proposalKey(key: string): boolean {
    switch (key) {
      case "ArrowDown":
      case "ArrowUp": {
        const count = this.proposals.length;
        this.active = (this.active + (key === "ArrowDown" ? 1 : count - 1)) % count;
        this.paintProposals();
        return true;
      }
      case "Enter":
      case "Tab":
      case " ": {
        const symbol = this.proposals[this.active];
        if (symbol) this.choose(symbol);
        return true;
      }
      default:
        return false;
    }
  }

  /// Le proposte per il nome che si sta scrivendo, in memoria: nessuna
  /// chiamata per tasto. Si nascondono quando non aggiungono niente.
  private offer(): void {
    const name = this.pending === null ? null : rules.pendingName(this.state, this.pending);
    let next: readonly MathSymbol[] = [];
    if (name && !this.dismissed) {
      next = propose(name);
      if (proposalsAddNothing(name, next)) next = [];
    }
    if (name === null || name === "") this.dismissed = false;
    const same = next.length === this.proposals.length && next.every((symbol, i) => symbol === this.proposals[i]);
    if (!same) {
      this.proposals = next;
      this.active = 0;
    }
    if (next.length === 0) {
      if (!this.list.hidden) {
        this.list.hidden = true;
        this.list.replaceChildren();
        this.input.removeAttribute("aria-activedescendant");
      }
      return;
    }
    if (!same || this.list.hidden) this.paintProposals(true);
  }

  private paintProposals(rebuild = false): void {
    const language = resolvedLanguage();
    if (rebuild) {
      this.list.replaceChildren(...this.proposals.map((symbol, i) => {
        const option = document.createElement("div");
        option.className = "cm-fub-mx-symbol";
        option.id = `${this.list.id}-${i}`;
        option.setAttribute("role", "option");
        const glyph = document.createElement("span");
        glyph.className = "cm-fub-mx-symbol-glyph";
        glyph.setAttribute("aria-hidden", "true");
        this.drawGlyph(symbol, glyph);
        const name = document.createElement("span");
        name.className = "cm-fub-mx-symbol-name";
        name.textContent = symbolName(symbol, language);
        option.dataset.index = String(i);
        option.append(glyph, name);
        return option;
      }));
      this.list.hidden = false;
    }
    this.list.querySelectorAll<HTMLElement>("[role=option]").forEach((option, i) => {
      option.setAttribute("aria-selected", String(i === this.active));
    });
    this.input.setAttribute("aria-activedescendant", `${this.list.id}-${this.active}`);
  }

  /// Il disegno di un simbolo, con la resa di lettura. KaTeX costruisce i
  /// nodi (gli stili passano dal CSSOM, che la CSP ammette): niente HTML in
  /// una stringa. Si disegnano solo le proposte nuove, al più cinque.
  private drawGlyph(symbol: MathSymbol, into: HTMLElement): void {
    if (!this.library) return;
    try {
      this.library.render(symbol.glyph, into, { ...readOptions(false), output: "html" });
    } catch {
      into.replaceChildren();
    }
  }

  /// Mette il simbolo al posto del nome scritto, coi suoi spazi vuoti; `false`
  /// se la formula non si leggerebbe più.
  private choose(symbol: MathSymbol): boolean {
    const from = this.pending;
    if (from === null) return false;
    const outcome = rules.insertSymbol(this.state, symbol.template, from, (tex) => this.reads(tex), { inTable: this.options.inTable });
    if (outcome.kind === "none") return false;
    this.pending = null;
    this.dismissed = false;
    // Il TeX prima della `\`: quello che si torna ad avere con Ctrl Z.
    this.state = { tex: this.state.tex.slice(0, from) + this.state.tex.slice(this.state.caret), caret: from };
    this.apply(outcome);
    // Il posto si ridice: «numeratore, spazio vuoto».
    this.said = "";
    this.announce();
    return true;
  }

  private leave(reason: LeaveReason): void {
    this.dropPending();
    this.options.onLeave(reason);
  }

  /// Un segno scritto: dentro un comando per nome le lettere lo allungano.
  private type(ch: string): void {
    if (this.pending !== null) {
      if (/[a-zA-Z]/.test(ch)) {
        this.dismissed = false;
        const { tex, caret } = this.state;
        this.commit({ tex: tex.slice(0, caret) + ch + tex.slice(caret), caret: caret + 1 }, false);
        return;
      }
      // Una `\` seguita da un segno: un simbolo come `\{` o `\,`.
      if (this.state.caret - this.pending === 1) {
        const { tex, caret } = this.state;
        const symbol: MathState = { tex: tex.slice(0, caret) + ch + tex.slice(caret), caret: caret + 1 };
        if (this.reads(symbol.tex)) {
          this.pending = null;
          this.commit(symbol);
        }
        return;
      }
      if (this.finishPending() === "kept") return;
    }
    if (ch === "\\") {
      const outcome = rules.typeChar(this.state, ch, { inTable: this.options.inTable });
      if (outcome.kind !== "edit") return;
      this.pending = outcome.state.caret - 1;
      this.commit(outcome.state);
      return;
    }
    this.apply(rules.typeChar(this.state, ch, { inTable: this.options.inTable }));
  }

  /// Finisce il comando in sospeso: `none` se non ce n'era, `done` se è
  /// entrato (o, con `drop`, se ne è andato), `kept` se resta in sospeso
  /// perché il nome non lo conosco: il tasto si ferma lì.
  private finishPending(drop = false): "none" | "done" | "kept" {
    const from = this.pending;
    if (from === null) return "none";
    // Un pezzo del catalogo entra coi suoi spazi vuoti (`\sum` è
    // `\sum_{}^{}`), anche con le proposte chiuse.
    const name = rules.pendingName(this.state, from);
    const piece = name ? SYMBOLS.find((symbol) => commandName(symbol) === `\\${name}`) : undefined;
    if (piece && this.choose(piece)) return "done";
    const outcome = rules.finishCommand(this.state, from, (tex) => this.reads(tex));
    if (!outcome) {
      if (drop) {
        this.dropPending();
        return "done";
      }
      this.status.textContent = liveStrings.t("live.math.unknown", { name: name ?? "" });
      this.said = "";
      return "kept";
    }
    this.pending = null;
    // Il TeX prima della `\`: quello che si torna ad avere con Ctrl Z.
    this.state = { tex: this.state.tex.slice(0, from) + this.state.tex.slice(this.state.caret), caret: from };
    this.apply(outcome);
    return "done";
  }

  private dropPending(): void {
    const from = this.pending;
    if (from === null) return;
    this.pending = null;
    const { tex, caret } = this.state;
    this.commit({ tex: tex.slice(0, from) + tex.slice(caret), caret: from }, false);
  }
}

/// Il posto di un punto, a parole.
function describe(place: Place): string {
  const t = liveStrings.t.bind(liveStrings);
  const base = place.base?.replace(/^\\/, "");
  switch (place.role) {
    case "exponent":
      return base ? t("live.math.place.exponent_of", { base }) : t("live.math.place.exponent");
    case "subscript":
      return base ? t("live.math.place.subscript_of", { base }) : t("live.math.place.subscript");
    case "argument":
      return t("live.math.place.argument", { command: (place.command ?? "").replace(/\*$/, "") });
    case "cell":
      return t("live.math.place.cell", { row: String(place.row ?? 1), column: String(place.column ?? 1) });
    default:
      return t(`live.math.place.${place.role}`);
  }
}
