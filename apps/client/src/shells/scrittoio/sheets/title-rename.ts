// Rinominare dal titolo del foglio.
//
// Nella testata la vista scrive il percorso del documento (`.pane-toolbar >
// .muted`). Qui quel percorso diventa il posto da cui si rinomina: doppio clic,
// oppure F2 (o Invio, o Spazio) col fuoco sul titolo, e al suo posto compare un
// campo col nome della pagina. Invio rinomina, Esc e la perdita del fuoco
// lasciano tutto com'era. Le cartelle del percorso (`[data-folder]`) sono della
// vista, che le apre nell'esplora: il doppio clic lì non rinomina.
//
// # La strada
//
// È quella dell'esplora, un passo alla volta: il nome si giudica **prima** del
// giro IPC con la regola specchiata (`nameFault`), il testo non salvato si
// mette in salvo (`flushPendingSave`), e la rinomina passa dalla sessione
// (`renameKeepingBuffer`), che tiene il buffer e risponde con un esito tipizzato
// — collisione compresa. Qui non si chiama l'host.
//
// # Il titolo è della vista
//
// La vista riscrive il testo del titolo a ogni ridisegno della testata. Il
// campo quindi non ci sta dentro: gli sta accanto, e il titolo si nasconde
// finché il campo è aperto. Un ridisegno a metà non tocca ciò che si è scritto.
//
// # Di quale documento si parla
//
// L'identità — percorso e riquadro — si fissa all'apertura del campo. Se sotto
// il campo il foglio passa a un altro documento, il campo si chiude senza
// rinominare: il nome scritto era per quello di prima. Una risposta che arriva
// quando il campo non c'è più non riapre niente: un rifiuto si dice con un
// avviso, perché non resti muto.
import "./sheets.css";

import { errorText } from "../../../host/errors";
import { onLanguage, t } from "../../../i18n/strings";
import { openPopover, textButton, textField, type PopoverHandle } from "../../../kit";
import { nameFault, pageName } from "../../../rules/mirrored";
import { searchedName } from "../../../rules/searched-name";
import { flushPendingSave, renameKeepingBuffer } from "../../../state/document-session";
import { NAME_FAULT, pageRenameTarget } from "../../../state/page-rename";
import { renameFolder } from "../../../state/vault";
import { activeDoc } from "../../../state/layout";
import { identifier } from "../../../ui/a11y";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { notify } from "../../../ui/notify";
import { setTooltip } from "../../../ui/tooltip";
import { paneIdOf, watchParts } from "./panes";

const TITLE = "sheet-title";

interface Edit {
  /// Il documento da rinominare, fissato all'apertura.
  doc: string;
  bar: HTMLElement;
  crumb: HTMLElement;
  holder: HTMLElement;
  input: HTMLInputElement;
  life: Lifetime;
  /// La rinomina è partita e non è ancora tornata.
  busy: boolean;
  /// Il messaggio sotto il campo, quando qualcosa non va.
  note: PopoverHandle | null;
}

/// Il nome che si può usare al posto di uno rifiutato, o `null`.
///
/// La pulizia è quella di «non l'ho trovata, creala» (`searchedName`: via i
/// caratteri che un filesystem si riserva, i controlli, i punti in coda); a dire
/// se il risultato va bene è poi la stessa regola del kernel (`nameFault`), non
/// una seconda. Si propone soltanto un nome che passa e che cambia davvero
/// qualcosa: «Che: cosa?» diventa «Che cosa».
export function proposedName(from: string, typed: string): string | null {
  const clean = searchedName(typed);
  if (clean === null || clean === typed.trim() || clean === pageName(from)) return null;
  return nameFault(pageRenameTarget(from, clean).to, "new") === null ? clean : null;
}

export function mountTitleRename(lifetime: Lifetime): void {
  let edit: Edit | null = null;

  const crumbOf = (bar: HTMLElement): HTMLElement | null =>
    bar.querySelector<HTMLElement>(":scope > .muted");
  const docOf = (bar: HTMLElement): string | null => {
    const pane = paneIdOf(bar);
    return pane === null ? null : activeDoc(pane);
  };

  const set = (el: HTMLElement, name: string, value: string | null): void => {
    if (el.getAttribute(name) === value) return;
    if (value === null) el.removeAttribute(name);
    else el.setAttribute(name, value);
  };

  /// Toglie dal titolo ciò che questo modulo gli ha messo.
  const undress = (crumb: HTMLElement): void => {
    if (!crumb.classList.contains(TITLE)) return;
    crumb.classList.remove(TITLE);
    crumb.removeAttribute("role");
    crumb.removeAttribute("tabindex");
    crumb.removeAttribute("aria-label");
    setTooltip(crumb, crumb.textContent ?? "");
  };

  const close = (focusTitle: boolean): void => {
    const mine = edit;
    if (!mine) return;
    edit = null;
    mine.note?.close();
    mine.life.close();
    mine.holder.remove();
    if (mine.crumb.hidden) mine.crumb.hidden = false;
    if (focusTitle && mine.crumb.isConnected) mine.crumb.focus({ preventScroll: true });
  };

  /// Il titolo di un documento si può mettere a fuoco e premere; quello di una
  /// vista, o di un riquadro vuoto, resta testo.
  const dress = (bar: HTMLElement): void => {
    const crumb = crumbOf(bar);
    if (!crumb) return;
    const doc = docOf(bar);
    if (edit && edit.bar === bar && (doc !== edit.doc || !edit.holder.isConnected)) close(false);
    if (doc === null) {
      undress(crumb);
      return;
    }
    if (!crumb.classList.contains(TITLE)) crumb.classList.add(TITLE);
    set(crumb, "role", "button");
    set(crumb, "tabindex", "0");
    set(crumb, "aria-label", t("sheet.title.button", { path: doc }));
    setTooltip(crumb, t("sheet.title.hint", { path: doc }));
  };

  const clearNote = (mine: Edit): void => {
    if (!mine.note) return;
    mine.note.close();
    mine.note = null;
    mine.input.removeAttribute("aria-invalid");
    mine.input.removeAttribute("aria-describedby");
  };

  /// Qualcosa non è andato. Col campo ancora aperto il messaggio gli sta sotto
  /// e il nome scritto resta; col campo già chiuso si dice con un avviso.
  const fail = (mine: Edit, message: string, tone: "info" | "guasto", proposal: string | null = null): void => {
    mine.busy = false;
    if (edit !== mine) {
      if (!lifetime.closed) notify(message, tone);
      return;
    }
    mine.input.readOnly = false;
    mine.holder.removeAttribute("aria-busy");
    clearNote(mine);
    const text = document.createElement("p");
    text.className = "sheet-title-error";
    text.id = identifier("sheet-title-error");
    text.textContent = message;
    mine.input.setAttribute("aria-invalid", "true");
    mine.input.setAttribute("aria-describedby", text.id);
    const content = document.createElement("div");
    content.append(text);
    // Niente vicolo cieco: un nome rifiutato per i suoi caratteri ha accanto
    // quello che si può usare, pronto, e un bottone per usarlo.
    if (proposal !== null) {
      const use = textButton({
        label: t("sheet.title.use", { name: proposal }),
        onPress: () => {
          if (edit !== mine || mine.busy) return;
          mine.input.value = proposal;
          mine.input.focus({ preventScroll: true });
          void submit();
        },
        lifetime: mine.life,
      });
      use.classList.add("sheet-title-proposal");
      // Il puntatore non porta via il fuoco dal campo, che chiuderebbe tutto.
      mine.life.listen(use, "mousedown", (event) => event.preventDefault());
      mine.life.listen(use, "keydown", (event) => {
        if (event.key !== "Escape" && !(event.key === "Tab" && event.shiftKey)) return;
        event.preventDefault();
        event.stopPropagation();
        mine.input.focus({ preventScroll: true });
      });
      content.append(use);
    }
    mine.note = openPopover({
      anchor: mine.input,
      content,
      placement: "bottom",
      align: "start",
      role: "alert",
      autoFocus: false,
      returnFocus: false,
      dismissOnOutside: false,
      dismissOnEscape: false,
      lifetime: mine.life,
    });
  };

  const submit = async (): Promise<void> => {
    const mine = edit;
    if (!mine || mine.busy) return;
    const from = mine.doc;
    const name = mine.input.value.trim();
    // Vuoto o uguale: non c'è niente da chiedere a nessuno.
    if (name === "" || name === pageName(from)) {
      close(true);
      return;
    }
    // La pagina di una cartella si chiama come la cartella: il titolo nuovo
    // rinomina la cartella, e il file resta `_index` (decisione 0229).
    const target = pageRenameTarget(from, name);
    const to = target.to;
    if (to === target.from) {
      close(true);
      return;
    }
    const fault = nameFault(to, "new");
    if (fault !== null) {
      fail(mine, t("explorer.bad_name", { name, reason: t(NAME_FAULT[fault]) }), "info", proposedName(from, name));
      return;
    }
    mine.busy = true;
    mine.input.readOnly = true;
    mine.holder.setAttribute("aria-busy", "true");
    clearNote(mine);
    try {
      // La rinomina riscrive i collegamenti entranti, cioè altri file: il testo
      // non salvato va messo in salvo prima, come fa l'esplora.
      const pending = await flushPendingSave();
      if (pending.length > 0) {
        fail(mine, t("document.unsaved_blocks", { doc: pending.join(", ") }), "guasto");
        return;
      }
      if (target.kind === "folder") {
        try {
          await renameFolder(target.from, to);
        } catch (error) {
          fail(mine, t("explorer.folder_move_failed", { folder: target.from, to, reason: errorText(error) }), "guasto");
          return;
        }
        mine.busy = false;
        if (edit === mine) close(true);
        return;
      }
      const outcome = await renameKeepingBuffer(from, to);
      if (outcome.kind === "collision") {
        fail(
          mine,
          t("explorer.rename_failed", { doc: from, to, reason: t("explorer.destination_open") }),
          "guasto",
        );
        return;
      }
    } catch (error) {
      fail(mine, t("explorer.rename_failed", { doc: from, to, reason: errorText(error) }), "guasto");
      return;
    }
    mine.busy = false;
    if (edit === mine) close(true);
  };

  const open = (bar: HTMLElement): void => {
    if (edit) close(false);
    const crumb = crumbOf(bar);
    const doc = docOf(bar);
    if (!crumb || doc === null) return;
    const life = openLifetime();
    const name = pageName(doc);
    const field = textField({
      label: t("sheet.title.field", { name }),
      labelHidden: true,
      value: name,
      onSubmit: () => void submit(),
      lifetime: life,
    });
    const holder = document.createElement("span");
    holder.className = "sheet-title-edit";
    holder.append(field.element);
    const mine: Edit = { doc, bar, crumb, holder, input: field.input, life, busy: false, note: null };
    edit = mine;
    crumb.hidden = true;
    crumb.after(holder);

    life.listen(field.input, "keydown", (event) => {
      // Da tastiera il nome proposto si raggiunge con Tab, come il prossimo
      // controllo: il riquadro del messaggio non sta accanto al campo nel DOM.
      if (event.key === "Tab" && !event.shiftKey && !event.isComposing) {
        const use = mine.note?.element.querySelector<HTMLElement>(".sheet-title-proposal");
        if (use) {
          event.preventDefault();
          use.focus({ preventScroll: true });
        }
        return;
      }
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      // Una rinomina partita non si annulla: Esc aspetta la risposta.
      if (edit === mine && !mine.busy) close(true);
    });
    life.listen(field.input, "input", () => clearNote(mine));
    // Il fuoco che passa al bottone del nome proposto resta dentro la rinomina;
    // ogni altra uscita la chiude.
    const inside = (target: EventTarget | null): boolean =>
      target instanceof Node && (target === mine.input || mine.note?.element.contains(target) === true);
    life.listen(field.input, "blur", (event) => {
      if (edit === mine && !inside(event.relatedTarget)) close(false);
    });
    life.listen(document, "focusout", (event) => {
      if (edit !== mine || !(event.target instanceof Node) || !mine.note?.element.contains(event.target)) return;
      if (!inside(event.relatedTarget)) close(false);
    });
    field.input.focus({ preventScroll: true });
    field.input.select();
  };

  const watch = watchParts(lifetime, ".pane-toolbar", { childList: true, subtree: true }, dress);
  if (!watch) return;
  const panes = watch.parts()[0]?.closest<HTMLElement>("#panes") ?? document.getElementById("panes");
  if (!panes) return;

  const titleOf = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>(`.pane-toolbar > .${TITLE}`) : null;
  const barOf = (title: HTMLElement): HTMLElement | null => title.closest<HTMLElement>(".pane-toolbar");

  lifetime.listen(panes, "dblclick", (event) => {
    const title = titleOf(event.target);
    const bar = title ? barOf(title) : null;
    // Una cartella del percorso si apre nell'esplora: due colpi lì non rinominano.
    if (!bar || (event.target as Element).closest("[data-folder]")) return;
    event.preventDefault();
    open(bar);
  });
  // Il titolo è un bottone per chi usa la tastiera: Invio e Spazio lo premono
  // (un clic, come per ogni bottone), F2 è il tasto di chi rinomina.
  lifetime.listen(panes, "keydown", (event) => {
    const title = titleOf(event.target);
    if (!title || event.target !== title) return;
    if (event.key === "F2") {
      const bar = barOf(title);
      if (!bar) return;
      event.preventDefault();
      open(bar);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      title.click();
    }
  });
  // Un clic del puntatore sul titolo non rinomina (è il doppio clic a farlo);
  // quello che arriva dalla tastiera sì, ed è riconoscibile: non conta colpi.
  lifetime.listen(panes, "click", (event) => {
    const title = titleOf(event.target);
    if (!title || event.detail !== 0) return;
    const bar = barOf(title);
    if (bar) open(bar);
  });

  lifetime.add(onLanguage(() => watch.refresh()));
  lifetime.add(() => {
    close(false);
    for (const bar of watch.parts()) {
      const crumb = crumbOf(bar);
      if (crumb) undress(crumb);
    }
  });
}
