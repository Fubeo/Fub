// Il lanciatore: una superficie sola per aprire, cercare e comandare.
//
// Nasce dalla pillola della barra del titolo e ci torna. Ha un campo, che
// tiene sempre il fuoco, una fila di modi e un elenco: il modo si sceglie col
// prefisso scritto in testa, con Tab o dalla fila, e ognuno ricorda la sua
// ultima domanda finché la shell vive. Che cosa c'è da scegliere lo dicono le
// sorgenti (`sources.ts`), che cosa succede a sceglierlo lo dicono i gesti
// (`actions.ts`); qui stanno il disegno, i tasti e la gara fra le risposte.
// Nel modo dei file, dove la finestra lo permette, accanto all'elenco c'è
// l'anteprima della nota attiva (`preview.ts`).
import "./launcher.css";
import { errorText } from "../../../host/errors";
import { t, onLanguage } from "../../../i18n/strings";
import { createList, createTabs, type ListHandle, type TabsHandle } from "../../../kit";
import { DURATION, animate, motionLevel, prepareExit } from "../../../moto";
import { platformSupports } from "../../../platform/capabilities";
import { pageName } from "../../../rules/mirrored";
import { focusEditor } from "../../../state/document-controller";
import { identifier, trapFocus } from "../../../ui/a11y";
import { allCommands, ariaBinding, displayBinding, matchesBinding } from "../../../ui/commands";
import { highlighted, markedTerms } from "../../../ui/highlight";
import { FORMAT_ICON, formatKindOf } from "../../../ui/format-kind";
import { iconEl } from "../../../ui/icons";
import { registerMenuSearch } from "../../../ui/menu";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { notify } from "../../../ui/notify";
import { scopeLabel } from "../../../ui/palette";
import { Race } from "../../../ui/race";
import { skeleton, SKELETON_DELAY_MS } from "../../../ui/skeleton";
import { step, toSearchPanel } from "./actions";
import { declareLauncherCommands } from "./commands";
import {
  MODES,
  PREFIX,
  createMemory,
  neighbour,
  openWay,
  pillPose,
  previewFits,
  read,
  type Mode,
  type OpenWay,
  type Reading,
} from "./model";
import { createPreview } from "./preview";
import { answersAtOnce, listing, type Listing, type Row } from "./sources";

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
  files: "launcher.mode.files",
  commands: "launcher.mode.commands",
  search: "launcher.mode.search",
  headings: "launcher.mode.headings",
  tags: "launcher.mode.tags",
  line: "launcher.mode.line",
  templates: "launcher.mode.templates",
} as const;

const PLACEHOLDER = {
  files: "launcher.placeholder.files",
  commands: "launcher.placeholder.commands",
  search: "launcher.placeholder.search",
  headings: "launcher.placeholder.headings",
  tags: "launcher.placeholder.tags",
  line: "launcher.placeholder.line",
  templates: "launcher.placeholder.templates",
} as const;

const MODE_ICON: Readonly<Record<Mode, string>> = {
  files: "notes",
  commands: "palette",
  search: "search",
  headings: "outline",
  tags: "tag",
  line: "keyboard",
  templates: "template",
};

/// Che cosa fa Invio in un modo, detto nel piede.
const ENTER_HINT = {
  files: "launcher.hint.open",
  commands: "launcher.hint.run",
  search: "launcher.hint.open",
  headings: "launcher.hint.go",
  tags: "launcher.hint.pick",
  line: "launcher.hint.go",
  templates: "launcher.hint.open",
} as const;

/// Invio, com'è scritto sui tasti del piede.
const ENTER_KEY = "↵";

/// I modi in cui ciò che si sceglie è una nota, e si può aprire altrove.
const OPENS_NOTES: readonly Mode[] = ["files", "search"];

/// I modi che mostrano l'anteprima della nota attiva, dove c'è posto.
const SHOWS_PREVIEW: readonly Mode[] = ["files"];

/// L'accordo che porta la domanda nel pannello Cerca. È un gesto del
/// lanciatore, come gli altri Invio del piede, non l'accordo di un comando.
const PANEL_CHORD = "Mod-Shift-Enter";

/// La velocità con cui l'opacità parte all'apertura (per ms): la superficie
/// si vede subito, mentre la misura segue la molla.
const OPENING_FADE_SPEED = 0.02;

interface Shown extends Listing {
  failed?: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

/// La cartella di un documento, letta come una strada.
function folderOf(doc: string): string {
  return doc.split("/").filter(Boolean).slice(0, -1).join(" › ");
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
    const windows = platformSupports("multipleWindows");

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
    const wait = el("span", "launcher-wait");
    wait.setAttribute("aria-hidden", "true");
    head.append(lens, input, wait);

    const strip = el("div", "launcher-modes");
    // Il modo, detto a chi non vede la fila: letto col campo quando si entra,
    // annunciato quando cambia. Tab lo cambia senza spostare il fuoco, e senza
    // questa voce cambierebbe in silenzio.
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
    // c'è. Ognuna parla solo quando cambia.
    const note = el("p", "launcher-note");
    note.setAttribute("role", "status");
    note.hidden = true;
    results.append(rows, note);
    const preview = createPreview(life);
    body.append(results, preview.element);

    const foot = el("div", "launcher-foot");
    const status = el("span", "launcher-status");
    status.setAttribute("role", "status");
    const hints = el("span", "launcher-hints");
    // Il controllo che porta la domanda nel pannello Cerca: si vede nel modo
    // Cerca, col suo accordo scritto sopra. Non è una fermata del Tab, che qui
    // cambia modo: alla tastiera la strada è l'accordo.
    const toPanel = el("button", "launcher-panel");
    toPanel.type = "button";
    toPanel.tabIndex = -1;
    toPanel.hidden = true;
    toPanel.setAttribute("aria-keyshortcuts", ariaBinding(PANEL_CHORD));
    foot.append(status, hints, toPanel);

    content.append(head, strip, said, body, foot);
    surface.append(content);
    layer.append(veil, surface);

    let mode: Mode = first;
    /// Vero finché ciò che si vede risponde a una domanda che non è più quella
    /// del campo.
    let stale = false;
    /// Un Invio arrivato prima della risposta: vale per la prima riga che arriva.
    let deferred: OpenWay | null = null;
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
      cell.classList.add("launcher-row");
      cell.style.removeProperty("--launcher-indent");
      const main = el("span", "launcher-row-main");
      const title = el("span", "launcher-row-title");
      const meta = el("span", "launcher-row-meta");
      main.append(title);
      const detail = (fill: (into: HTMLElement) => void): void => {
        const line = el("span", "launcher-row-detail");
        fill(line);
        main.append(line);
      };
      switch (row.kind) {
        case "note": {
          const asked = mode === "files" ? input.value : "";
          // Un documento che non è una nota porta l'icona del suo formato.
          const kind = formatKindOf(row.doc);
          const format = kind && kind !== "note" ? iconEl(FORMAT_ICON[kind]) : null;
          if (format) {
            format.classList.add("launcher-row-format");
            title.append(format);
          }
          title.append(markedTerms(pageName(row.doc), asked));
          if (row.snippet) {
            const snippet = row.snippet;
            detail((into) => into.append(highlighted(snippet.text, snippet.highlights)));
          }
          meta.textContent = row.recent ? t("launcher.row.recent") : folderOf(row.doc);
          break;
        }
        case "query":
          title.textContent = row.query;
          meta.textContent = t("launcher.row.recent_search");
          break;
        case "create":
          title.textContent = t("launcher.row.create", { name: row.name });
          break;
        case "command": {
          title.textContent = row.entry.title;
          if (row.entry.description) {
            const description = row.entry.description;
            detail((into) => {
              into.textContent = description;
            });
          }
          if (row.entry.spec) meta.append(scopeLabel(row.entry.spec));
          const chord = displayBinding(row.entry.binding);
          if (chord) {
            const key = el("kbd", "launcher-key");
            key.textContent = chord;
            meta.append(key);
          }
          break;
        }
        case "heading":
          title.textContent = row.text;
          meta.textContent = `H${row.level}`;
          cell.style.setProperty("--launcher-indent", String(Math.max(0, Math.min(5, row.level - 1))));
          break;
        case "tag":
          title.textContent = `#${row.name}`;
          meta.textContent = String(row.count);
          break;
        case "line":
          title.textContent = row.column === null
            ? t("launcher.row.line", { line: row.line })
            : t("launcher.row.line_column", { line: row.line, column: row.column });
          meta.textContent = t("launcher.row.lines", { lines: row.lines });
          break;
        case "template":
          title.textContent = pageName(row.doc);
          meta.textContent = folderOf(row.doc);
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
      else leaveFor(next.run);
    };

    /// Porta la domanda nel pannello Cerca, se ce n'è una da portare.
    const carry = (): void => {
      if (mode !== "search") return;
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
        const way = openWay(event as KeyboardEvent | MouseEvent, windows);
        if (!stale) {
          choose(row, way);
          return;
        }
        // La riga attiva risponde a una domanda vecchia: l'Invio aspetta la
        // risposta giusta, e intanto la si chiede subito.
        deferred = way;
        if (askTimer !== undefined) query();
      },
      onHighlight: () => watch(),
      focus: "activedescendant",
      owner: input,
      lifetime: life,
    });

    /// L'anteprima segue la nota della riga attiva, dove l'anteprima c'è.
    function watch(): void {
      const row = list.active();
      preview.follow(surface.hasAttribute("data-preview") && row?.kind === "note" ? row.doc : null);
    }

    /// Il posto dell'anteprima dipende dal modo e dalla finestra, mai da ciò
    /// che l'elenco contiene: dentro un modo la superficie non cambia misura.
    const makeRoom = (): void => {
      const roomy = SHOWS_PREVIEW.includes(mode) && previewFits(window.innerWidth, window.innerHeight);
      surface.toggleAttribute("data-preview", roomy);
      preview.element.hidden = !roomy;
    };

    const show = (answer: Shown): void => {
      window.clearTimeout(slowTimer);
      slowTimer = undefined;
      stale = false;
      setBusy(false);
      // Le righe si ridisegnano tutte: il segno delle lettere cercate dipende
      // dalla domanda, non solo dalla voce.
      list.setItems([]);
      list.setItems(answer.rows);
      const count = answer.rows.length;
      input.setAttribute("aria-expanded", String(count > 0));
      rows.hidden = count === 0;
      note.hidden = count > 0;
      note.toggleAttribute("data-failed", answer.failed === true);
      const said = count > 0 ? "" : (answer.note ?? "");
      if (note.textContent !== said) note.textContent = said;
      const only = answer.rows[0];
      const counted = count === 0
        ? ""
        : only && only.kind === "create"
          ? t("launcher.status.create")
          : answer.total !== null
            ? t("launcher.status.count_of", { count, total: answer.total })
            : count === 1
              ? t("launcher.status.one")
              : t("launcher.status.count", { count });
      if (status.textContent !== counted) status.textContent = counted;
      rows.scrollTop = 0;
      watch();
      const way = deferred;
      deferred = null;
      // Un Invio dato alla cieca non crea niente: creare vuole la riga vista.
      if (way !== null && only && only.kind !== "create") choose(only, way);
    };

    const failure = (error: unknown): Shown => ({
      rows: [],
      note: t("launcher.failed", { reason: errorText(error) }),
      total: null,
      failed: true,
    });

    function query(): void {
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
        show(answer);
        return;
      }
      const coming = answer;
      window.clearTimeout(slowTimer);
      slowTimer = window.setTimeout(() => setBusy(true), SLOW_AFTER_MS);
      // Una risposta superata da una domanda più nuova non arriva a `show`.
      void race.last(async (expected) => {
        show(await expected(coming.catch(failure)));
      });
    }

    const ask = (): void => {
      stale = true;
      window.clearTimeout(askTimer);
      askTimer = undefined;
      if (answersAtOnce(mode)) query();
      else askTimer = window.setTimeout(query, ASK_DELAY_MS);
    };

    const hint = (keys: string, label: string): HTMLElement => {
      const item = el("span", "launcher-hint");
      const key = el("kbd", "launcher-key");
      key.textContent = keys;
      item.append(key, label);
      return item;
    };
    /// Un accordo con Invio, coi nomi dei modificatori della piattaforma.
    const withEnter = (chord: string): string => displayBinding(chord).replace("Enter", ENTER_KEY);

    const panelChord = el("kbd", "launcher-key");
    panelChord.setAttribute("aria-hidden", "true");
    panelChord.textContent = withEnter(PANEL_CHORD);
    toPanel.append(t("launcher.panel"), panelChord);
    /// Il controllo c'è per tutto il modo Cerca; senza una domanda da portare
    /// è spento, non sparito: il piede non si muove mentre si scrive.
    const offerPanel = (): void => {
      toPanel.hidden = mode !== "search";
      toPanel.disabled = mode !== "search" || toSearchPanel(input.value) === null;
    };

    const dress = (): void => {
      lens.replaceChildren();
      const drawn = iconEl(MODE_ICON[mode]);
      if (drawn) lens.append(drawn);
      input.placeholder = t(PLACEHOLDER[mode]);
      hints.replaceChildren(hint(ENTER_KEY, t(ENTER_HINT[mode])));
      if (OPENS_NOTES.includes(mode)) {
        hints.append(hint(withEnter("Mod-Enter"), t("launcher.hint.split")));
        if (windows) hints.append(hint(withEnter("Alt-Enter"), t("launcher.hint.window")));
      }
      hints.append(hint("Tab", t("launcher.hint.mode")));
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
    // Il prefisso sta accanto al nome del modo: è lì che lo si impara.
    for (const each of MODES) {
      const prefix = PREFIX[each];
      const button = tabs.tab(each);
      if (!button || prefix === null) continue;
      const glyph = el("span", "launcher-mode-prefix");
      glyph.setAttribute("aria-hidden", "true");
      glyph.textContent = prefix;
      button.append(glyph);
      button.setAttribute("aria-label", t("launcher.mode.hint", { mode: t(MODE_LABEL[each]), prefix }));
    }
    /// Tab qui cambia modo e non lascia il campo: nessuna linguetta è una
    /// fermata del Tab, e non deve dichiararsi tale. Il kit ne tiene una a
    /// zero (è la sua regola, giusta altrove); qui la si toglie ogni volta.
    const outOfTabOrder = (): void => {
      for (const each of MODES) {
        const button = tabs.tab(each);
        if (button) button.tabIndex = -1;
      }
    };

    /// Passa a un modo. Con un testo la domanda è quella; senza, torna l'ultima
    /// che il modo ricorda, scelta tutta: scrivere la sostituisce.
    function setMode(next: Mode, asked?: string): void {
      mode = next;
      deferred = null;
      const recalled = asked === undefined || asked === "";
      const value = recalled ? memory.recall(next) : asked;
      input.value = value;
      memory.remember(next, value);
      if (tabs.selected() !== next) tabs.select(next);
      outOfTabOrder();
      const name = t(MODE_LABEL[next]);
      if (said.textContent !== name) said.textContent = name;
      dress();
      offerPanel();
      makeRoom();
      // Le righe che si vedono sono ancora del modo di prima: l'anteprima
      // aspetta quelle nuove.
      preview.follow(null);
      if (recalled && value !== "") input.select();
      else input.setSelectionRange(value.length, value.length);
      stale = true;
      query();
    }

    life.listen(input, "input", () => {
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

    life.listen(toPanel, "click", () => carry());
    // In cattura: è un Invio, e l'elenco non deve prenderlo per una scelta.
    life.listen(surface, "keydown", (event) => {
      if (event.isComposing || mode !== "search" || !matchesBinding(event, PANEL_CHORD)) return;
      event.preventDefault();
      event.stopPropagation();
      carry();
    }, { capture: true });
    life.listen(window, "resize", () => {
      makeRoom();
      watch();
    });

    life.listen(surface, "keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Tab") {
        // Tab non esce: percorre i modi. Il fuoco resta nel campo.
        event.preventDefault();
        setMode(neighbour(mode, event.shiftKey ? -1 : 1));
        input.focus();
      } else if (event.key === "Backspace" && event.target === input && input.value === "" && mode !== "files") {
        // Cancellare a campo vuoto toglie il modo, come si toglie un prefisso.
        event.preventDefault();
        setMode("files");
      }
    });
    // Premere dentro la superficie non toglie il fuoco al campo.
    life.listen(surface, "mousedown", (event) => {
      if (event.target !== input) event.preventDefault();
    });
    life.listen(veil, "click", () => close());
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
    // di camminare sulla pagina sotto il velo.
    life.add(trapFocus(surface, close));
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
    }),
  );
  lifetime.add(() => launcher.close());
  return launcher;
}
