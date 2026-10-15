// Il filo dei titoli: sul bordo destro del foglio, una tacca per ogni titolo
// del documento, lunga quanto il suo livello. Al passaggio del puntatore, o
// col fuoco, il filo diventa un indice che si legge; scegliere una voce porta
// il testo su quel titolo, dalla stessa strada della «Struttura»
// dell'ispettore (`reveal`).
//
// # Da dove vengono i titoli
//
// Dall'indice (`outline`), non dal testo dell'editor: il filo non sa che cosa
// sia Markdown e non legge il buffer. Si aggiorna quindi quando il **kernel**
// dice che il documento è cambiato (`document_changed`, `batch_ended`,
// `index_updated`) — cioè a salvataggio avvenuto — e mai a ogni battuta. Un
// documento senza titoli, o di un formato che non ne ha, non ha filo.
//
// # Non copre niente
//
// A riposo il filo sta nel margine destro della colonna del testo, a sinistra
// della barra di scorrimento. Quando quel margine non basta, o il foglio è
// troppo stretto perché un indice ci stia, il filo non c'è: lo decide la
// misura vera, che cambia con la larghezza del foglio, la modalità e gli spazi
// scelti. Aperto, l'indice sta sopra il testo: ma lo si è chiesto.
//
// # Di quale documento si parla
//
// Ogni foglio ha il suo filo e la sua corsa (`Race`): la risposta di un
// documento che il foglio non mostra più non disegna niente. Il salto porta
// prima il fuoco sul foglio del filo: `reveal` cerca il documento a partire dal
// riquadro col fuoco, e due fogli possono mostrare la stessa nota.
import "./sheets.css";

import type { Heading } from "../../../host/contract";
import { errorText } from "../../../host/errors";
import { api } from "../../../host/ipc";
import { onLanguage, t } from "../../../i18n/strings";
import { pageName } from "../../../rules/mirrored";
import { focusEditor, reveal } from "../../../state/document-controller";
import { onEvent } from "../../../state/kernel";
import { activeDoc, focusPane } from "../../../state/layout";
import { on } from "../../../state/store";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { notify } from "../../../ui/notify";
import { Race } from "../../../ui/race";
import { paneIdOf, watchParts } from "./panes";

/// Il margine che serve a destra del testo perché il filo ci stia senza
/// toccarlo: la barra di scorrimento, le tacche, un po' d'aria. È poco meno
/// del margine che la colonna del testo tiene di suo.
const ROOM = 30;
/// Sotto questa larghezza un foglio non ha posto per un indice.
const MIN_WIDTH = 440;

interface Thread {
  /// La superficie del foglio (`.pane-editor`) e il pannello che la contiene.
  editor: HTMLElement;
  panel: HTMLElement;
  nav: HTMLElement;
  list: HTMLElement;
  own: Lifetime;
  race: Race;
  /// Il documento di cui si mostrano, o si aspettano, i titoli.
  doc: string | null;
  headings: Heading[];
  /// Che cosa è disegnato: non si rifà ciò che non è cambiato.
  drawn: string | null;
  /// C'è già una domanda in partenza per questo giro di segnali.
  asked: boolean;
}

export function mountHeadingThread(lifetime: Lifetime): void {
  const threads = new Map<HTMLElement, Thread>();

  const paneOf = (thread: Thread): string | null => paneIdOf(thread.editor);
  const items = (thread: Thread): HTMLButtonElement[] => [
    ...thread.list.querySelectorAll<HTMLButtonElement>(".sheet-thread-item"),
  ];

  // --- lo spazio --------------------------------------------------------------

  /// C'è posto per il filo: il foglio è abbastanza largo, e fra il testo e il
  /// bordo destro resta il margine che serve.
  const roomy = (thread: Thread): boolean => {
    const surface =
      thread.editor.dataset.markdownMode === "reading"
        ? thread.editor.querySelector<HTMLElement>(":scope > .pane-preview")
        : thread.editor.querySelector<HTMLElement>(".cm-content");
    if (!surface) return false;
    const panel = thread.panel.getBoundingClientRect();
    if (panel.width < MIN_WIDTH) return false;
    const padding = Number.parseFloat(getComputedStyle(surface).paddingRight) || 0;
    const text = surface.getBoundingClientRect().right - padding;
    return panel.right - text >= ROOM;
  };

  const fit = (thread: Thread): void => {
    const show = thread.doc !== null && thread.headings.length > 0 && roomy(thread);
    if (thread.nav.hidden === show) thread.nav.hidden = !show;
  };

  // --- il disegno -------------------------------------------------------------

  const paint = (thread: Thread): void => {
    const label = thread.doc === null ? "" : t("sheet.thread.label", { name: pageName(thread.doc) });
    const signature = JSON.stringify([
      thread.doc,
      label,
      thread.headings.map((heading) => [heading.level, heading.text, heading.span.start, heading.span.end]),
    ]);
    if (thread.drawn === signature) return;
    thread.drawn = signature;

    // Chi era dentro con la tastiera resta sulla voce allo stesso posto.
    const before = items(thread);
    const held = before.indexOf(document.activeElement as HTMLButtonElement);
    if (thread.nav.getAttribute("aria-label") !== label) thread.nav.setAttribute("aria-label", label);
    const rows = thread.headings.map((heading, index) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sheet-thread-item";
      button.dataset.index = String(index);
      button.dataset.level = String(Math.min(Math.max(Math.trunc(heading.level), 1), 6));
      // Il filo è una fermata sola del Tab: dentro ci si muove con le frecce.
      button.tabIndex = index === 0 ? 0 : -1;
      // A riposo il testo non si vede: il nome resta comunque quello del titolo.
      button.setAttribute("aria-label", heading.text);
      const notch = document.createElement("span");
      notch.className = "sheet-thread-notch";
      notch.setAttribute("aria-hidden", "true");
      const text = document.createElement("span");
      text.className = "sheet-thread-text";
      text.setAttribute("aria-hidden", "true");
      text.textContent = heading.text;
      button.append(notch, text);
      item.append(button);
      return item;
    });
    thread.list.replaceChildren(...rows);
    if (held !== -1) {
      const next = items(thread);
      const target = next[Math.min(held, next.length - 1)];
      if (target) {
        for (const each of next) each.tabIndex = each === target ? 0 : -1;
        target.focus({ preventScroll: true });
      }
    }
  };

  // --- i titoli ---------------------------------------------------------------

  const load = async (thread: Thread): Promise<void> => {
    thread.asked = false;
    const doc = thread.doc;
    if (doc === null || lifetime.closed || thread.own.closed) return;
    await thread.race.last(async (expected) => {
      const answer = await expected(api.queryIndex({ kind: "outline", doc }).catch(() => null));
      if (lifetime.closed || thread.own.closed || thread.doc !== doc) return;
      thread.headings = answer?.kind === "outline" ? answer.value : [];
      paint(thread);
      fit(thread);
    });
  };

  /// Chiede i titoli una volta sola per giro di segnali.
  const ask = (thread: Thread): void => {
    if (thread.asked || thread.doc === null) return;
    thread.asked = true;
    void Promise.resolve().then(() => load(thread));
  };

  // --- i gesti ----------------------------------------------------------------

  const jump = (thread: Thread, index: number): void => {
    const heading = thread.headings[index];
    const pane = paneOf(thread);
    const doc = thread.doc;
    if (!heading || pane === null || doc === null || lifetime.closed) return;
    focusPane(pane);
    reveal(doc, { span: heading.span }).catch((error: unknown) => {
      if (!lifetime.closed) notify(t("preview.open_failed", { page: doc, reason: errorText(error) }), "guasto");
    });
  };

  /// Il margine cambia con la larghezza del foglio: lo dice chi la misura.
  const measured = (entries: ResizeObserverEntry[]): void => {
    if (lifetime.closed) return;
    for (const entry of entries) {
      for (const thread of threads.values()) if (thread.panel === entry.target) fit(thread);
    }
  };
  let resize: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") resize = new ResizeObserver(measured);
  lifetime.add(() => resize?.disconnect());

  const make = (editor: HTMLElement, panel: HTMLElement): Thread => {
    const nav = document.createElement("nav");
    nav.className = "sheet-thread";
    nav.hidden = true;
    const list = document.createElement("ul");
    list.className = "sheet-thread-list";
    nav.append(list);
    const own = openLifetime();
    const thread: Thread = {
      editor,
      panel,
      nav,
      list,
      own,
      race: new Race(),
      doc: null,
      headings: [],
      drawn: null,
      asked: false,
    };
    own.listen(nav, "click", (event) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLElement>(".sheet-thread-item") : null;
      if (button) jump(thread, Number(button.dataset.index));
    });
    own.listen(nav, "keydown", (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const all = items(thread);
      const at = all.indexOf(event.target as HTMLButtonElement);
      if (at === -1) return;
      if (event.key === "Escape") {
        // Si torna al testo del foglio.
        const pane = paneOf(thread);
        if (pane === null) return;
        event.preventDefault();
        event.stopPropagation();
        focusPane(pane);
        focusEditor();
        return;
      }
      const to =
        event.key === "ArrowDown" ? at + 1
        : event.key === "ArrowUp" ? at - 1
        : event.key === "Home" ? 0
        : event.key === "End" ? all.length - 1
        : -1;
      if (to < 0 || to >= all.length || to === at) return;
      event.preventDefault();
      all[at]!.tabIndex = -1;
      all[to]!.tabIndex = 0;
      all[to]!.focus({ preventScroll: true });
    });
    resize?.observe(panel);
    own.add(() => resize?.unobserve(panel));
    threads.set(editor, thread);
    return thread;
  };

  const drop = (thread: Thread): void => {
    threads.delete(thread.editor);
    thread.race.cancel();
    thread.own.close();
    thread.nav.remove();
  };

  /// Un foglio tolto dal layout non ha più filo.
  const prune = (): void => {
    for (const thread of [...threads.values()]) if (!thread.editor.isConnected) drop(thread);
  };

  const follow = (editor: HTMLElement): void => {
    prune();
    const panel = editor.parentElement;
    const pane = paneIdOf(editor);
    if (!editor.isConnected || !panel || pane === null) return;
    const thread = threads.get(editor) ?? make(editor, panel);
    // Prima della superficie: col Tab ci si arriva dalla testata, senza
    // attraversare l'editor.
    if (thread.nav.parentElement !== panel) panel.prepend(thread.nav);
    const doc = activeDoc(pane);
    if (doc !== thread.doc) {
      // Un altro documento: i titoli di prima non sono i suoi.
      thread.race.cancel();
      thread.doc = doc;
      thread.headings = [];
      paint(thread);
      ask(thread);
    }
    fit(thread);
  };

  const watch = watchParts(
    lifetime,
    ".pane-editor",
    { attributes: true, attributeFilter: ["data-markdown-mode"] },
    follow,
  );
  if (!watch) return;

  const changed = (doc: string): void => {
    for (const thread of threads.values()) if (thread.doc === doc) ask(thread);
  };
  const refresh = (): void => {
    prune();
    watch.refresh();
  };

  lifetime.add(on("layout", refresh));
  lifetime.add(on("active-doc", refresh));
  lifetime.add(onEvent("document_changed", (event) => changed(event.id)));
  lifetime.add(
    onEvent("batch_ended", (event) => {
      for (const doc of event.changed) changed(doc);
    }),
  );
  lifetime.add(
    onEvent("index_updated", () => {
      for (const thread of threads.values()) ask(thread);
    }),
  );
  lifetime.add(
    onLanguage(() => {
      for (const thread of threads.values()) paint(thread);
    }),
  );
  lifetime.add(() => {
    for (const thread of [...threads.values()]) drop(thread);
  });
}
