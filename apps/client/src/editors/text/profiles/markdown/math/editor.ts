// La formula che si modifica toccandola (T60, E27): il pezzo con il DOM. Di
// serie il codice non si vede: la formula resta una formula, disegnata da
// KaTeX coi segni del cursore (`caret.ts`), e il cursore lampeggia dentro di
// lei. I tasti li prende un campo nascosto (che ospita anche l'IME) e li passa
// alle regole senza DOM (`edit.ts`); il clic e le frecce su e giù li decide la
// geometria dei segni. Quello che si scrive com'è (`a/b`, `->`, `alpha`)
// diventa LaTeX, e Backspace subito dopo lo rimette com'era (T63).
//
// Con «Mostra il LaTeX» (`editor.math.source`, T63) sotto la formula c'è il
// campo del suo LaTeX e si scrive lì; il clic sulla formula porta soltanto
// agli spazi vuoti. Il campo ha le tre misure di aiuto (`editor.math.help`):
// pieni, discreti, spenti. Le due preferenze si cambiano anche dai tre puntini
// del riquadro.
//
// Una formula che già non si legge (un errore nel file) si apre col suo
// LaTeX, in un campo a vista con la resa sopra: lì le regole del tocco non
// valgono, perché partono da una formula buona, e nemmeno gli aiuti.
//
// Nel campo, quando il LaTeX non si legge, dopo 450 ms di pausa compare sotto
// che cosa non va, in chiaro, con la correzione se è una sola (`errors.ts`,
// T64); la correzione entra soltanto col gesto della persona.
//
// Il disegno si rifà a ogni TeX nuovo, una volta per fotogramma; spostare il
// cursore non ridisegna, sposta soltanto il segno acceso.
import type katex from "katex";
import { resolvedLanguage } from "../../../../../i18n/strings";
import { iconEl } from "../../../../../ui/icons";
import { openLifetime, type Lifetime } from "../../../../../ui/lifetime";
import { MATH_HELP_LEVELS, type MathHelp } from "../../../live-reveal";
import { loadKatex, readOptions } from "../math";
import { liveStrings } from "../strings";
import { editOptions, instrument, instrumentHoles, markerElement, markersIn, nearestPoint, verticalPoint } from "./caret";
import * as rules from "./edit";
import type { MathState, Outcome, QuickUndo, QuickWrite } from "./edit";
import { alignEnter } from "./align";
import { diagnose, explain, type MathFix } from "./errors";
import { unwrapFormula } from "./paste";
import { holesOf, mapFormula, placeAt, snap, type Place, type Span } from "./points";
import { commandName, propose, proposalsAddNothing, SYMBOLS, symbolName, type MathSymbol } from "./symbols";

/// Perché il cursore lascia la formula. `close` è la chiusura scritta a mano
/// (`$`, o `$$` in un blocco): il cursore va dopo la formula, dove scrivere.
export type LeaveReason = "before" | "after" | "enter" | "escape" | "up" | "down" | "close";

/// Dove sta il cursore quando la formula si apre.
export type MathStart = "start" | "end" | { readonly x: number; readonly y: number };

/// Le due preferenze delle formule, come le vede il riquadro.
export interface MathPreferences {
  /// «Mostra il LaTeX» (`editor.math.source`).
  readonly source: boolean;
  /// Gli aiuti del campo (`editor.math.help`).
  readonly help: MathHelp;
}

export interface MathEditorOptions {
  readonly tex: string;
  /// A blocco (`$$`) o in riga.
  readonly display: boolean;
  readonly start?: MathStart;
  /// La formula sta in una riga di tabella (`|` non chiude la cella).
  readonly inTable?: boolean;
  /// Le preferenze di adesso; senza, la formula si tocca e gli aiuti sono
  /// pieni.
  readonly preferences?: MathPreferences;
  /// Una preferenza cambiata dai tre puntini: chi chiama la scrive. Senza, i
  /// tre puntini non ci sono.
  onPreferences?(next: MathPreferences): void;
  /// «Posto» nei tre puntini (T65): la formula passa da riga a blocco o
  /// indietro, e chi chiama la riscrive nella nota. Senza, la riga non c'è
  /// (una formula in un elenco, in una citazione, in una tabella).
  onPlace?(display: boolean): void;
  /// Una frase da dire a chi scrive (la prima scrittura veloce, una misura
  /// d'aiuto cambiata).
  tell?(message: string): void;
  /// Un TeX nuovo da scrivere nella nota. Non arriva a metà di un comando
  /// scritto per nome, che non si legge ancora.
  onChange(tex: string): void;
  onLeave(reason: LeaveReason): void;
  readonly lifetime: Lifetime;
}

/// Che cosa si vede: la formula che si tocca, il campo del LaTeX scelto con
/// «Mostra il LaTeX», o il LaTeX di una formula che non si legge.
export type MathMode = "visual" | "source" | "latex";

const HISTORY_LIMIT = 200;

/// I tasti che da soli non scrivono e non muovono: arrivano prima del tasto
/// che accompagnano (T66).
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "OS", "CapsLock", "Fn", "Hyper", "Super"]);
/// Quanto si aspetta, dopo l'ultimo tasto, prima di dire che cosa non va:
/// mentre si scrive niente lampeggia (E27).
export const PROBLEM_DELAY = 450;
const CARET_CLASS = "cm-fub-mx-caret";
/// Gli id delle proposte: uno per riquadro, perché il campo li nomina.
let lists = 0;
/// La prima scrittura veloce si spiega una volta per sessione.
let quickTold = false;
/// Il primo Invio che allinea si spiega una volta per sessione.
let alignTold = false;

/// La virgola decimale all'italiana vale nella lingua italiana.
const decimalComma = () => resolvedLanguage().toLowerCase().startsWith("it");

export class MathEditor {
  readonly element: HTMLElement;
  private readonly surface: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  /// Il campo, il pulsante della tavolozza (con gli aiuti discreti) e i tre
  /// puntini.
  private readonly row: HTMLElement;
  private readonly more: HTMLButtonElement | null;
  private readonly paletteToggle: HTMLButtonElement;
  private readonly settings: HTMLElement;
  private readonly note: HTMLElement;
  private readonly status: HTMLElement;
  /// Che cosa non va nel LaTeX, in chiaro, con la correzione se è una sola
  /// (T64).
  private readonly problem: HTMLElement;
  private problemTimer: ReturnType<typeof setTimeout> | null = null;
  /// La correzione che si vede, e il TeX per cui vale.
  private shownFix: { readonly tex: string; readonly fix: MathFix } | null = null;
  /// L'ultimo disegno è riuscito: il TeX di adesso si legge.
  private reading = true;
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
  /// In un blocco, la prima `$` della chiusura `$$` scritta a mano: la
  /// seconda lascia la formula.
  private dollar = false;
  /// Chi scrive ha battuto una graffa, che nella formula toccata non si
  /// scrive: scrive LaTeX a mano, e un esponente o un pedice aperto col suo
  /// tasto prende un segno solo, come `L_t` nel LaTeX.
  private handTex = false;
  /// L'esponente o il pedice appena aperto col suo tasto: vale per il tasto dopo.
  private freshScript = false;
  /// Si sta scrivendo in un esponente o in un pedice aperto col suo tasto,
  /// senza graffa: un segno come `+` o lo spazio ne esce (`leaveScript`).
  /// Un tasto che non scrive (una freccia, Invio) lo dimentica.
  private keyedScript = false;
  private mode: MathMode;
  private preferences: MathPreferences;
  /// La scrittura veloce appena fatta: Backspace subito dopo la annulla.
  private quickUndo: QuickUndo | null = null;
  /// La fila dei pezzi della tavolozza, dove stanno i tre puntini del blocco.
  private palette: { readonly row: HTMLElement; focus(): void; retell(): void } | null = null;
  private library: typeof katex | null = null;
  private frame = 0;
  private start: MathStart | null;
  private readonly undoStack: MathState[] = [];
  private readonly redoStack: MathState[] = [];
  private said = "";
  /// La scelta (T66): dove è cominciata e dove arriva la punta; `piece` sono
  /// i pezzi interi che prende (`choosePiece`), `null` senza scelta.
  private pick: { readonly anchor: number; readonly head: number } | null = null;
  private piece: Span | null = null;
  /// Il puntatore premuto sulla formula: il mouse trascinando sceglie, il
  /// dito porta il cursore con sé.
  private drag: { readonly id: number; readonly touch: boolean; readonly anchor: number } | null = null;

  constructor(private readonly options: MathEditorOptions) {
    this.life = openLifetime();
    options.lifetime.add(() => this.life.close());
    this.state = { tex: options.tex, caret: options.tex.length };
    this.start = options.start ?? "end";
    this.preferences = options.preferences ?? { source: false, help: "piene" };
    this.mode = this.preferences.source ? "source" : "visual";
    const t = liveStrings.t.bind(liveStrings);

    this.element = document.createElement("div");
    this.element.className = "cm-fub-mx";
    this.element.dataset.display = options.display ? "block" : "inline";

    this.surface = document.createElement("div");
    this.surface.className = "cm-fub-mx-surface";
    this.surface.dataset.state = "loading";

    this.input = document.createElement("textarea");
    this.input.rows = 1;
    this.input.spellcheck = false;
    this.input.setAttribute("autocomplete", "off");
    this.input.setAttribute("autocapitalize", "off");

    this.row = document.createElement("div");
    this.row.className = "cm-fub-mx-row";

    this.paletteToggle = document.createElement("button");
    this.paletteToggle.type = "button";
    this.paletteToggle.className = "cm-fub-mx-palette-toggle";
    this.paletteToggle.textContent = t("live.math.palette.show");
    this.paletteToggle.setAttribute("aria-expanded", "false");
    this.paletteToggle.hidden = true;

    this.settings = document.createElement("div");
    this.settings.className = "cm-fub-mx-options";
    this.settings.id = `cm-fub-mx-options-${lists + 1}`;
    this.settings.hidden = true;
    this.settings.setAttribute("role", "group");
    this.settings.setAttribute("aria-label", t("live.math.options"));

    if (options.onPreferences) {
      this.more = document.createElement("button");
      this.more.type = "button";
      this.more.className = "cm-fub-mx-more";
      this.more.setAttribute("aria-label", t("live.math.options"));
      this.more.title = t("live.math.options");
      this.more.setAttribute("aria-expanded", "false");
      this.more.setAttribute("aria-controls", this.settings.id);
      const dots = iconEl("more");
      dots?.setAttribute("aria-hidden", "true");
      if (dots) this.more.append(dots);
    } else {
      this.more = null;
    }
    this.row.append(this.input, this.paletteToggle, ...(this.more ? [this.more] : []));

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
    this.list.setAttribute("aria-label", t("live.math.symbols"));
    this.input.setAttribute("aria-controls", this.list.id);

    this.problem = document.createElement("div");
    this.problem.className = "cm-fub-mx-error";
    this.problem.hidden = true;
    this.problem.setAttribute("role", "status");

    this.element.append(this.surface, this.row, this.settings, this.list, this.note, this.status, this.problem);
    this.applyMode();
    this.listen();
    this.life.add(() => cancelAnimationFrame(this.frame));
    this.life.add(() => this.cancelProblem());

    void loadKatex().then((library) => {
      if (this.life.closed) return;
      this.library = library;
      // Il comando che si sta scrivendo per nome (`\fr`) non si legge ancora,
      // e non fa della formula una da scrivere in LaTeX: conta il resto.
      const { tex, caret } = this.state;
      const settled = this.pending === null ? tex : tex.slice(0, this.pending) + tex.slice(caret);
      if (this.mode === "visual" && !this.reads(settled)) this.toMode("latex");
      this.paint();
    }, () => {
      if (!this.life.closed && this.mode === "visual") this.toMode("latex");
    });
  }

  /// Il TeX di adesso.
  get tex(): string {
    return this.state.tex;
  }

  /// Che cosa si vede adesso.
  get currentMode(): MathMode {
    return this.mode;
  }

  /// Gli aiuti che valgono adesso: pieni nella formula che si tocca, nessuno
  /// nel LaTeX di una formula che non si legge.
  get help(): MathHelp {
    return this.mode === "visual" ? "piene" : this.mode === "latex" ? "spente" : this.preferences.help;
  }

  focus(): void {
    this.input.focus({ preventScroll: true });
  }

  /// La tavolozza è attaccata sotto la formula (`palette.ts`): `row` è la
  /// fila dei pezzi, `focus` porta il fuoco nei pezzi.
  adoptPalette(palette: { readonly row: HTMLElement; focus(): void; retell(): void }): void {
    this.palette = palette;
    this.placeMore();
    this.applyHelp();
  }

  /// Le preferenze cambiate fuori (le Impostazioni, un altro riquadro): la
  /// formula resta aperta col suo TeX e il cursore dov'era.
  configure(next: MathPreferences): void {
    if (this.life.closed) return;
    const sourceChanged = next.source !== this.preferences.source;
    const helpChanged = next.help !== this.preferences.help;
    if (!sourceChanged && !helpChanged) return;
    this.preferences = next;
    if (sourceChanged) {
      const focused = this.element.contains(document.activeElement);
      this.dropPending();
      if (next.source) this.toMode("source");
      else this.toMode(this.library && !this.reads(this.state.tex) ? "latex" : "visual");
      this.paint();
      if (focused) this.focus();
    } else {
      this.applyHelp();
      this.offer();
    }
    if (!this.settings.hidden) this.fillOptions();
  }

  /// Un simbolo scelto nella tavolozza (T62): entra dove sta il cursore, coi
  /// suoi spazi vuoti e il cursore nel primo, come una proposta. Un nome che
  /// si stava scrivendo dopo `\` se ne va. `false` se la formula non si
  /// leggerebbe più (un pezzo dentro `\text{}`) o se si vede il LaTeX di una
  /// formula che non si legge.
  insert(symbol: MathSymbol): boolean {
    if (this.life.closed || this.mode === "latex") return false;
    this.quickUndo = null;
    if (this.mode === "source") {
      const from = Math.min(this.input.selectionStart, this.input.selectionEnd);
      const to = Math.max(this.input.selectionStart, this.input.selectionEnd);
      this.writeField(rules.insertTemplate({ tex: this.state.tex, caret: from }, symbol.template, from, to));
      return true;
    }
    this.dropPending();
    // Un pezzo scelto va dentro il pezzo nuovo: sotto la radice, nel
    // numeratore, nell'esponente (T66).
    const outcome = this.piece
      ? rules.wrapPiece(this.state.tex, this.piece, symbol.template, (tex) => this.reads(tex), { inTable: this.options.inTable })
      : rules.insertSymbol(this.state, symbol.template, this.state.caret, (tex) => this.reads(tex), { inTable: this.options.inTable });
    if (outcome.kind === "none") return false;
    this.apply(outcome);
    // Il posto si ridice: «numeratore, spazio vuoto».
    this.said = "";
    this.announce();
    return true;
  }

  // ── Il modo ───────────────────────────────────────────────────────────────

  private toMode(mode: MathMode): void {
    this.mode = mode;
    this.pending = null;
    this.quickUndo = null;
    this.applyMode();
  }

  private applyMode(): void {
    const t = liveStrings.t.bind(liveStrings);
    const mode = this.mode;
    this.element.dataset.mode = mode;
    // Al tocco il dito sulla formula porta il cursore, in ogni direzione (fra
    // numeratore e denominatore si va anche in su e in giù): la nota non
    // scorre sotto di lui. Sta nel codice perché è un comportamento, non un
    // aspetto, e la pelle non ha `touch-action` (T66).
    this.surface.style.touchAction = mode === "visual" ? "none" : "";
    this.syncNote();
    if (mode === "visual") {
      this.input.className = "cm-fub-mx-input";
      this.input.value = "";
      this.input.removeAttribute("placeholder");
      // La formula fa parte del testo della nota, che è una fermata sola del
      // Tab: ci si entra col cursore (le frecce, il clic), e dentro Tab va da
      // uno spazio vuoto all'altro.
      this.input.tabIndex = -1;
      this.input.setAttribute("aria-label", t("live.math.edit"));
    } else {
      this.input.className = mode === "source" ? "cm-fub-mx-latex cm-fub-mx-field" : "cm-fub-mx-latex";
      this.input.value = this.state.tex;
      this.input.tabIndex = 0;
      this.input.setAttribute("aria-label", t("live.math.source"));
      this.input.removeAttribute("placeholder");
      const caret = Math.min(this.state.caret, this.input.value.length);
      this.input.setSelectionRange(caret, caret);
      this.grow();
    }
    if (mode === "latex") this.note.textContent = t("live.math.latex");
    this.hideProposals();
    this.placeMore();
    this.applyHelp();
    this.palette?.retell();
    this.showCaret();
  }

  /// Gli aiuti sulla pelle: la tavolozza si vede coi pieni, a richiesta coi
  /// discreti, mai con gli spenti.
  private applyHelp(): void {
    const help = this.help;
    this.element.dataset.help = help;
    if (this.mode === "source") {
      // Con gli aiuti spenti sotto non c'è niente da scegliere.
      this.input.placeholder = liveStrings.t(help === "spente" ? "live.math.source_placeholder_quiet" : "live.math.source_placeholder");
    }
    const onRequest = this.mode === "source" && help === "discrete" && this.palette !== null;
    this.paletteToggle.hidden = !onRequest;
    if (!onRequest) {
      delete this.element.dataset.palette;
      this.paletteToggle.setAttribute("aria-expanded", "false");
    }
    if (help === "spente") this.hideProposals();
  }

  /// I tre puntini: in cima a destra della formula in riga, accanto al campo
  /// del LaTeX, in fondo alla fila dei pezzi sotto un blocco toccato.
  private placeMore(): void {
    if (!this.more) return;
    const inPalette = this.mode === "visual" && this.options.display && this.palette !== null;
    const parent = inPalette ? this.palette!.row : this.row;
    if (this.more.parentElement !== parent) parent.append(this.more);
  }

  // ── Il disegno ─────────────────────────────────────────────────────────────

  private reads(tex: string): boolean {
    if (!this.library) return false;
    try {
      this.library.renderToString(tex, readOptions(this.options.display, tex));
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
      if (this.mode === "visual") {
        const pending = this.pending === null ? null : { from: this.pending, to: this.state.caret };
        try {
          library.render(instrument(tex, pending, this.piece), staging, editOptions(this.options.display, tex));
        } catch (error) {
          // Un pezzo scelto che KaTeX non sa chiudere in un gruppo (un `\\`
          // al primo livello): la formula si disegna senza il suo colore.
          if (!this.piece) throw error;
          staging.replaceChildren();
          library.render(instrument(tex, pending), staging, editOptions(this.options.display, tex));
        }
      } else {
        // Nel campo del LaTeX soltanto gli spazi vuoti hanno il loro segno.
        library.render(instrumentHoles(tex, rules.sourceHoles(tex)), staging, editOptions(this.options.display, tex));
      }
    } catch {
      // Senza una resa buona il riquadro si toglie finché il LaTeX non si
      // legge. Con una, resta com'è mentre si scrive; dopo una pausa si
      // attenua, e sotto il campo compare che cosa non va (T64).
      if (this.surface.childElementCount === 0) this.surface.dataset.state = "empty";
      this.reading = false;
      // La formula com'era nel file non si sta scrivendo: si dice subito.
      if (tex === this.options.tex) {
        this.cancelProblem();
        this.showProblem();
      } else {
        this.scheduleProblem();
      }
      return;
    }
    this.reading = true;
    this.clearProblem();
    const nodes: Node[] = [...staging.childNodes];
    if (tex.trim() === "" && this.mode !== "latex") {
      const placeholder = document.createElement("span");
      placeholder.className = "cm-fub-mx-placeholder";
      placeholder.textContent = liveStrings.t(this.mode === "visual" ? "live.math.empty" : "live.math.preview_empty");
      nodes.push(placeholder);
    }
    this.surface.replaceChildren(...nodes);
    this.surface.dataset.state = "ready";
    this.showCaret();
    if (this.start !== null && this.mode === "visual") {
      const start = this.start;
      this.start = null;
      if (typeof start === "object") {
        const at = nearestPoint(markersIn(this.surface), start.x, start.y);
        if (at !== null) this.moveTo(at);
      } else if (start === "start") {
        this.moveTo(mapFormula(tex).points[0]?.at ?? 0);
      }
    } else if (this.start !== null) {
      // Nel campo il cursore va in fondo, o all'inizio entrando da sinistra.
      const at = this.start === "start" ? 0 : this.state.tex.length;
      this.start = null;
      this.input.setSelectionRange(at, at);
      this.state = { tex: this.state.tex, caret: at };
      this.showCaret();
    }
  }

  /// Accende il segno del cursore, senza ridisegnare: nella formula che si
  /// tocca il punto in cui si è, nel campo lo spazio vuoto in cui si scrive.
  private showCaret(): void {
    for (const lit of this.surface.querySelectorAll(`.${CARET_CLASS}`)) lit.classList.remove(CARET_CLASS);
    if (this.mode === "latex") return;
    // Con un pezzo scelto il cursore non si vede: si vede il pezzo.
    if (this.piece && this.mode === "visual") return;
    const marker = markerElement(this.surface, this.state.caret);
    marker?.classList.add(CARET_CLASS);
    if (marker && this.mode === "visual") this.keepInView(marker);
  }

  /// Una formula più larga del riquadro scorre: il cursore resta in vista
  /// (le frecce, il dito che lo porta oltre il bordo). Si muove soltanto il
  /// riquadro, mai la nota.
  private keepInView(marker: HTMLElement): void {
    const surface = this.surface;
    if (surface.scrollWidth <= surface.clientWidth) return;
    const box = surface.getBoundingClientRect();
    const x = marker.getBoundingClientRect().left;
    const margin = 24;
    if (x < box.left + margin) surface.scrollLeft -= box.left + margin - x;
    else if (x > box.right - margin) surface.scrollLeft += x - (box.right - margin);
  }

  // ── Gli errori in chiaro (T64) ─────────────────────────────────────────────

  /// Il LaTeX non si legge: la frase arriva dopo una pausa. Ogni tasto la
  /// rimanda; quella che si vede resta finché non arriva la nuova.
  private scheduleProblem(): void {
    this.cancelProblem();
    this.problemTimer = setTimeout(() => {
      this.problemTimer = null;
      this.showProblem();
    }, PROBLEM_DELAY);
  }

  private cancelProblem(): void {
    if (this.problemTimer === null) return;
    clearTimeout(this.problemTimer);
    this.problemTimer = null;
  }

  /// Dice che cosa non va nel TeX di adesso. Si chiede a KaTeX il TeX com'è
  /// nel file, senza i segni degli spazi vuoti, così le posizioni sono quelle
  /// del campo.
  private showProblem(): void {
    const library = this.library;
    if (!library || this.life.closed) return;
    const tex = this.state.tex;
    let failure: unknown = null;
    try {
      library.renderToString(tex, readOptions(this.options.display, tex));
    } catch (error) {
      failure = error;
    }
    if (failure === null) {
      this.clearProblem();
      return;
    }
    if (this.surface.childElementCount > 0) this.surface.dataset.state = "stale";
    // Nella formula che si tocca il TeX resta sempre leggibile: la frase è
    // del campo del LaTeX.
    if (this.mode === "visual") return;
    const diagnosis = diagnose(failure, tex);
    const text = explain(diagnosis);
    const sentence = document.createElement("span");
    sentence.className = "cm-fub-mx-error-text";
    for (const part of text.parts) {
      if ("code" in part) {
        const code = document.createElement("code");
        code.textContent = part.code;
        sentence.append(code);
      } else {
        sentence.append(part.text);
      }
    }
    const nodes: Node[] = [sentence];
    this.shownFix = diagnosis.fix && text.fix ? { tex, fix: diagnosis.fix } : null;
    if (this.shownFix && text.fix) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cm-fub-mx-error-fix";
      button.textContent = text.fix;
      nodes.push(button);
    }
    const focused = this.problem.contains(document.activeElement);
    this.problem.replaceChildren(...nodes);
    this.problem.hidden = false;
    this.syncNote();
    // Il fuoco che stava sul pulsante di prima resta nella formula.
    if (focused) (this.problem.querySelector<HTMLElement>(".cm-fub-mx-error-fix") ?? this.input).focus({ preventScroll: true });
  }

  /// Il LaTeX si legge: la frase se ne va subito.
  private clearProblem(): void {
    this.cancelProblem();
    if (this.surface.dataset.state === "stale") this.surface.dataset.state = "ready";
    this.shownFix = null;
    if (!this.problem.hidden) {
      const focused = this.problem.contains(document.activeElement);
      this.problem.hidden = true;
      this.problem.replaceChildren();
      if (focused) this.focus();
    }
    this.syncNote();
  }

  /// La correzione scelta dalla persona: il TeX cambia adesso, in un passo
  /// solo dell'annulla. Se intanto il TeX è cambiato la correzione è vecchia:
  /// non si applica, e la frase si rifà sul TeX di adesso.
  private applyFix(): void {
    const shown = this.shownFix;
    if (!shown || this.mode === "visual" || this.life.closed) return;
    if (shown.tex !== this.state.tex) {
      this.cancelProblem();
      this.showProblem();
      return;
    }
    this.quickUndo = null;
    this.writeField({ tex: shown.fix.tex, caret: Math.min(shown.fix.caret, shown.fix.tex.length) });
    this.focus();
  }

  /// La nota del LaTeX di una formula che non si legge lascia il posto alla
  /// frase che dice che cosa non va, e se ne va quando la formula si legge.
  private syncNote(): void {
    this.note.hidden = this.mode !== "latex" || this.reading || !this.problem.hidden;
  }

  // ── Lo stato ───────────────────────────────────────────────────────────────

  private moveTo(caret: number): void {
    this.dropPick();
    this.state = { tex: this.state.tex, caret };
    this.showCaret();
    this.announce();
  }

  // ── Il pezzo scelto (T66) ──────────────────────────────────────────────────

  /// Sceglie i pezzi interi fra `anchor` e `head`; il cursore sta dalla parte
  /// della punta. Una scelta vuota torna il cursore in `head`.
  private pickPieces(anchor: number, head: number): void {
    const { tex } = this.state;
    const piece = rules.choosePiece(tex, anchor, head);
    if (!piece) {
      this.moveTo(snap(mapFormula(tex), head));
      return;
    }
    const same = this.piece !== null && this.piece.from === piece.from && this.piece.to === piece.to;
    this.pick = { anchor, head };
    this.piece = piece;
    this.state = { tex, caret: snap(mapFormula(tex), head >= anchor ? piece.to : piece.from) };
    if (same) return;
    this.element.dataset.chosen = "true";
    this.schedule();
    this.say(liveStrings.t("live.math.chosen"));
  }

  /// Toglie la scelta, senza toccare il TeX.
  private dropPick(): void {
    if (!this.pick) return;
    this.pick = null;
    this.piece = null;
    delete this.element.dataset.chosen;
    this.said = "";
    this.schedule();
  }

  /// Il clic o il tocco in `x`, `y`: il cursore nel punto più vicino, o con
  /// `extend` la scelta fin lì. Torna il punto, o `null` se non ce n'è.
  private pointAt(x: number, y: number, extend: boolean): number | null {
    this.finishPending(true);
    const at = nearestPoint(markersIn(this.surface), x, y);
    if (at === null) return null;
    if (extend) this.pickPieces(this.pick?.anchor ?? this.state.caret, at);
    else this.moveTo(at);
    return at;
  }

  /// Lascia la scelta e mette il cursore al suo inizio o alla sua fine.
  private collapse(side: -1 | 1): void {
    const piece = this.piece;
    if (!piece) return;
    this.moveTo(snap(mapFormula(this.state.tex), side < 0 ? piece.from : piece.to));
  }

  /// Un cambiamento sul pezzo scelto: entra se la formula si legge ancora.
  private applyToPiece(outcome: Outcome): boolean {
    if (outcome.kind !== "edit" || !this.reads(outcome.state.tex)) return false;
    this.commit(outcome.state);
    return true;
  }

  /// Copia il LaTeX del pezzo scelto; con `cut` lo toglie anche.
  private copyPiece(data: DataTransfer | null, cut: boolean): boolean {
    const piece = this.piece;
    if (!piece || !data) return false;
    data.setData("text/plain", rules.pieceText(this.state.tex, piece));
    if (cut) this.applyToPiece(rules.removePiece(this.state.tex, piece));
    else this.say(liveStrings.t("live.math.copied"));
    return true;
  }

  private commit(next: MathState, record = true): void {
    if (this.pick) {
      this.pick = null;
      this.piece = null;
      delete this.element.dataset.chosen;
      this.said = "";
      if (next.tex === this.state.tex) this.schedule();
    }
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
    this.quickUndo = null;
    if (this.mode !== "visual") this.setField(next);
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
    if (holesOf(map).includes(caret) || rules.emptyCells(map).includes(caret)) text = liveStrings.t("live.math.place.hole", { place: text });
    if (text === this.said) return;
    this.said = text;
    this.status.textContent = text;
  }

  /// Dice una frase al lettore di schermo, anche se è la stessa di prima.
  private say(text: string): void {
    this.said = "";
    this.status.textContent = text;
  }

  // ── Il campo del LaTeX ────────────────────────────────────────────────────

  private grow(): void {
    this.input.rows = Math.min(8, Math.max(1, this.input.value.split("\n").length));
  }

  /// Mette nel campo un TeX e un cursore, senza passare dall'`input`.
  private setField(next: MathState): void {
    if (this.input.value !== next.tex) this.input.value = next.tex;
    this.input.setSelectionRange(next.caret, next.caret);
    this.grow();
  }

  /// Un TeX nuovo dal campo, scritto da una regola (una parentesi, una
  /// proposta, la tavolozza).
  private writeField(next: MathState): void {
    this.setField(next);
    this.commit(next);
  }

  /// Il cursore del campo, dopo una freccia o un clic.
  private readField(): void {
    const caret = this.input.selectionStart;
    if (caret === this.state.caret && this.input.value === this.state.tex) return;
    this.state = { tex: this.input.value, caret };
    this.showCaret();
    this.offer();
  }

  private fieldInput(event: Event): void {
    this.quickUndo = null;
    let next: MathState = { tex: this.input.value, caret: this.input.selectionStart };
    const typed = event instanceof InputEvent && event.inputType === "insertText" && !event.isComposing ? event.data : null;
    if (typed && this.mode === "source") {
      const quick = rules.quickWrite(next, typed, { help: this.help, decimalComma: decimalComma() });
      if (quick) {
        next = quick.state;
        this.setField(next);
        this.noteQuick(quick);
      }
    }
    this.grow();
    this.dismissed = false;
    this.commit(next);
  }

  /// I tasti del campo del LaTeX: le parentesi che si chiudono, le proposte,
  /// Backspace che annulla la scrittura veloce, Tab fra gli spazi vuoti.
  private fieldKeydown(event: KeyboardEvent): void {
    const undo = this.quickUndo;
    this.quickUndo = null;
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    const mod = event.ctrlKey || event.metaKey;
    const help = this.help;
    const caret = this.input.selectionStart;
    const collapsed = caret === this.input.selectionEnd;
    const here: MathState = { tex: this.input.value, caret };
    if (this.optionsKey(event)) return;
    if (mod && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === "z" || key === "y") {
        handled();
        this.history(key === "y" || event.shiftKey ? "redo" : "undo");
      } else if (key === "enter") {
        handled();
        this.options.onLeave("enter");
      }
      return;
    }
    if (!this.list.hidden && help !== "spente" && this.proposalKey(event.key)) {
      handled();
      return;
    }
    if (event.altKey) return;
    switch (event.key) {
      case "Enter":
        if (event.shiftKey) return;
        handled();
        // A blocco Invio va a capo e allinea gli uguali; Ctrl Invio o Esc
        // finiscono (T65).
        if (this.options.display && this.mode === "source" && collapsed) {
          this.writeField(alignEnter(here));
          this.tellAlign();
          return;
        }
        this.options.onLeave("enter");
        return;
      case "Escape":
        handled();
        if (!this.list.hidden) {
          this.dismissed = true;
          this.hideProposals();
          return;
        }
        this.options.onLeave("escape");
        return;
      case "Tab": {
        const outcome = rules.sourceTab(here, event.shiftKey);
        // Dopo l'ultimo spazio vuoto il Tab segue la pagina: i tre puntini,
        // la tavolozza, poi fuori dal riquadro, come dalla tavolozza. Lo
        // stesso con una correzione da scegliere (T64).
        if (outcome.kind === "leave" && (this.more || this.shownFix)) return;
        handled();
        if (outcome.kind === "move") {
          this.input.setSelectionRange(outcome.caret, outcome.caret);
          this.readField();
        } else if (outcome.kind === "leave") {
          this.options.onLeave(outcome.side);
        }
        return;
      }
      case "Backspace": {
        if (!collapsed) return;
        const back = undo ? rules.undoQuick(here, undo) : null;
        const pair = back ?? (help !== "spente" ? rules.dropPair(here) : null);
        if (!pair) return;
        handled();
        this.writeField(pair);
        return;
      }
      default:
        break;
    }
    if (help === "spente" || !collapsed || event.key.length !== 1) return;
    const over = rules.stepOver(here, event.key);
    if (over !== null) {
      handled();
      this.input.setSelectionRange(over, over);
      this.readField();
      return;
    }
    const pair = rules.openPair(here, event.key);
    if (pair) {
      handled();
      this.writeField(pair);
    }
  }

  // ── I tre puntini ─────────────────────────────────────────────────────────

  private toggleOptions(open = this.settings.hidden, focus = false): void {
    if (!this.more) return;
    this.more.setAttribute("aria-expanded", String(open));
    if (open) this.fillOptions();
    this.settings.hidden = !open;
    if (open && focus) this.settings.querySelector<HTMLElement>("[aria-pressed=\"true\"]")?.focus();
  }

  /// Le righe dei tre puntini: «Mostra il LaTeX» (No, Sì) e, col campo, gli
  /// aiuti (Pieni, Discreti, Spenti).
  private fillOptions(): void {
    const t = liveStrings.t.bind(liveStrings);
    const rows: HTMLElement[] = [];
    const row = (label: string, buttons: readonly (readonly [string, string, boolean])[], kind: "source" | "help" | "place") => {
      const line = document.createElement("div");
      line.className = "cm-fub-mx-option";
      const name = document.createElement("span");
      name.className = "cm-fub-mx-option-name";
      name.id = `${this.settings.id}-${kind}`;
      name.textContent = label;
      const segments = document.createElement("span");
      segments.className = "cm-fub-mx-segments";
      segments.setAttribute("role", "group");
      segments.setAttribute("aria-labelledby", name.id);
      for (const [value, text, pressed] of buttons) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "cm-fub-mx-segment";
        button.dataset[kind] = value;
        button.textContent = text;
        button.setAttribute("aria-pressed", String(pressed));
        segments.append(button);
      }
      line.append(name, segments);
      rows.push(line);
    };
    const source = this.preferences.source;
    row(t("live.math.options.source"), [["off", t("live.math.options.no"), !source], ["on", t("live.math.options.yes"), source]], "source");
    if (source) {
      row(t("live.math.options.help"), MATH_HELP_LEVELS.map((level) => [level, t(`live.math.help.${level}`), this.preferences.help === level] as const), "help");
    }
    if (this.options.onPlace) {
      const display = this.options.display;
      row(t("live.math.options.place"), [["inline", t("live.math.options.inline"), !display], ["block", t("live.math.options.block"), display]], "place");
    }
    this.settings.replaceChildren(...rows);
  }

  /// Un pulsante dei tre puntini: la preferenza vale subito qui e per tutte le
  /// formule, e chi chiama la scrive nelle Impostazioni.
  private choose3Dots(target: Element): void {
    const sourceButton = target.closest<HTMLElement>("[data-source]");
    const helpButton = target.closest<HTMLElement>("[data-help]");
    const placeButton = target.closest<HTMLElement>("[data-place]");
    const t = liveStrings.t.bind(liveStrings);
    if (placeButton) {
      const display = placeButton.dataset.place === "block";
      if (display === this.options.display || !this.options.onPlace) return;
      this.toggleOptions(false);
      this.options.onPlace(display);
      return;
    }
    if (sourceButton) {
      const source = sourceButton.dataset.source === "on";
      if (source === this.preferences.source) return;
      const next = { ...this.preferences, source };
      this.configure(next);
      this.toggleOptions(false);
      this.focus();
      this.options.onPreferences?.(next);
      this.options.tell?.(t(source ? "live.math.told.source_on" : "live.math.told.source_off"));
      return;
    }
    if (helpButton) {
      const help = helpButton.dataset.help as MathHelp;
      if (!MATH_HELP_LEVELS.includes(help) || help === this.preferences.help) return;
      const next = { ...this.preferences, help };
      this.configure(next);
      this.fillOptions();
      this.settings.querySelector<HTMLElement>(`[data-help="${help}"]`)?.focus();
      this.options.onPreferences?.(next);
      this.options.tell?.(t(`live.math.told.help_${help}`));
    }
  }

  /// Maiusc F10 o il tasto del menu aprono i tre puntini.
  private optionsKey(event: KeyboardEvent): boolean {
    if (!this.more) return false;
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault();
      event.stopPropagation();
      this.toggleOptions(true, true);
      return true;
    }
    return false;
  }

  // ── I gesti ───────────────────────────────────────────────────────────────

  private listen(): void {
    const on = <K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, handler: (event: HTMLElementEventMap[K]) => void) => {
      target.addEventListener(type, handler as EventListener);
      this.life.add(() => target.removeEventListener(type, handler as EventListener));
    };
    on(this.input, "keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (this.mode === "visual") this.keydown(event);
      else this.fieldKeydown(event);
    });
    on(this.input, "beforeinput", (event) => {
      // In vista nessun tasto scrive da sé: lo fanno le regole. Resta l'IME,
      // che si raccoglie alla fine della composizione.
      if (this.mode === "visual" && !event.isComposing && event.inputType !== "insertCompositionText") event.preventDefault();
    });
    on(this.input, "compositionend", (event) => {
      if (this.mode !== "visual") return;
      this.input.value = "";
      // Il testo dell'IME prende il posto del pezzo scelto (T66).
      const piece = this.piece;
      if (piece && event.data && !this.applyToPiece(rules.removePiece(this.state.tex, piece))) return;
      // L'IME scrive il suo testo com'è: niente scrittura veloce.
      for (const ch of event.data ?? "") this.type(ch, false);
    });
    on(this.input, "input", (event) => {
      if (this.mode !== "visual") this.fieldInput(event);
    });
    on(this.input, "keyup", (event) => {
      if (this.mode !== "visual" && /^(Arrow|Home|End|Page)/.test(event.key)) this.readField();
    });
    on(this.input, "click", () => {
      if (this.mode !== "visual") this.readField();
    });
    on(this.input, "paste", (event) => {
      const text = event.clipboardData?.getData("text/plain") ?? "";
      // Una formula incollata coi suoi delimitatori entra senza (T65).
      const unwrapped = unwrapFormula(text);
      if (this.mode !== "visual") {
        if (!unwrapped) return;
        event.preventDefault();
        this.quickUndo = null;
        const from = Math.min(this.input.selectionStart, this.input.selectionEnd);
        const to = Math.max(this.input.selectionStart, this.input.selectionEnd);
        const tex = this.input.value;
        this.writeField({ tex: tex.slice(0, from) + unwrapped.tex + tex.slice(to), caret: from + unwrapped.tex.length });
        return;
      }
      event.preventDefault();
      this.quickUndo = null;
      this.finishPending();
      const pasted = unwrapped ? unwrapped.tex : text;
      const piece = this.piece;
      if (piece) {
        // Ciò che si incolla prende il posto del pezzo scelto, in un passo
        // solo dell'annulla; se non entra, il pezzo resta.
        const removed = rules.removePiece(this.state.tex, piece);
        const outcome = removed.kind === "edit" ? rules.insertText(removed.state, pasted) : removed;
        this.applyToPiece(outcome);
        return;
      }
      this.apply(rules.insertText(this.state, pasted));
    });
    // Ctrl C e Ctrl X col pezzo scelto (T66): il suo LaTeX, senza dollari,
    // che si incolla in un'altra formula.
    for (const type of ["copy", "cut"] as const) {
      on(this.input, type, (event) => {
        if (this.mode !== "visual") return;
        this.input.value = "";
        if (!this.piece) return;
        event.preventDefault();
        event.stopPropagation();
        this.copyPiece(event.clipboardData, type === "cut");
      });
    }
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
      if (event.button !== 0 || this.mode === "latex") return;
      // Il fuoco resta nel campo: il clic porta soltanto il cursore.
      event.preventDefault();
      event.stopPropagation();
      this.quickUndo = null;
      if (this.mode === "source") {
        // Col campo il clic porta soltanto agli spazi vuoti.
        const hole = (event.target as Element | null)?.closest<HTMLElement>("[data-fubhole]");
        const at = hole ? Number(hole.getAttribute("data-fubp")) : NaN;
        this.focus();
        if (Number.isSafeInteger(at) && at <= this.input.value.length) {
          this.input.setSelectionRange(at, at);
          this.readField();
        }
        return;
      }
      // Col mouse il cursore l'ha già portato `pointerdown`, che sta
      // trascinando; il tocco arriva qui dopo il dito alzato, nello stesso
      // punto.
      if (this.drag === null) this.pointAt(event.clientX, event.clientY, event.shiftKey);
      this.focus();
    });
    // Il puntatore sulla formula che si tocca (T66). Il mouse: il clic porta
    // il cursore, Maiusc clic e il trascinamento scelgono pezzi interi. Il
    // dito: il tocco porta il cursore, e trascinando il cursore lo segue;
    // niente scelta e niente che compaia al passaggio.
    on(this.surface, "pointerdown", (event) => {
      if (this.mode !== "visual" || !event.isPrimary || event.button !== 0) return;
      const touch = event.pointerType === "touch";
      this.quickUndo = null;
      const anchor = this.pointAt(event.clientX, event.clientY, event.shiftKey && !touch);
      if (anchor === null) return;
      this.drag = { id: event.pointerId, touch, anchor: this.pick?.anchor ?? anchor };
      this.surface.setPointerCapture?.(event.pointerId);
    });
    on(this.surface, "pointermove", (event) => {
      const drag = this.drag;
      if (!drag || event.pointerId !== drag.id || this.mode !== "visual") return;
      const at = nearestPoint(markersIn(this.surface), event.clientX, event.clientY);
      if (at === null) return;
      if (drag.touch) {
        if (at !== this.state.caret || this.pick) this.moveTo(at);
      } else if (at === drag.anchor) {
        if (this.pick) this.moveTo(at);
      } else {
        this.pickPieces(drag.anchor, at);
      }
    });
    const release = (event: PointerEvent) => {
      if (this.drag?.id !== event.pointerId) return;
      this.drag = null;
      if (this.surface.hasPointerCapture?.(event.pointerId)) this.surface.releasePointerCapture(event.pointerId);
    };
    on(this.surface, "pointerup", release);
    on(this.surface, "pointercancel", release);
    on(this.row, "mousedown", (event) => {
      // I pulsanti della fila non rubano il fuoco al campo.
      if (event.target !== this.input) event.preventDefault();
      event.stopPropagation();
    });
    on(this.settings, "mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    on(this.problem, "mousedown", (event) => {
      // La correzione non ruba il fuoco al campo, e la frase non chiude il
      // riquadro.
      event.preventDefault();
      event.stopPropagation();
    });
    on(this.problem, "keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.focus();
    });
    on(this.element, "click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (this.more && target.closest(".cm-fub-mx-more") === this.more) {
        this.toggleOptions(undefined, event.detail === 0);
        return;
      }
      if (target.closest(".cm-fub-mx-error-fix")) {
        this.applyFix();
        return;
      }
      if (target.closest(".cm-fub-mx-palette-toggle")) {
        this.showPalette(this.element.dataset.palette !== "open", event.detail === 0);
        return;
      }
      if (this.settings.contains(target)) this.choose3Dots(target);
    });
    on(this.settings, "keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.toggleOptions(false);
      this.focus();
    });
    on(this.element, "keydown", (event) => {
      // Alt ↓ con gli aiuti discreti apre la tavolozza a richiesta.
      if (event.key !== "ArrowDown" || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (this.mode !== "source" || this.help !== "discrete") return;
      if (event.target !== this.input) return;
      event.preventDefault();
      event.stopPropagation();
      this.showPalette(true, true);
    });
  }

  /// La tavolozza a richiesta, con gli aiuti discreti.
  private showPalette(open: boolean, focus: boolean): void {
    if (this.paletteToggle.hidden) return;
    if (open) this.element.dataset.palette = "open";
    else delete this.element.dataset.palette;
    this.paletteToggle.setAttribute("aria-expanded", String(open));
    if (open && focus) this.palette?.focus();
  }

  private keydown(event: KeyboardEvent): void {
    // Un tasto modificatore da solo (Maiusc premuto prima di ←) non fa niente:
    // né lascia la scelta né chiude la scrittura veloce.
    if (MODIFIER_KEYS.has(event.key)) return;
    // La prima `$` di un blocco non seguita dalla seconda era un segno: entra
    // come prima, `\$`, e il tasto fa il suo.
    if (this.dollar && event.key !== "$") {
      this.dollar = false;
      this.apply(rules.typeChar(this.state, "$", { inTable: this.options.inTable }));
    }
    // L'esponente appena aperto vale soltanto per il tasto che segue.
    const script = this.freshScript;
    this.freshScript = false;
    if (event.key.length !== 1) this.keyedScript = false;
    const undo = this.quickUndo;
    this.quickUndo = null;
    // Il LaTeX messo nel campo per Ctrl C (T66) non resta.
    if (this.input.value) this.input.value = "";
    if (this.optionsKey(event)) return;
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
      } else if (key === "a") {
        // Tutta la formula, come un pezzo solo.
        handled();
        this.finishPending(true);
        const stops = mapFormula(this.state.tex).points;
        if (stops.length > 1) this.pickPieces(stops[0]!.at, stops[stops.length - 1]!.at);
      } else if (key === "enter") {
        handled();
        this.leave("enter");
      } else if ((key === "c" || key === "x") && this.piece && !event.shiftKey) {
        // La copia la fa il sistema, sul campo che prende i tasti: ci va il
        // LaTeX del pezzo, e `copy` (o `cut`) lo scrive negli appunti.
        event.stopPropagation();
        this.input.value = rules.pieceText(this.state.tex, this.piece);
        this.input.select();
      }
      // Le altre scorciatoie (salva, cerca) restano dell'app.
      return;
    }
    if (event.altKey) return;
    if (!this.list.hidden && this.proposalKey(event.key)) {
      handled();
      return;
    }
    if (event.shiftKey && /^(?:ArrowLeft|ArrowRight|Home|End)$/.test(event.key)) {
      // Maiusc con le frecce sceglie un pezzo intero alla volta (T66).
      handled();
      this.finishPending(true);
      const anchor = this.pick?.anchor ?? this.state.caret;
      const head = this.pick?.head ?? this.state.caret;
      const stops = mapFormula(this.state.tex).points;
      const next = event.key === "Home" ? stops[0]?.at ?? null
        : event.key === "End" ? stops[stops.length - 1]?.at ?? null
          : rules.stepPiece(this.state.tex, head, event.key === "ArrowLeft" ? -1 : 1);
      if (next !== null) this.pickPieces(anchor, next);
      return;
    }
    if (this.piece && this.pieceKey(event.key)) {
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
      case "Enter": {
        handled();
        if (this.finishPending() !== "none") return;
        // In una matrice Invio passa alla riga dopo (T66).
        const cell = rules.cellEnter(this.state);
        if (cell && (cell.kind !== "edit" || this.reads(cell.state.tex))) {
          this.apply(cell);
          return;
        }
        if (this.options.display && this.alignRow()) return;
        this.leave("enter");
        return;
      }
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
      case "Backspace": {
        handled();
        if (this.pending !== null) {
          if (this.state.caret - this.pending <= 1) this.dropPending();
          else this.commit({ tex: this.state.tex.slice(0, this.state.caret - 1) + this.state.tex.slice(this.state.caret), caret: this.state.caret - 1 }, false);
          return;
        }
        // Subito dopo una scrittura veloce torna ciò che si era scritto.
        const back = undo ? rules.undoQuick(this.state, undo) : null;
        if (back && this.reads(back.tex)) {
          this.commit({ tex: back.tex, caret: snap(mapFormula(back.tex), back.caret) });
          return;
        }
        const pair = this.textRole() ? null : rules.dropPair(this.state);
        if (pair && pair.tex[pair.caret - 1] !== "{" && this.reads(pair.tex)) {
          this.commit({ tex: pair.tex, caret: snap(mapFormula(pair.tex), pair.caret) });
          return;
        }
        this.apply(rules.backspace(this.state));
        return;
      }
      case "Delete":
        handled();
        if (this.finishPending() !== "none") return;
        this.apply(rules.deleteForward(this.state));
        return;
      case " ": {
        handled();
        if (this.finishPending() !== "none") return;
        // Una parola finita (`alpha`, `sin`) diventa il suo comando.
        if (!this.textRole()) {
          const { tex, caret } = this.state;
          const typed = { tex: `${tex.slice(0, caret)} ${tex.slice(caret)}`, caret: caret + 1 };
          const quick = rules.quickWrite(typed, " ", { help: "piene", decimalComma: decimalComma() });
          if (quick && this.commitQuick(quick)) return;
          // `x^2 + y^2`: lo spazio chiude l'esponente scritto col suo tasto.
          const out = this.keyedScript ? rules.leaveScript(this.state, " ") : null;
          this.keyedScript = false;
          if (out !== null) {
            this.moveTo(out);
            return;
          }
        }
        this.apply(rules.space(this.state));
        return;
      }
      default:
        if (event.key.length === 1) {
          handled();
          this.type(event.key, true, script);
        }
    }
  }

  /// Un tasto col pezzo scelto (T66). Le frecce lasciano la scelta da quel
  /// lato, Esc e lo spazio la lasciano e basta; Backspace e Canc tolgono il
  /// pezzo; `/`, `^`, `_` e le parentesi lo mettono in una frazione, in un
  /// esponente, in un pedice, fra parentesi; un altro segno lo sostituisce.
  /// `false` per i tasti che, lasciata la scelta, fanno quello di sempre.
  private pieceKey(key: string): boolean {
    const piece = this.piece!;
    const { tex } = this.state;
    const renders = (next: string) => this.reads(next);
    const options = { inTable: this.options.inTable };
    switch (key) {
      case "ArrowLeft":
      case "ArrowRight":
        this.collapse(key === "ArrowLeft" ? -1 : 1);
        return true;
      case "Escape":
      case " ":
        this.collapse(1);
        return true;
      case "Backspace":
      case "Delete":
        this.applyToPiece(rules.removePiece(tex, piece));
        return true;
      case "Tab":
      case "Enter":
        this.collapse(1);
        return false;
      default:
        break;
    }
    if (key.length !== 1) {
      this.dropPick();
      return false;
    }
    const wrapped = key === "/" ? rules.wrapPiece(tex, piece, "\\frac{}{}", renders, options)
      : key === "^" || key === "_" ? rules.wrapPiece(tex, piece, `${key}{}`, renders, options)
        : key === "(" || key === "[" ? rules.wrapPair(tex, piece, key)
          : null;
    if (wrapped && this.applyToPiece(wrapped)) return true;
    // Il segno prende il posto del pezzo, in un passo solo dell'annulla.
    const depth = this.undoStack.length;
    if (!this.applyToPiece(rules.removePiece(tex, piece))) return true;
    this.type(key);
    if (this.undoStack.length === depth + 2) this.undoStack.splice(depth + 1, 1);
    return true;
  }

  /// Invio nella formula a blocco che si tocca: una riga nuova, allineata
  /// sull'uguale (`align.ts`). `false` se la formula non si leggerebbe più:
  /// allora Invio esce, come in riga.
  private alignRow(): boolean {
    const next = alignEnter(this.state);
    if (!this.reads(next.tex)) return false;
    this.commit({ tex: next.tex, caret: snap(mapFormula(next.tex), next.caret) });
    this.tellAlign();
    return true;
  }

  private tellAlign(): void {
    if (alignTold) return;
    alignTold = true;
    this.options.tell?.(liveStrings.t("live.math.told.align"));
  }

  private textRole(): boolean {
    return placeAt(mapFormula(this.state.tex), this.state.caret).role === "text";
  }

  // ── La scrittura veloce (T63) ─────────────────────────────────────────────

  /// Una scrittura veloce nella formula che si tocca: entra se la formula si
  /// legge, col cursore in un punto buono; Backspace subito dopo la annulla.
  /// Le regole senza annullamento (un segno che esce da un esponente) sono
  /// del campo: qui l'esponente è un posto, e ci si resta finché non si esce
  /// con →.
  private commitQuick(quick: QuickWrite): boolean {
    if (!quick.undo || !this.reads(quick.state.tex)) return false;
    const caret = snap(mapFormula(quick.state.tex), quick.state.caret);
    this.commit({ tex: quick.state.tex, caret });
    this.noteQuick({ state: { tex: quick.state.tex, caret }, undo: { ...quick.undo, at: caret } });
    return true;
  }

  /// Ricorda come annullare la trasformazione, e la spiega la prima volta.
  private noteQuick(quick: QuickWrite): void {
    this.quickUndo = quick.undo;
    if (!quick.undo) return;
    const t = liveStrings.t.bind(liveStrings);
    this.say(t("live.math.quick.done"));
    if (!quickTold && this.options.tell) {
      quickTold = true;
      this.options.tell(t("live.math.told.quick"));
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

  /// Il nome che si sta scrivendo dopo `\`, e dove comincia la `\`.
  private typedName(): { readonly name: string; readonly from: number } | null {
    if (this.mode === "visual") {
      if (this.pending === null) return null;
      const name = rules.pendingName(this.state, this.pending);
      return name === null ? null : { name, from: this.pending };
    }
    if (this.help === "spente") return null;
    const match = /\\([a-zA-Z]*)$/.exec(this.state.tex.slice(0, this.state.caret));
    return match ? { name: match[1]!, from: this.state.caret - match[0].length } : null;
  }

  /// Le proposte per il nome che si sta scrivendo, in memoria: nessuna
  /// chiamata per tasto. Si nascondono quando non aggiungono niente.
  private offer(): void {
    const typed = this.typedName();
    const name = typed?.name ?? null;
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
      this.hideProposals();
      return;
    }
    if (!same || this.list.hidden) this.paintProposals(true);
  }

  private hideProposals(): void {
    if (this.list.hidden) return;
    this.list.hidden = true;
    this.list.replaceChildren();
    this.input.removeAttribute("aria-activedescendant");
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
        // Col campo del LaTeX la proposta dice anche il suo comando.
        const command = commandName(symbol);
        if (command && this.mode !== "visual") {
          const code = document.createElement("code");
          code.className = "cm-fub-mx-symbol-code";
          code.textContent = command;
          option.append(code);
        }
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
    if (this.mode !== "visual") {
      const typed = this.typedName();
      if (!typed) return false;
      this.dismissed = false;
      this.quickUndo = null;
      this.writeField(rules.insertTemplate(this.state, symbol.template, typed.from));
      return true;
    }
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
    // Una `$` sola prima di uscire con un altro gesto era un segno.
    if (this.dollar) {
      this.dollar = false;
      this.apply(rules.typeChar(this.state, "$", { inTable: this.options.inTable }));
    }
    this.dropPending();
    this.options.onLeave(reason);
  }

  /// Un segno scritto: dentro un comando per nome le lettere lo allungano.
  /// `quick` falso per il testo dell'IME, che entra com'è.
  private type(ch: string, quick = true, script = false): void {
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
      // Il cursore resta subito dopo la `\`: in uno spazio vuoto come
      // `\frac{|}{}` il posto agganciato cadrebbe oltre la graffa, che con la
      // `\` davanti si legge `\}`, e il nome finirebbe fuori dal pezzo.
      const from = this.state.caret;
      this.pending = from;
      this.commit({ tex: outcome.state.tex, caret: from + 1 });
      return;
    }
    const text = this.textRole();
    if (quick && !text && ch === "$") {
      // La chiusura scritta a mano: `$` in una formula nel testo, `$$` in un
      // blocco, lascia la formula invece di scrivere `\$`.
      if (this.options.display && !this.dollar) {
        this.dollar = true;
        return;
      }
      this.dollar = false;
      this.leave("close");
      return;
    }
    if (quick && !text && ch === "{") {
      this.handTex = true;
      // `x^{`: l'esponente si chiude con la sua graffa, non con un segno.
      if (script) this.keyedScript = false;
    }
    if (quick && !text && this.keyedScript) {
      const out = rules.leaveScript(this.state, ch);
      if (out !== null) {
        this.keyedScript = false;
        this.moveTo(out);
        // Lo spazio, che nella formula non si scrive, ha già fatto il suo.
        if (ch === " ") return;
      }
    }
    if (quick && script && this.handTex && !text && ch !== "{" && ch !== "}") {
      // `L_t` scritto a mano: il pedice prende la `t` e il cursore ne esce.
      const outcome = rules.typeChar(this.state, ch, { inTable: this.options.inTable });
      if (outcome.kind === "edit") {
        this.commit(outcome.state);
        const out = rules.typeChar(this.state, "}", { inTable: this.options.inTable });
        if (out.kind !== "none") this.apply(out);
        return;
      }
    }
    if (quick && !text) {
      // Le parentesi che si chiudono da sole, e quella chiusa che c'è già.
      const over = rules.stepOver(this.state, ch);
      if (over !== null && ch !== "}") {
        this.moveTo(snap(mapFormula(this.state.tex), over));
        return;
      }
      if (ch === "(" || ch === "[") {
        const pair = rules.openPair(this.state, ch);
        if (pair && this.reads(pair.tex)) {
          const quickWord = rules.quickWrite(pair, ch, { help: "piene", decimalComma: decimalComma() });
          if (quickWord && this.commitQuick(quickWord)) return;
          this.commit({ tex: pair.tex, caret: snap(mapFormula(pair.tex), pair.caret) });
          return;
        }
      }
      // `"` apre un testo dritto dentro la formula.
      if (ch === "\"") {
        this.openText();
        return;
      }
    }
    if (quick && text && ch === "\"") {
      // Nel testo le virgolette lo chiudono: il cursore esce dal testo.
      const close = this.state.tex.indexOf("}", this.state.caret);
      if (close >= 0) {
        this.moveTo(snap(mapFormula(this.state.tex), close + 1));
        return;
      }
    }
    const outcome = rules.typeChar(this.state, ch, { inTable: this.options.inTable });
    if (quick && outcome.kind === "edit" && !text) {
      const written = rules.quickWrite(outcome.state, ch, { help: "piene", decimalComma: decimalComma() });
      if (written && this.commitQuick(written)) return;
      if (ch === "*") {
        // `*` è il punto del prodotto (`\cdot`): Backspace subito dopo
        // rimette l'asterisco.
        const from = this.state.caret;
        const replaced = outcome.state.tex.slice(from, outcome.state.caret);
        this.commit(outcome.state);
        this.noteQuick({ state: outcome.state, undo: { at: outcome.state.caret, from, replaced, literal: "*" } });
        return;
      }
    }
    const opened = quick && (ch === "^" || ch === "_") && outcome.kind === "edit"
      && outcome.state.tex.length === this.state.tex.length + 3;
    this.apply(outcome);
    this.freshScript = opened;
    if (opened) this.keyedScript = true;
  }

  /// `"` nella formula che si tocca: un `\text{}` col cursore dentro, che si
  /// annulla con Backspace subito dopo e torna le virgolette.
  private openText(): void {
    const before = this.state;
    const outcome = rules.insertSymbol(before, "\\text{}", before.caret, (tex) => this.reads(tex), { inTable: this.options.inTable });
    if (outcome.kind !== "edit") {
      this.apply(rules.typeChar(before, "\"", { inTable: this.options.inTable }));
      return;
    }
    const grown = outcome.state.tex.length - before.tex.length;
    const replaced = outcome.state.tex.slice(before.caret, before.caret + grown);
    this.commit(outcome.state);
    this.noteQuick({ state: outcome.state, undo: { at: outcome.state.caret, from: before.caret, replaced, literal: "\"" } });
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
