// La scheda PDF della lavagna (N6 T6): una pagina alla volta, adattata alla
// larghezza della scheda, con «3 / 24» in basso e ‹ › ai lati.
//
// Viva, la scheda apre un `PdfEngine` (pdf.js) e disegna la pagina corrente
// in un canvas fuori dal DOM; a resa finita la copia nel canvas che si vede e
// la mette nella cache delle immagini ferme (parte `page-N@larghezza`). Ferma,
// chiude il motore (un PDF chiuso non tiene il worker) e mostra l'immagine
// della pagina dalla cache, se c'è.
//
// Il canvas che si vede non è mai quello della cache: la cache chiude (porta
// a 0×0) chi esce, e la scheda resterebbe bianca. Le rese si disegnano fuori
// dal DOM, così una resa interrotta non lascia mai mezza pagina in vista, e
// vince l'ultima chiesta: ogni attesa guarda un contatore di generazione, e
// dopo `destroy` nessuna risposta tardiva tocca il DOM né la cache.
//
// La scheda legge e basta: sfogliare non cambia il file né il `.canvas`
// (D-5 del piano N6).

import { t } from "../../../i18n/strings";
import { pdfPageFromFragment, type PdfEngine, type PdfEngineLoader } from "../../media/pdf-view";
import type { CanvasNode } from "../model";
import { snapshotPart, type CardContext, type CardMode, type CardRenderer, type CardView } from "../cards";

/// Ciò che la scheda PDF chiede a chi la monta.
export interface PdfCardPort {
  /// I byte del file; `null` se il file non c'è.
  read(path: string): Promise<Uint8Array | null>;
  /// Apre i byte in un motore pdf.js.
  load: PdfEngineLoader;
  /// Avvisa quando il file cambia; restituisce come smettere.
  watch(path: string, changed: () => void): () => void;
}

/// Quante volte la larghezza della scheda può essere la resa, al più, in
/// pixel del dispositivo: oltre, ingrandire la lavagna non aggiunge dettaglio.
export const PDF_CARD_MAX_SCALE = 2;

export function pdfCardRenderer(port: PdfCardPort): CardRenderer {
  return {
    kinds: ["pdf"],
    mount: (node, host, mode, context) => mountPdfCard(node, host, mode, context, port),
  };
}

/// La pagina di partenza dal `subpath` (`#page=3`, da 1); `null` se non la dice.
export function pdfCardStartPage(subpath: string | null): number | null {
  return subpath === null ? null : pdfPageFromFragment(subpath);
}

function mountPdfCard(
  _node: CanvasNode,
  host: HTMLElement,
  initialMode: CardMode,
  context: CardContext,
  port: PdfCardPort,
): CardView {
  const { path, snapshots, lifetime } = context;

  const root = document.createElement("div");
  root.className = "canvas-card-pdf";
  const screen = document.createElement("canvas");
  screen.className = "canvas-card-pdf-page";
  screen.hidden = true;
  // Adattata alla larghezza della scheda, qualunque sia la densità della resa.
  screen.style.width = "100%";
  screen.style.height = "auto";
  screen.setAttribute("role", "img");
  screen.setAttribute("aria-label", path.split("/").pop() || path);
  const message = document.createElement("p");
  message.className = "canvas-card-pdf-message";
  message.hidden = true;
  const previous = arrow("canvas-card-pdf-previous", "‹", t("canvas.card.previous_page"));
  const next = arrow("canvas-card-pdf-next", "›", t("canvas.card.next_page"));
  const status = document.createElement("span");
  status.className = "canvas-card-pdf-status";
  status.hidden = true;
  root.append(screen, message, previous, next, status);
  host.append(root);

  let mode: CardMode = initialMode;
  let destroyed = false;
  let engine: PdfEngine | null = null;
  /// Cresce a ogni apertura e a ogni chiusura del motore.
  let opening = 0;
  /// Cresce a ogni resa chiesta: risponde solo l'ultima.
  let drawing = 0;
  /// Le pagine del file, note dall'ultima apertura; `null` se mai aperto.
  let pageCount: number | null = null;
  const start = pdfCardStartPage(context.subpath);
  let page = start ?? 1;
  /// La parte della cache che il canvas in vista mostra, o `null`.
  let shown: string | null = null;

  previous.hidden = true;
  next.hidden = true;
  lifetime.listen(previous, "click", () => void go(page - 1));
  lifetime.listen(next, "click", () => void go(page + 1));
  // Smettere di ascoltare il file è di `destroy`, che la vita della scheda
  // chiama anche se la tela la chiude senza passare da `destroy`.
  const unwatch = port.watch(path, changed);
  lifetime.add(destroy);

  /// La larghezza della resa in pixel del dispositivo: la scheda per lo zoom
  /// e la densità dello schermo, al più due volte la scheda.
  function pixelWidth(): number {
    const width = context.size().width;
    const ratio = globalThis.devicePixelRatio || 1;
    const scale = Math.min(Math.max(context.zoom(), 0) * ratio, PDF_CARD_MAX_SCALE);
    return Math.max(1, Math.round(width * scale));
  }

  function partOf(n: number): string {
    return snapshotPart(`page-${n}`, pixelWidth());
  }

  function updateChrome(): void {
    const live = mode === "live" && engine !== null && pageCount !== null;
    const several = pageCount !== null && pageCount > 1;
    previous.hidden = !live || !several;
    next.hidden = !live || !several;
    previous.disabled = page <= 1;
    next.disabled = pageCount === null || page >= pageCount;
    if (pageCount === null) {
      status.hidden = true;
      status.textContent = "";
    } else {
      status.hidden = false;
      status.textContent = t("canvas.card.page", { page, pages: pageCount });
    }
  }

  function say(text: string | null): void {
    message.hidden = text === null;
    message.textContent = text ?? "";
  }

  /// Copia un'immagine nel canvas in vista.
  function present(source: ImageBitmap | HTMLCanvasElement, part: string): void {
    screen.width = source.width;
    screen.height = source.height;
    screen.getContext("2d")?.drawImage(source, 0, 0);
    screen.hidden = false;
    shown = part;
    say(null);
  }

  function blank(): void {
    screen.width = 0;
    screen.height = 0;
    screen.hidden = true;
    shown = null;
  }

  /// Mostra la pagina dalla cache, se c'è a questa larghezza.
  function fromCache(n: number): boolean {
    const part = partOf(n);
    if (shown === part) return true;
    const cached = snapshots.get(path, part);
    if (!cached) return false;
    present(cached.bitmap, part);
    return true;
  }

  async function open(): Promise<void> {
    const ticket = ++opening;
    if (!fromCache(page)) say(t("canvas.card.loading"));
    let bytes: Uint8Array | null;
    try {
      bytes = await port.read(path);
    } catch {
      if (ticket === opening) unreadable();
      return;
    }
    if (ticket !== opening) return;
    if (bytes === null) {
      say(null);
      context.missing();
      return;
    }
    let loaded: PdfEngine;
    try {
      loaded = await port.load(bytes);
    } catch {
      if (ticket === opening) unreadable();
      return;
    }
    if (ticket !== opening) {
      loaded.destroy();
      return;
    }
    engine = loaded;
    const count = Math.max(0, Math.floor(loaded.pageCount));
    if (count < 1) {
      closeEngine();
      unreadable();
      return;
    }
    const first = pageCount === null;
    pageCount = count;
    // Al primo avvio una pagina fuori dall'intervallo torna alla prima; dopo
    // (il file è cambiato) si resta il più vicino possibile.
    page = first ? (page > count ? 1 : page) : Math.min(page, count);
    updateChrome();
    await draw();
  }

  async function draw(): Promise<void> {
    const loaded = engine;
    if (loaded === null || mode !== "live") return;
    const ticket = ++drawing;
    const n = page;
    if (fromCache(n)) return;
    const part = partOf(n);
    try {
      const [width] = await loaded.pageSize(n - 1);
      if (ticket !== drawing || engine !== loaded) return;
      const frame = document.createElement("canvas");
      const scale = width > 0 ? pixelWidth() / width : 1;
      await loaded.renderPage(n - 1, frame, scale);
      if (ticket !== drawing || engine !== loaded) return;
      // Prima in vista, poi in cache: un'immagine troppo grande per la
      // cache vi entra chiusa, e non deve sparire dalla scheda.
      present(frame, part);
      snapshots.put(path, part, { bitmap: frame, bytes: frame.width * frame.height * 4 });
    } catch {
      if (ticket === drawing && engine === loaded) unreadable();
    }
  }

  function unreadable(): void {
    blank();
    say(t("canvas.card.unreadable", { name: path.split("/").pop() || path }));
  }

  async function go(n: number): Promise<void> {
    if (mode !== "live" || engine === null || pageCount === null) return;
    const target = Math.min(Math.max(1, n), pageCount);
    if (target === page) return;
    page = target;
    updateChrome();
    await draw();
  }

  function closeEngine(): void {
    opening++;
    drawing++;
    const loaded = engine;
    engine = null;
    loaded?.destroy();
  }

  function changed(): void {
    if (destroyed) return;
    snapshots.forget(path);
    if (mode === "live") {
      closeEngine();
      blank();
      void open();
    } else {
      blank();
    }
  }

  function freeze(): void {
    closeEngine();
    // Resta l'immagine della pagina dalla cache; se non c'è e il canvas in
    // vista ha un'altra pagina (una resa interrotta), meglio niente.
    if (!fromCache(page)) blank();
    say(null);
    updateChrome();
  }

  function setMode(wanted: CardMode): void {
    if (destroyed || wanted === mode) return;
    mode = wanted;
    if (mode === "live") void open();
    else freeze();
  }

  function key(event: KeyboardEvent): boolean {
    if (destroyed || mode !== "live" || engine === null || pageCount === null) return false;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
    switch (event.key) {
      case "PageUp":
        void go(page - 1);
        return true;
      case "PageDown":
        void go(page + 1);
        return true;
      case "Home":
        void go(1);
        return true;
      case "End":
        void go(pageCount);
        return true;
      default:
        return false;
    }
  }

  function resize(): void {
    if (destroyed) return;
    if (mode === "live") void draw();
    else fromCache(page);
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    closeEngine();
    unwatch();
    root.remove();
  }

  updateChrome();
  if (mode === "live") void open();
  else fromCache(page);

  return {
    setMode,
    resize,
    key,
    page: () => page,
    destroy,
  };
}

function arrow(className: string, glyph: string, label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = glyph;
  button.setAttribute("aria-label", label);
  button.title = label;
  return button;
}
