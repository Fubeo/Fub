// «Importa disegno»: la finestra che fa un disegno nuovo da un file di
// Excalidraw o di draw.io. La shell la carica con un `import()` dalle sue
// porte (`registerDrawingImport` in `ui/commands.ts`): il menu File, il
// riquadro dei file, la palette.
//
// # Prima di scrivere si guarda
//
// La finestra legge il file, lo converte e mostra il disegno com'è venuto:
// l'anteprima, quanto c'è dentro e che cosa cambia rispetto all'originale,
// una frase per genere di nota (`report.ts`). Il nome e la cartella si
// scrivono intanto; il disegno nasce soltanto con «Importa». Il file
// d'origine non cambia mai.
//
// # Dove nasce
//
// Accanto all'originale se viene dal vault, nella cartella da cui lo si è
// chiesto se viene dal disco. Il nome è quello del file senza l'estensione
// del programma; un nome con una barra è un percorso dalla radice del vault,
// come per «Nuovo disegno». Un nome occupato non si sovrascrive mai: il
// disegno prende il primo libero della sua famiglia, «rete 1», «rete 2», come
// un allegato, e il suo titolo è il nome che ha preso.
//
// # I tasti
//
// Invio importa quando il disegno è pronto; Esc chiude, e il fuoco torna a
// chi ha aperto la finestra. Un errore resta qui, nell'avviso.

import { errorText } from "../../../host/errors";
import { api } from "../../../host/ipc";
import { vaultFolders } from "../../../host/query";
import { resolvedLanguage } from "../../../i18n/strings";
import { nameFault, normalizedName } from "../../../rules/mirrored";
import { identifier } from "../../../ui/a11y";
import type { DrawingSource } from "../../../ui/commands";
import { actions, openFrame } from "../../../ui/dialogs";
import { nameFaultText } from "../../../ui/name-fault";
import type { PaletteHost } from "../../../ui/palette";
import { attachmentCandidate } from "../../media/attachment-target";
import { MEDIA_MAX_INLINE_BYTES } from "../../media/media-types";
import { openResourcePort, type ResourceTransport } from "../../media/resource-port";
import { appFonts, selfContained, type FontSheets } from "../picture";
import { MAX_EDIT_BYTES } from "../scene/read";
import { utf8Length } from "../scene/text";
import { drawStrings, t as drawT } from "../strings";
import { browserMeasure, estimate, loadFonts } from "../tools/measure";
import { ensureTextFont } from "../tools/text";
import type { Diagram } from "./diagram";
import { browserPictures, type Pictures } from "./images";
import { fontsOf, importedName, ImportError, readDiagram, writeImported, type Imported } from "./index";
import { countText, noteText, reportOrder } from "./report";
import { t } from "./strings";
import { retitled, type Setup } from "./write";

/// Quanto si legge di un file da importare: quanto una risorsa passa intera
/// per il confine con l'host.
const MAX_SOURCE_BYTES = MEDIA_MAX_INLINE_BYTES;

/// Quanti nomi della stessa famiglia si provano prima di arrendersi.
const MAX_CANDIDATES = 10_000;

/// Quanti suggerimenti di cartella si chiedono al vault.
const FOLDER_SUGGESTIONS = 200;

/// Il nome dei due programmi, come lo scrivono loro.
const PROGRAM: Readonly<Record<Diagram["source"], string>> = { excalidraw: "Excalidraw", drawio: "draw.io" };

/// I byte dei file del vault, per chi li legge interi.
const transport: ResourceTransport = {
  open: (id, vault) => api.resourceOpen(id, vault ?? null),
  read_chunk: api.resourceReadChunk,
  close: api.resourceClose,
};

export interface ImportOptions {
  /// Chi dà i caratteri all'anteprima; i caratteri dell'app, se manca.
  readonly fonts?: FontSheets;
  /// Chi prepara le immagini; quelle del browser, se manca.
  readonly pictures?: Pictures | null;
}

/// Una finestra d'importazione aperta.
export interface ImportDialog {
  /// Chiude la finestra senza scrivere niente.
  close(): void;
  /// Porta il fuoco al nome.
  focus(): void;
  /// Si risolve quando il disegno è pronto da importare, o quando si sa che
  /// non lo sarà.
  readonly ready: Promise<void>;
}

/// La finestra aperta adesso: ce n'è una sola.
let current: ImportDialog | null = null;

/// Un file oltre `MAX_SOURCE_BYTES`.
class TooBig extends Error {}

/// Un elemento col suo testo.
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/// Il nome del file da cui si importa, com'è.
const sourceName = (from: DrawingSource): string => (from.kind === "vault" ? from.path : from.file.name);

/// La cartella di un percorso del vault; `""` per la radice.
const folderOf = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/// I byte di `from`. Lancia [`TooBig`] se passano `MAX_SOURCE_BYTES`.
async function bytesOf(from: DrawingSource): Promise<Uint8Array> {
  if (from.kind === "file") {
    if (from.file.size > MAX_SOURCE_BYTES) throw new TooBig();
    return new Uint8Array(await from.file.arrayBuffer());
  }
  const port = await openResourcePort(transport, from.path);
  try {
    if (port.descriptor.len > MAX_SOURCE_BYTES) throw new TooBig();
    return await port.readAll();
  } finally {
    await port.close();
  }
}

/// Lo `Setup` dello scrittore per un disegno che si chiama `title`: i nomi di
/// partenza dell'editor nella lingua dell'interfaccia, e la misura del
/// browser coi caratteri già letti.
function setupFor(title: string): Setup {
  const strings = drawStrings.catalogFor(resolvedLanguage());
  return {
    title,
    measure: browserMeasure() ?? estimate,
    layerName: (n) => drawT("draw.layer.default", { n }),
    boardName: (n) => drawT("draw.board.name", { n }),
    shapeName: (key) => strings[key] ?? key,
  };
}

/// La frase di un file che non si importa.
function unreadableText(error: unknown, reading: boolean): string {
  if (error instanceof TooBig) return t("draw.import.error.too_big", { limit: MAX_SOURCE_BYTES / (1024 * 1024) });
  if (error instanceof ImportError) {
    if (error.reason === "format") return t("draw.import.error.format");
    if (error.reason === "empty") return t("draw.import.error.empty");
    return t("draw.import.error.large");
  }
  return reading ? t("draw.import.error.read", { reason: errorText(error) }) : t("draw.import.error.convert", { reason: errorText(error) });
}

/// Se `error` è il rifiuto di un nome già preso.
const taken = (error: unknown): boolean => typeof error === "object" && error !== null && "kind" in error && error.kind === "already_exists";

/// Apre la finestra per importare `from`. Il disegno scritto si apre con
/// l'effetto `navigate` di `host`; un errore dopo la chiusura arriva con
/// `host.notify`. Se c'è già una finestra aperta, il fuoco torna a quella.
export function openImport(from: DrawingSource, host: Pick<PaletteHost, "onEffect" | "notify">, options: ImportOptions = {}): ImportDialog {
  if (current !== null) {
    current.focus();
    return current;
  }
  const fonts = options.fonts ?? appFonts;
  const pictures = options.pictures === undefined ? browserPictures() : options.pictures;
  const source = sourceName(from);
  const stem = importedName(source);
  const urls: string[] = [];

  let closed = false;
  let busy = false;
  /// Il diagramma letto e il disegno scritto; `null` finché non sono pronti.
  let diagram: Diagram | null = null;
  let imported: Imported | null = null;

  const finish = (): void => {
    if (closed) return;
    closed = true;
    if (current === dialog) current = null;
    for (const url of urls) URL.revokeObjectURL(url);
    frame.close();
  };
  const frame = openFrame(t("draw.import.title"), finish);
  frame.overlay.classList.add("draw-import-overlay");
  frame.box.classList.add("draw-import");

  const form = element("form", "palette-form draw-import-form");
  form.noValidate = true;
  form.setAttribute("aria-busy", "true");
  const body = element("div", "draw-import-body");

  // --- Il disegno com'è venuto ---------------------------------------------

  const fromLine = element("p", "draw-import-from");
  fromLine.hidden = true;
  const preview = element("div", "draw-import-preview");
  const image = element("img", "draw-import-image");
  image.alt = t("draw.import.preview");
  image.hidden = true;
  image.draggable = false;
  image.decoding = "async";
  const status = element("p", "draw-import-status", t("draw.import.reading"));
  status.setAttribute("role", "status");
  preview.append(image, status);
  const count = element("p", "draw-import-count");
  count.hidden = true;

  const reportTitle = element("h3", "draw-import-report-title", t("draw.import.report"));
  reportTitle.id = identifier("draw-import-report");
  const report = element("section", "draw-import-report");
  report.setAttribute("aria-labelledby", reportTitle.id);
  report.hidden = true;
  report.append(reportTitle);

  // --- Nome e cartella -----------------------------------------------------

  const fields = element("div", "draw-import-fields");
  const nameLabel = element("label", "draw-import-field");
  const name = element("input", "");
  name.type = "text";
  name.autocomplete = "off";
  name.spellcheck = false;
  name.value = stem;
  name.placeholder = stem;
  nameLabel.append(element("span", "palette-label", t("draw.import.name")), name);

  const folderLabel = element("label", "draw-import-field");
  const folder = element("input", "");
  folder.type = "text";
  folder.autocomplete = "off";
  folder.spellcheck = false;
  folder.placeholder = t("draw.import.folder.placeholder");
  folder.value = from.kind === "vault" ? folderOf(from.path) : from.folder.trim();
  const folderList = document.createElement("datalist");
  folderList.id = identifier("draw-import-folders");
  folder.setAttribute("list", folderList.id);
  folderLabel.append(element("span", "palette-label", t("draw.import.folder")), folder, folderList);
  fields.append(nameLabel, folderLabel);

  // Un avviso che c'è già quando il testo arriva: così lo annuncia chi legge
  // con una voce. Il riquadro vero compare dentro, soltanto con un errore.
  const alert = element("div", "draw-import-alert");
  alert.setAttribute("role", "alert");

  const clearError = (): void => {
    alert.replaceChildren();
    name.removeAttribute("aria-invalid");
    name.removeAttribute("aria-describedby");
  };
  const showError = (message: string, onName: boolean): void => {
    const box = element("p", "palette-error", message);
    box.id = identifier("draw-import-error");
    alert.replaceChildren(box);
    if (!onName) return;
    name.setAttribute("aria-invalid", "true");
    name.setAttribute("aria-describedby", box.id);
    name.focus();
    name.select();
  };

  body.append(fromLine, preview, count, report, fields, alert);

  // --- Le azioni -----------------------------------------------------------

  const row = actions(t("draw.import.create"), finish);
  const submit = row.querySelector<HTMLButtonElement>("button[type=submit]")!;
  const cancel = row.querySelector<HTMLButtonElement>("button[type=button]")!;
  submit.disabled = true;
  form.append(body, row);
  frame.box.append(form);

  /// Il testo del disegno col titolo `title`. Il titolo cambia la misura: se
  /// con quello nuovo il disegno passa il limite, lo si riscrive col titolo
  /// suo, che è quanto fa lo scrittore per stare nella misura.
  const textFor = async (title: string): Promise<string> => {
    const text = retitled(imported!.text, title);
    if (utf8Length(text) <= MAX_EDIT_BYTES) return text;
    return (await writeImported(diagram!, setupFor(title), pictures)).text;
  };

  /// Scrive il disegno nel primo nome libero della famiglia di `path`, senza
  /// estensione; dà il percorso che ha preso.
  const write = async (dir: string, base: string): Promise<string> => {
    for (let n = 0; n <= MAX_CANDIDATES; n++) {
      const candidate = attachmentCandidate(dir, base, "svg", n);
      const title = candidate.slice(candidate.lastIndexOf("/") + 1, -".svg".length);
      const bytes = new TextEncoder().encode(await textFor(title));
      try {
        await api.resourceWrite(candidate, bytes, null);
        return candidate;
      } catch (error) {
        if (!taken(error)) throw error;
      }
    }
    throw new Error(`nessun nome libero per «${base}»`);
  };

  const create = async (): Promise<void> => {
    if (busy || closed || imported === null) return;
    clearError();
    // Il nome senza `.svg`, che si aggiunge; con una barra è un percorso
    // dalla radice del vault.
    const typed = normalizedName(name.value.trim() === "" ? stem : name.value).replace(/\.svg$/i, "");
    const dir = typed.includes("/") ? folderOf(typed) : normalizedName(folder.value).replace(/^\/+|\/+$/g, "");
    const base = typed.slice(typed.lastIndexOf("/") + 1);
    const fault = base === "" ? "empty" : nameFault(`${dir === "" ? "" : `${dir}/`}${base}.svg`, "new");
    if (fault !== null) {
      showError(t("draw.import.error.name", { reason: nameFaultText(fault) }), true);
      return;
    }
    busy = true;
    submit.disabled = true;
    form.setAttribute("aria-busy", "true");
    try {
      const path = await write(dir, base);
      finish();
      host.notify(t("draw.import.done", { path }), "info");
      try {
        await host.onEffect({ kind: "navigate", doc: path });
      } catch (error) {
        host.notify(errorText(error), "guasto");
      }
    } catch (error) {
      const message = t("draw.import.error.write", { reason: errorText(error) });
      if (closed) host.notify(message, "guasto");
      else showError(message, false);
    } finally {
      busy = false;
      submit.disabled = imported === null;
      form.removeAttribute("aria-busy");
    }
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void create();
  });

  // --- Ciò che arriva dopo -------------------------------------------------

  /// Mostra il disegno pronto: l'anteprima, quanto c'è, che cosa cambia.
  const show = async (read: Diagram, done: Imported): Promise<void> => {
    fromLine.textContent = t("draw.import.from", { file: source, program: PROGRAM[read.source] });
    fromLine.hidden = false;
    count.textContent = countText(done.count);
    count.hidden = count.textContent === "";
    const notes = reportOrder(done.notes);
    if (notes.length === 0) {
      report.append(element("p", "draw-import-report-none", t("draw.import.report.none")));
    } else {
      const list = element("ul", "draw-import-notes");
      for (const note of notes) list.append(element("li", "draw-import-note", noteText(note)));
      report.append(list);
    }
    report.hidden = false;
    const svg = await selfContained(done.text, () => Promise.resolve(null), 0, fonts).catch(() => null);
    if (closed) return;
    if (svg === null) {
      preview.hidden = true;
      return;
    }
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    urls.push(url);
    image.addEventListener("load", () => {
      image.hidden = false;
      status.hidden = true;
    });
    image.addEventListener("error", () => {
      preview.hidden = true;
    });
    image.src = url;
  };

  /// Il file non si importa: resta l'avviso, e il fuoco va su Annulla.
  const refuse = (message: string): void => {
    preview.hidden = true;
    fields.hidden = true;
    submit.hidden = true;
    showError(message, false);
    cancel.focus();
  };

  const load = async (): Promise<void> => {
    void vaultFolders({ offset: 0, limit: FOLDER_SUGGESTIONS })
      .then((folders) => {
        if (closed) return;
        for (const entry of folders.items) {
          const option = document.createElement("option");
          option.value = entry.path;
          folderList.append(option);
        }
      })
      .catch(() => {});
    let bytes: Uint8Array;
    try {
      bytes = await bytesOf(from);
    } catch (error) {
      if (!closed) refuse(unreadableText(error, true));
      return;
    }
    let read: Diagram;
    try {
      read = await readDiagram(source, bytes);
    } catch (error) {
      if (!closed) refuse(unreadableText(error, false));
      return;
    }
    if (closed) return;
    status.textContent = t("draw.import.preparing");
    let done: Imported;
    try {
      ensureTextFont();
      await loadFonts(fontsOf(read));
      done = await writeImported(read, setupFor(stem), pictures);
    } catch (error) {
      if (!closed) refuse(unreadableText(error, false));
      return;
    }
    if (closed) return;
    diagram = read;
    imported = done;
    submit.disabled = busy;
    form.removeAttribute("aria-busy");
    await show(read, done);
  };
  const ready = load().finally(() => form.removeAttribute("aria-busy"));

  const dialog: ImportDialog = {
    close: finish,
    focus: () => {
      if (fields.hidden) cancel.focus();
      else name.focus();
    },
    ready,
  };
  current = dialog;
  // Con un dito la tastiera sullo schermo coprirebbe l'anteprima: il fuoco
  // sta sulla finestra, e il nome si tocca quando serve.
  const touch = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  if (touch) frame.overlay.focus();
  else name.focus();
  return dialog;
}
