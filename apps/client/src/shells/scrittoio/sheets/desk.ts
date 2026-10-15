// La scrivania: ciò che offre un foglio vuoto.
//
// Quando un riquadro non ha linguette la vista ci scrive una frase e due gesti
// (`.pane-empty`). Qui quel vuoto diventa il posto da cui si ricomincia: i gesti
// per cominciare (nuova nota, nota del giorno, apri), le note da riprendere, le
// appuntate, e le bozze che aspettano una scelta.
//
// # Solo ciò che c'è già
//
// Nessun comando e nessun dato nuovo. I gesti sono comandi del registro
// (`allCommands`), avviati dalla strada di tutti (`startCommand`): uno che il
// registro non ha non compare. Le note recenti le ricorda `state/recent.ts`, le
// appuntate sono nell'organizzazione del vault, le bozze le dice l'indice
// (`drafts`) e le giudica `state/drafts.ts`. Un gruppo senza righe non c'è.
//
// # Il vuoto è della vista
//
// La vista rifà da capo il contenuto del riquadro vuoto a ogni ridisegno
// (`replaceChildren`), e un ridisegno arriva anche soltanto perché il riquadro
// ha preso il fuoco: basta entrarci con Tab, o premerci il mouse. La scrivania
// è quindi **un nodo solo**, che dopo ogni ridisegno torna al suo posto
// com'era, e si difende in due modi:
//
//   - chi era su una riga con la tastiera ritrova il fuoco sulla stessa riga;
//   - una pressione del mouse su un suo bottone non arriva al riquadro finché
//     non è diventata un clic. Un nodo staccato fra la pressione e il rilascio
//     perde il clic, e il primo gesto in un riquadro senza fuoco andrebbe a
//     vuoto. Il fuoco al riquadro lo dà il gesto stesso, prima di agire.
//
// I due gesti della vista restano nel DOM ma cedono il posto (`sheets.css`):
// rifatti a ogni giro, non hanno nessuna delle due difese.
//
// Il titolo resta quello della vista, ed è l'unico: i gruppi hanno un'etichetta,
// non un altro titolo.
//
// # Una risposta vecchia non scrive
//
// Le tre domande partono insieme e conta solo l'ultimo giro (`Race`): una
// risposta arrivata dopo che il vault è cambiato, o dopo lo smontaggio, non
// disegna niente. Senza una scrivania a schermo non si chiede niente.
import "./sheets.css";

import type { DraftInfo } from "../../../host/contract";
import { errorText } from "../../../host/errors";
import { existingDocuments, unsavedDrafts, vaultHealth } from "../../../host/query";
import { onLanguage, t, type Key } from "../../../i18n/strings";
import { textButton } from "../../../kit";
import { pageName } from "../../../rules/mirrored";
import { openDocument } from "../../../state/document-controller";
import { documentSessions } from "../../../state/document-session";
import { CASE_KEY, caseOf, toRecover } from "../../../state/drafts";
import { focusPane, layout } from "../../../state/layout";
import { paletteHost } from "../../../state/palette-host";
import { existingRecentNotes } from "../../../state/recent";
import { on, state } from "../../../state/store";
import { identifier } from "../../../ui/a11y";
import { allCommands, displayBinding, type CommandEntry } from "../../../ui/commands";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { notify } from "../../../ui/notify";
import { startCommand } from "../../../ui/palette";
import { Race } from "../../../ui/race";
import { TEMPLATE_COMMAND } from "../launcher/sources";
import { paneIdOf, watchParts } from "./panes";

const NEW_NOTE = "shell.note.new";
const DAILY_NOTE = "note.daily";
const OPEN_NOTE = "shell.switcher";

/// Quante note da sistemare si elencano: la scrivania accenna, non fa il
/// rapporto della salute del vault.
const HEALTH = 5;

/// Quanti problemi si chiedono all'indice per trovare quelle note.
const HEALTH_WINDOW = 200;

/// Quante note da riprendere: abbastanza per ritrovare il filo, non un elenco.
const RECENT = 6;

/// I gesti per cominciare, nell'ordine in cui si leggono. `label` è la frase
/// che la vista usa già per quel gesto; senza, vale il titolo del comando.
const ACTIONS: readonly { id: string; label: Key | null }[] = [
  { id: NEW_NOTE, label: "commands.note.new" },
  { id: DAILY_NOTE, label: null },
  { id: TEMPLATE_COMMAND, label: null },
  { id: OPEN_NOTE, label: "pane.empty.open" },
];

interface Facts {
  recent: string[];
  pinned: string[];
  drafts: DraftInfo[];
  /// Le note con collegamenti rotti, una riga ciascuna.
  health: { doc: string; note: string }[];
}

interface Desk {
  /// Il riquadro vuoto della vista a cui questa scrivania appartiene.
  part: HTMLElement;
  root: HTMLElement;
  /// La vita della scrivania: finisce col suo riquadro.
  own: Lifetime;
  /// La vita di ciò che è disegnato adesso: si chiude a ogni ridisegno.
  life: Lifetime | null;
  /// Che cosa è disegnato: non si rifà ciò che non è cambiato.
  drawn: string | null;
  /// La riga che ha il fuoco, per ridarglielo quando la vista stacca il nodo.
  held: string | null;
  /// Il mouse è premuto su un bottone e non è ancora stato rilasciato.
  pressing: boolean;
}

const NONE: Facts = { recent: [], pinned: [], drafts: [], health: [] };

/// La cartella di una nota, per distinguere due note con lo stesso nome.
function folderOf(doc: string): string {
  const slash = doc.lastIndexOf("/");
  return slash === -1 ? "" : doc.slice(0, slash);
}

/// Le note con collegamenti rotti, nell'ordine dell'indice, con la frase che
/// dice quanti e, se è uno solo, dove puntava.
async function brokenLinks(): Promise<Facts["health"]> {
  const found = await vaultHealth("broken_links", { offset: 0, limit: HEALTH_WINDOW });
  const byDoc = new Map<string, string[]>();
  for (const issue of found.items) {
    const list = byDoc.get(issue.doc) ?? [];
    list.push(issue.detail ?? "");
    byDoc.set(issue.doc, list);
  }
  return [...byDoc]
    .slice(0, HEALTH)
    .map(([doc, targets]) => ({
      doc,
      note:
        targets.length === 1 && targets[0] !== ""
          ? t("sheet.desk.health_one", { dest: targets[0]! })
          : t("sheet.desk.health_many", { n: String(targets.length) }),
    }));
}

export function mountDesk(lifetime: Lifetime): void {
  const desks = new Map<HTMLElement, Desk>();
  const race = new Race();
  let facts: Facts = NONE;
  let asked = false;

  const command = (id: string): CommandEntry | null =>
    allCommands().find((entry) => entry.id === id) ?? null;

  const shown = (): Desk[] => [...desks.values()].filter((desk) => !desk.part.hidden && desk.root.isConnected);

  const keyOf = (node: EventTarget | null): string | null =>
    node instanceof Element ? node.closest<HTMLElement>("[data-key]")?.dataset.key ?? null : null;
  const byKey = (desk: Desk, key: string): HTMLElement | null =>
    [...desk.root.querySelectorAll<HTMLElement>("[data-key]")].find((each) => each.dataset.key === key) ?? null;
  const focusLost = (): boolean =>
    document.activeElement === null || document.activeElement === document.body;

  /// Porta il fuoco sul riquadro della scrivania prima di agire: ogni gesto
  /// della shell lavora sul riquadro col fuoco.
  const here = (desk: Desk): boolean => {
    const pane = paneIdOf(desk.part);
    if (pane === null || lifetime.closed) return false;
    focusPane(pane);
    return true;
  };

  const run = (desk: Desk, id: string): void => {
    const entry = command(id);
    if (!entry || !here(desk)) return;
    startCommand(entry, paletteHost);
  };

  const open = (desk: Desk, doc: string): void => {
    if (!here(desk)) return;
    openDocument(doc).catch((error: unknown) => {
      if (!lifetime.closed) notify(t("preview.open_failed", { page: doc, reason: errorText(error) }), "guasto");
    });
  };

  // --- il disegno -----------------------------------------------------------

  const actions = (): { id: string; text: string }[] => {
    const found: { id: string; text: string }[] = [];
    for (const action of ACTIONS) {
      const entry = command(action.id);
      if (!entry) continue;
      const label = action.label ? t(action.label) : entry.title;
      const chord = displayBinding(entry.binding ?? null);
      found.push({ id: action.id, text: chord ? `${label} (${chord})` : label });
    }
    return found;
  };

  const row = (desk: Desk, life: Lifetime, kind: string, doc: string, note: string): HTMLElement => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sheet-desk-row";
    button.dataset.key = `${kind}:${doc}`;
    const name = document.createElement("span");
    name.className = "sheet-desk-name";
    name.textContent = pageName(doc);
    button.append(name);
    if (note !== "") {
      const more = document.createElement("span");
      more.className = "sheet-desk-note";
      more.textContent = note;
      button.append(more);
    }
    life.listen(button, "click", () => open(desk, doc));
    item.append(button);
    return item;
  };

  const group = (kind: string, label: string, rows: HTMLElement[]): HTMLElement | null => {
    if (rows.length === 0) return null;
    const box = document.createElement("div");
    box.className = "sheet-desk-group";
    box.dataset.kind = kind;
    box.setAttribute("role", "group");
    const title = document.createElement("div");
    title.className = "sheet-desk-label";
    title.id = identifier("sheet-desk-label");
    title.textContent = label;
    box.setAttribute("aria-labelledby", title.id);
    const list = document.createElement("ul");
    list.className = "sheet-desk-list";
    list.append(...rows);
    box.append(title, list);
    return box;
  };

  const paint = (desk: Desk): void => {
    const gestures = actions();
    const drafts = facts.drafts.map((draft) => ({ doc: draft.doc, note: t(CASE_KEY[caseOf(draft)]) }));
    const signature = JSON.stringify([
      gestures,
      t("sheet.desk.actions"),
      t("sheet.desk.recent"),
      t("explorer.pinned"),
      t("sheet.desk.drafts"),
      t("sheet.desk.health"),
      facts.health,
      facts.recent,
      facts.pinned,
      drafts,
    ]);
    if (desk.drawn === signature) return;
    desk.drawn = signature;

    const inside = desk.root.contains(document.activeElement);
    const key = inside ? keyOf(document.activeElement) : null;
    desk.life?.close();
    const life = openLifetime();
    desk.life = life;

    const parts: HTMLElement[] = [];
    if (gestures.length > 0) {
      const bar = document.createElement("div");
      bar.className = "sheet-desk-actions";
      bar.setAttribute("role", "group");
      bar.setAttribute("aria-label", t("sheet.desk.actions"));
      gestures.forEach((gesture, index) => {
        const button = textButton({
          label: gesture.text,
          kind: index === 0 ? "primary" : "normal",
          onPress: () => run(desk, gesture.id),
          lifetime: life,
        });
        button.dataset.key = `command:${gesture.id}`;
        bar.append(button);
      });
      parts.push(bar);
    }
    const groups = [
      group(
        "draft",
        t("sheet.desk.drafts"),
        drafts.map((draft) => row(desk, life, "draft", draft.doc, draft.note)),
      ),
      group(
        "health",
        t("sheet.desk.health"),
        facts.health.map((issue) => row(desk, life, "health", issue.doc, issue.note)),
      ),
      group(
        "recent",
        t("sheet.desk.recent"),
        facts.recent.map((doc) => row(desk, life, "recent", doc, folderOf(doc))),
      ),
      group(
        "pinned",
        t("explorer.pinned"),
        facts.pinned.map((doc) => row(desk, life, "pinned", doc, folderOf(doc))),
      ),
    ].filter((each): each is HTMLElement => each !== null);
    if (groups.length > 0) {
      const shelf = document.createElement("div");
      shelf.className = "sheet-desk-groups";
      shelf.append(...groups);
      parts.push(shelf);
    }
    desk.root.replaceChildren(...parts);
    if (desk.root.hidden !== (parts.length === 0)) desk.root.hidden = parts.length === 0;

    // Chi era dentro con la tastiera ci resta: sulla stessa riga se c'è ancora,
    // altrimenti sulla prima cosa che si può premere.
    if (inside) {
      const next = (key ? byKey(desk, key) : null) ?? desk.root.querySelector<HTMLElement>("button");
      next?.focus({ preventScroll: true });
    }
  };

  // --- i dati ---------------------------------------------------------------

  const load = async (): Promise<void> => {
    asked = false;
    if (lifetime.closed || shown().length === 0) return;
    const vault = state.vaultRoot;
    const pinned = [...state.meta.pinned];
    await race.last(async (expected) => {
      const [recent, existing, drafts, health] = await expected(
        Promise.all([
          existingRecentNotes().catch((): string[] => []),
          existingDocuments(pinned).catch(() => new Set<string>()),
          unsavedDrafts().catch((): DraftInfo[] => []),
          // Un indice che non risponde non è un vault sano né uno malato: il
          // gruppo semplicemente non c'è.
          brokenLinks().catch((): Facts["health"] => []),
        ]),
      );
      if (lifetime.closed || state.vaultRoot !== vault) return;
      facts = {
        recent: recent.slice(0, RECENT),
        pinned: pinned.filter((doc) => existing.has(doc)),
        // Una bozza si recupera aprendo la sua nota: lì il testo è già rientrato
        // nel buffer (`recoverDrafts`), ed è per questo che il buffer è sporco.
        // Una bozza che non è rientrata non ha niente da mostrare aprendola.
        drafts: toRecover(drafts).filter((draft) => documentSessions.get(draft.doc)?.dirty === true),
        health,
      };
      for (const desk of shown()) paint(desk);
    });
  };

  /// Chiede i dati una volta sola per giro di segnali.
  const ask = (): void => {
    if (asked || lifetime.closed) return;
    asked = true;
    void Promise.resolve().then(load);
  };

  // --- il posto nella vista -------------------------------------------------

  const title = (part: HTMLElement): void => {
    const heading = part.querySelector<HTMLElement>(":scope > .pane-empty-title");
    if (!heading) return;
    if (heading.getAttribute("role") !== "heading") heading.setAttribute("role", "heading");
    if (heading.getAttribute("aria-level") !== "2") heading.setAttribute("aria-level", "2");
  };

  const make = (part: HTMLElement): Desk => {
    const root = document.createElement("div");
    root.className = "sheet-desk";
    const own = openLifetime();
    const desk: Desk = { part, root, own, life: null, drawn: null, held: null, pressing: false };
    // Il riquadro prende il fuoco appena lo si tocca, e ridisegna il vuoto:
    // finché il mouse è giù su un bottone, non deve saperlo.
    own.listen(root, "mousedown", (event) => {
      if (!(event.target instanceof Element) || !event.target.closest("button")) return;
      desk.pressing = true;
      event.stopPropagation();
    });
    own.listen(root, "focusin", (event) => {
      desk.held = keyOf(event.target);
      if (desk.pressing) event.stopPropagation();
    });
    // Il fuoco che se ne va perché la vista sta staccando il nodo non è un
    // addio. Nel momento dell'evento i due casi sono uguali (il nodo è ancora
    // nel documento): si distinguono un attimo dopo, quando il nodo staccato
    // non c'è più e quello lasciato per davvero è ancora al suo posto.
    own.listen(root, "focusout", () => {
      void Promise.resolve().then(() => {
        if (root.isConnected && !root.contains(document.activeElement)) desk.held = null;
      });
    });
    // Le frecce scorrono tutto ciò che si può premere, dall'alto in basso.
    own.listen(root, "keydown", (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const buttons = [...root.querySelectorAll<HTMLElement>("button")];
      const at = buttons.indexOf(event.target as HTMLElement);
      if (at === -1) return;
      const to =
        event.key === "ArrowDown" ? at + 1
        : event.key === "ArrowUp" ? at - 1
        : event.key === "Home" ? 0
        : event.key === "End" ? buttons.length - 1
        : -1;
      if (to < 0 || to >= buttons.length || to === at) return;
      event.preventDefault();
      buttons[to]!.focus({ preventScroll: true });
    });
    desks.set(part, desk);
    return desk;
  };

  const drop = (desk: Desk): void => {
    desks.delete(desk.part);
    desk.life?.close();
    desk.own.close();
    desk.root.remove();
  };

  const react = (part: HTMLElement): void => {
    for (const desk of [...desks.values()]) if (!desk.part.isConnected) drop(desk);
    // Un riquadro tolto dal layout può ancora mutare (gli si toglie la sua
    // scrivania, appunto): non è più un posto in cui rimetterla.
    if (!part.isConnected || part.hidden) return;
    const desk = desks.get(part) ?? make(part);
    title(part);
    const back = desk.root.parentElement !== part;
    if (back || part.lastElementChild !== desk.root) part.append(desk.root);
    paint(desk);
    if (back) {
      // La vista ha rifatto il vuoto: la scrivania è tornata, e con lei il
      // fuoco di chi c'era dentro — se il riquadro è ancora quello col fuoco:
      // a chi sta andando in un altro riquadro non lo si riprende.
      if (desk.held !== null && focusLost() && layout.focus === paneIdOf(part)) {
        byKey(desk, desk.held)?.focus({ preventScroll: true });
      }
      // I dati possono essere invecchiati.
      ask();
    }
  };

  const watch = watchParts(
    lifetime,
    ".pane-empty",
    { childList: true, attributes: true, attributeFilter: ["hidden"] },
    react,
  );
  if (!watch) return;

  const repaint = (): void => {
    for (const desk of shown()) paint(desk);
  };

  // Il rilascio chiude la pressione ovunque avvenga, anche fuori dal bottone.
  lifetime.listen(
    window,
    "mouseup",
    () => {
      for (const desk of desks.values()) desk.pressing = false;
    },
    { capture: true },
  );

  lifetime.add(on("active-doc", ask));
  lifetime.add(on("documents", ask));
  lifetime.add(on("organization", ask));
  lifetime.add(on("commands", repaint));
  lifetime.add(
    on("vault", () => {
      // Le righe di un altro vault non restano a schermo nemmeno un momento.
      race.cancel();
      facts = NONE;
      repaint();
      ask();
    }),
  );
  /// Una bozza elencata che viene salvata non è più da recuperare.
  const settled = (event: { kind: string; id: string }): void => {
    if (event.kind === "saved" && facts.drafts.some((draft) => draft.doc === event.id)) ask();
  };
  lifetime.add(documentSessions.subscribe(settled));
  lifetime.add(onLanguage(repaint));

  lifetime.add(() => {
    race.cancel();
    for (const desk of [...desks.values()]) drop(desk);
    for (const part of watch.parts()) {
      const heading = part.querySelector<HTMLElement>(":scope > .pane-empty-title");
      heading?.removeAttribute("role");
      heading?.removeAttribute("aria-level");
    }
  });
}
