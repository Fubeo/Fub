// La galleria di «Nuovo disegno»: il modulo proprio di `drawing.create`, che la
// shell registra all'avvio (`registerCommandForm`) e carica con un `import()`
// la prima volta che serve.
//
// Il comando è quello del kernel, con i suoi parametri e il suo esito; cambia
// chi chiede gli argomenti. Qui si sceglie guardando: un nome, la cartella, e
// un modello fra gli otto che Fub porta, ognuno con la sua anteprima e una riga
// che dice a che cosa serve, oppure uno dei disegni della cartella dei modelli
// del vault («Dal vault»).
//
// # Da dove vengono le anteprime
//
// Dai file dei modelli, gli stessi che il comando copia
// (`crates/fub-features/templates/<id>.<it|en>.svg`), nella lingua
// dell'interfaccia. Si importano con un `import.meta.glob` senza `eager`, uno
// per file: arrivano quando la galleria si apre e solo quelli della lingua
// che serve. Nessuna rete. Ogni file diventa un'immagine che si vede da sola,
// coi caratteri dell'app dentro (`selfContained`, come la Lettura e
// «Esporta»), e vive quanto la finestra.
//
// # I tasti
//
// Invio crea, anche da una scheda; Esc chiude, e il fuoco torna a chi ha aperto
// la galleria. Le frecce scelgono fra le schede: sono pulsanti di scelta
// nativi, nello stesso gruppo, quindi il browser fa il resto; Home e Fine
// vanno alla prima e all'ultima.
//
// # Un errore resta qui
//
// Un nome preso, un disegno che non si legge: la frase del comando compare
// vicino al nome, in un avviso, e il fuoco torna al nome. La finestra non si
// chiude su un errore.

import type { CommandSpec, Paged, VaultEntry } from "../../../host/contract";
import { errorText } from "../../../host/errors";
import { api } from "../../../host/ipc";
import { settings, vaultEntries, vaultFolders } from "../../../host/query";
import { t as shell } from "../../../i18n/strings";
import { readState, state, writeState } from "../../../state/store";
import { identifier } from "../../../ui/a11y";
import { NEW_DRAWING } from "../../../ui/commands";
import { actions, openFrame } from "../../../ui/dialogs";
import { deliverOutcome, type PaletteHost } from "../../../ui/palette";
import { appFonts, selfContained, type FontSheets } from "../picture";
import type { Lang, TemplateId } from "./content";
import {
  BLANK,
  CHOICE_KEY,
  DRAW_BUNDLE,
  FIRST,
  TEMPLATES_SETTING,
  cardsOf,
  createArgs,
  memoryOf,
  offersVault,
  previewLanguage,
  selectionFrom,
  templatesFolder,
  vaultDrawings,
  type Card,
  type Selection,
  type VaultDrawing,
} from "./choices";
import { t } from "./strings";

/// I file dei modelli, per percorso, ognuno da leggere quando serve.
const TEMPLATE_FILES = import.meta.glob<string>("../../../../../../crates/fub-features/templates/*.svg", {
  query: "?raw",
  import: "default",
});

/// Quanti suggerimenti di cartella si chiedono al vault.
const FOLDER_SUGGESTIONS = 200;

export interface GalleryOptions {
  /// Chi dà i caratteri alle anteprime; i caratteri dell'app, se manca.
  readonly fonts?: FontSheets;
  /// I file dei modelli, per percorso; quelli distribuiti con Fub, se manca.
  readonly files?: Readonly<Record<string, () => Promise<string>>>;
}

/// Una galleria aperta.
export interface Gallery {
  /// Chiude la galleria senza creare niente.
  close(): void;
  /// Porta il fuoco al nome.
  focus(): void;
  /// Si risolve quando sono arrivati i disegni del vault e l'ultima scelta.
  readonly ready: Promise<void>;
}

/// La galleria aperta adesso: ce n'è una sola.
let current: Gallery | null = null;

/// Un elemento col suo testo.
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/// Il testo del file di `id` nella lingua `lang`, o `null` se non c'è.
async function fileText(files: Readonly<Record<string, () => Promise<string>>>, id: TemplateId, lang: Lang): Promise<string | null> {
  const suffix = `/${id}.${lang}.svg`;
  const key = Object.keys(files).find((path) => path.endsWith(suffix));
  if (key === undefined) return null;
  try {
    return await files[key]!();
  } catch {
    return null;
  }
}

/// La spec di `drawing.create`, se la shell la conosce.
function specOf(): CommandSpec | undefined {
  return state.commandSpecs.find((spec) => spec.id === NEW_DRAWING);
}

/// Una pagina vuota, per quando il vault non risponde.
function empty<T>(): Paged<T> {
  return { items: [], offset: 0, total: 0 };
}

/// Apre la galleria. `prefill.folder` riempie la cartella; il risultato del
/// comando lo consegna `deliverOutcome`, come la palette. Se c'è già una
/// galleria aperta, il fuoco torna a quella: un nome scritto a metà non si perde
/// per un secondo gesto.
export function openGallery(
  prefill: Readonly<Record<string, string>>,
  host: Pick<PaletteHost, "onEffect" | "notify" | "flushPendingSave">,
  options: GalleryOptions = {},
): Gallery {
  if (current !== null) {
    current.focus();
    return current;
  }
  const fonts = options.fonts ?? appFonts;
  const files = options.files ?? TEMPLATE_FILES;
  const lang = previewLanguage();
  const spec = specOf();
  const cards = cardsOf(spec, lang);
  const withVault = offersVault(spec);
  const group = identifier("draw-new-choice");
  const urls: string[] = [];
  /// Ogni scheda e ogni disegno del vault ha un pulsante di scelta: la scelta
  /// che porta, e la sua riga.
  const choices = new Map<HTMLInputElement, { readonly selection: Selection; readonly row: HTMLElement }>();

  let closed = false;
  let busy = false;
  let selection: Selection = FIRST;
  /// L'utente ha scelto lui: l'ultima scelta, che arriva dopo, non la copre.
  let touched = false;

  const finish = (): void => {
    if (closed) return;
    closed = true;
    if (current === gallery) current = null;
    for (const url of urls) URL.revokeObjectURL(url);
    frame.close();
  };
  const frame = openFrame(t("draw.new.title"), finish);
  frame.overlay.classList.add("draw-new-overlay");
  frame.box.classList.add("draw-new");

  const form = element("form", "palette-form draw-new-form");
  form.noValidate = true;
  const body = element("div", "draw-new-body");

  // --- Nome e cartella -----------------------------------------------------

  const fields = element("div", "draw-new-fields");
  const nameLabel = element("label", "draw-new-field");
  const name = element("input", "");
  name.type = "text";
  name.autocomplete = "off";
  name.placeholder = t("draw.new.name.placeholder");
  name.spellcheck = false;
  nameLabel.append(element("span", "palette-label", t("draw.new.name")), name);

  const folderLabel = element("label", "draw-new-field");
  const folder = element("input", "");
  folder.type = "text";
  folder.autocomplete = "off";
  folder.spellcheck = false;
  folder.placeholder = t("draw.new.folder.placeholder");
  folder.value = prefill.folder?.trim() ?? "";
  const folderList = document.createElement("datalist");
  folderList.id = identifier("draw-new-folders");
  folder.setAttribute("list", folderList.id);
  folderLabel.append(element("span", "palette-label", t("draw.new.folder")), folder, folderList);
  fields.append(nameLabel, folderLabel);

  // Un avviso che c'è già quando il testo arriva: così lo annuncia chi legge
  // con una voce. Il riquadro vero compare dentro, soltanto con un errore.
  const alert = element("div", "draw-new-alert");
  alert.setAttribute("role", "alert");

  const clearError = (): void => {
    alert.replaceChildren();
    name.removeAttribute("aria-invalid");
    name.removeAttribute("aria-describedby");
  };
  const showError = (message: string): void => {
    const box = element("p", "palette-error", message);
    box.id = identifier("draw-new-error");
    alert.replaceChildren(box);
    name.setAttribute("aria-invalid", "true");
    name.setAttribute("aria-describedby", box.id);
    name.focus();
    name.select();
  };

  body.append(fields, alert);

  // --- I modelli -----------------------------------------------------------

  const choose = (next: Selection): void => {
    selection = next;
    for (const [input, entry] of choices) {
      const mine = entry.selection.kind === next.kind && memoryOf(entry.selection) === memoryOf(next);
      input.checked = mine;
      if (mine) entry.row.setAttribute("data-selected", "");
      else entry.row.removeAttribute("data-selected");
    }
  };
  const radio = (value: Selection, row: HTMLElement): HTMLInputElement => {
    const input = element("input", "");
    input.type = "radio";
    input.name = group;
    input.value = memoryOf(value);
    input.addEventListener("change", () => {
      if (!input.checked) return;
      touched = true;
      choose(value);
    });
    choices.set(input, { selection: value, row });
    return input;
  };

  const templatesTitle = element("h3", "draw-new-group-title", t("draw.new.templates"));
  templatesTitle.id = identifier("draw-new-templates");
  const grid = element("div", "draw-new-cards");
  grid.setAttribute("role", "radiogroup");
  grid.setAttribute("aria-labelledby", templatesTitle.id);

  const showPreview = async (image: HTMLImageElement, id: TemplateId): Promise<void> => {
    const text = await fileText(files, id, lang);
    if (text === null || closed) return;
    const svg = await selfContained(text, () => Promise.resolve(null), 0, fonts).catch(() => null);
    if (svg === null || closed) return;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    urls.push(url);
    image.addEventListener("load", () => {
      image.hidden = false;
    });
    image.src = url;
  };

  const cardFor = (card: Card): HTMLElement => {
    const row = element("label", "draw-new-card");
    row.setAttribute("data-template", card.id);
    const preview = element("span", "draw-new-preview");
    if (card.file !== null) {
      const image = element("img", "draw-new-image");
      image.alt = "";
      image.hidden = true;
      image.draggable = false;
      image.decoding = "async";
      preview.append(image);
      void showPreview(image, card.file);
    } else if (card.id === BLANK) {
      preview.append(element("span", "draw-new-blank"));
    }
    const head = element("span", "draw-new-card-head");
    const input = radio({ kind: "template", id: card.id }, row);
    const title = element("span", "draw-new-card-name", card.title);
    title.id = identifier("draw-new-card");
    input.setAttribute("aria-labelledby", title.id);
    head.append(input, title);
    row.append(preview, head);
    if (card.note !== null) {
      const note = element("span", "draw-new-card-note", card.note);
      note.id = identifier("draw-new-note");
      input.setAttribute("aria-describedby", note.id);
      row.append(note);
    }
    return row;
  };
  for (const card of cards) grid.append(cardFor(card));
  const templates = element("section", "draw-new-group");
  templates.append(templatesTitle, grid);
  body.append(templates);

  // --- Dal vault -----------------------------------------------------------

  const vaultTitle = element("h3", "draw-new-group-title", t("draw.new.vault"));
  vaultTitle.id = identifier("draw-new-vault");
  const vaultHint = element("p", "draw-new-group-hint");
  const vaultList = element("div", "draw-new-vault");
  vaultList.hidden = true;
  vaultList.setAttribute("role", "radiogroup");
  vaultList.setAttribute("aria-labelledby", vaultTitle.id);
  if (withVault) {
    const vault = element("section", "draw-new-group");
    vault.append(vaultTitle, vaultHint, vaultList);
    body.append(vault);
  }

  const fillVault = (where: string, drawings: readonly VaultDrawing[]): void => {
    if (drawings.length === 0) {
      vaultHint.textContent = where === "" ? t("draw.new.vault.empty_root") : t("draw.new.vault.empty", { folder: where });
      return;
    }
    vaultHint.textContent = where === "" ? t("draw.new.vault.in_root") : t("draw.new.vault.in_folder", { folder: where });
    for (const drawing of drawings) {
      const row = element("label", "draw-new-vault-item");
      row.setAttribute("data-drawing", drawing.path);
      const input = radio({ kind: "from", path: drawing.path }, row);
      row.append(input, element("span", "draw-new-vault-name", drawing.name));
      vaultList.append(row);
    }
    vaultList.hidden = false;
  };

  // --- Le azioni -----------------------------------------------------------

  const row = actions(t("draw.new.create"), finish);
  const submit = row.querySelector<HTMLButtonElement>("button[type=submit]")!;
  form.append(body, row);
  frame.box.append(form);
  choose(FIRST);

  const create = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    submit.disabled = true;
    form.setAttribute("aria-busy", "true");
    clearError();
    const fail = (message: string): void => {
      if (closed) host.notify(message, "guasto");
      else showError(message);
    };
    try {
      // Come la palette prima di un comando che scrive: i buffer ancora sporchi
      // si salvano prima, e se qualcuno non ce la fa il comando non parte. Un
      // comando senza spec nota si tratta come uno che scrive.
      if (spec === undefined || spec.scope.writes) {
        const pending = await host.flushPendingSave();
        if (pending.length > 0) {
          fail(shell("document.unsaved_blocks", { doc: pending.join(", ") }));
          return;
        }
      }
      writeState(CHOICE_KEY, memoryOf(selection));
      const outcome = await api.invokeCommand(NEW_DRAWING, createArgs(name.value, folder.value, selection), "apply");
      finish();
      try {
        await deliverOutcome(outcome, host, NEW_DRAWING);
      } catch (error) {
        host.notify(errorText(error), "guasto");
      }
    } catch (error) {
      fail(errorText(error));
    } finally {
      busy = false;
      submit.disabled = false;
      form.removeAttribute("aria-busy");
    }
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void create();
  });
  // Invio crea anche da un pulsante di scelta, che il browser non farebbe da
  // solo in ogni motore.
  form.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof HTMLInputElement && event.target.type === "radio") {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  // Home e Fine vanno alla prima e all'ultima scelta del gruppo; le frecce
  // fra quelle vicine sono del browser.
  const edges = (list: HTMLElement): void => {
    list.addEventListener("keydown", (event) => {
      if ((event.key !== "Home" && event.key !== "End") || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      const inputs = [...list.querySelectorAll<HTMLInputElement>("input[type=radio]")];
      const next = event.key === "Home" ? inputs[0] : inputs[inputs.length - 1];
      if (next === undefined) return;
      event.preventDefault();
      next.focus();
      if (!next.checked) next.click();
    });
  };
  edges(grid);
  edges(vaultList);

  // --- Ciò che arriva dopo -------------------------------------------------

  const load = async (): Promise<void> => {
    const [setting, memory, folders] = await Promise.all([
      settings(DRAW_BUNDLE).then(
        (entries) => entries.find((entry) => entry.spec.key === TEMPLATES_SETTING)?.value,
        () => undefined,
      ),
      readState<unknown>(CHOICE_KEY),
      vaultFolders({ offset: 0, limit: FOLDER_SUGGESTIONS }).catch(() => empty<{ path: string }>()),
    ]);
    if (closed) return;
    for (const entry of folders.items) {
      const option = document.createElement("option");
      option.value = entry.path;
      folderList.append(option);
    }
    let drawings: VaultDrawing[] = [];
    if (withVault) {
      const where = templatesFolder(setting);
      const entries = await vaultEntries({ offset: 0, limit: 500 }, undefined, { path: where, descendants: false }).catch(() => empty<VaultEntry>());
      if (closed) return;
      drawings = vaultDrawings(entries.items, where);
      fillVault(where, drawings);
    }
    if (!touched) choose(selectionFrom(memory, cards, drawings));
  };
  const ready = load();

  const gallery: Gallery = {
    close: finish,
    focus: () => {
      name.focus();
    },
    ready,
  };
  current = gallery;
  // Con un dito la tastiera sullo schermo coprirebbe metà dei modelli: il
  // fuoco sta sulla finestra, e il nome si tocca quando serve.
  const touch = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  if (touch) frame.overlay.focus();
  else name.focus();
  return gallery;
}
