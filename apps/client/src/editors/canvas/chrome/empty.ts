// La lavagna vuota (T62): quando la lavagna non ha niente, al centro tre righe e
// tre pulsanti, «Scrivi una scheda», «Aggiungi file…» e «Incolla». Si tolgono
// alla prima scheda, al primo gruppo, al primo collegamento o al primo tratto
// d'inchiostro sulla lavagna, e tornano quando la lavagna torna vuota. In sola
// lettura restano le tre righe, senza pulsanti.
//
// I pulsanti non hanno una strada loro. La tela dice che cosa fare
// (`CanvasEmptyOptions`) e lo fa con la strada di sempre: «Scrivi una scheda»
// apre la scheda di testo al centro, già in scrittura, come lo strumento Testo;
// «Aggiungi file…» e «Incolla» consegnano dati a `receive`, che li manda dal
// deposito come un rilascio o un Ctrl+V.
//
// Gli appunti si leggono solo al clic: leggerli prima chiederebbe un permesso
// senza un gesto. Se il sistema li nega, o negli appunti non c'è niente che
// diventa una scheda, lo dice un avviso normale, non un errore. Il selettore dei
// file è quello del sistema, come «Importa file…» dell'esplora (`panels/
// explorer.ts`): `host/dialog.ts` non ne ha uno che dia i file.

import { textButton } from "../../../kit/button";
import { t } from "../../../i18n/strings";
import { readClipboard, type ClipboardEntry } from "../../../platform/clipboard";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { notify } from "../../../ui/notify";
import { INK_KEY } from "../ink-record";
import type { CanvasDocument } from "../model";

export interface CanvasEmptyOptions {
  /** Il padrone dei pulsanti e dei loro ascolti: chiuso, la lavagna non li ha più. */
  readonly lifetime: Lifetime;
  /** Mette la scheda di testo al centro della vista, già in scrittura. */
  readonly write: () => void;
  /** Riceve i dati degli appunti o dal selettore, come un Ctrl+V dagli appunti. */
  readonly receive: (data: DataTransfer) => void;
  /** Se la lavagna può ricevere file dal computer (il deposito): senza, il pulsante non c'è. */
  readonly addFiles: boolean;
}

/** Ciò che la lavagna sa adesso: se è vuota, e se si può scrivere. */
export interface CanvasEmptyState {
  readonly empty: boolean;
  readonly editable: boolean;
}

export interface CanvasEmpty {
  /** `.canvas-blank`: nascosto quando la lavagna ha qualcosa, o non è aperta. */
  readonly element: HTMLElement;
  /** Mostra o toglie le righe e, in sola lettura, i pulsanti. */
  sync(state: CanvasEmptyState): void;
  /** Rifà le parole nella lingua di adesso. */
  relabel(): void;
}

/// Una lavagna è vuota se non ha schede, collegamenti né inchiostro. Un gruppo
/// vuoto è una scheda, e l'inchiostro sulla lavagna si vede: non sono vuote.
export function isEmptyBoard(doc: CanvasDocument): boolean {
  if (doc.nodes.length > 0 || doc.edges.length > 0) return false;
  return !hasStrokes(doc[INK_KEY]);
}

function hasStrokes(ink: unknown): boolean {
  if (typeof ink !== "object" || ink === null) return false;
  const strokes = (ink as { strokes?: unknown }).strokes;
  return Array.isArray(strokes) && strokes.length > 0;
}

/// Ciò che c'è negli appunti, letto come lo legge Ctrl+V: il primo `text/plain`,
/// il primo `text/html` (per le tabelle) e le immagini, che diventano file.
/// `null` se non c'è niente che diventa una scheda: senza testo né immagini,
/// Ctrl+V non fa nulla, e lo stesso fa questo pulsante.
export async function transferOf(entries: readonly ClipboardEntry[]): Promise<DataTransfer | null> {
  let text: string | null = null;
  let html: string | null = null;
  const images: File[] = [];
  for (const entry of entries) {
    if (text === null && entry.types.includes("text/plain")) text = await readText(entry, "text/plain");
    if (html === null && entry.types.includes("text/html")) html = await readText(entry, "text/html");
    const image = entry.types.find((type) => type.startsWith("image/"));
    if (image !== undefined) {
      const extension = image.slice("image/".length).split("+")[0];
      images.push(new File([await entry.getType(image)], `image.${extension}`, { type: image }));
    }
  }
  const plain = text ?? "";
  if (plain === "" && images.length === 0) return null;
  const data = new DataTransfer();
  if (plain !== "") data.setData("text/plain", plain);
  if (html) data.setData("text/html", html);
  for (const file of images) data.items.add(file);
  return data;
}

async function readText(entry: ClipboardEntry, type: string): Promise<string> {
  return (await entry.getType(type)).text();
}

/// Il selettore dei file del sistema, aperto subito, dentro il clic. I file
/// scelti arrivano come un rilascio; annullato, il browser non dice niente e non
/// succede niente.
function chooseFiles(receive: (data: DataTransfer) => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.addEventListener("change", () => {
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    const data = new DataTransfer();
    for (const file of files) data.items.add(file);
    receive(data);
  }, { once: true });
  input.click();
}

const LINES = ["canvas.blank.1", "canvas.blank.2", "canvas.blank.3"] as const;

/// Monta la lavagna vuota: le righe e i pulsanti nell'ordine del DOM (Scrivi,
/// Aggiungi file, Incolla), veri `button` per la tastiera.
export function createCanvasEmpty(options: CanvasEmptyOptions): CanvasEmpty {
  const { lifetime } = options;
  const element = document.createElement("div");
  element.className = "canvas-blank";
  element.hidden = true;
  const lines = document.createElement("p");
  lines.className = "canvas-blank-lines";
  const actions = document.createElement("div");
  actions.className = "canvas-blank-actions";
  element.append(lines, actions);

  // Gli ascolti dei pulsanti vivono in una vita figlia, così rifare le parole
  // non ne lascia dei vecchi.
  let buttons: Lifetime | null = null;

  // La lettura parte dentro il clic, come chiede il sistema; il resto è dalla
  // promessa. Una lavagna chiusa nel frattempo non riceve niente.
  const paste = (): void => {
    readClipboard().then(transferOf).then((data) => {
      if (lifetime.closed) return;
      if (data === null) notify(t("canvas.blank.paste_none"));
      else options.receive(data);
    }, () => {
      if (!lifetime.closed) notify(t("canvas.blank.paste_denied"));
    });
  };

  const build = (): void => {
    buttons?.close();
    buttons = openLifetime();
    const life = buttons;
    lines.replaceChildren(...LINES.map((key) => {
      const span = document.createElement("span");
      span.textContent = t(key);
      return span;
    }));
    const write = textButton({ label: t("canvas.blank.write"), kind: "primary", onPress: () => options.write(), lifetime: life });
    const row: HTMLButtonElement[] = [write];
    if (options.addFiles) {
      row.push(textButton({ label: t("canvas.blank.add"), onPress: () => chooseFiles(options.receive), lifetime: life }));
    }
    const pasteButton = textButton({ label: t("canvas.blank.paste"), onPress: paste, lifetime: life });
    pasteButton.setAttribute("aria-keyshortcuts", "Control+V");
    row.push(pasteButton);
    actions.replaceChildren(...row);
  };

  build();
  lifetime.add(() => buttons?.close());

  return {
    element,
    sync(state) {
      element.hidden = !state.empty;
      actions.hidden = !state.editable;
    },
    relabel() {
      build();
    },
  };
}
