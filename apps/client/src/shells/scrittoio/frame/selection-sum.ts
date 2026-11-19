// La somma nella banda (E24): con due o più celle numeriche scelte, in una
// tabella Markdown o in una Base, la banda dice «Somma 2.520 · Media 840 ·
// Conteggio 3» al posto del conto delle parole.
//
// Si calcola qui, nella shell, sui valori che la superficie mostra
// (`EditorSurface.cellSelection`): nessuna IPC per una selezione, e lo stesso
// conto per ogni superficie, che dà soltanto i valori e la lingua in cui sono
// scritti. Il testo e le celle vuote non contano; l'intestazione la toglie già
// la superficie.
//
// Un numero si legge nella lingua della tabella (`lang` della nota, o quella
// dell'interfaccia): in italiano «1.240,50», in inglese «1,240.50». La forma
// del computer («1240.5», senza separatori delle migliaia) vale soltanto dove
// il punto non separa le migliaia: in italiano «15.11» e «12.30» sono una data
// e un'ora, non numeri. Fra parentesi un numero è negativo, come nei conti:
// «(1.234)». I risultati si scrivono nella stessa lingua delle celle, senza
// zeri in fondo, come il prototipo: copiati e incollati nella tabella, si
// rileggono uguali. Se tutte le celle contate sono percentuali, anche somma,
// media, minimo e massimo lo sono («10%» e «20%» fanno «30%»); se sono miste,
// una percentuale vale la sua frazione («12%» è 0,12) e i risultati sono
// numeri.
//
// Un clic su un numero lo copia; il tasto destro (o il tasto Menu) apre la
// scelta di che cosa mostrare, anche minimo e massimo. La scelta vale per la
// sessione: non è un'impostazione del vault.
import type { SurfaceCellSelection } from "../../../editors/core/registry";
import { t } from "../../../i18n/strings";
import { writeClipboardText } from "../../../platform/clipboard";
import type { Lifetime } from "../../../ui/lifetime";
import { showContextMenu, type MenuItem } from "../../../ui/menu";
import { notify } from "../../../ui/notify";
import { setTooltip } from "../../../ui/tooltip";
import { knownLocale, readShownNumber } from "../../../i18n/shown-number";

export { readShownNumber, type ShownNumber } from "../../../i18n/shown-number";

/// Che cosa la banda può dire di una selezione, nell'ordine in cui lo dice.
export const SUM_STATS = ["sum", "average", "count", "min", "max"] as const;
export type SumStat = (typeof SUM_STATS)[number];

/// Ciò che si vede senza aver scelto: come nei fogli di calcolo.
const DEFAULT_STATS: readonly SumStat[] = ["sum", "average", "count"];

const STAT_NAMES = {
  sum: "frame.status.sum.sum",
  average: "frame.status.sum.average",
  count: "frame.status.sum.count",
  min: "frame.status.sum.min",
  max: "frame.status.sum.max",
} as const;

/// Le cifre dopo la virgola oltre le quali un risultato si arrotonda: tolgono
/// il rumore dei numeri a virgola mobile (0,1 + 0,2) senza perdere ciò che le
/// celle dicono.
const MAX_DECIMALS = 10;

/// I conti di una selezione, coi decimali che le sue celle portano.
export interface SelectionSum {
  /// Tutte le celle contate sono percentuali: i risultati si scrivono così.
  readonly percent: boolean;
  readonly sum: number;
  readonly average: number;
  /// Quante celle numeriche: il testo e le celle vuote non contano.
  readonly count: number;
  readonly min: number;
  readonly max: number;
  /// Le cifre dopo la virgola della cella che ne ha di più.
  readonly decimals: number;
  readonly locale: string;
}

const formatters = new Map<string, Intl.NumberFormat>();

/// Le cifre dopo la virgola di un numero che il formato dà già come numero.
function decimalsOf(value: number): number {
  const text = String(Math.abs(value));
  if (text.includes("e")) return MAX_DECIMALS;
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

/// I conti delle celle scelte; `null` con meno di due celle numeriche, dove la
/// banda torna al conto delle parole. Un giro solo sui valori, senza copie.
export function summarizeSelection(selection: SurfaceCellSelection): SelectionSum | null {
  let count = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  let decimals = 0;
  let percents = 0;
  for (const shown of selection.values()) {
    let value: number;
    let places: number;
    if (typeof shown === "number") {
      if (!Number.isFinite(shown)) continue;
      value = shown;
      places = decimalsOf(shown);
    } else {
      const read = readShownNumber(shown, selection.locale);
      if (!read) continue;
      value = read.value;
      places = read.decimals;
      if (read.percent) percents++;
    }
    count++;
    sum += value;
    if (value < min) min = value;
    if (value > max) max = value;
    if (places > decimals) decimals = places;
  }
  if (count < 2) return null;
  return {
    sum,
    average: sum / count,
    count,
    min,
    max,
    decimals: Math.min(decimals, MAX_DECIMALS),
    percent: percents === count,
    locale: selection.locale,
  };
}

function formatter(locale: string, decimals: number, percent = false): Intl.NumberFormat {
  const key = `${locale}\u0000${decimals}\u0000${percent}`;
  let format = formatters.get(key);
  if (!format) {
    // Le migliaia sempre separate, anche dove la lingua le lascia unite fino a
    // diecimila (l'italiano): «2.520», come nel prototipo. Gli zeri in fondo
    // se ne vanno, come nel prototipo: «1,50 + 1» fa «2,5».
    format = new Intl.NumberFormat(knownLocale(locale), {
      useGrouping: true,
      maximumFractionDigits: decimals,
      ...(percent ? { style: "percent" } : {}),
    });
    formatters.set(key, format);
  }
  return format;
}

/// Un conto scritto nella lingua delle celle. La media porta almeno due
/// decimali, che una divisione li chiede; il conteggio è un intero. Con sole
/// percentuali i decimali sono quelli del percento («12,5%»).
export function formatStat(summary: SelectionSum, stat: SumStat): string {
  if (stat === "count") return formatter(summary.locale, 0).format(summary.count);
  const places = summary.percent ? Math.max(summary.decimals - 2, 0) : summary.decimals;
  const decimals = stat === "average" ? Math.min(Math.max(places, 2), MAX_DECIMALS) : places;
  return formatter(summary.locale, decimals, summary.percent).format(summary[stat]);
}

/// Che cosa la banda mostra, per la sessione: almeno una voce.
let shown: ReadonlySet<SumStat> = new Set(DEFAULT_STATS);

/// Torna alla scelta di serie (i test).
export function resetShownStats(): void {
  shown = new Set(DEFAULT_STATS);
}

/// La voce della banda che dice i conti: un bottone per numero, che lo copia.
/// La crea nascosta; la riempie `show`.
export class BandSum {
  readonly element: HTMLElement;
  /// La stessa cosa a voce, per chi non vede la banda: una regione cortese
  /// (`role="status"`), fuori dalla voce che si nasconde, perché una regione
  /// nascosta non parla. La scelta delle celle nella Base non ha altra voce:
  /// la sua tabella non è una griglia ARIA (`docs/product/editor-tables.md`).
  readonly voice: HTMLElement;
  readonly #lifetime: Lifetime;
  #summary: SelectionSum | null = null;
  /// Le parti, per conto: si riscrivono solo dove cambiano, e il fuoco su un
  /// numero non si perde quando la selezione si allarga.
  readonly #parts = new Map<SumStat, { readonly button: HTMLButtonElement; readonly name: HTMLElement; readonly value: HTMLElement; readonly dot: HTMLElement }>();

  constructor(lifetime: Lifetime) {
    this.#lifetime = lifetime;
    const element = document.createElement("span");
    element.id = "status-sum";
    element.className = "status-sum";
    element.setAttribute("role", "group");
    element.hidden = true;
    this.element = element;
    lifetime.listen(element, "click", (event) => {
      const button = (event.target as Element | null)?.closest<HTMLButtonElement>("button[data-stat]");
      if (button) this.#copy(button.dataset.stat as SumStat);
    });
    lifetime.listen(element, "contextmenu", (event) => {
      event.preventDefault();
      this.#openMenu(event);
    });
    const voice = document.createElement("span");
    voice.id = "status-sum-voice";
    voice.className = "sr-only";
    voice.setAttribute("role", "status");
    voice.setAttribute("aria-live", "polite");
    this.voice = voice;
    lifetime.add(() => element.remove());
    lifetime.add(() => voice.remove());
  }

  /// I conti da dire, o `null` per spegnere la voce.
  show(summary: SelectionSum | null): void {
    this.#summary = summary;
    this.element.hidden = summary === null;
    if (!summary) {
      this.#say("");
      return;
    }
    this.element.setAttribute("aria-label", t("frame.status.sum.label"));
    const spoken: string[] = [];
    let first = true;
    for (const stat of SUM_STATS) {
      const on = shown.has(stat);
      const part = on ? this.#part(stat) : this.#parts.get(stat);
      if (!part) continue;
      part.button.hidden = !on;
      part.dot.hidden = !on || first;
      if (!on) continue;
      const name = t(STAT_NAMES[stat]);
      const value = formatStat(summary, stat);
      if (part.name.textContent !== name) part.name.textContent = name;
      if (part.value.textContent !== value) part.value.textContent = value;
      // Il primo numero è quello che si cerca: in inchiostro, come nel
      // prototipo; gli altri restano a voce bassa.
      part.button.toggleAttribute("data-lead", first);
      part.button.setAttribute("aria-label", t("frame.status.sum.part", { stat: name, value }));
      setTooltip(part.button, t("frame.status.sum.copy_hint"));
      spoken.push(t("frame.status.sum.spoken", { stat: name, value }));
      first = false;
    }
    this.#say(spoken.join(", "));
  }

  /// Parla soltanto quando la frase cambia: un ridisegno con gli stessi conti
  /// non si ripete.
  #say(text: string): void {
    if (this.voice.textContent !== text) this.voice.textContent = text;
  }

  #part(stat: SumStat) {
    const existing = this.#parts.get(stat);
    if (existing) return existing;
    const dot = document.createElement("span");
    dot.className = "status-sum-dot";
    dot.setAttribute("aria-hidden", "true");
    dot.textContent = "·";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "status-item status-item--button status-sum-part";
    button.dataset.stat = stat;
    const name = document.createElement("span");
    name.className = "status-sum-name";
    const value = document.createElement("span");
    value.className = "status-sum-value";
    button.append(name, value);
    // Al suo posto nell'ordine dei conti, anche se nasce dopo.
    const after = SUM_STATS.slice(SUM_STATS.indexOf(stat) + 1).map((each) => this.#parts.get(each)).find(Boolean);
    this.element.insertBefore(dot, after?.dot ?? null);
    this.element.insertBefore(button, after?.dot ?? null);
    const part = { button, name, value, dot };
    this.#parts.set(stat, part);
    return part;
  }

  #copy(stat: SumStat): void {
    const summary = this.#summary;
    if (!summary) return;
    const value = formatStat(summary, stat);
    void writeClipboardText(value).then(
      () => {
        if (!this.#lifetime.closed) notify(t("frame.status.sum.copied", { stat: t(STAT_NAMES[stat]), value }), "info");
      },
      () => {
        if (!this.#lifetime.closed) notify(t("editor_menu.copy_failed"), "guasto");
      },
    );
  }

  #openMenu(event: MouseEvent): void {
    const items: MenuItem[] = SUM_STATS.map((stat) => {
      const on = shown.has(stat);
      return {
        label: t(STAT_NAMES[stat]),
        choice: "checkbox",
        checked: on,
        // L'ultima voce accesa resta: una banda senza conti non direbbe niente.
        disabled: on && shown.size === 1,
        run: () => {
          const next = new Set(shown);
          if (on) next.delete(stat);
          else next.add(stat);
          shown = next;
          this.show(this.#summary);
        },
      };
    });
    // Dalla tastiera (tasto Menu, Maiusc+F10) il gesto non ha un punto: il
    // menu si apre sul numero a fuoco, o sulla voce, mai in un angolo.
    const byKeyboard = event.button !== 2 || (event.clientX === 0 && event.clientY === 0);
    const owner = (event.target as Element | null)?.closest<HTMLElement>("button[data-stat]") ?? this.element;
    // Cinque scelte: niente ricerca, che con così poche voci è rumore.
    showContextMenu(byKeyboard ? owner : event, items, { label: t("frame.status.sum.menu"), search: false });
  }
}
