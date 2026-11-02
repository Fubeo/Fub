// **La pagina «Componenti»** delle impostazioni: che cosa è acceso, perché, e
// che cosa succede prima che succeda.
//
// # Chi decide
//
// La regola è dell'host (Q-4): chi richiede chi, che cosa si spegne con un
// profilo, chi resta senza nessuno che lo usi. La pagina non ricalcola niente
// in TypeScript: legge la mappa (`components_map`), chiede una prova
// (`components_apply` senza `apply`) quando deve dire prima che cosa si spegne,
// applica, e poi rilegge. I nomi negli avvisi vengono dalle righe della mappa,
// mai dagli id.
//
// # La mappa è quella di tutta l'app
//
// La pagina non legge da sé: la mappa è quella di `state/components.ts`, che
// la rilegge per una scelta arrivata da fuori (la CLI, MCP) e per il
// rimontaggio del vault che la lavagna porta con sé, una volta per evento per
// tutta l'app. La pagina ridisegna a ogni lettura (`onComponentsRead`: anche
// il profilo e chi è in attesa, che non cambiano ciò che è acceso), e dopo un
// suo gesto chiede `refreshComponents()` e la aspetta. Una lettura che
// fallisce — il vault è chiuso per un istante mentre si rimonta — lascia la
// mappa di prima.
//
// # Il riquadro «Fub con questi componenti»
//
// Accanto all'elenco (sopra, se la finestra è stretta) dice che cosa cambia in
// Fub con ciò che è acceso: le voci del menu «Nuovo» (`newKinds`, la stessa
// fonte dell'esploratore), che cosa si apre dentro Fub e che cosa resta un file
// (`editorFiles` e `uiOn`), e quanti componenti sono accesi. Non è una regione
// che parla: l'esito di un gesto lo dice già l'avviso.
//
// # Il disegno
//
// La testata (titolo, frase e ricerca) si costruisce una volta: il campo di
// ricerca non si ridisegna mai sotto le dita. I profili, i gruppi e l'avviso si
// ridisegnano dalla mappa; la ricerca nasconde e non ridisegna. Il fuoco torna
// sul controllo che lo aveva (`data-focus-key`).
import { api } from "../host/ipc";
import type {
  ComponentAction,
  ComponentProfile,
  ComponentRow,
  ComponentsApplied,
  ComponentsMap,
} from "../host/contract";
import { errorText } from "../host/errors";
import { plural, resolvedLanguage, t } from "../i18n/strings";
import { confirm } from "../platform/confirm";
import { editorFiles, UI_TEXT } from "../editors/core/component-surfaces";
import {
  components,
  componentsReady,
  onComponentsRead,
  refreshComponents,
  type Components,
} from "../state/components";
import { on } from "../state/store";
import { newKinds, type NewKind } from "../ui/commands";
import { icon } from "../ui/icons";
import type { Lifetime } from "../ui/lifetime";
import { notify } from "../ui/notify";
import { guardDisabledKeys, laterReason, profileButton } from "./component-profiles";
import { matchesTerms, normalizeSearch, searchTerms } from "./settings-model";

/// L'icona di ogni componente che questa shell conosce. È presentazione della
/// shell, non dell'host: un componente nuovo prende `component` e la pagina
/// non si rompe.
export const COMPONENT_ICONS: Readonly<Record<string, string>> = {
  "fub.core": "vault",
  "fub.maintenance": "settings",
  "fub.markdown": "notes",
  "fub.search": "search",
  "fub.versioning": "history",
  "fub.backlinks": "backlinks",
  "fub.outline": "outline",
  "fub.tags": "tag",
  "fub.properties": "properties",
  "fub.template": "template",
  "fub.queries": "query",
  "fub.dashboard": "dashboard",
  "fub.backup": "backup",
  "fub.trash": "trash",
  "fub.stats": "stats",
  "fub.graph": "graph",
  "fub.proof": "footnote",
  "fub.commands": "keyboard",
  "fub.blocks": "square",
  "fub.base": "collection",
  "fub.formatting": "format-word",
  "fub.draw": "format-drawing",
  "fub.rich": "format-word",
  "fub.xlsx": "format-sheet",
  "fub.lavagna": "layout-dashboard",
  "fub.pdf": "view",
  "fub.penna": "format-drawing",
  "fub.dizionari": "footnote",
  "fub.motore-documenti": "format-odt",
  "fub.motore-fogli": "format-sheet",
  "fub.importers": "folder",
  "fub.linkcard": "backlink",
  "fub.updates": "sync",
  "fub.publish": "publish",
  "fub.sync": "sync",
};

/// L'icona di una riga, con quella di ripiego per un id che non è in tabella o
/// un nome che questo kit non disegna.
export function componentIcon(id: string): string {
  return icon(COMPONENT_ICONS[id] ?? "component") || icon("component");
}

/// Il gruppo dei componenti che si aggiungono e si tolgono da soli.
const SUPPORT = "supporto";

/// Le voci del menu «Nuovo», con l'icona e il nome che il menu dice.
const NEW_ENTRIES: Readonly<Record<NewKind, { icon: string; label: "components.preview.new.note" | "components.preview.new.drawing" }>> = {
  note: { icon: "notes", label: "components.preview.new.note" },
  drawing: { icon: "format-drawing", label: "components.preview.new.drawing" },
};

export interface ComponentsPageHooks {
  /// Se la pagina è a schermo: una pagina nascosta non ridisegna, e si segna
  /// da ridisegnare quando torna.
  visible(): boolean;
  /// Dopo una scelta che accende o spegne un bundle: la shell ricarica ciò che
  /// i bundle registrano.
  reloadProvider(): Promise<void>;
}

export interface ComponentsPage {
  /// La radice della pagina: sempre la stessa, così la testata e la ricerca
  /// sopravvivono ai ridisegni delle impostazioni.
  readonly element: HTMLElement;
  /// La pagina sta per comparire: ridisegna dalla mappa di tutta l'app,
  /// aspettandola se non è ancora arrivata.
  show(): Promise<void>;
  /// Le impostazioni si sono chiuse: si dimenticano ricerca, avviso e gruppo
  /// aperto.
  reset(): void;
}

/// Un avviso di passaggio: dice l'esito di un gesto, finché non se ne fa un
/// altro o si risponde «Va bene».
interface Message {
  text: string;
  error: boolean;
}

export function mountComponentsPage(lifetime: Lifetime, hooks: ComponentsPageHooks): ComponentsPage {
  let map: ComponentsMap | null = null;
  /// Il vault della mappa a schermo, e se la sua mappa non si è letta.
  let mapRoot: string | null = null;
  let unreadable = false;
  let current: Components | null = null;
  let supportOpen = false;
  let message: Message | null = null;
  /// Le righe e i profili di un gesto in corso: un gesto alla volta.
  let busy: Set<string> | null = null;
  /// Il controllo che aveva il fuoco, per ritrovarlo dopo un ridisegno.
  let focusKey: string | null = null;

  const root = document.createElement("section");
  root.className = "components-page";
  root.setAttribute("aria-labelledby", "components-page-title");

  const head = document.createElement("div");
  head.className = "components-head";
  const headText = document.createElement("div");
  headText.className = "components-head-text";
  const title = document.createElement("h3");
  title.className = "components-title";
  title.id = "components-page-title";
  title.tabIndex = -1;
  const lede = document.createElement("p");
  lede.className = "components-lede";
  headText.append(title, lede);
  const find = document.createElement("input");
  find.type = "search";
  find.className = "setting-input components-find";
  find.id = "components-find";
  find.dataset.focusKey = "find";
  head.append(headText, find);

  const profiles = document.createElement("div");
  profiles.className = "components-profiles";
  profiles.setAttribute("role", "group");
  profiles.setAttribute("aria-labelledby", "components-profiles-label");

  const list = document.createElement("div");
  list.className = "components-list";
  const empty = document.createElement("p");
  empty.className = "components-empty";
  empty.hidden = true;
  const notice = document.createElement("div");
  notice.className = "components-notice";
  notice.hidden = true;
  const main = document.createElement("div");
  main.className = "components-main";
  main.append(head, profiles, list, empty, notice);
  const preview = document.createElement("aside");
  preview.className = "components-preview";
  preview.setAttribute("aria-labelledby", "components-preview-title");
  preview.hidden = true;
  root.append(main, preview);

  lifetime.listen(find, "input", () => applySearch());
  // La guardia dei tasti sui controlli `aria-disabled` (`component-profiles.ts`):
  // un profilo «più avanti» dice perché.
  guardDisabledKeys(lifetime, root, (name) => map?.profili.find((candidate) => candidate.nome === name), (profile) =>
    say(laterReason(profile)),
  );
  lifetime.listen(root, "focusin", (event) => {
    const key = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-focus-key]")?.dataset.focusKey;
    if (key) focusKey = key;
  });

  lifetime.add(onComponentsRead((next) => {
    if (lifetime.closed) return;
    take(next);
    // Nascosta non ridisegna: `show` ridisegna quando torna.
    if (hooks.visible()) draw();
  }));
  // Il disegno nuovo c'è se il kernel sa farli: i comandi arrivano anche dopo
  // la mappa.
  lifetime.add(on("commands", () => {
    if (lifetime.closed) return;
    if (hooks.visible()) drawPreview();
  }));

  /// La mappa di una lettura diventa quella della pagina. Una lettura fallita
  /// dello stesso vault lascia quella di prima; di un vault nuovo, dice che non
  /// si legge.
  function take(next: Components | null): void {
    if (!next) return;
    if (next.map) {
      map = next.map;
      unreadable = false;
    } else if (next.root !== mapRoot || map === null) {
      map = null;
      unreadable = true;
    }
    mapRoot = next.root;
    current = next;
  }

  /// Rilegge la mappa dopo un gesto e la mette a schermo, anche se la lettura
  /// non è cambiata o non è riuscita: il gesto è finito e i controlli tornano.
  async function reread(): Promise<void> {
    try {
      take(await refreshComponents());
    } catch (error) {
      console.error(error);
    }
    if (!lifetime.closed) draw();
  }

  // --- il disegno -------------------------------------------------------------

  function rowsById(): Map<string, ComponentRow> {
    return new Map((map?.righe ?? []).map((item) => [item.id, item]));
  }

  /// I nomi di questi id, come li dice la mappa, in un elenco della lingua.
  function names(ids: readonly string[], quoted = true, type: "conjunction" | "disjunction" = "conjunction"): string {
    const byId = rowsById();
    const words = ids.map((id) => {
      const name = byId.get(id)?.nome || id;
      return quoted ? `«${name}»` : name;
    });
    try {
      return new Intl.ListFormat(resolvedLanguage(), { type }).format(words);
    } catch {
      return words.join(", ");
    }
  }

  function nameOf(id: string): string {
    return rowsById().get(id)?.nome || id;
  }

  function draw(): void {
    title.textContent = t("components.title");
    lede.textContent = t("components.lede");
    find.placeholder = t("components.search");
    find.setAttribute("aria-label", t("components.search"));
    empty.textContent = t("components.none");
    const hadFocus = root.contains(document.activeElement) ? focusKey : null;
    drawProfiles();
    drawList();
    drawNotice();
    drawPreview();
    applySearch();
    if (hadFocus) restoreFocus(hadFocus);
  }

  function restoreFocus(key: string): void {
    if (!root.isConnected) return;
    const target = root.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`);
    const next = target && !target.hidden ? target : title;
    if (document.activeElement !== next) next.focus({ preventScroll: true });
  }

  function drawProfiles(): void {
    const label = document.createElement("span");
    label.className = "components-profiles-label";
    label.id = "components-profiles-label";
    label.textContent = t("components.profile");
    const nodes: HTMLElement[] = [label];
    const current = map?.profilo ?? null;
    for (const profile of map?.profili ?? []) {
      const pressed = current === profile.nome;
      nodes.push(profileButton(profile, {
        pressed,
        busy: busy !== null,
        busyHere: busy?.has(`profile:${profile.nome}`) ?? false,
        onLater: (later) => say(laterReason(later)),
        onChoose: (chosen) => {
          if (!pressed) void gesture(`profile:${chosen.nome}`, () => chooseProfile(chosen));
        },
      }));
    }
    if (map && map.profilo === null) {
      const custom = document.createElement("span");
      custom.className = "components-custom";
      custom.textContent = t("components.profile.custom");
      nodes.push(custom);
    }
    profiles.replaceChildren(...nodes);
    profiles.hidden = map === null;
  }

  function drawList(): void {
    if (!map) {
      list.replaceChildren(...(unreadable ? [paragraph("muted settings-note", t("components.unreadable"))] : []));
      return;
    }
    const byGroup = new Map<string, ComponentRow[]>();
    for (const item of map.righe) {
      const rows = byGroup.get(item.gruppo) ?? [];
      rows.push(item);
      byGroup.set(item.gruppo, rows);
    }
    const sections: HTMLElement[] = [];
    for (const group of map.gruppi) {
      const rows = byGroup.get(group.id);
      if (!rows?.length) continue;
      sections.push(groupSection(group.id, group.nome, rows));
    }
    list.replaceChildren(...sections);
  }

  function groupSection(id: string, nome: string, rows: ComponentRow[]): HTMLElement {
    const section = document.createElement("section");
    section.className = "components-group";
    section.dataset.group = id;
    const headId = `components-group-${id}`;
    section.setAttribute("aria-labelledby", headId);
    const groupHead = document.createElement("div");
    groupHead.className = "components-group-head";
    const heading = document.createElement("h4");
    heading.className = "components-group-title";
    heading.id = headId;
    heading.textContent = nome;
    groupHead.append(heading);
    const items = document.createElement("ul");
    items.className = "components-rows";
    items.id = `components-rows-${id}`;
    if (id === SUPPORT) {
      const on = rows.filter((item) => item.acceso).length;
      const sub = document.createElement("span");
      sub.className = "components-group-sub";
      sub.textContent = plural(on, "components.support.sub.one", "components.support.sub");
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "components-group-toggle";
      toggle.dataset.focusKey = "toggle:support";
      toggle.setAttribute("aria-expanded", String(supportOpen));
      toggle.setAttribute("aria-controls", items.id);
      toggle.textContent = t(supportOpen ? "components.support.hide" : "components.support.show");
      toggle.addEventListener("click", () => {
        supportOpen = !supportOpen;
        draw();
      });
      groupHead.append(sub, toggle);
      section.dataset.support = "true";
    }
    for (const item of rows) items.append(componentRow(item));
    section.append(groupHead, items);
    return section;
  }

  function componentRow(item: ComponentRow): HTMLElement {
    const li = document.createElement("li");
    const orphan = item.perche === "InAttesa";
    const required = typeof item.perche === "object" ? item.perche.RichiestoDa : [];
    li.className = `components-row ${item.acceso ? "components-row--on" : "components-row--off"}${orphan ? " components-row--orphan" : ""}`;
    li.dataset.component = item.id;
    const figure = document.createElement("span");
    figure.className = "components-icon";
    figure.setAttribute("aria-hidden", "true");
    figure.innerHTML = componentIcon(item.id);
    const text = document.createElement("div");
    text.className = "components-text";
    const nameLine = document.createElement("div");
    nameLine.className = "components-name";
    const switchId = `component-${item.id}`;
    const core = item.perche === "Nucleo";
    const label = document.createElement(core ? "span" : "label");
    label.textContent = item.nome;
    if (!core) (label as HTMLLabelElement).htmlFor = switchId;
    nameLine.append(label);
    if (item.acceso && required.length > 0) {
      nameLine.append(tag("components-tag components-tag--why", t("components.needed_by", { names: names(required, false) })));
    }
    if (orphan) nameLine.append(tag("components-tag components-tag--orphan", t("components.not_needed")));
    const description = document.createElement("div");
    description.className = "components-desc";
    description.id = `components-desc-${item.id}`;
    const more = item.acceso ? item.usa.filter((id) => !rowsById().get(id)?.acceso) : [];
    description.textContent = more.length > 0
      ? `${item.descrizione} ${t("components.uses_more", { names: names(more, false, "disjunction") })}`.trim()
      : item.descrizione;
    text.append(nameLine, description);
    li.dataset.search = normalizeSearch(`${item.nome} ${item.descrizione}`);
    li.append(figure, text);
    if (core) {
      li.append(tag("components-always", t("components.always_on")));
      return li;
    }
    const input = componentSwitch(switchId, item.acceso);
    input.dataset.focusKey = `switch:${item.id}`;
    input.setAttribute("aria-describedby", description.id);
    if (item.acceso && item.perche !== "Scelto") input.classList.add("components-switch--auto");
    if (busy) input.setAttribute("aria-disabled", "true");
    if (busy?.has(item.id)) li.setAttribute("aria-busy", "true");
    input.addEventListener("click", (event) => {
      if (busy) {
        event.preventDefault();
        return;
      }
      const on = input.checked;
      void gesture(`switch:${item.id}`, () => (on ? turnOn(item) : turnOff(item)), item.id);
    });
    li.append(input);
    return li;
  }

  function drawNotice(): void {
    const waitingIds = map?.stato.in_attesa ?? [];
    const nodes: HTMLElement[] = [];
    if (message) {
      const line = document.createElement("div");
      line.className = `components-notice-line${message.error ? " components-notice-line--error" : ""}`;
      const text = paragraph("components-notice-msg", message.text);
      text.setAttribute("role", message.error ? "alert" : "status");
      const ok = button(t("components.ok"), "notice:ok");
      ok.addEventListener("click", () => {
        message = null;
        draw();
      });
      line.append(text, ok);
      nodes.push(line);
    }
    if (waitingIds.length > 0) {
      const line = document.createElement("div");
      line.className = "components-notice-line components-notice-line--orphans";
      const text = paragraph("components-notice-msg", plural(waitingIds.length, "components.orphans.one", "components.orphans", {
        names: names(waitingIds),
      }));
      text.setAttribute("role", "status");
      const keep = button(plural(waitingIds.length, "components.keep.one", "components.keep"), "notice:keep");
      const drop = button(t("components.drop"), "notice:drop", true);
      if (busy) {
        keep.setAttribute("aria-disabled", "true");
        drop.setAttribute("aria-disabled", "true");
      }
      keep.addEventListener("click", () => {
        if (!busy) void gesture("notice:keep", () => answer("tieni"));
      });
      drop.addEventListener("click", () => {
        if (!busy) void gesture("notice:drop", () => answer("togli"));
      });
      line.append(text, keep, drop);
      nodes.push(line);
    }
    notice.replaceChildren(...nodes);
    notice.hidden = nodes.length === 0;
  }

  /// Il riquadro: che cosa cambia in Fub con ciò che è acceso adesso.
  function drawPreview(): void {
    preview.hidden = map === null;
    if (!map) {
      preview.replaceChildren();
      return;
    }
    const heading = document.createElement("h4");
    heading.className = "components-preview-title";
    heading.id = "components-preview-title";
    heading.textContent = t("components.preview.title");
    preview.replaceChildren(heading, newSection(), opensSection(), weightSection(map));
  }

  function previewSection(label: string): HTMLElement {
    const section = document.createElement("section");
    section.className = "components-preview-section";
    const heading = document.createElement("h5");
    heading.className = "components-preview-head";
    heading.textContent = label;
    section.append(heading);
    return section;
  }

  function newSection(): HTMLElement {
    const section = previewSection(t("components.preview.new"));
    const items = document.createElement("ul");
    items.className = "components-new";
    const kinds = newKinds();
    for (const kind of kinds) {
      const entry = NEW_ENTRIES[kind];
      const item = document.createElement("li");
      item.className = "components-new-item";
      const figure = document.createElement("span");
      figure.className = "components-new-icon";
      figure.setAttribute("aria-hidden", "true");
      figure.innerHTML = icon(entry.icon);
      const name = document.createElement("span");
      name.textContent = t(entry.label);
      item.append(figure, name);
      items.append(item);
    }
    section.append(items);
    return section;
  }

  /// Una riga per le note, che si aprono sempre, e una per ogni editor che si
  /// può spegnere: le sue estensioni, e il componente acceso che le apre o
  /// «solo come file».
  function opensSection(): HTMLElement {
    const section = previewSection(t("components.preview.opens"));
    const items = document.createElement("ul");
    items.className = "components-opens";
    for (const editor of editorFiles()) {
      const item = document.createElement("li");
      item.className = "components-opens-item";
      item.dataset.ui = editor.ui;
      const code = document.createElement("code");
      code.className = "components-opens-ext";
      code.textContent = editor.extensions.map((extension) => `.${extension}`).join(" ");
      const inside = editor.ui === UI_TEXT || (current?.uiOn(editor.ui) ?? true);
      const owners = (map?.righe ?? []).filter((row) => row.ui.includes(editor.ui) && (row.acceso || editor.ui === UI_TEXT));
      const where = document.createElement("span");
      if (inside) {
        where.className = "components-opens-in";
        where.textContent = owners.length > 0
          ? t("components.preview.opens.in", { names: names(owners.map((row) => row.id)) })
          : t("components.preview.opens.inside");
      } else {
        where.className = "components-opens-out";
        where.textContent = t("components.preview.opens.file");
      }
      item.append(code, where);
      items.append(item);
    }
    section.append(items);
    return section;
  }

  /// Quanti componenti sono accesi e quanti spenti, contando le righe della
  /// mappa, e che cosa vuol dire per ciò che Fub carica.
  function weightSection(shown: ComponentsMap): HTMLElement {
    const section = previewSection(t("components.preview.weight"));
    const active = shown.righe.filter((row) => row.acceso);
    const support = active.filter((row) => row.gruppo === SUPPORT).length;
    const off = shown.righe.length - active.length;
    section.append(
      weightLine(active.length, plural(active.length, "components.preview.active.one", "components.preview.active", { support })),
      weightLine(off, plural(off, "components.preview.off.one", "components.preview.off")),
      paragraph("components-weight-note", t("components.preview.lazy")),
    );
    return section;
  }

  function weightLine(count: number, text: string): HTMLElement {
    const line = document.createElement("p");
    line.className = "components-weight";
    const number = document.createElement("b");
    number.className = "components-weight-count";
    number.textContent = String(count);
    const words = document.createElement("span");
    words.textContent = text;
    line.append(number, words);
    return line;
  }

  function applySearch(): void {
    const terms = searchTerms(find.value);
    const filtering = terms.length > 0;
    let shown = 0;
    for (const section of list.querySelectorAll<HTMLElement>(".components-group")) {
      const support = section.dataset.support === "true";
      let inside = 0;
      for (const item of section.querySelectorAll<HTMLElement>(".components-row")) {
        const match = !filtering || matchesTerms(item.dataset.search ?? "", terms);
        item.hidden = !match;
        if (match) inside++;
      }
      const rows = section.querySelector<HTMLElement>(".components-rows");
      if (rows) rows.hidden = support && !supportOpen && !filtering;
      const toggle = section.querySelector<HTMLElement>(".components-group-toggle");
      if (toggle) toggle.hidden = filtering;
      section.hidden = inside === 0;
      shown += inside;
    }
    empty.hidden = !(filtering && map !== null && shown === 0);
  }

  // --- i gesti ----------------------------------------------------------------

  /// Un gesto: i controlli si fermano finché non finisce, l'esito si dice, e la
  /// mappa si rilegge comunque — anche dopo un errore, che rimette così
  /// l'interruttore com'era.
  async function gesture(origin: string, run: () => Promise<void>, id: string = origin): Promise<void> {
    if (busy || lifetime.closed) return;
    busy = new Set([id]);
    message = null;
    focusKey = origin;
    draw();
    try {
      await run();
    } catch (error) {
      message = { text: t("components.failed", { reason: errorText(error) }), error: true };
    }
    busy = null;
    await reread();
    if (!root.contains(document.activeElement) && document.activeElement === document.body) {
      restoreFocus(origin);
    }
  }

  /// Cambia soltanto l'avviso: i profili e le righe restano gli stessi nodi,
  /// e il fuoco resta sul controllo che ha parlato.
  function say(text: string, error = false): void {
    message = { text, error };
    const hadFocus = root.contains(document.activeElement) ? focusKey : null;
    drawNotice();
    if (hadFocus) restoreFocus(hadFocus);
  }

  async function apply(action: ComponentAction, really: boolean): Promise<ComponentsApplied> {
    return api.componentsApply(action, really);
  }

  /// L'esito di una scelta applicata: gli avvisi dell'host, i componenti
  /// accesi con lei, e il ricaricamento di ciò che i bundle registrano.
  async function applied(result: ComponentsApplied, item?: ComponentRow): Promise<void> {
    if (result.risposta === "rifiuto") {
      say(refusal(result), false);
      return;
    }
    for (const warning of result.avvisi) notify(errorText(warning), "guasto");
    const support = new Set((map?.righe ?? []).filter((row) => row.gruppo === SUPPORT).map((row) => row.id));
    const added = result.effetto.accesi_anche;
    if ([...added, ...result.effetto.orfani].some((id) => support.has(id))) supportOpen = true;
    if (item && added.length > 0) {
      message = {
        text: plural(added.length, "components.added.one", "components.added", { names: names(added), name: nameOf(item.id) }),
        error: false,
      };
    }
    if (result.applicato && result.scritture.some((write) => write.bundle)) {
      try {
        await hooks.reloadProvider();
      } catch (error) {
        notify(t("settings.components.reload_failed", { reason: errorText(error) }), "guasto");
      }
    }
  }

  function refusal(result: Extract<ComponentsApplied, { risposta: "rifiuto" }>): string {
    switch (result.rifiuto) {
      case "nucleo":
        return t("components.refused.core", { name: nameOf(result.id) });
      case "sconosciuto":
        return t("components.refused.unknown", { name: result.id });
      case "richiesto":
        return t("components.refused.required", { name: nameOf(result.id), names: names(result.da) });
      case "profilo_sconosciuto":
        return t("components.refused.profile", { name: result.nome });
      case "profilo_piu_avanti": {
        const profile = map?.profili.find((candidate) => candidate.nome === result.nome);
        return profile ? laterReason(profile) : t("components.refused.profile", { name: result.nome });
      }
    }
  }

  async function turnOn(item: ComponentRow): Promise<void> {
    await applied(await apply({ azione: "accendi", id: item.id }, true), item);
  }

  async function turnOff(item: ComponentRow): Promise<void> {
    const trial = await apply({ azione: "spegni", id: item.id }, false);
    if (trial.risposta === "rifiuto" && trial.rifiuto === "richiesto") {
      const yes = await confirm(t("components.off.ask", { names: names(trial.da) }), {
        title: t("components.off.ask_title", { name: item.nome }),
        okLabel: plural(trial.da.length + 1, "components.off.ok.one", "components.off.ok"),
        danger: true,
      });
      if (!yes) return;
      await applied(await apply({ azione: "spegni", id: item.id, anche_questi: true }, true), item);
      return;
    }
    if (trial.risposta === "rifiuto") {
      say(refusal(trial));
      return;
    }
    await applied(await apply({ azione: "spegni", id: item.id }, true), item);
  }

  async function chooseProfile(profile: ComponentProfile): Promise<void> {
    const action: ComponentAction = { azione: "profilo", nome: profile.nome };
    const trial = await apply(action, false);
    if (trial.risposta === "rifiuto") {
      say(refusal(trial));
      return;
    }
    const off = trial.effetto.spenti_anche;
    if (off.length > 0) {
      const yes = await confirm(plural(off.length, "components.profile.ask.one", "components.profile.ask", { names: names(off) }), {
        title: t("components.profile.ask_title", { name: profile.etichetta }),
        okLabel: plural(off.length, "components.off.ok.one", "components.off.ok"),
      });
      if (!yes) return;
    }
    await applied(await apply(action, true));
  }

  async function answer(choice: "togli" | "tieni"): Promise<void> {
    await applied(await apply({ azione: "rispondi", orfani: choice, ids: [] }, true));
  }

  return {
    element: root,
    async show() {
      let next = components();
      if (!next) {
        try {
          next = await componentsReady();
        } catch (error) {
          console.error(error);
        }
      }
      if (lifetime.closed) return;
      take(next);
      draw();
    },
    reset() {
      message = null;
      supportOpen = false;
      find.value = "";
      focusKey = null;
    },
  };
}

function paragraph(className: string, text: string): HTMLElement {
  const el = document.createElement("p");
  el.className = className;
  el.textContent = text;
  return el;
}

function tag(className: string, text: string): HTMLElement {
  const el = document.createElement("span");
  el.className = className;
  el.textContent = text;
  return el;
}

function button(text: string, focusKey: string, primary = false): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = primary ? "settings-btn settings-btn--primary" : "settings-btn";
  el.dataset.focusKey = focusKey;
  el.textContent = text;
  return el;
}

/// L'interruttore di una riga: una casella con `role="switch"`, nominata dalla
/// sua etichetta. Invio lo commuta come Spazio, come gli altri interruttori del
/// pannello.
function componentSwitch(id: string, checked: boolean): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "setting-switch components-switch";
  input.setAttribute("role", "switch");
  input.id = id;
  input.checked = checked;
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (input.getAttribute("aria-disabled") === "true") return;
    input.click();
  });
  return input;
}
