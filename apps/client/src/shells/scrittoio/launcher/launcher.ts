// Il lanciatore: una superficie sola per aprire, cercare e comandare.
//
// Nasce dalla pillola della barra del titolo e ci torna. Ha un campo, che
// tiene sempre il fuoco, una fila di modi e un elenco. «Tutto» non ha
// prefisso: cerca fra le note per nome, nel testo e fra i titoli della nota
// aperta. Gli altri modi si scelgono col prefisso in testa, dalla fila o col
// clic, e ognuno ricorda la sua ultima domanda finché la shell vive. Tab non
// cambia modo: mostra le azioni della riga. Che cosa c'è da scegliere lo dicono
// le sorgenti (`sources.ts`), che cosa succede a sceglierlo lo dicono i gesti
// (`actions.ts`); qui stanno il disegno, i tasti e la gara fra le risposte.
// Dove la finestra lo permette, accanto all'elenco c'è l'anteprima della riga
// attiva, che cambia con la specie (`preview.ts`): il foglio di una nota, ciò
// che fa un comando, la sintassi di un blocco. I tasti non stanno qui: il
// lanciatore li dice alla porta dei suggerimenti (`editors/core/hints.ts`), e
// la riga della banda li scrive, cambiando con la riga attiva.
import "./launcher.css";
import { openHintSource, type HintItem } from "../../../editors/core/hints";
import { mediaKindOfId, type MediaKind } from "../../../editors/media/media-types";
import { errorText } from "../../../host/errors";
import { onLanguage, plural, t } from "../../../i18n/strings";
import { createList, createTabs, type ListHandle, type TabsHandle } from "../../../kit";
import { DURATION, animate, motionLevel, prepareExit } from "../../../moto";
import { pageName } from "../../../rules/mirrored";
import { focusEditor } from "../../../state/document-controller";
import { identifier, trapFocus } from "../../../ui/a11y";
import { allCommands, ariaBinding, displayBinding, matchesBinding } from "../../../ui/commands";
import { scopeLabel } from "../../../ui/palette";
import { highlighted, markedTerms } from "../../../ui/highlight";
import { FORMAT_ICON, formatKindOf } from "../../../ui/format-kind";
import { iconEl } from "../../../ui/icons";
import { registerMenuSearch } from "../../../ui/menu";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { notify } from "../../../ui/notify";
import { markdownHint } from "../../../panels/slash/entries";
import { ACTION_LOOKS } from "../../../panels/format-bar";
import { isNoteDoc } from "../../../state/note-cards";
import { Race } from "../../../ui/race";
import { skeleton, SKELETON_DELAY_MS } from "../../../ui/skeleton";
import { on, state } from "../../../state/store";
import { actionRows, createNamed, step, toSearchPanel } from "./actions";
import { declareLauncherCommands } from "./commands";
import {
  MODES,
  PREFIX,
  createMemory,
  openWay,
  pillPose,
  previewFits,
  read,
  type Mode,
  type OpenWay,
  type Reading,
} from "./model";
import { createPreview, folderOf, type PreviewCard, type PreviewFact } from "./preview";
import { answersAtOnce, listing, prefetchFiles, rereadFiles, selectable, type ActionId, type Listing, type Row } from "./sources";

/// Quanto si aspetta dopo l'ultima battuta prima di chiedere a una sorgente
/// che risponde da lontano (ms).
export const ASK_DELAY_MS = 120;
/// Dopo quanto una risposta che non arriva si dice (ms). Un elenco ancora
/// vuoto mostra intanto la sagoma delle righe.
export const SLOW_AFTER_MS = SKELETON_DELAY_MS;
/// Le righe della sagoma dell'elenco.
const SKELETON_ROWS = 5;

export interface Launcher {
  /// Apre in un modo; se è già aperto, ci passa. Con `text` la domanda è
  /// quella, altrimenti l'ultima che il modo ricorda.
  open(mode: Mode, text?: string): void;
  /// Chiude e restituisce il fuoco a chi l'aveva.
  close(): void;
  readonly isOpen: boolean;
}

const MODE_LABEL = {
  all: "launcher.mode.all",
  commands: "launcher.mode.commands",
  tags: "launcher.mode.tags",
  people: "launcher.mode.people",
  blocks: "launcher.mode.blocks",
  help: "launcher.mode.help",
  line: "launcher.mode.line",
} as const;

const PLACEHOLDER = {
  all: "launcher.placeholder.all",
  commands: "launcher.placeholder.commands",
  tags: "launcher.placeholder.tags",
  people: "launcher.placeholder.people",
  blocks: "launcher.placeholder.blocks",
  help: "launcher.placeholder.help",
  line: "launcher.placeholder.line",
} as const;

/// L'icona davanti a ogni riga, per specie: ciò che si sceglie si riconosce
/// prima di leggerlo. Le intestazioni, le etichette e le righe hanno un segno
/// scritto (`ROW_GLYPH`) al posto di un disegno, come i prefissi della fila.
const ROW_ICON = {
  note: "notes",
  person: "people",
  "create-person": "people",
  command: "palette",
  block: "blocks",
  help: "keyboard",
} as const;

/// Il segno scritto delle righe che non hanno un disegno.
const ROW_GLYPH = {
  heading: "#",
  tag: "#",
  line: ":",
} as const;

/// L'icona di ogni azione della riga (Tab).
const ACTION_ICON: Readonly<Record<ActionId, string>> = {
  open: "notes",
  split: "struttura",
  peek: "eye",
  rename: "pen",
  "copy-link": "backlinks",
  pin: "pin",
};

/// Esc, com'è scritto sul segno che chiude.
const ESC_KEY = "Esc";

/// Che cosa fa Invio su una riga, detto nella banda. L'aiuto non ha un gesto:
/// serve a leggere.
const ENTER_HINT = {
  note: "launcher.hint.open",
  person: "launcher.hint.open",
  "create-person": "launcher.hint.create_person",
  command: "launcher.hint.run",
  action: "launcher.hint.run",
  block: "launcher.hint.insert",
  tag: "launcher.hint.pick",
  heading: "launcher.hint.go",
  line: "launcher.hint.go",
} as const;

/// Il nome del contesto che il lanciatore dà alla porta dei suggerimenti: la
/// riga della banda lo scrive in `data-context`, e la geometria del lanciatore
/// la tiene nascosta finché non dice il suo.
export const LAUNCHER_HINTS = "launcher";

/// I modi in cui ciò che si sceglie è una nota, e si può aprire a lato.
const OPENS_NOTES: readonly Mode[] = ["all", "people"];

/// I modi che mostrano l'anteprima della riga attiva, dove c'è posto. La Riga
/// no: la sua riga sola dice già tutto.
const SHOWS_PREVIEW: readonly Mode[] = ["all", "commands", "tags", "people", "blocks", "help"];

/// L'accordo che porta la domanda nel pannello Cerca. È un gesto del
/// lanciatore, come gli altri Invio del piede, non l'accordo di un comando.
const PANEL_CHORD = "Mod-Shift-Enter";
/// L'accordo che crea la nota col nome scritto, quando la risposta lo offre.
const CREATE_CHORD = "Shift-Enter";

/// La velocità con cui l'opacità parte all'apertura (per ms): la superficie
/// si vede subito, mentre la misura segue la molla.
const OPENING_FADE_SPEED = 0.02;

interface Shown extends Listing {
  failed?: boolean;
}

/// L'icona dei file che non sono documenti, per specie. Un file d'altra specie
/// non ne porta.
const MEDIA_ICON: Readonly<Partial<Record<MediaKind, string>>> = {
  image: "image",
  pdf: "book",
  audio: "music",
  video: "monitor",
};

/// L'icona della riga di un file: il formato di un documento che non è una
/// nota, o la specie di un file; nessuna per una nota (porta quella delle note).
function kindIcon(doc: string): string | null {
  const format = formatKindOf(doc);
  if (format) return format === "note" ? null : FORMAT_ICON[format];
  return MEDIA_ICON[mediaKindOfId(doc)] ?? null;
}

/// Le righe su cui Tab mostra le azioni: una nota o una persona.
function actionable(row: Row | null): row is Extract<Row, { kind: "note" | "person" }> {
  return row !== null && (row.kind === "note" || row.kind === "person");
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

/// Il segno che tiene il posto di un tasto in una frase del catalogo: la frase
/// si spezza lì, e il tasto si scrive nel suo riquadro. Un carattere d'uso
/// privato: nessuna lingua lo scrive, e nessuna serializzazione lo cambia.
const KEY_MARK = "\uE000";

/// Una frase dell'anteprima con un tasto dentro: le parole prima, il tasto, le
/// parole dopo.
function withKey(sentence: string, key: string): PreviewFact["parts"] {
  const [before = "", ...rest] = sentence.split(KEY_MARK);
  return rest.length === 0 ? [sentence] : [before, { key }, rest.join("")];
}

/// L'icona di un blocco: quella della barra di formato, se ne ha una.
function blockIcon(id: string): string {
  const look = ACTION_LOOKS[id]?.icon;
  return look ? look : ROW_ICON.block;
}

/// Il quadro dell'anteprima per una riga che non è una nota: che cos'è e che
/// cosa fa, col tasto e la sintassi che servono. `null` per le note (le mostra
/// il foglio) e per le righe che dicono già tutto da sole.
function cardOf(row: Row): PreviewCard | null {
  switch (row.kind) {
    case "command": {
      const entry = row.entry;
      const facts: PreviewFact[] = [];
      const chord = displayBinding(entry.binding);
      if (chord) facts.push({ icon: "keyboard", parts: [{ key: chord }] });
      // Il raggio di un comando del nucleo: che cosa tocca, e se si torna
      // indietro. Uno che non si annulla lo dice col segno d'avviso.
      if (entry.spec) facts.push({ icon: entry.spec.scope.reversible ? "info" : "warning", parts: [scopeLabel(entry.spec)] });
      if (entry.group) facts.push({ icon: "more", parts: [t("launcher.preview.command.where", { where: entry.group })] });
      return {
        key: row.key,
        icon: ROW_ICON.command,
        title: entry.title,
        // Un comando spento dice il suo motivo al posto di ciò che fa.
        text: entry.unavailable || entry.description,
        facts,
      };
    }
    case "block": {
      const facts: PreviewFact[] = [];
      const syntax = markdownHint(row.entry.id);
      const chord = displayBinding(row.entry.binding);
      if (syntax) facts.push({ icon: "keyboard", parts: withKey(t("launcher.preview.block.syntax", { syntax: KEY_MARK }), syntax) });
      else if (chord) facts.push({ icon: "keyboard", parts: [{ key: chord }] });
      facts.push({ icon: "pen", parts: [t("launcher.preview.block.where")] });
      return { key: row.key, icon: blockIcon(row.entry.id), title: row.entry.title, text: row.entry.description, facts };
    }
    case "help": {
      const chord = displayBinding(row.entry.binding);
      return {
        key: row.key,
        icon: ROW_ICON.help,
        title: row.entry.title,
        text: row.entry.description,
        facts: chord ? [{ icon: "keyboard", parts: [{ key: chord }] }] : [],
      };
    }
    case "tag":
      return {
        key: row.key,
        glyph: ROW_GLYPH.tag,
        title: `#${row.name}`,
        text: plural(row.count, "launcher.preview.tag.one", "launcher.preview.tag"),
        facts: [],
      };
    case "heading":
      return {
        key: row.key,
        glyph: ROW_GLYPH.heading,
        title: row.text,
        text: t("launcher.preview.heading", { level: row.level }),
        facts: [{ icon: "notes", parts: [pageName(row.doc)] }],
      };
    case "create-person":
      return {
        key: row.key,
        icon: ROW_ICON["create-person"],
        title: t("launcher.row.create_person", { name: row.name }),
        text: t("launcher.preview.create_person"),
        facts: [],
      };
    case "group":
    case "note":
    case "person":
    case "line":
    case "action":
      return null;
  }
}

/// Monta il lanciatore e dichiara i comandi che lo aprono. Chiudere `lifetime`
/// lo chiude, ritira i comandi e rimette quelli della shell comune.
export function mountLauncher(lifetime: Lifetime): Launcher {
  const memory = createMemory();
  /// La chiusura in corso, se il lanciatore è aperto.
  let closeOpen: (() => void) | null = null;
  /// Il passaggio di modo di quello aperto.
  let switchOpen: ((mode: Mode, text?: string) => void) | null = null;

  const build = (first: Mode, text: string | undefined): void => {
    const origin = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;
    const pill = document.getElementById("pill");
    const life = openLifetime();
    const race = new Race();
    // I file del vault si rileggono a ogni apertura (quelli letti l'altra volta
    // possono essere cambiati), e la lettura parte subito: corre mentre si scrive.
    prefetchFiles();

    const layer = el("div", "launcher-layer");
    const veil = el("div", "launcher-veil");
    const surface = el("div", "launcher");
    surface.setAttribute("role", "dialog");
    surface.setAttribute("aria-modal", "true");
    surface.setAttribute("aria-label", t("launcher.label"));
    const content = el("div", "launcher-content");

    const head = el("div", "launcher-head");
    const lens = el("span", "launcher-lens");
    lens.setAttribute("aria-hidden", "true");
    const input = el("input", "launcher-input");
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    // Niente `aria-haspopup`: per un combobox è già «listbox», e scriverlo
    // lascia axe indeciso su `aria-controls`.
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-label", t("launcher.field"));
    // La lente è una sola per tutti i modi: il modo lo dice la fila sotto.
    const lensIcon = iconEl("search");
    if (lensIcon) lens.append(lensIcon);
    const wait = el("span", "launcher-wait");
    wait.setAttribute("aria-hidden", "true");
    // Il segno «Esc» in fondo al campo chiude, come il tasto che porta scritto.
    // Non è una fermata del Tab (qui Tab mostra le azioni): è per il puntatore.
    const dismiss = el("button", "launcher-close");
    dismiss.type = "button";
    dismiss.tabIndex = -1;
    dismiss.textContent = ESC_KEY;
    dismiss.setAttribute("aria-label", t("launcher.close"));
    dismiss.setAttribute("aria-keyshortcuts", "Escape");
    head.append(lens, input, wait, dismiss);

    const strip = el("div", "launcher-modes");
    // Il modo, detto a chi non vede la fila: letto col campo quando si entra,
    // annunciato quando cambia. Tab lo mostra senza cambiarlo, e senza questa
    // voce il modo cambierebbe in silenzio.
    const said = el("span", "sr-only");
    said.id = identifier("launcher-mode");
    said.setAttribute("role", "status");
    input.setAttribute("aria-describedby", said.id);
    const body = el("div", "launcher-body");
    const results = el("div", "launcher-results");
    // A scorrere è l'elenco stesso: è lui il riquadro che il campo controlla.
    const rows = el("div", "launcher-list");
    rows.id = identifier("launcher-list");
    rows.setAttribute("aria-label", t("launcher.label"));
    input.setAttribute("aria-controls", rows.id);
    // Due voci sobrie: la frase di quando non c'è niente, e il conto di quando
    // c'è. Ognuna parla solo quando cambia. Il conto non si vede: lo sente chi
    // ascolta, e a chi guarda lo dice l'elenco stesso.
    const note = el("p", "launcher-note");
    note.setAttribute("role", "status");
    note.hidden = true;
    const status = el("span", "sr-only launcher-status");
    status.setAttribute("role", "status");
    // Crea la nota col nome scritto, quando la risposta lo offre: lo stesso che
    // fa Maiusc-Invio, da toccare o da cliccare, sotto la frase che lo propone.
    // Non è una fermata del Tab (qui Tab mostra le azioni): alla tastiera la
    // strada è l'accordo, che la banda scrive.
    const toCreate = el("button", "launcher-panel launcher-create");
    toCreate.type = "button";
    toCreate.tabIndex = -1;
    toCreate.hidden = true;
    toCreate.setAttribute("aria-keyshortcuts", ariaBinding(CREATE_CHORD));
    toCreate.textContent = t("launcher.create.offer");
    results.append(rows, note, toCreate, status);
    const preview = createPreview(life);
    body.append(results, preview.element);

    // Il piede c'è solo al telefono (`launcher.css`): i controlli di chi tocca e
    // non ha i tasti. Sul computer i tasti li scrive la banda.
    const foot = el("div", "launcher-foot");
    // Porta la domanda nel pannello Cerca: si vede in «Tutto», e resta spento
    // senza una domanda. Non è una fermata del Tab: alla tastiera la strada è
    // l'accordo.
    const toPanel = el("button", "launcher-panel");
    toPanel.type = "button";
    toPanel.tabIndex = -1;
    toPanel.hidden = true;
    toPanel.setAttribute("aria-keyshortcuts", ariaBinding(PANEL_CHORD));
    toPanel.textContent = t("launcher.panel");
    // Le azioni della riga per chi non ha la tastiera: lo stesso che fa Tab.
    const toActions = el("button", "launcher-panel launcher-actions");
    toActions.type = "button";
    toActions.tabIndex = -1;
    toActions.hidden = true;
    toActions.textContent = t("launcher.actions");
    foot.append(toActions, toPanel);
    /// Il piede senza niente da premere non si vede: al telefono un controllo
    /// spento sparisce (`mobile.css`), e un piede vuoto sarebbe una striscia.
    function fitFoot(): void {
      const empty = toActions.hidden && (toPanel.hidden || toPanel.disabled);
      if (foot.hasAttribute("data-empty") !== empty) foot.toggleAttribute("data-empty", empty);
    }

    // I tasti che servono adesso, detti alla porta dei suggerimenti: la riga
    // della banda li scrive al posto di quelli dell'editor sotto il velo. La
    // fonte è la più recente, e finché il lanciatore è aperto è lei a parlare.
    const hintSource = openHintSource(() => (life.closed ? null : { id: LAUNCHER_HINTS, items: hintItems() }));
    life.add(() => hintSource.close());
    // La banda sale sopra il velo, con i soli suggerimenti (`launcher.css`).
    const band = document.getElementById("status-band");
    band?.setAttribute("data-launcher", "");
    life.add(() => band?.removeAttribute("data-launcher"));

    content.append(head, strip, said, body, foot);
    surface.append(content);
    layer.append(veil, surface);

    let mode: Mode = first;
    /// Vero finché ciò che si vede risponde a una domanda che non è più quella
    /// del campo.
    let stale = false;
    /// Un Invio arrivato prima della risposta: vale per la prima riga che arriva.
    let deferred: OpenWay | null = null;
    /// Vero mentre si rifà la stessa domanda (i documenti sono cambiati): le
    /// righe che si vedono sono ancora quelle, e un Invio vale per la riga
    /// scelta, se c'è ancora, non per la prima che arriva.
    let refreshing = false;
    /// La riga a cui va l'Invio dato durante un rifacimento.
    let deferredKey: string | null = null;
    /// Vero quando chi usa Fub ha mosso la scelta (frecce, puntatore): un
    /// elenco che si aggiorna da sé non gliela sposta. Altrimenti la scelta è
    /// la prima riga, anche dopo l'aggiornamento.
    let moved = false;
    /// La nota (o la persona) di cui si mostrano le azioni, se si mostrano.
    let actionsOf: string | null = null;
    /// L'ultima risposta mostrata, per tornarci dalle azioni.
    let shown: Shown | null = null;
    /// Quante righe scelte si vedono adesso.
    let visible = 0;
    /// Vero mentre `paint` rifà l'elenco: le righe passano per uno stato vuoto,
    /// e lì l'anteprima non deve spegnersi e riaccendersi. `paint` chiama
    /// `watch` a fine lavoro.
    let painting = false;
    let askTimer: number | undefined;
    let slowTimer: number | undefined;
    life.add(() => {
      window.clearTimeout(askTimer);
      window.clearTimeout(slowTimer);
      race.cancel();
    });

    const shape = skeleton(SKELETON_ROWS, "div", true);
    const setBusy = (on: boolean): void => {
      if (surface.hasAttribute("data-busy") === on) return;
      surface.toggleAttribute("data-busy", on);
      if (on) status.textContent = t("launcher.status.waiting");
      // La sagoma solo dove non c'è niente: un elenco pieno resta dov'è.
      if (on && input.getAttribute("aria-expanded") !== "true") {
        note.hidden = true;
        results.prepend(shape);
      } else {
        shape.remove();
      }
    };

    const drawRow = (row: Row, cell: HTMLElement): void => {
      if (row.kind === "group") {
        // L'intestazione di un gruppo: non si sceglie, le frecce la saltano, e
        // non è un'opzione. Il ruolo `presentation` la lascia fuori dall'elenco
        // di chi legge (`paint` toglie anche lo stato di opzione che il kit le dà).
        cell.classList.add("launcher-group");
        cell.setAttribute("role", "presentation");
        cell.textContent = row.title;
        return;
      }
      cell.classList.add("launcher-row");
      cell.style.removeProperty("--launcher-indent");
      cell.removeAttribute("aria-disabled");
      const mark = el("span", "launcher-row-icon");
      mark.setAttribute("aria-hidden", "true");
      const draw = (name: string): void => {
        const drawn = iconEl(name);
        if (drawn) mark.append(drawn);
      };
      if (row.kind === "heading" || row.kind === "tag" || row.kind === "line") mark.textContent = ROW_GLYPH[row.kind];
      else if (row.kind === "action") draw(ACTION_ICON[row.action]);
      else if (row.kind === "note") draw(kindIcon(row.doc) ?? ROW_ICON.note);
      else if (row.kind === "block") draw(blockIcon(row.entry.id));
      else draw(ROW_ICON[row.kind]);
      cell.append(mark);
      // Una riga è una linea sola: l'icona, il nome con le lettere trovate, e a
      // destra in grigio ciò che serve (la cartella, la scorciatoia, la
      // sintassi). Ciò che spiega sta nell'anteprima; chi ascolta lo sente col
      // nome, come prima, da una parte che non si vede.
      const main = el("span", "launcher-row-main");
      const title = el("span", "launcher-row-title");
      const meta = el("span", "launcher-row-meta");
      main.append(title);
      const named = (text: string): void => {
        title.append(markedTerms(text, input.value));
      };
      const explained = (text: string | null | undefined): void => {
        if (!text) return;
        const heard = el("span", "sr-only");
        heard.textContent = `, ${text}`;
        main.append(heard);
      };
      /// A destra un tasto, una sintassi o un numero: in monospazio.
      const typed = (text: string): void => {
        if (!text) return;
        meta.textContent = text;
        meta.setAttribute("data-mono", "");
      };
      switch (row.kind) {
        case "note": {
          // L'icona davanti alla riga è quella del formato di un documento che
          // non è una nota, o della specie di un file (un PDF, un'immagine).
          named(pageName(row.doc));
          if (row.snippet) {
            // Trovata nel testo: a destra il punto trovato, con le parole
            // cercate, al posto della cartella (che dice l'anteprima).
            meta.append(highlighted(row.snippet.text, row.snippet.highlights));
            meta.setAttribute("data-snippet", "");
          } else {
            // La cartella, anche fra le recenti: il gruppo «Recenti» dice già
            // che sono recenti, e scriverlo accanto a ogni riga sarebbe un doppione.
            meta.textContent = folderOf(row.doc);
          }
          break;
        }
        case "person":
          named(pageName(row.doc));
          meta.textContent = t("launcher.row.person");
          break;
        case "create-person":
          title.textContent = t("launcher.row.create_person", { name: row.name });
          break;
        case "command":
          named(row.entry.title);
          // Un comando spento dice il suo motivo, a destra e nell'anteprima.
          if (row.entry.unavailable) {
            cell.setAttribute("aria-disabled", "true");
            meta.textContent = row.entry.unavailable;
          } else {
            explained(row.entry.description);
            typed(displayBinding(row.entry.binding));
          }
          break;
        case "block":
          named(row.entry.title);
          explained(row.entry.description);
          typed(markdownHint(row.entry.id) ?? displayBinding(row.entry.binding));
          break;
        case "help":
          named(row.entry.title);
          typed(displayBinding(row.entry.binding));
          break;
        case "action":
          title.textContent = row.title;
          if (row.keys) typed(row.keys);
          break;
        case "heading":
          named(row.text);
          typed(`H${row.level}`);
          cell.style.setProperty("--launcher-indent", String(Math.max(0, Math.min(5, row.level - 1))));
          break;
        case "tag":
          named(`#${row.name}`);
          meta.textContent = plural(row.count, "launcher.row.tag.one", "launcher.row.tag");
          break;
        case "line":
          title.textContent = row.column === null
            ? t("launcher.row.line", { line: row.line })
            : t("launcher.row.line_column", { line: row.line, column: row.column });
          meta.textContent = t("launcher.row.lines", { lines: row.lines });
          break;
      }
      cell.append(main);
      if (meta.childNodes.length > 0) cell.append(meta);
    };

    const report = (error: unknown): void => {
      notify(t("launcher.failed", { reason: errorText(error) }), "guasto");
    };

    /// Chiude e fa partire un gesto. Prima si chiude, e il fuoco torna a chi
    /// l'aveva: il gesto che parte (un'apertura, un modulo di parametri, il
    /// campo del pannello Cerca) lo prende da lì.
    const leaveFor = (run: () => void | Promise<void>): void => {
      close();
      try {
        const running = run();
        if (running instanceof Promise) running.catch(report);
      } catch (error) {
        report(error);
      }
    };

    const choose = (row: Row, way: OpenWay): void => {
      const next = step(row, way, { mode, text: input.value });
      if (next.kind === "go") setMode(next.mode, next.text);
      else if (next.kind === "run") leaveFor(next.run);
    };

    /// Porta la domanda nel pannello Cerca, se ce n'è una da portare.
    const carry = (): void => {
      if (mode !== "all") return;
      const run = toSearchPanel(input.value);
      if (run) leaveFor(run);
    };

    const list: ListHandle<Row> = createList<Row>({
      container: rows,
      role: "listbox",
      items: [],
      key: (row) => row.key,
      render: drawRow,
      onActivate: (row, event) => {
        const way = openWay(event as KeyboardEvent | MouseEvent);
        if (!stale) {
          choose(row, way);
          return;
        }
        // La riga attiva risponde a una domanda vecchia: l'Invio aspetta la
        // risposta giusta, e intanto la si chiede subito. Se la domanda è la
        // stessa (si rifà perché i documenti sono cambiati), l'Invio resta
        // per questa riga.
        deferred = way;
        deferredKey = refreshing ? row.key : null;
        if (askTimer !== undefined) query();
      },
      onHighlight: () => {
        if (painting) return;
        moved = true;
        watch();
      },
      disabled: (row) => !selectable(row),
      focus: "activedescendant",
      owner: input,
      lifetime: life,
    });
    // L'evidenziatore che il kit fa scivolare sotto la riga attiva: qui ha il
    // vestito del lanciatore, e la pelle lo trova col suo nome.
    rows.querySelector(":scope > .kit-list-highlight")?.classList.add("launcher-highlight");

    /// I tasti che servono adesso, per la banda: quelli della riga attiva, o
    /// quelli delle azioni. La porta li legge dopo una pausa, non a ogni freccia.
    function hintItems(): HintItem[] {
      const items: HintItem[] = [];
      const say = (key: string, words: string): void => {
        items.push({ keys: [key], say: words });
      };
      if (actionsOf !== null) {
        say("Enter", t("launcher.hint.run"));
        say("Escape", t("launcher.hint.back"));
        return items;
      }
      const row = stale ? null : list.active();
      // Invio dice che cosa fa solo quando c'è una riga che fa qualcosa.
      if (row !== null && row.kind !== "group" && row.kind !== "help") say("Enter", t(ENTER_HINT[row.kind]));
      if (actionable(row) && OPENS_NOTES.includes(mode)) {
        say("Mod-Enter", t("launcher.hint.split"));
        if (row.kind === "person" || isNoteDoc(row.doc)) say("Alt-Enter", t("launcher.hint.peek"));
      }
      if (actionable(row)) say("Tab", t("launcher.hint.actions"));
      if (row?.kind === "command" && mode === "all") say(PREFIX.commands ?? ">", t("launcher.hint.commands"));
      if (!stale && visible === 0 && mode === "all" && shown?.create !== undefined) say(CREATE_CHORD, t("launcher.hint.create"));
      if (mode === "all" && toSearchPanel(input.value) !== null) say(PANEL_CHORD, t("launcher.hint.panel"));
      say("Escape", t("launcher.hint.close"));
      return items;
    }

    /// L'anteprima segue la riga attiva, dove l'anteprima c'è: il foglio di
    /// una nota o di una persona, il quadro di ciò che non è una nota. Con le
    /// azioni aperte, la nota che si agisce. Le azioni e i tasti seguono la riga.
    function watch(): void {
      const row = list.active();
      const roomy = surface.hasAttribute("data-preview");
      const doc = actionsOf ?? (row?.kind === "note" || row?.kind === "person" ? row.doc : null);
      preview.follow(roomy ? doc : null);
      preview.describe(roomy && doc === null && row !== null ? cardOf(row) : null);
      toActions.hidden = actionsOf !== null || !actionable(row);
      fitFoot();
      hintSource.changed(true);
    }

    /// Il posto dell'anteprima dipende dal modo e dalla finestra, mai da ciò
    /// che l'elenco contiene: dentro un modo la superficie non cambia misura.
    const makeRoom = (): void => {
      const roomy = SHOWS_PREVIEW.includes(mode) && previewFits(window.innerWidth, window.innerHeight);
      surface.toggleAttribute("data-preview", roomy);
      preview.element.hidden = !roomy;
    };

    /// Disegna un elenco. Torna quante righe scelte ci sono e la prima. Con
    /// `keep` è la stessa domanda aggiornata: la scelta mossa da chi usa Fub
    /// resta sulla sua riga, se c'è ancora, e l'elenco non torna in cima.
    const paint = (answer: Shown, keep = false): Row | null => {
      setBusy(false);
      const found = answer.rows.filter(selectable);
      painting = true;
      try {
        if (keep) {
          // Il kit tiene la riga attiva se la sua chiave c'è ancora, e ridisegna
          // le voci nuove: la domanda è la stessa, quindi anche il segno.
          list.setItems(answer.rows);
          if (!moved) list.setActive(found[0]?.key ?? null);
        } else {
          // Le righe si ridisegnano tutte: il segno delle lettere cercate dipende
          // dalla domanda, non solo dalla voce.
          moved = false;
          list.setItems([]);
          list.setItems(answer.rows);
        }
      } finally {
        painting = false;
      }
      // Il kit dà a ogni voce il ruolo di opzione e lo stato di scelta, anche
      // alle intestazioni: quelle non sono opzioni, e la prima opzione è la
      // prima riga che si può scegliere.
      for (const head of rows.querySelectorAll<HTMLElement>(".launcher-group")) {
        head.setAttribute("role", "presentation");
        head.removeAttribute("aria-selected");
        head.removeAttribute("aria-disabled");
      }
      const count = found.length;
      visible = count;
      input.setAttribute("aria-expanded", String(count > 0));
      rows.hidden = count === 0;
      note.hidden = count > 0;
      note.toggleAttribute("data-failed", answer.failed === true);
      const said = count > 0 ? "" : (answer.note ?? "");
      if (note.textContent !== said) note.textContent = said;
      const counted = count === 0
        ? ""
        : answer.total !== null
          ? t("launcher.status.count_of", { count, total: answer.total })
          : count === 1
            ? t("launcher.status.one")
            : t("launcher.status.count", { count });
      if (status.textContent !== counted) status.textContent = counted;
      if (!keep) rows.scrollTop = 0;
      offerCreate();
      watch();
      return found[0] ?? null;
    };

    const show = (answer: Shown, keep = false): void => {
      window.clearTimeout(slowTimer);
      slowTimer = undefined;
      stale = false;
      shown = answer;
      const only = paint(answer, keep);
      const way = deferred;
      const key = deferredKey;
      deferred = null;
      deferredKey = null;
      refreshing = false;
      if (way === null) return;
      // Un Invio dato alla cieca va alla prima riga che arriva; dato durante un
      // rifacimento, alla riga su cui era, se c'è ancora.
      const target = key === null ? only : (answer.rows.find((row) => row.key === key && selectable(row)) ?? null);
      if (target !== null) choose(target, way);
    };

    const failure = (error: unknown): Shown => ({
      rows: [],
      note: t("launcher.failed", { reason: errorText(error) }),
      total: null,
      failed: true,
    });

    /// Chiede la risposta alla domanda del campo. Con `keep` è la stessa
    /// domanda rifatta: la risposta nuova non sposta la scelta.
    function query(keep = false): void {
      window.clearTimeout(askTimer);
      askTimer = undefined;
      let answer: Listing | Promise<Listing>;
      try {
        answer = listing(mode, input.value);
      } catch (error) {
        answer = failure(error);
      }
      if (!(answer instanceof Promise)) {
        race.cancel();
        show(answer, keep);
        const more = answer.more;
        if (more) void race.last(async (expected) => addLater(await expected(more.catch(() => null))));
        return;
      }
      const coming = answer;
      window.clearTimeout(slowTimer);
      slowTimer = window.setTimeout(() => setBusy(true), SLOW_AFTER_MS);
      // Una risposta superata da una domanda più nuova non arriva a `show`, e
      // nemmeno ciò che arriva dopo di lei (`more`): passa dallo stesso giro.
      void race.last(async (expected) => {
        const first: Shown = await expected(coming.catch(failure));
        show(first, keep);
        if (first.more) addLater(await expected(first.more.catch(() => null)));
      });
    }

    /// Ciò che arriva dopo la risposta si aggiunge: chi ha mosso la scelta la
    /// ritrova. Con le azioni aperte si tiene per quando si torna all'elenco.
    function addLater(later: Listing | null): void {
      if (later === null) return;
      if (actionsOf === null) show(later, true);
      else shown = later;
    }

    const ask = (): void => {
      refreshing = false;
      deferredKey = null;
      stale = true;
      window.clearTimeout(askTimer);
      askTimer = undefined;
      if (answersAtOnce(mode)) query();
      else askTimer = window.setTimeout(query, ASK_DELAY_MS);
    };

    /// Il controllo c'è per tutto «Tutto»; senza una domanda da portare è
    /// spento, non sparito: il piede non si muove mentre si scrive.
    const offerPanel = (): void => {
      // Con le azioni aperte la domanda non si porta: la banda dice Esc torna.
      toPanel.hidden = mode !== "all" || actionsOf !== null;
      toPanel.disabled = mode !== "all" || toSearchPanel(input.value) === null;
      fitFoot();
    };

    /// «Crea la nota» si vede quando la risposta offre di creare, in «Tutto»
    /// e fuori dalle azioni. Mentre si scrive resta (non salta a ogni
    /// battuta), ma crea solo quando la risposta è quella della domanda scritta.
    function offerCreate(): void {
      toCreate.hidden = mode !== "all" || actionsOf !== null || shown?.create === undefined;
    }

    /// Crea la nota offerta, se la risposta che si vede è quella del campo.
    const create = (): boolean => {
      const name = shown?.create;
      if (mode !== "all" || actionsOf !== null || stale || name === undefined || !state.vaultRoot) return false;
      leaveFor(() => createNamed(name));
      return true;
    };

    const dress = (): void => {
      input.placeholder = t(PLACEHOLDER[mode]);
      hintSource.changed(true);
    };

    const tabs: TabsHandle = createTabs({
      tablist: strip,
      tabs: MODES.map((each) => ({ id: each, label: t(MODE_LABEL[each]) })),
      selected: first,
      label: t("launcher.modes"),
      onSelect: (id) => {
        setMode(id as Mode);
        input.focus();
      },
      lifetime: life,
    });
    // Il prefisso sta in un quadratino davanti al nome del modo: è lì che lo
    // si impara. «Tutto» non ne ha, e porta la lente.
    for (const each of MODES) {
      const prefix = PREFIX[each];
      const button = tabs.tab(each);
      if (!button) continue;
      button.classList.add("launcher-mode");
      const tile = el("span", "launcher-mode-tile");
      tile.setAttribute("aria-hidden", "true");
      if (prefix === null) {
        const drawn = iconEl("search");
        if (drawn) tile.append(drawn);
      } else {
        tile.textContent = prefix;
        button.setAttribute("aria-label", t("launcher.mode.hint", { mode: t(MODE_LABEL[each]), prefix }));
      }
      button.prepend(tile);
    }
    /// Tab qui non cambia modo e non lascia il campo: nessuna linguetta è una
    /// fermata del Tab, e non deve dichiararsi tale. Il kit ne tiene una a
    /// zero (è la sua regola, giusta altrove); qui la si toglie ogni volta.
    const outOfTabOrder = (): void => {
      for (const each of MODES) {
        const button = tabs.tab(each);
        if (button) button.tabIndex = -1;
      }
    };

    /// Il modo scelto resta in vista se la fila scorre (una finestra stretta;
    /// sul telefono i modi vanno a capo). Si sposta solo la fila.
    const keepInView = (each: Mode): void => {
      const button = tabs.tab(each);
      if (!button) return;
      const box = button.getBoundingClientRect();
      const bar = strip.getBoundingClientRect();
      if (box.left < bar.left) strip.scrollLeft -= bar.left - box.left;
      else if (box.right > bar.right) strip.scrollLeft += box.right - bar.right;
    };

    /// Passa a un modo. Con un testo la domanda è quella; senza, torna l'ultima
    /// che il modo ricorda, scelta tutta: scrivere la sostituisce.
    function setMode(next: Mode, asked?: string): void {
      mode = next;
      deferred = null;
      deferredKey = null;
      refreshing = false;
      actionsOf = null;
      shown = null;
      offerCreate();
      const recalled = asked === undefined || asked === "";
      const value = recalled ? memory.recall(next) : asked;
      input.value = value;
      memory.remember(next, value);
      if (tabs.selected() !== next) tabs.select(next);
      keepInView(next);
      outOfTabOrder();
      const name = t(MODE_LABEL[next]);
      if (said.textContent !== name) said.textContent = name;
      dress();
      offerPanel();
      makeRoom();
      // Le righe che si vedono sono ancora del modo di prima: l'anteprima
      // aspetta quelle nuove.
      preview.follow(null);
      preview.describe(null);
      if (recalled && value !== "") input.select();
      else input.setSelectionRange(value.length, value.length);
      stale = true;
      query();
    }

    /// Mostra le azioni della riga: si lasciano con Esc o Tab, e l'elenco di
    /// prima torna com'era.
    function enterActions(row: Extract<Row, { kind: "note" | "person" }>): void {
      if (stale || actionsOf !== null) return;
      actionsOf = row.doc;
      window.clearTimeout(askTimer);
      askTimer = undefined;
      window.clearTimeout(slowTimer);
      slowTimer = undefined;
      race.cancel();
      const name = pageName(row.doc);
      paint({ rows: [{ kind: "group", key: "g:actions", title: t("launcher.group.actions", { name }) }, ...actionRows(row.doc)], note: null, total: null });
      status.textContent = t("launcher.group.actions", { name });
      offerPanel();
    }

    /// Torna dalle azioni all'elenco di prima.
    function leaveActions(): void {
      if (actionsOf === null) return;
      actionsOf = null;
      offerPanel();
      if (shown !== null) paint(shown);
      else {
        stale = true;
        query();
      }
    }

    life.listen(input, "input", () => {
      // Scrivere lascia le azioni: la domanda nuova ha il suo elenco.
      actionsOf = null;
      const reading: Reading = read(mode, input.value);
      if (reading.mode !== mode || reading.text !== input.value) {
        setMode(reading.mode, reading.text);
        return;
      }
      memory.remember(mode, input.value);
      deferred = null;
      offerPanel();
      ask();
    });

    // Quando i documenti cambiano la domanda si rifà, senza aspettare una
    // battuta: l'indice può arrivare dopo la domanda (una ricerca senza
    // risultati li trova), e una nota in elenco può essere stata cancellata o
    // rinominata (non resta in elenco e in anteprima). Il segnale non dice quali
    // documenti: si rifà ogni elenco che mostra note, tenendo la scelta. Le
    // righe che si vedono intanto non sono quelle della risposta nuova
    // (`stale`): Maiusc-Invio non crea. Un risultato vecchio non scrive sopra
    // il nuovo: lo tiene la gara (`race`).
    life.add(on("documents", () => {
      rereadFiles();
      if (stale || actionsOf !== null || (mode !== "all" && mode !== "people")) return;
      const notes = shown?.rows.some((row) => row.kind === "note" || row.kind === "person") ?? false;
      if (!notes && (visible > 0 || input.value.trim() === "")) return;
      stale = true;
      refreshing = true;
      query(true);
    }));

    life.listen(toPanel, "click", () => carry());
    life.listen(toCreate, "click", () => {
      if (!create()) input.focus();
    });
    life.listen(toActions, "click", () => {
      if (actionable(list.active())) enterActions(list.active() as Extract<Row, { kind: "note" | "person" }>);
      // Il fuoco torna al campo: il bottone, che ha preso il tocco, non deve
      // restare col suo contorno di fuoco (il riquadro strano del telefono).
      input.focus();
    });
    // In cattura: è un Invio, e l'elenco non deve prenderlo per una scelta.
    life.listen(surface, "keydown", (event) => {
      if (event.isComposing || mode !== "all" || !matchesBinding(event, PANEL_CHORD)) return;
      event.preventDefault();
      event.stopPropagation();
      carry();
    }, { capture: true });
    // Esc, dalle azioni, torna all'elenco e non chiude. Il giro del fuoco lo
    // ascolta dal documento in cattura: qui si arriva prima, dalla finestra.
    life.listen(window, "keydown", (event) => {
      if (actionsOf === null || event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      leaveActions();
    }, { capture: true });
    life.listen(window, "resize", () => {
      makeRoom();
      watch();
    });

    // Maiusc-Invio crea la nota col nome scritto, solo quando la risposta che
    // si vede lo offre: non con righe, non mentre l'indice lavora, non con una
    // sintassi a metà o un guasto, non mentre una risposta nuova è in arrivo.
    life.listen(input, "keydown", (event) => {
      if (event.isComposing || event.key !== "Enter" || !event.shiftKey) return;
      if (create()) event.preventDefault();
    });

    life.listen(surface, "keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Tab") {
        // Tab non esce e non cambia modo: mostra le azioni della riga, o le lascia.
        event.preventDefault();
        if (actionsOf !== null) leaveActions();
        else {
          const row = list.active();
          if (actionable(row)) enterActions(row);
        }
        input.focus();
      } else if (event.key === "Backspace" && event.target === input && input.value === "" && mode !== "all") {
        // Cancellare a campo vuoto riporta a «Tutto», come si toglie un prefisso.
        event.preventDefault();
        setMode("all");
      }
    });
    // Premere dentro la superficie non toglie il fuoco al campo.
    life.listen(surface, "mousedown", (event) => {
      if (event.target !== input) event.preventDefault();
    });
    life.listen(veil, "click", () => close());
    life.listen(dismiss, "click", () => close());
    // In un'altra lingua le parole sarebbero quelle di prima: si chiude, e
    // riaprendolo parla la lingua nuova.
    life.add(onLanguage(() => close()));

    function close(): void {
      if (life.closed) return;
      // Lo stato cambia subito: la superficie sparisce e il fuoco torna. A
      // tornare alla pillola è un'immagine ferma.
      // L'uscita si prepara per prima: ferma la corsa d'entrata, e il
      // rettangolo che si misura dopo è quello a riposo.
      const leaving = prepareExit(surface);
      const fading = prepareExit(veil);
      const from = surface.getBoundingClientRect();
      const to = pill?.getBoundingClientRect() ?? null;
      life.close();
      layer.remove();
      pill?.removeAttribute("aria-expanded");
      closeOpen = null;
      switchOpen = null;
      const pose = to && to.width > 0 && from.width > 0 && from.height > 0
        ? { ...pillPose(to, from), opacity: 0 }
        : { opacity: 0 };
      // Chi smonta la shell non lascia un'immagine a metà corsa. L'uscita è
      // breve come tutte (≤ `swap`): chi chiude ha già deciso.
      if (!lifetime.closed) {
        leaving.play({ to: pose, duration: DURATION.swap, easing: "ease-in", lifetime });
        fading.play({ to: { opacity: 0 }, duration: DURATION.swap, lifetime });
      }
      if (origin?.isConnected) origin.focus();
      else focusEditor();
    }

    document.body.append(layer);
    // La trappola è quella della shell, con la sua pila: Esc chiude solo la
    // superficie in cima, e un Tab partito da fuori rientra nel campo invece
    // di camminare sulla pagina sotto il velo. Il fuoco va nel campo, una
    // volta sola, qui sotto.
    life.add(trapFocus(surface, close, { moveFocus: false }));
    pill?.setAttribute("aria-expanded", "true");
    closeOpen = close;
    switchOpen = (next, asked) => {
      setMode(next, asked);
      input.focus();
    };
    input.focus();
    setMode(first, text);

    // La corsa: lo stato è già quello finale, e ciò che si vede è la differenza
    // dalla pillola. La superficie ne esce intera, con una scala sola per i
    // due assi: ciò che contiene cresce, non si deforma mai. Col moto ridotto
    // resta una dissolvenza.
    const from = pill?.getBoundingClientRect() ?? null;
    const box = surface.getBoundingClientRect();
    if (motionLevel() === "reduced") {
      animate(surface, { from: { opacity: 0 }, whenReduced: "fade", lifetime: life });
    } else if (from && from.width > 0 && box.width > 0 && box.height > 0) {
      animate(surface, {
        from: { ...pillPose(from, box), opacity: 0 },
        velocity: { opacity: OPENING_FADE_SPEED },
        spring: "wide",
        lifetime: life,
      });
    } else {
      animate(surface, { from: { opacity: 0, scale: 0.98 }, spring: "wide", lifetime: life });
    }
    animate(veil, { from: { opacity: 0 }, duration: DURATION.short, whenReduced: "fade", lifetime: life });
  };

  const launcher: Launcher = {
    open(mode, text) {
      if (lifetime.closed) return;
      if (switchOpen) switchOpen(mode, text);
      else build(mode, text);
    },
    close() {
      closeOpen?.();
    },
    get isOpen() {
      return closeOpen !== null;
    },
  };

  declareLauncherCommands(lifetime, launcher);
  // Il piede dei menu contestuali: quando le voci non bastano, «Cerca fra tutti
  // i comandi» apre qui i comandi con ciò che si è scritto.
  lifetime.add(
    registerMenuSearch({
      run: (query) => launcher.open("commands", query),
      hint: () => displayBinding(allCommands().find((entry) => entry.id === "shell.palette")?.binding),
      find: (where, query) => launcher.open(where === "tags" ? "tags" : "all", query),
    }),
  );
  lifetime.add(() => launcher.close());
  return launcher;
}
