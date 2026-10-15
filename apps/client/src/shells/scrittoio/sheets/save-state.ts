// Lo stato di salvataggio che si apre.
//
// La vista (`panels/document.ts`) scrive lo stato in `#save-state`: una parola e
// un `data-state`, dentro `#pane-status`, il gruppo che il controllore sposta
// nella testata del foglio col fuoco. È un `role="status"`: si annuncia quando
// cambia, ma non si può premere. Qui gli si mette accanto un bottone che lo
// ripete e lo apre: lo stato in parole, la revisione, l'ora dell'ultimo
// salvataggio e le azioni che la shell ha già come comandi.
//
// # Che cosa resta della vista
//
// `#save-state` resta dov'è e resta la regione viva: esce soltanto dalla vista
// (`sr-only`), così chi ascolta sente il cambio una volta sola e chi guarda
// vede un solo stato. Il bottone lo si segue con un osservatore sul nodo della
// vista — parola e `data-state` —, e ogni scrittura avviene solo se il valore
// cambia: un osservatore che riscrive ciò che osserva non si ferma più.
//
// # Che cosa si sa, e che cosa no
//
// - La **revisione** è la base di scrittura della sessione
//   (`documentSessions.inspect`): c'è quando il testo discende da una revisione
//   letta, non c'è quando la scrittura è dettata.
// - L'**ora** dell'ultimo salvataggio nessuno la conserva: si ricorda qui, dal
//   momento in cui la shell è montata, sull'evento `saved` della sessione. Di
//   un documento che non si è ancora salvato in questa seduta non si dice
//   niente, invece di inventare un'ora.
// - Le **azioni** sono comandi di shell cercati per id fra quelli disponibili
//   adesso: se un comando non c'è, il suo bottone non c'è.
//
// # Di quale documento si parla
//
// L'identità si fissa all'apertura. I comandi agiscono sul documento attivo:
// prima di eseguirne uno si verifica che sia ancora quello, e il popover si
// chiude appena il foglio col fuoco o il suo documento cambiano.
import "./sheets.css";

import { onLanguage, resolvedLanguage, t, type Key } from "../../../i18n/strings";
import { openPopover, textButton, type PopoverHandle } from "../../../kit";
import { confirm } from "../../../platform/confirm";
import { documentSessions } from "../../../state/document-session";
import { onEvent } from "../../../state/kernel";
import { activeDoc, layout } from "../../../state/layout";
import type { SaveState } from "../../../state/saving";
import { on } from "../../../state/store";
import { focusableElements } from "../../../ui/a11y";
import { allCommands, displayBinding, type CommandEntry } from "../../../ui/commands";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";

const SAVE = "shell.doc.save";
const KEEP_MINE = "shell.doc.conflict.mine";
const KEEP_THEIRS = "shell.doc.conflict.theirs";

/// Ciò che ogni stato vuol dire, in una frase. Il conflitto ha già la sua nella
/// vista, ed è la stessa.
const DETAIL: Record<SaveState, Key> = {
  salvato: "sheet.save.detail.saved",
  in_corso: "sheet.save.detail.saving",
  non_salvato: "sheet.save.detail.unsaved",
  fallito: "sheet.save.detail.failed",
  conflitto: "document.conflict.body",
};

const STATES = new Set<string>(Object.keys(DETAIL));

/// Come si chiamano qui i comandi che la vista nomina già più in breve.
const LABEL: Record<string, Key | undefined> = {
  [KEEP_MINE]: "document.conflict.keep_mine",
  [KEEP_THEIRS]: "document.conflict.use_disk",
};

/// I comandi che hanno senso in ogni stato, nell'ordine in cui si offrono.
const ACTIONS: Record<SaveState, string[]> = {
  salvato: [],
  in_corso: [],
  non_salvato: [SAVE],
  fallito: [SAVE],
  conflitto: [KEEP_MINE, KEEP_THEIRS],
};

interface Opened {
  /// Il documento di cui si parla, fissato all'apertura.
  doc: string;
  /// Il foglio che aveva il fuoco all'apertura.
  pane: string;
  popover: PopoverHandle;
  body: HTMLElement;
  /// Gli ascolti dei bottoni disegnati: si chiude a ogni ridisegno.
  drawn: Lifetime;
}

function command(id: string): CommandEntry | undefined {
  return allCommands().find((entry) => entry.id === id && entry.run !== null);
}

export function mountSaveState(lifetime: Lifetime): void {
  const group = document.getElementById("pane-status");
  const live = document.getElementById("save-state");
  if (!group || !live || typeof MutationObserver === "undefined") return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "save-state sheet-save";
  button.setAttribute("aria-haspopup", "dialog");
  button.hidden = true;

  /// L'ora dell'ultimo salvataggio visto, per documento.
  const savedAt = new Map<string, number>();
  let opened: Opened | null = null;

  const stateNow = (): SaveState | null => {
    const value = live.dataset.state ?? "";
    return STATES.has(value) ? (value as SaveState) : null;
  };

  /// Porta sul bottone ciò che la vista ha scritto. Scrive solo ciò che cambia.
  const sync = (): void => {
    if (button.parentElement !== group) live.after(button);
    const state = stateNow();
    const word = state === null ? "" : (live.textContent ?? "");
    if (button.hidden !== (state === null)) button.hidden = state === null;
    if ((button.dataset.state ?? "") !== (state ?? "")) {
      if (state === null) delete button.dataset.state;
      else button.dataset.state = state;
    }
    if (button.textContent !== word) button.textContent = word;
    const name = state === null ? "" : t("sheet.save.button", { state: word });
    if ((button.getAttribute("aria-label") ?? "") !== name) {
      if (name === "") button.removeAttribute("aria-label");
      else button.setAttribute("aria-label", name);
    }
  };

  const fact = (list: HTMLElement, term: string, value: string, mono = false): void => {
    const name = document.createElement("dt");
    name.textContent = term;
    const what = document.createElement("dd");
    what.textContent = value;
    if (mono) what.className = "sheet-save-mono";
    list.append(name, what);
  };

  /// Esegue un comando sul documento fissato, e solo se è ancora quello attivo.
  const act = async (id: string, doc: string): Promise<void> => {
    if (id !== SAVE) {
      // Scegliere un lato di un conflitto butta via l'altro: si chiede, con le
      // stesse parole dell'avviso nel foglio. Il popover si chiude prima: la
      // domanda è una finestra sua.
      opened?.popover.close();
      const title = t(id === KEEP_MINE ? "commands.doc.conflict.mine" : "commands.doc.conflict.theirs");
      const detail = t(id === KEEP_MINE ? "commands.doc.conflict.mine.desc" : "commands.doc.conflict.theirs.desc");
      const ok = await confirm(`${title}\n${doc}\n${detail}`, {
        title: t("document.conflict.title", { doc }),
        okLabel: title,
        danger: id === KEEP_THEIRS,
      });
      if (!ok) return;
      // Mentre la domanda aspettava il conflitto può essersi risolto altrove.
      if (documentSessions.saveState(doc) !== "conflitto") return;
    }
    if (lifetime.closed || activeDoc() !== doc) return;
    await command(id)?.run?.();
  };

  const draw = (): void => {
    if (!opened) return;
    const { body, doc } = opened;
    const surface = opened.popover.element;
    const held = surface.contains(document.activeElement) ? document.activeElement : null;
    const heldCommand = held instanceof HTMLElement ? (held.dataset.command ?? null) : null;
    opened.drawn.close();
    const drawn = openLifetime();
    opened.drawn = drawn;

    const state = stateNow();
    const headline = document.createElement("p");
    headline.className = "sheet-save-headline";
    if (state !== null) headline.dataset.state = state;
    headline.textContent = state === null ? t("sheet.save.title") : (live.textContent ?? "");
    const nodes: HTMLElement[] = [headline];
    if (state !== null) {
      const detail = document.createElement("p");
      detail.className = "sheet-save-detail";
      detail.textContent = t(DETAIL[state]);
      nodes.push(detail);
    }

    const facts = document.createElement("dl");
    facts.className = "sheet-save-facts";
    fact(facts, t("sheet.save.document"), doc);
    const base = documentSessions.inspect(doc)?.base;
    if (base?.kind === "descends_from") fact(facts, t("sheet.save.revision"), base.value, true);
    const when = savedAt.get(doc);
    if (when !== undefined) {
      fact(
        facts,
        t("sheet.save.last"),
        new Date(when).toLocaleTimeString(resolvedLanguage(), { hour: "2-digit", minute: "2-digit" }),
      );
    }
    nodes.push(facts);

    const entries = (state === null ? [] : ACTIONS[state])
      .map((id) => command(id))
      .filter((entry): entry is CommandEntry => entry !== undefined);
    if (entries.length > 0) {
      const actions = document.createElement("div");
      actions.className = "sheet-save-actions";
      for (const entry of entries) {
        const chord = displayBinding(entry.binding);
        // I due lati del conflitto si chiamano come nell'avviso del foglio: il
        // titolo del comando ripeterebbe «Conflitto» dentro il suo popover.
        const name = LABEL[entry.id] ? t(LABEL[entry.id]!) : entry.title;
        const control = textButton({
          label: chord ? `${name} (${chord})` : name,
          kind: entry.id === KEEP_THEIRS ? "danger" : entry.id === KEEP_MINE ? "normal" : "primary",
          onPress: () => void act(entry.id, doc),
          lifetime: drawn,
        });
        control.dataset.command = entry.id;
        actions.append(control);
      }
      nodes.push(actions);
    }
    body.replaceChildren(...nodes);

    // Il bottone premuto può non esserci più (dopo «Salva» lo stato è
    // «Salvato»): il fuoco non deve cadere fuori dal popover.
    if (held && !surface.contains(document.activeElement)) {
      const again = heldCommand
        ? body.querySelector<HTMLElement>(`[data-command="${heldCommand}"]`)
        : null;
      (again ?? focusableElements(surface)[0] ?? surface).focus({ preventScroll: true });
    }
    opened.popover.reposition();
  };

  const open = (): void => {
    const doc = activeDoc();
    if (doc === null || stateNow() === null) return;
    const body = document.createElement("div");
    body.className = "sheet-save-panel";
    const mine: { current: Opened | null } = { current: null };
    const popover = openPopover({
      anchor: button,
      content: body,
      placement: "bottom",
      align: "end",
      label: t("sheet.save.title"),
      lifetime,
      onClose: () => {
        mine.current?.drawn.close();
        if (opened === mine.current) opened = null;
      },
    });
    if (popover.closed) return;
    mine.current = { doc, pane: layout.focus, popover, body, drawn: openLifetime() };
    opened = mine.current;
    draw();
    // Disegnato dopo l'apertura: il fuoco va sul primo bottone, se c'è.
    (focusableElements(popover.element)[0] ?? popover.element).focus({ preventScroll: true });
  };

  /// Chi ha cambiato foglio o documento non sta più guardando quello stato.
  const follow = (): void => {
    if (!opened) return;
    if (layout.focus !== opened.pane || activeDoc() !== opened.doc) opened.popover.close();
  };

  lifetime.listen(button, "click", () => {
    if (opened) opened.popover.close();
    else open();
  });

  const observer = new MutationObserver(() => {
    sync();
    draw();
  });
  observer.observe(live, {
    attributes: true,
    attributeFilter: ["data-state"],
    childList: true,
    characterData: true,
    subtree: true,
  });
  // Il gruppo è della vista: se lo riscrive, il bottone torna al suo posto.
  const kept = new MutationObserver(() => {
    if (button.parentElement !== group && live.parentElement === group) sync();
  });
  kept.observe(group, { childList: true });
  lifetime.add(() => {
    observer.disconnect();
    kept.disconnect();
  });

  /// L'ora dell'ultimo salvataggio la ricorda questo modulo: nessun altro la tiene.
  const remember = (event: { kind: string; id: string }): void => {
    if (event.kind !== "saved") return;
    savedAt.set(event.id, Date.now());
    if (opened?.doc === event.id) draw();
  };
  lifetime.add(documentSessions.subscribe(remember));
  lifetime.add(
    onEvent("document_renamed", (event) => {
      const when = savedAt.get(event.from);
      if (when === undefined) return;
      savedAt.delete(event.from);
      savedAt.set(event.to, when);
    }),
  );
  lifetime.add(onEvent("document_removed", (event) => void savedAt.delete(event.id)));
  lifetime.add(on("vault", () => savedAt.clear()));
  lifetime.add(on("layout", follow));
  lifetime.add(on("active-doc", follow));
  lifetime.add(
    onLanguage(() => {
      sync();
      draw();
    }),
  );

  live.classList.add("sr-only");
  sync();

  lifetime.add(() => {
    button.remove();
    live.classList.remove("sr-only");
  });
}
