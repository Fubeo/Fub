// Il moto della carta del documento: le modalità, la barra, lo zoom e il
// foglio che nasce.
//
// La regola è quella del palco (`shells/scrittoio/stage-motion.ts`):
//
// - **il testo è sempre al suo posto finale.** Chi scrive non aspetta, e il
//   testo non si sposta né si deforma;
// - **a muoversi è la carta**, cioè la sagoma di ogni foglio
//   (`.rich-sheet::before`): parte dal rettangolo che si vedeva e arriva a
//   quello nuovo. In Scrittura la carta non c'è: entrando in Pagina si allarga
//   dalla colonna del testo, uscendone sparisce;
// - **il punto di lettura resta**: il paragrafo in cima alla vista prima del
//   cambio è in cima anche dopo. Lo zoom tiene invece il punto al centro della
//   vista, e la carta si scala attorno a lui. Vale anche senza moto;
// - la barra che torna entra dal suo bordo; quando sparisce, sparisce, e la
//   carta sale al suo posto;
// - un foglio **nuovo** (un salto pagina scritto) esce dal bordo di quello
//   sopra e i fogli sotto scivolano; di uno **tolto** resta una sagoma che si
//   dissolve, mentre quello sopra si allunga. Quando il documento si apre o
//   cambia da fuori, niente si muove.
//
// Chi cambia la modalità (la shell, con la classe `look-*` e `data-mode`) non
// ne sa niente: il modulo segue gli attributi. Quando la mutazione arriva il
// DOM è già cambiato, quindi il «prima» è una fotografia tenuta aggiornata a
// ogni scorrimento e a ogni misura. Lo zoom e i fogli li cambia il motore, che
// chiama il modulo prima di cambiare.
import { animate, DURATION, liveState, motionDriver, motionLevel, type Motion, type MotionState } from "../../moto";
import { openLifetime } from "../../ui/lifetime";

/// Di quanto scorre la barra rientrando (px): lo stesso passo dei cassetti.
const RIBBON_TRAVEL = 28;
/// Quanto della sua altezza percorre un foglio nuovo uscendo da quello sopra,
/// e il tetto (px della carta).
const SHEET_TRAVEL_SHARE = 0.12;
const SHEET_TRAVEL_MAX = 64;
/// La sagoma di un foglio tolto arretra appena mentre si dissolve.
const GHOST_SCALE = 0.97;
/// Sotto questa differenza (px) un foglio non si è mosso.
const NEGLIGIBLE_PX = 0.5;

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/// Un foglio sulla scrivania, in px della carta.
export interface SheetBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/// I fogli rifatti dal motore: quelli di prima, quelli di adesso con i loro
/// elementi, e il foglio del cursore.
export interface SheetRedraw {
  readonly before: readonly SheetBox[];
  readonly after: readonly SheetBox[];
  readonly elements: readonly HTMLElement[];
  readonly at: number;
}

/// Il punto di lettura: un blocco del testo, e dove cade la riga della vista
/// dentro di lui (0 è il suo bordo di sopra, 1 quello di sotto).
export interface ReadingPoint {
  readonly block: Element;
  readonly ratio: number;
  /// La riga della vista, dal bordo di sopra della vista (px).
  readonly line: number;
}

/// Il blocco del testo sotto la riga `line` della vista (px dal suo bordo di
/// sopra), e dove la riga lo taglia. `null` senza blocchi.
export function readingPoint(page: HTMLElement, content: HTMLElement, line: number): ReadingPoint | null {
  const blocks = content.children;
  if (blocks.length === 0) return null;
  const y = page.getBoundingClientRect().top + line;
  // Il primo blocco che finisce sotto la riga: i blocchi stanno in colonna.
  let low = 0;
  let high = blocks.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (blocks[mid]!.getBoundingClientRect().bottom > y) high = mid;
    else low = mid + 1;
  }
  const block = blocks[low]!;
  const rect = block.getBoundingClientRect();
  const ratio = rect.height > 0 ? Math.min(1, Math.max(0, (y - rect.top) / rect.height)) : 0;
  return { block, ratio, line };
}

/// Riporta il punto di lettura alla sua riga della vista, scorrendo. `false`
/// se il blocco non c'è più.
export function keepReadingPoint(page: HTMLElement, point: ReadingPoint): boolean {
  if (!point.block.isConnected) return false;
  const rect = point.block.getBoundingClientRect();
  const shift = rect.top + point.ratio * rect.height - (page.getBoundingClientRect().top + point.line);
  if (Math.abs(shift) >= NEGLIGIBLE_PX) page.scrollTop += shift;
  return true;
}

interface Snapshot {
  /// La vista, sullo schermo.
  readonly page: Rect;
  /// L'origine della scrivania sullo schermo e la sua scala.
  readonly deskLeft: number;
  readonly deskTop: number;
  readonly scale: number;
  /// I fogli, in px della carta; `null` se la carta non si vedeva.
  readonly sheets: readonly SheetBox[] | null;
  /// La colonna del testo, sullo schermo.
  readonly column: Rect;
  readonly reading: ReadingPoint | null;
  readonly ribbon: boolean;
}

export interface RichMotionOptions {
  /// La vista che scorre.
  readonly page: HTMLElement;
  readonly desk: HTMLElement;
  /// Lo strato dei fogli (`.rich-sheets`).
  readonly layer: HTMLElement;
  readonly content: () => HTMLElement;
  /// La scala della scrivania (lo zoom).
  readonly scale: () => number;
  /// Misura e ridisegna i fogli subito.
  readonly measure: () => void;
}

const centerX = (rect: Rect): number => rect.left + rect.width / 2;
const centerY = (rect: Rect): number => rect.top + rect.height / 2;

/// Dove si vede adesso una carta la cui corsa è ancora in volo, attorno al
/// suo centro; `scale` porta lo scarto della corsa sullo schermo.
function seen(paper: Rect, live: MotionState | null, scale: number): Rect {
  if (!live) return paper;
  const width = paper.width * (live.pose.scaleX ?? 1);
  const height = paper.height * (live.pose.scaleY ?? 1);
  return {
    left: centerX(paper) + (live.pose.x ?? 0) * scale - width / 2,
    top: centerY(paper) + (live.pose.y ?? 0) * scale - height / 2,
    width,
    height,
  };
}

/// L'aspetto scritto in una classe (`look-*`).
const lookIn = (classes: string | null): string => (classes ?? "").split(/\s+/).filter((name) => name.startsWith("look-")).sort().join(" ");

/// Una mutazione che sposta la carta: un'altra modalità o un altro aspetto,
/// la barra che si nasconde, o la barra intera che si raccoglie (non un suo
/// gruppo che si stringe).
function moves(record: MutationRecord, ribbon: HTMLElement | null): boolean {
  const target = record.target as Element;
  switch (record.attributeName) {
    case "class":
      return lookIn(record.oldValue) !== lookIn(target.getAttribute("class"));
    case "data-mode":
      return record.oldValue !== target.getAttribute("data-mode");
    case "data-collapsed":
      return target.parentElement === ribbon;
    default:
      return true;
  }
}

function rectOf(el: Element): Rect {
  const rect = el.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/// Un foglio disegnato, dal suo stile in linea (`sheets.ts`).
export function sheetBox(sheet: HTMLElement): SheetBox {
  const px = (value: string) => Number.parseFloat(value) || 0;
  return { left: px(sheet.style.left), top: px(sheet.style.top), width: px(sheet.style.width), height: px(sheet.style.height) };
}

export class RichMotion {
  readonly #options: RichMotionOptions;
  readonly #life = openLifetime();
  #snapshot: Snapshot | null = null;
  #ribbon: HTMLElement | null = null;
  #ribbonRun: Motion | null = null;
  readonly #papers = new Map<HTMLElement, Motion>();
  #observer: MutationObserver | null = null;

  constructor(options: RichMotionOptions) {
    this.#options = options;
    this.#life.listen(options.page, "scroll", () => this.remember(), { passive: true });
    if (typeof ResizeObserver !== "undefined") {
      const sizes = new ResizeObserver(() => this.remember());
      sizes.observe(options.page);
      sizes.observe(options.desk);
      this.#life.add(() => sizes.disconnect());
    }
  }

  /// Segue la modalità e l'aspetto: gli attributi di `targets` e la barra
  /// `ribbon`, che si nasconde in Lettura e si raccoglie con Ctrl+F1.
  follow(targets: readonly HTMLElement[], ribbon: HTMLElement | null): void {
    if (this.#life.closed || typeof MutationObserver === "undefined") return;
    this.#ribbon = ribbon;
    this.#observer?.disconnect();
    const observer = new MutationObserver((records) => {
      if (this.#life.closed) return;
      if (records.some((record) => moves(record, ribbon))) this.#settle(this.#snapshot, "top");
    });
    for (const target of targets) observer.observe(target, { attributes: true, attributeFilter: ["class", "data-mode"], attributeOldValue: true });
    if (ribbon) {
      observer.observe(ribbon, { attributes: true, attributeFilter: ["hidden"] });
      observer.observe(ribbon, { attributes: true, attributeFilter: ["data-collapsed"], subtree: true });
    }
    this.#observer = observer;
    this.#life.add(() => observer.disconnect());
    this.remember();
  }

  /// Cambia lo zoom con `apply`, tenendo il punto al centro della vista: la
  /// carta si scala attorno a lui.
  zoom(apply: () => void): void {
    if (this.#life.closed) return apply();
    const before = this.#capture(this.#options.page.clientHeight / 2);
    apply();
    this.#settle(before, "center");
  }

  /// I fogli che una modifica scritta sta per rifare: uno nuovo esce da quello
  /// sopra, uno tolto si dissolve, gli altri scivolano. Si legge subito dove
  /// si vede ogni foglio di prima, perché il disegno riusa gli elementi per
  /// indice e ne toglie: la corsa in volo di un foglio sta sull'elemento che
  /// lo mostrava, e un elemento tolto la perde.
  redraw(previous: readonly HTMLElement[]): (change: SheetRedraw) => void {
    const scale = this.#options.scale();
    const local = (b: SheetBox): Rect => ({ left: b.left * scale, top: b.top * scale, width: b.width * scale, height: b.height * scale });
    const flying = previous.map((sheet) => {
      const live = liveState(sheet, "::before");
      return { seen: seen(local(sheetBox(sheet)), live, scale), opacity: live?.pose.opacity ?? 1 };
    });
    return (change) => this.#redrawn(change, flying, previous, scale);
  }

  #redrawn(change: SheetRedraw, flying: readonly { seen: Rect; opacity: number }[], previous: readonly HTMLElement[], scale: number): void {
    if (this.#life.closed) return;
    const { before, after, elements, at } = change;
    const delta = after.length - before.length;
    if (Math.abs(delta) !== 1 || previous.length !== before.length) return;
    const view = this.#viewBand(scale);
    const shown = (box: SheetBox) => box.top + box.height >= view.top && box.top <= view.bottom;
    const added = delta === 1 ? at : -1;
    const removed = delta === -1 ? at + 1 : -1;
    if (delta === 1 ? added < 1 || added >= after.length : removed < 1 || removed >= before.length) return;
    const local = (b: SheetBox): Rect => ({ left: b.left * scale, top: b.top * scale, width: b.width * scale, height: b.height * scale });
    const inFlight = previous.map((sheet) => this.#papers.has(sheet));
    for (const sheet of new Set([...previous, ...elements])) {
      this.#papers.get(sheet)?.cancel();
      this.#papers.delete(sheet);
    }
    // Ogni foglio di adesso continua quello di prima al suo posto nell'ordine.
    for (const [j, box] of after.entries()) {
      if (j === added) continue;
      const k = delta === 1 ? (j < added ? j : j - 1) : j < removed ? j : j + 1;
      if (!shown(box) && !shown(before[k]!) && !inFlight[k]) continue;
      this.#morph(elements[j]!, flying[k]!.seen, local(box), scale);
    }
    if (added >= 0 && shown(after[added]!)) {
      const sheet = elements[added]!;
      const travel = Math.min(SHEET_TRAVEL_MAX, after[added]!.height * SHEET_TRAVEL_SHARE);
      const motion = animate(sheet, { pseudo: "::before", from: { y: -travel, opacity: 0 }, spring: "wide", whenReduced: "none", lifetime: this.#life });
      if (motion.running) this.#papers.set(sheet, motion);
    }
    if (removed >= 0 && (shown(before[removed]!) || inFlight[removed])) {
      const { seen: at, opacity } = flying[removed]!;
      this.#ghost(this.#options.layer, { left: at.left / scale, top: at.top / scale, width: at.width / scale, height: at.height / scale }, opacity);
    }
    this.remember();
  }

  /// Aggiorna la fotografia del «prima».
  remember(): void {
    if (this.#life.closed) return;
    this.#snapshot = this.#capture(0);
  }

  destroy(): void {
    this.#life.close();
    this.#papers.clear();
    this.#snapshot = null;
  }

  #capture(line: number): Snapshot {
    const { page, desk, layer } = this.#options;
    const deskRect = desk.getBoundingClientRect();
    const paper = layer.isConnected && getComputedStyle(layer).display !== "none";
    const content = this.#options.content();
    return {
      page: rectOf(page),
      deskLeft: deskRect.left,
      deskTop: deskRect.top,
      scale: this.#options.scale(),
      sheets: paper ? this.#sheets().map(sheetBox) : null,
      column: rectOf(content),
      reading: readingPoint(page, content, line),
      ribbon: this.#ribbon !== null && !this.#ribbon.hidden,
    };
  }

  #sheets(): HTMLElement[] {
    return [...this.#options.layer.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains("rich-sheet"));
  }

  /// La fascia della carta che si vede, in px della carta, con una vista in
  /// più sopra e sotto: ciò che entra scorrendo durante la corsa.
  #viewBand(scale: number): { top: number; bottom: number } {
    const page = this.#options.page.getBoundingClientRect();
    const desk = this.#options.desk.getBoundingClientRect();
    const top = (page.top - desk.top) / scale;
    const height = page.height / scale;
    return { top: top - height, bottom: top + 2 * height };
  }

  /// Dopo un cambio: il punto di lettura torna alla sua riga, poi la carta
  /// va da dove si vedeva a dove sta.
  #settle(before: Snapshot | null, anchor: "top" | "center"): void {
    const { page, desk, layer } = this.#options;
    const paper = layer.isConnected && getComputedStyle(layer).display !== "none";
    if (paper) this.#options.measure();
    if (before?.reading) {
      // In zoom anche il punto in orizzontale resta al centro.
      if (anchor === "center") {
        const was = before.deskLeft;
        const ratio = before.scale > 0 ? (before.page.left + before.page.width / 2 - was) / before.scale : 0;
        const now = desk.getBoundingClientRect();
        const pageRect = page.getBoundingClientRect();
        const shift = now.left + ratio * this.#options.scale() - (pageRect.left + pageRect.width / 2);
        if (Math.abs(shift) >= NEGLIGIBLE_PX) page.scrollLeft += shift;
      }
      keepReadingPoint(page, before.reading);
    }
    this.#ribbonEnters(before);
    if (!paper) {
      this.#paperLeaves(before);
    } else if (before) {
      this.#morphAll(before);
    }
    this.remember();
  }

  /// La carta se ne va (in Scrittura): sparisce. Un foglio la cui corsa era
  /// ancora in volo lascia la sua sagoma dove si vedeva, che si dissolve: la
  /// corsa interrotta non salta.
  #paperLeaves(before: Snapshot | null): void {
    const flying = [...this.#papers.keys()];
    const sheets = this.#sheets();
    const desk = this.#options.desk.getBoundingClientRect();
    const scale = this.#options.scale();
    for (const sheet of flying) {
      const i = sheets.indexOf(sheet);
      // L'ultimo disegno: la fotografia può avere un fotogramma di ritardo.
      const was = i >= 0 ? sheetBox(sheet) : null;
      const live = liveState(sheet, "::before");
      this.#papers.get(sheet)?.cancel();
      if (!before || !was || !live) continue;
      const paper = { left: before.deskLeft + was.left * before.scale, top: before.deskTop + was.top * before.scale, width: was.width * before.scale, height: was.height * before.scale };
      const at = seen(paper, live, before.scale);
      const box = { left: (at.left - desk.left) / scale, top: (at.top - desk.top) / scale, width: at.width / scale, height: at.height / scale };
      this.#ghost(this.#options.desk, box, live.pose.opacity ?? 1);
    }
    this.#papers.clear();
  }

  /// La barra che prima non si vedeva entra dal suo bordo di sopra.
  #ribbonEnters(before: Snapshot | null): void {
    const ribbon = this.#ribbon;
    if (!ribbon || !before) return;
    if (ribbon.hidden) {
      this.#ribbonRun?.cancel();
      this.#ribbonRun = null;
      return;
    }
    if (before.ribbon) return;
    this.#ribbonRun?.cancel();
    const motion = animate(ribbon, { from: { y: -RIBBON_TRAVEL, opacity: 0 }, spring: "wide", whenReduced: "fade", lifetime: this.#life });
    this.#ribbonRun = motion.running ? motion : null;
  }

  /// Ogni foglio che si vede va dal rettangolo di prima a quello di adesso,
  /// sullo schermo. Se prima la carta non c'era, parte dalla colonna del testo.
  #morphAll(before: Snapshot): void {
    const { desk, page } = this.#options;
    const scale = this.#options.scale();
    const deskRect = desk.getBoundingClientRect();
    const view = rectOf(page);
    for (const [i, sheet] of this.#sheets().entries()) {
      const box = sheetBox(sheet);
      const to: Rect = { left: deskRect.left + box.left * scale, top: deskRect.top + box.top * scale, width: box.width * scale, height: box.height * scale };
      const was = before.sheets?.[i];
      let from: Rect;
      if (before.sheets === null) {
        from = { left: before.column.left, width: before.column.width, top: to.top, height: to.height };
      } else if (was) {
        const paper = {
          left: before.deskLeft + was.left * before.scale,
          top: before.deskTop + was.top * before.scale,
          width: was.width * before.scale,
          height: was.height * before.scale,
        };
        from = seen(paper, liveState(sheet, "::before"), before.scale);
      } else {
        continue;
      }
      // Un foglio che non si vede né prima né dopo non ha niente da mostrare,
      // se non è in volo: una corsa interrotta prosegue anche fuori vista.
      const out = (r: Rect) => r.top + r.height < view.top || r.top > view.top + view.height;
      if (out(from) && out(to) && !this.#papers.has(sheet)) {
        this.#papers.get(sheet)?.cancel();
        this.#papers.delete(sheet);
        continue;
      }
      this.#morph(sheet, from, to, scale);
    }
  }

  /// La sagoma di `sheet` va da `from` a `to` (px dello schermo); lo scarto
  /// della corsa è in px della carta.
  #morph(sheet: HTMLElement, from: Rect, to: Rect, scale: number): void {
    this.#papers.get(sheet)?.cancel();
    this.#papers.delete(sheet);
    if (!(from.width > 0 && from.height > 0 && to.width > 0 && to.height > 0 && scale > 0)) return;
    const x = centerX(from) - centerX(to);
    const y = centerY(from) - centerY(to);
    const still =
      Math.abs(x) < NEGLIGIBLE_PX &&
      Math.abs(y) < NEGLIGIBLE_PX &&
      Math.abs(from.width - to.width) < NEGLIGIBLE_PX &&
      Math.abs(from.height - to.height) < NEGLIGIBLE_PX;
    if (still) return;
    const motion = animate(sheet, {
      pseudo: "::before",
      from: { x: x / scale, y: y / scale, scaleX: from.width / to.width, scaleY: from.height / to.height },
      spring: "wide",
      whenReduced: "none",
      lifetime: this.#life,
    });
    if (motion.running) this.#papers.set(sheet, motion);
  }

  /// Di un foglio tolto resta la sagoma, ferma dove si vedeva, che si
  /// dissolve da com'era. Sta in `parent`, sotto il testo.
  #ghost(parent: HTMLElement, box: SheetBox, opacity: number): void {
    if (motionLevel() === "reduced" || motionDriver().instant) return;
    const ghost = document.createElement("div");
    ghost.className = "rich-sheet-ghost";
    ghost.setAttribute("aria-hidden", "true");
    ghost.style.cssText = `top: ${box.top}px; left: ${box.left}px; width: ${box.width}px; height: ${box.height}px`;
    if (parent === this.#options.layer) parent.append(ghost);
    else parent.insertBefore(ghost, parent.firstChild);
    const motion = animate(ghost, {
      from: { opacity, scale: 1 },
      to: { opacity: 0, scale: GHOST_SCALE },
      duration: DURATION.short,
      easing: "ease-out",
      whenReduced: "none",
      lifetime: this.#life,
    });
    // A riposo la sagoma non si vede: fra la fine della corsa e la rimozione
    // non resta un fotogramma pieno.
    ghost.style.opacity = "0";
    void motion.finished.then(() => ghost.remove());
  }
}
