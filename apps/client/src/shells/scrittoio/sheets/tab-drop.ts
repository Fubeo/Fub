// Rilasciare una linguetta sul foglio.
//
// Il riordino sulla striscia e lo spostamento fra riquadri li fa già la vista
// (`wireTabDrag` in `panels/document.ts`), tab su tab. Qui c'è il resto del
// gesto, che non ha un posto dentro la vista perché guarda l'intero piano dei
// fogli:
//
//   - sul **corpo** di un foglio il rilascio ha cinque zone: i quattro bordi
//     dividono il foglio e ci mettono la linguetta in un riquadro nuovo, il
//     centro ce la porta in coda. Mentre si trascina un'anteprima mostra dove
//     finirà;
//   - sulla **striscia**, fuori da ogni linguetta, la linguetta va in coda al
//     riquadro;
//   - fuori dalla finestra una linguetta di nota diventa una finestra;
//   - una **nota dall'albero** lasciata sulla striscia (anche sopra una
//     linguetta) si apre in quel riquadro: sul corpo, invece, la prende
//     l'editor e diventa un collegamento.
//
// Ogni zona ha il suo comando nel menu della linguetta (`tabmenu.*`): il gesto
// col mouse non è l'unica strada, come vuole il §18.2.
//
// # Come si sa che cosa si trascina
//
// Durante `dragover` il browser non lascia leggere i dati, solo i tipi. Perciò
// la linguetta in volo si ricorda alla partenza, leggendo ciò che la vista ha
// appena scritto (`{ pane, index }`), e si dimentica a rilascio o fine. Un
// trascinamento che non parte da una linguetta (un file dal sistema) non è
// mai preso per uno nostro.
import { platformSupports } from "../../../platform/capabilities";
import { openDocument, synchronize } from "../../../state/document-controller";
import { focusPane, moveTab, moveTabToPane, pane, splitWithTab, type SplitEdge } from "../../../state/layout";
import { NOTE_DRAG_TYPE } from "../../../ui/drag-types";
import type { Lifetime } from "../../../ui/lifetime";
import { byId } from "../frame/dom";
import { paneIdOf } from "./panes";

/// Quanto di un foglio, dal bordo, vale come «dividi da questo lato».
const EDGE = 0.25;

export type DropZone = SplitEdge | "center";

/// Che zona di un riquadro è sotto il puntatore: il bordo più vicino, se è
/// dentro la fascia; altrimenti il centro.
export function zoneOf(rect: { left: number; top: number; width: number; height: number }, x: number, y: number): DropZone {
  if (rect.width <= 0 || rect.height <= 0) return "center";
  const fx = (x - rect.left) / rect.width;
  const fy = (y - rect.top) / rect.height;
  const near: [SplitEdge, number][] = [
    ["left", fx],
    ["right", 1 - fx],
    ["top", fy],
    ["bottom", 1 - fy],
  ];
  near.sort((a, b) => a[1] - b[1]);
  const [edge, distance] = near[0]!;
  return distance < EDGE ? edge : "center";
}

/// La parte del riquadro che l'anteprima copre.
function previewRect(
  from: { left: number; top: number; width: number; height: number },
  zone: DropZone,
): { left: number; top: number; width: number; height: number } {
  // Una copia con le sole quattro misure: un `DOMRect` si espande in un oggetto
  // vuoto, perché le sue misure sono accessori del prototipo.
  const rect = { left: from.left, top: from.top, width: from.width, height: from.height };
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
  switch (zone) {
    case "left":
      return { ...rect, width: halfW };
    case "right":
      return { ...rect, left: rect.left + halfW, width: halfW };
    case "top":
      return { ...rect, height: halfH };
    case "bottom":
      return { ...rect, top: rect.top + halfH, height: halfH };
    default:
      return rect;
  }
}

interface Flight {
  pane: string;
  index: number;
}

export function mountTabDrop(lifetime: Lifetime): void {
  const panes = byId("panes");
  if (!panes) return;
  let flight: Flight | null = null;
  let preview: HTMLElement | null = null;

  const hide = (): void => {
    preview?.remove();
    preview = null;
  };
  const clear = (): void => {
    flight = null;
    hide();
  };
  lifetime.add(clear);

  /// Il foglio senza la sua striscia: le zone si misurano sul corpo.
  const bodyOf = (frame: HTMLElement): { left: number; top: number; width: number; height: number } => {
    const whole = frame.getBoundingClientRect();
    const strip = frame.querySelector<HTMLElement>(".pane-tabs")?.getBoundingClientRect();
    const top = strip ? Math.max(whole.top, strip.bottom) : whole.top;
    return { left: whole.left, top, width: whole.width, height: Math.max(0, whole.top + whole.height - top) };
  };
  const onTab = (target: EventTarget | null): boolean =>
    target instanceof Element && target.closest('[draggable="true"]') !== null;
  const frameOf = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>(".pane[data-pane]") : null;

  /// Dove andrebbe, se si rilasciasse adesso. `null`: da nessuna parte.
  const landing = (event: DragEvent): { target: string; zone: DropZone | "strip"; frame: HTMLElement } | null => {
    if (!flight || onTab(event.target)) return null;
    const frame = frameOf(event.target);
    const target = frame ? paneIdOf(frame) : null;
    if (!frame || !target) return null;
    if (event.target instanceof Element && event.target.closest(".pane-tabs")) {
      return { target, zone: "strip", frame };
    }
    const zone = zoneOf(bodyOf(frame), event.clientX, event.clientY);
    // Il centro del proprio foglio non sposta niente.
    if (zone === "center" && target === flight.pane) return null;
    // L'unica linguetta di un foglio non si separa da sé.
    if (zone !== "center" && target === flight.pane && (pane(flight.pane)?.tabs.length ?? 0) <= 1) return null;
    return { target, zone, frame };
  };

  const show = (frame: HTMLElement, zone: DropZone): void => {
    if (!preview) {
      preview = document.createElement("div");
      preview.className = "tab-drop-preview";
      preview.setAttribute("aria-hidden", "true");
      document.body.append(preview);
    }
    const box = previewRect(bodyOf(frame), zone);
    preview.dataset.zone = zone;
    preview.style.left = `${box.left}px`;
    preview.style.top = `${box.top}px`;
    preview.style.width = `${box.width}px`;
    preview.style.height = `${box.height}px`;
  };

  lifetime.listen(panes, "dragstart", (event) => {
    if (!onTab(event.target)) return;
    try {
      const data = JSON.parse(event.dataTransfer?.getData("text/plain") ?? "") as Partial<Flight>;
      flight =
        typeof data.pane === "string" && typeof data.index === "number" ? { pane: data.pane, index: data.index } : null;
    } catch {
      flight = null;
    }
  });
  /// Il riquadro della striscia sotto una nota dell'albero in volo, o `null`.
  const noteStrip = (event: DragEvent): string | null => {
    if (flight || !event.dataTransfer?.types?.includes(NOTE_DRAG_TYPE)) return null;
    if (!(event.target instanceof Element) || !event.target.closest(".pane-tabs")) return null;
    const frame = frameOf(event.target);
    return frame ? paneIdOf(frame) : null;
  };

  lifetime.listen(panes, "dragover", (event) => {
    if (noteStrip(event)) {
      event.preventDefault();
      event.dataTransfer!.dropEffect = "copy";
      return;
    }
    const place = landing(event);
    if (!place) {
      hide();
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    if (place.zone === "strip") hide();
    else show(place.frame, place.zone);
  });
  lifetime.listen(panes, "dragleave", (event) => {
    if (event.relatedTarget instanceof Node && panes.contains(event.relatedTarget)) return;
    hide();
  });
  lifetime.listen(panes, "drop", (event) => {
    const strip = noteStrip(event);
    const note = strip ? event.dataTransfer?.getData(NOTE_DRAG_TYPE) : "";
    if (strip && note) {
      event.preventDefault();
      focusPane(strip);
      void openDocument(note);
      return;
    }
    const place = landing(event);
    const dropped = flight;
    clear();
    if (!place || !dropped) return;
    event.preventDefault();
    const done =
      place.zone === "strip" || place.zone === "center"
        ? place.target === dropped.pane
          ? moveTab(dropped.pane, dropped.index, (pane(dropped.pane)?.tabs.length ?? 1) - 1)
          : moveTabToPane(dropped.pane, dropped.index, place.target)
        : splitWithTab(dropped.pane, dropped.index, place.target, place.zone) !== null;
    if (done) void synchronize();
  });
  // Una linguetta lasciata fuori dalla finestra diventa una finestra. Il
  // browser non dice sempre dove è finito il puntatore: si agisce solo se il
  // rilascio non è stato accolto da nessuno e le coordinate cadono davvero
  // fuori, mai sullo zero che alcuni motori danno a un trascinamento annullato.
  lifetime.listen(document, "dragend", (event) => {
    const dropped = flight;
    clear();
    if (!dropped || event.dataTransfer?.dropEffect !== "none") return;
    const outside =
      event.clientX < 0 || event.clientY < 0 || event.clientX > window.innerWidth || event.clientY > window.innerHeight;
    if (!outside || !platformSupports("multipleWindows")) return;
    const tab = pane(dropped.pane)?.tabs[dropped.index];
    if (!tab || tab.k !== "doc") return;
    void import("../../../state/document-windows").then((windows) => windows.openCurrentInNewWindow(tab.doc));
  });
}
