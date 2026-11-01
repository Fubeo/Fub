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
// # Una lettura alla volta, e mai una vecchia sopra una nuova
//
// La mappa cambia per un gesto di qui, per una scelta arrivata da fuori (la
// CLI, MCP) e per il rimontaggio del vault che la lavagna porta con sé. Ogni
// strada chiede una lettura con `requestRead`: le richieste di fila si fondono
// in una (un breve ritardo, poi `CoalescingQueue`, che tiene al più una lettura
// in volo e una che aspetta), e le letture partono in ordine, quindi l'ultima
// che arriva è anche l'ultima chiesta. Una lettura che fallisce — il vault è
// chiuso per un istante mentre si rimonta — lascia la mappa di prima.
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
import { onEvent } from "../state/kernel";
import { icon } from "../ui/icons";
import type { Lifetime } from "../ui/lifetime";
import { notify } from "../ui/notify";
import { CoalescingQueue } from "../ui/race";
import { setTooltip } from "../ui/tooltip";
import { matchesTerms, normalizeSearch, searchTerms } from "./settings-model";

/// L'icona di ogni componente che questa shell conosce. È presentazione della
/// shell, non dell'host: un componente nuovo prende `component` e la pagina
/// non si rompe.
const ICONS: Readonly<Record<string, string>> = {
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
  "fub.commands": "keyboard",
  "fub.blocks": "square",
  "fub.base": "collection",
  "fub.formatting": "format-word",
  "fub.draw": "format-drawing",
  "fub.rich": "format-odt",
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
  return icon(ICONS[id] ?? "component") || icon("component");
}

/// Il profilo consigliato: un consiglio della shell, non una regola dell'host.
const RECOMMENDED = "studio";

/// I profili che l'host elenca con un altro nome per lo stesso insieme: «note»
/// è il nome corto di «Solo note» per la CLI. La pagina mostra un pulsante
/// solo, e lo dà per premuto anche quando la scelta è arrivata col nome corto.
const ALIASES: Readonly<Record<string, string>> = { note: "solo-note" };

/// Il gruppo dei componenti che si aggiungono e si tolgono da soli.
const SUPPORT = "supporto";

/// Quanto aspetta una lettura chiesta da un evento: gli eventi di una scelta
/// arrivano a raffica (`setting_changed` per chiave, poi il rimontaggio), e
/// devono diventare una lettura sola.
const READ_DELAY_MS = 30;

export interface ComponentsPageHooks {
  /// Se la pagina è a schermo: una pagina nascosta non legge, e si segna da
  /// rileggere quando torna.
  visible(): boolean;
  /// Dopo una scelta che accende o spegne un bundle: la shell ricarica ciò che
  /// i bundle registrano.
  reloadProvider(): Promise<void>;
}

export interface ComponentsPage {
  /// La radice della pagina: sempre la stessa, così la testata e la ricerca
  /// sopravvivono ai ridisegni delle impostazioni.
  readonly element: HTMLElement;
  /// La pagina sta per comparire: rilegge se qualcosa è cambiato mentre non si
  /// vedeva (o se non ha mai letto), e ridisegna.
  show(): Promise<void>;
  /// Le impostazioni si sono chiuse: si dimenticano ricerca, avviso e gruppo
  /// aperto, e alla prossima apertura si rilegge.
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
  let readError: unknown = null;
  let stale = true;
  let supportOpen = false;
  let message: Message | null = null;
  /// Le righe e i profili di un gesto in corso: un gesto alla volta.
  let busy: Set<string> | null = null;
  const reads = new CoalescingQueue();
  let readTimer: ReturnType<typeof setTimeout> | null = null;
  let waiting: Array<() => void> = [];
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
  root.append(head, profiles, list, empty, notice);

  lifetime.listen(find, "input", () => applySearch());
  // Un controllo `aria-disabled` resta raggiungibile (per sentirne il perché)
  // ma Invio e Spazio non devono attivarlo: il tasto si ferma qui, prima che
  // il browser ne faccia un clic. Un profilo «più avanti» dice invece perché.
  const stopDisabled = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[aria-disabled="true"]');
    if (!target || !root.contains(target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type !== "keydown" || event.repeat) return;
    const name = target.dataset.profile;
    const profile = name ? map?.profili.find((candidate) => candidate.nome === name) : undefined;
    if (profile?.piu_avanti) say(laterReason(profile));
  };
  lifetime.listen(root, "keydown", stopDisabled, { capture: true });
  lifetime.listen(root, "keyup", stopDisabled, { capture: true });
  lifetime.listen(root, "focusin", (event) => {
    const key = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-focus-key]")?.dataset.focusKey;
    if (key) focusKey = key;
  });

  const interesting = (key: string) =>
    key.startsWith("components.") || key === "plugins.disabled" || key === "locale.language";
  lifetime.add(onEvent("setting_changed", (event) => {
    if (interesting(event.key)) changed();
  }));
  lifetime.add(onEvent("vault_opened", () => changed()));
  lifetime.add(() => {
    if (readTimer !== null) clearTimeout(readTimer);
    readTimer = null;
    for (const resolve of waiting) resolve();
    waiting = [];
  });

  /// Qualcosa fuori di qui ha cambiato la mappa.
  function changed(): void {
    if (lifetime.closed) return;
    if (!hooks.visible()) {
      stale = true;
      return;
    }
    void requestRead();
  }

  /// Una lettura, fusa con quelle chieste nello stesso istante. Torna quando la
  /// mappa letta è a schermo.
  function requestRead(): Promise<void> {
    if (lifetime.closed) return Promise.resolve();
    return new Promise((resolve) => {
      waiting.push(resolve);
      if (readTimer !== null) clearTimeout(readTimer);
      readTimer = setTimeout(() => {
        readTimer = null;
        const done = waiting;
        waiting = [];
        void reads.enqueueByKey("map", read).finally(() => {
          for (const finish of done) finish();
        });
      }, READ_DELAY_MS);
    });
  }

  async function read(): Promise<void> {
    if (lifetime.closed) return;
    try {
      map = await api.componentsMap();
      readError = null;
    } catch (error) {
      // Il vault che si rimonta risponde per un istante «nessun vault»: la
      // mappa di prima resta, e il `vault_opened` che segue rilegge.
      if (map === null) readError = error;
    }
    stale = false;
    draw();
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
    const current = map?.profilo ? (ALIASES[map.profilo] ?? map.profilo) : null;
    for (const profile of map?.profili ?? []) {
      if (ALIASES[profile.nome]) continue;
      nodes.push(profileButton(profile, current === profile.nome));
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

  function laterReason(profile: ComponentProfile): string {
    return plural(profile.arriva_con.length, "components.profile.later_why.one", "components.profile.later_why", {
      name: profile.etichetta,
    });
  }

  function profileButton(profile: ComponentProfile, pressed: boolean): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "components-profile";
    button.dataset.focusKey = `profile:${profile.nome}`;
    button.dataset.profile = profile.nome;
    button.setAttribute("aria-pressed", String(pressed));
    const name = document.createElement("span");
    name.textContent = profile.etichetta;
    button.append(name);
    if (profile.piu_avanti) {
      button.classList.add("components-profile--later");
      button.setAttribute("aria-disabled", "true");
      const later = document.createElement("span");
      later.className = "components-profile-later";
      later.textContent = t("components.profile.later");
      button.append(later);
      setTooltip(button, laterReason(profile));
    } else if (profile.nome === RECOMMENDED) {
      const recommended = document.createElement("span");
      recommended.className = "components-profile-rec";
      recommended.textContent = t("components.profile.recommended");
      button.append(recommended);
    }
    if (busy) button.setAttribute("aria-disabled", "true");
    if (busy?.has(`profile:${profile.nome}`)) button.setAttribute("aria-busy", "true");
    button.addEventListener("click", () => {
      if (busy) return;
      if (profile.piu_avanti) {
        say(laterReason(profile));
        return;
      }
      if (pressed) return;
      void gesture(`profile:${profile.nome}`, () => chooseProfile(profile));
    });
    return button;
  }

  function drawList(): void {
    if (!map) {
      list.replaceChildren(...(readError === null ? [] : [
        paragraph("muted settings-note", t("settings.read_failed", { reason: errorText(readError) })),
      ]));
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
    await requestRead();
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
      if (stale || map === null) await requestRead();
      else draw();
    },
    reset() {
      stale = true;
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
