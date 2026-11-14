// La pagina «Tutti i componenti»: ciò che un tema veste, in ogni stato, da
// guardare mentre lo si scrive.
//
// La apre Aspetto in modalità sviluppatore (`panels/settings.ts`), con un
// `import()` (`carica.ts`): il suo codice, le sue stringhe e il suo foglio non
// pesano sull'avvio. Sta sopra le impostazioni, che restano aperte sotto: così
// vale il tema in uso **o in anteprima**, e chiudendola si torna dove si era.
//
// Quattro schede: i componenti dell'anatomia (`COMPONENTS`) e le viste dei
// componenti (`UiNode`), ciascuno in ogni suo stato; la tavolozza; i
// caratteri; i primitivi del kit. Il cuore è quello dei cataloghi del banco
// (`anatomia.ts`, `samples.ts`, `tavolozza.ts`, `caratteri.ts`, `kit.ts`). In
// testa due interruttori, Chiaro/Scuro e Contrasto alto, che provano la pagina
// nell'altra luce senza toccare la scelta salvata (un'anteprima, come quella
// di Aspetto), e la diagnosi del tema quando il tema è rifiutato. Un clic su un
// componente ne mostra il nome e gli hook che lo vestono, da copiare.
//
// Ce n'è una sola: aprirla di nuovo la riporta davanti.
import "./catalogo.css";
import { errorText } from "../../host/errors";
import { createTabs, iconButton, labelButton } from "../../kit";
import { onLanguage, resolvedLanguage, t as shellText } from "../../i18n/strings";
import { renderDiagnosis, themeDiagnoses } from "../../panels/theme-folder";
import { writeClipboardText } from "../../platform/clipboard";
import { on } from "../../state/store";
import { COMPONENTS, HOOKS, PARTS, type ComponentState, type StateName } from "../../theme/scrittoio/anatomia";
import {
  SERIES_THEME_ID,
  cancelThemePreview,
  currentContrast,
  currentTheme,
  currentThemeOptions,
  currentThemePreview,
  previewTheme,
  themeCatalog,
  themeTrust,
  type Theme,
} from "../../theme/theme";
import type { ContrastLevel } from "../../theme/scrittoio/recipe";
import { trapFocus } from "../../ui/a11y";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { enterSurface } from "../../ui/motion";
import { mountTree } from "../../ui/node";
import { notify } from "../../ui/notify";
import { TRUST_LABELS } from "../../ui/permissions";
import { anatomyProof, keepScrollersReachable } from "./anatomia";
import { fontStack } from "./caratteri";
import { force, holdForcedStates } from "./forza";
import { renderKit } from "./kit";
import { SAMPLES } from "./samples";
import { t, type CatalogPageKey } from "./strings";
import { ROLE_SWATCHES, TEXT_MINIMUM, renderedContrast } from "./tavolozza";

/// La pagina aperta.
export interface CatalogPage {
  /// L'elemento della pagina, sopra tutto il resto.
  readonly element: HTMLElement;
  /// La chiude; chiamarla di nuovo non fa niente.
  close(): void;
}

type TabId = "componenti" | "tavolozza" | "caratteri" | "kit";

const TABS: readonly (readonly [TabId, CatalogPageKey])[] = [
  ["componenti", "tab.components"],
  ["tavolozza", "tab.palette"],
  ["caratteri", "tab.fonts"],
  ["kit", "tab.kit"],
];

const STATE_KEYS: Readonly<Record<StateName, CatalogPageKey>> = {
  rest: "state.rest",
  hover: "state.hover",
  pressed: "state.pressed",
  selected: "state.selected",
  focused: "state.focused",
  disabled: "state.disabled",
  dragging: "state.dragging",
};

/// La pagina aperta, la sua vita e la vita di chi l'ha aperta.
let current: CatalogPage | null = null;
let currentLifetime: Lifetime | null = null;
let currentParent: Lifetime | null = null;
/// Le vite che hanno già il loro smontaggio della pagina: uno per vita, non
/// uno per apertura. `Lifetime` non toglie uno smontaggio registrato, e una
/// vita che apre la pagina dieci volte ne terrebbe dieci.
const watched = new WeakSet<Lifetime>();

/// La pagina aperta, se c'è.
export function openedCatalogPage(): CatalogPage | null {
  return current;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function stateLabel(state: ComponentState): string {
  return t(STATE_KEYS[state.name]);
}

/// «Sei stati: riposo, passaggio, …», con le parole della pagina.
function statesSentence(labels: readonly string[]): string {
  const count = Math.min(Math.max(labels.length, 1), 7) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
  return t(`states.${count}`, { list: labels.join(", ") });
}

/// Tiene un provino nello stato dato: gli stati di puntatore e tastiera coi
/// gemelli di `forza.ts`, gli altri con gli attributi che la pelle legge.
///
/// `aria-current` e `aria-disabled` stanno su un `div` generico perché sono i
/// selettori con cui la pelle disegna «selezionato» e «disabilitato» (venti e
/// più regole ciascuno in `skin.css`): senza, il campione mostrerebbe il
/// riposo. `data-selected` e `data-dragging` per le regole che leggono quelli,
/// e la classe `selected` per gli hook che la dichiarano.
function hold(proof: HTMLElement, state: StateName, hooks: readonly string[]): void {
  switch (state) {
    case "hover":
      force(proof, "hover");
      break;
    case "pressed":
      force(proof, "hover", "active");
      break;
    case "focused":
      force(proof, "focus");
      break;
    case "selected":
      proof.setAttribute("aria-current", "true");
      proof.dataset.selected = "";
      if (hooks.includes("selected")) proof.classList.add("selected");
      break;
    case "disabled":
      proof.setAttribute("aria-disabled", "true");
      break;
    case "dragging":
      proof.dataset.dragging = "";
      break;
    case "rest":
      break;
  }
}

/// Ciò che il riquadro di destra mostra del componente scelto. La frase si
/// rifà a ogni lettura, così segue la lingua.
interface Picked {
  readonly name: string;
  lede(): string;
  readonly hooks: readonly string[];
}

/// Apre la pagina, o riporta davanti quella aperta. `parent` è la vita di chi
/// la apre: chiusa quella, si chiude anche la pagina.
export function openCatalogPage(parent: Lifetime): CatalogPage {
  if (current) {
    current.element.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    return current;
  }
  if (parent.closed) return { element: document.createElement("div"), close: () => {} };
  const lifetime = openLifetime();
  if (!watched.has(parent)) {
    watched.add(parent);
    parent.add(() => {
      if (currentParent === parent) currentLifetime?.close();
    });
  }
  currentLifetime = lifetime;
  currentParent = parent;
  lifetime.add(() => {
    if (currentLifetime !== lifetime) return;
    current = null;
    currentLifetime = null;
    currentParent = null;
  });
  // La costruzione gemella i selettori di tutti i fogli della finestra e mette
  // la pagina nel documento: se si ferma a metà, la vita chiusa disfa ciò che
  // ha fatto, e la shell resta com'era.
  try {
    const page = buildPage(lifetime);
    current = page;
    return page;
  } catch (error) {
    lifetime.close();
    throw error;
  }
}

function buildPage(lifetime: Lifetime): CatalogPage {
  // La scelta di Aspetto quando la pagina si apre: chiudendola si rimette.
  const before = currentThemePreview();
  let touched = false;

  const root = el("div", "dev-catalog-window");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "dev-catalog-title");
  root.tabIndex = -1;
  const page = el("section", "dev-catalog");
  root.append(page);

  // ── La testata ─────────────────────────────────────────────────────────────
  const head = el("header", "dev-catalog-head");
  const heading = el("div", "dev-catalog-heading");
  const title = el("h2", "dev-catalog-title");
  title.id = "dev-catalog-title";
  const subtitle = el("p", "muted");
  heading.append(title, subtitle);

  const switches = el("div", "dev-catalog-switches");
  const lights = el("div", "segmented");
  lights.setAttribute("role", "radiogroup");
  const lightButtons = (["light", "dark"] as const).map((light) => {
    const button = el("button", "segmented-option");
    button.type = "button";
    button.setAttribute("role", "radio");
    button.dataset.light = light;
    lights.append(button);
    return button;
  });
  const contrastLabel = el("label", "dev-catalog-switch");
  const contrastInput = el("input", "setting-switch");
  contrastInput.type = "checkbox";
  contrastInput.setAttribute("role", "switch");
  const contrastText = el("span");
  contrastLabel.append(contrastInput, contrastText);
  const closeButton = iconButton({ icon: "close", label: t("page.close"), onPress: () => close(), lifetime });
  closeButton.classList.add("dev-catalog-close");
  switches.append(lights, contrastLabel, closeButton);
  head.append(heading, switches);

  const diagnoses = el("div", "dev-catalog-diagnoses");

  // ── Le schede ──────────────────────────────────────────────────────────────
  const tablist = el("div", "dev-catalog-tabs");
  const body = el("div", "dev-catalog-body");
  const panels = new Map<TabId, HTMLElement>();
  for (const [id] of TABS) {
    const panel = el("div", "dev-catalog-list");
    panel.dataset.panel = id;
    panels.set(id, panel);
    body.append(panel);
  }
  const info = el("aside", "dev-catalog-info");
  info.setAttribute("aria-labelledby", "dev-catalog-info-title");
  body.append(info);
  page.append(head, diagnoses, tablist, body);

  /// Ogni scheda disegnata ha la sua vita: un cambio di lingua la chiude e la
  /// ridisegna, coi suoi ascoltatori.
  const drawn = new Map<TabId, Lifetime>();
  let shown: TabId = "componenti";
  const tabs = createTabs({
    tablist,
    tabs: TABS.map(([id, key]) => ({ id, label: t(key), panel: panels.get(id)! })),
    selected: "componenti",
    label: t("page.tabs"),
    onSelect: (id) => draw(id as TabId),
    lifetime,
  });
  // Gli id delle schede sono quelli della pagina, così una prova o un link
  // le trova per nome.
  for (const [id] of TABS) {
    const button = tabs.tab(id);
    if (button) button.id = `dev-tab-${id}`;
    panels.get(id)!.setAttribute("aria-labelledby", `dev-tab-${id}`);
  }

  // ── Il componente scelto ───────────────────────────────────────────────────
  let pickedItem: HTMLElement | null = null;
  const infoTitle = el("h3", "dev-catalog-info-title");
  infoTitle.id = "dev-catalog-info-title";
  const infoLede = el("p", "muted");
  const infoHooks = el("ul", "dev-catalog-hooks");
  const infoActions = el("div", "settings-actions");
  const copyButton = el("button", "settings-btn");
  copyButton.type = "button";
  infoActions.append(copyButton);
  info.append(infoTitle, infoLede, infoHooks, infoActions);
  let picked: Picked | null = null;

  const showPicked = (next: Picked, item: HTMLElement): void => {
    picked = next;
    pickedItem?.removeAttribute("aria-current");
    pickedItem = item;
    item.setAttribute("aria-current", "true");
    infoTitle.textContent = next.name;
    infoLede.textContent = next.lede();
    infoHooks.replaceChildren(
      ...(next.hooks.length > 0
        ? next.hooks.map((hook) => {
            const row = el("li");
            row.append(el("code", undefined, `.${hook}`));
            return row;
          })
        : [el("li", "muted", t("info.no_hooks"))]),
    );
    copyButton.disabled = next.hooks.length === 0;
  };
  lifetime.listen(copyButton, "click", () => {
    const chosen = picked;
    if (!chosen) return;
    writeClipboardText(chosen.hooks.map((hook) => `.${hook}`).join("\n"))
      .then(() => notify(t("info.copied", { name: chosen.name })))
      .catch((error: unknown) => notify(t("info.copy_failed", { reason: errorText(error) }), "guasto"));
  });

  /// Un riquadro della lista: il nome (un pulsante, che sceglie), il pezzo e
  /// lo strato, e un campione per stato.
  const item = (
    life: Lifetime,
    id: string,
    name: string,
    where: string,
    figures: readonly HTMLElement[],
    details: Picked,
  ): HTMLElement => {
    const section = el("section", "dev-catalog-item");
    // Il nome col pezzo: lo stesso nome torna in pezzi diversi
    // (`context-menu` nei menu e nel moto), e i riquadri restano distinti.
    section.setAttribute("aria-labelledby", `${id} ${id}-where`);
    const nameEl = el("h3", "dev-catalog-name");
    const pick = el("button", "dev-catalog-pick", name);
    pick.type = "button";
    pick.id = id;
    const whereEl = el("span", "muted", where);
    whereEl.id = `${id}-where`;
    nameEl.append(pick, " ", whereEl);
    const states = el("div", "dev-catalog-states");
    states.append(...figures);
    section.append(nameEl, states);
    life.listen(section, "click", () => showPicked(details, section));
    return section;
  };

  const figure = (caption: string, ...content: Node[]): HTMLElement => {
    const node = el("figure", "dev-catalog-state");
    node.append(...content, el("figcaption", "muted", caption));
    return node;
  };

  // ── Le schede, disegnate la prima volta che si aprono ─────────────────────
  const drawComponents = (panel: HTMLElement, life: Lifetime): void => {
    let first: [Picked, HTMLElement] | null = null;
    let again: [Picked, HTMLElement] | null = null;
    const chosen = picked?.name;
    COMPONENTS.forEach((component, index) => {
      const layer = layerOf(component);
      const where = `${component.part} · ${layer}`;
      const figures = component.states.map((state) => {
        const proofs = el("div", "dev-catalog-proofs");
        for (const hook of component.hooks) {
          const frame = el("div", "dev-catalog-proof");
          frame.dataset.label = `${component.name} · ${stateLabel(state)} · ${hook}`;
          const proof = anatomyProof(component, state, hook);
          hold(proof, state.name, component.hooks);
          frame.append(proof);
          proofs.append(frame);
        }
        return figure(stateLabel(state), proofs);
      });
      const details: Picked = {
        name: component.name,
        lede: () =>
          t("info.lede", { part: component.part, layer, states: statesSentence(component.states.map(stateLabel)) }),
        hooks: component.hooks,
      };
      const node = item(life, `dev-item-${index}`, component.name, where, figures, details);
      panel.append(node);
      first ??= [details, node];
      if (again === null && component.name === chosen) again = [details, node];
    });
    // Le viste dei componenti: il renderer vero dei `UiNode`, con una porta
    // che non fa niente.
    const known = new Set(HOOKS);
    SAMPLES.forEach((sample, index) => {
      const figures = sample.states.map((state) => {
        const proof = el("div", "dev-catalog-proof dev-catalog-proof--view");
        mountTree(proof, state.node, async () => {});
        return figure(state.label, proof);
      });
      const hooks = new Set<string>();
      for (const node of figures) {
        for (const child of node.querySelectorAll<HTMLElement>("[class]")) {
          for (const name of child.classList) if (known.has(name)) hooks.add(name);
        }
      }
      const details: Picked = {
        name: sample.title,
        lede: () =>
          t("info.view_lede", {
            kinds: sample.covers.join(", "),
            states: statesSentence(sample.states.map((state) => state.label)),
          }),
        hooks: [...hooks],
      };
      const node = item(life, `dev-view-${index}`, sample.title, t("info.views"), figures, details);
      panel.append(node);
      if (again === null && sample.title === chosen) again = [details, node];
    });
    const start = again ?? first;
    if (start) showPicked(start[0], start[1]);
    if (panel.isConnected) roomForFloating(panel);
    // Un provino che scorre (la pelle dà a qualche hook un suo `overflow`)
    // resta raggiungibile da tastiera, come nel catalogo del banco.
    life.add(
      keepScrollersReachable(
        panel.querySelectorAll<HTMLElement>(".dev-catalog-proof[data-label], .dev-catalog-proof[data-label] > :not([tabindex])"),
        (frame) => frame.closest<HTMLElement>(".dev-catalog-proof")!.dataset.label!,
      ),
    );
  };

  /// Un hook che la pelle mette fuori dal flusso (il tooltip, un popover, un
  /// velo: `fixed` o `absolute`) non dà altezza né larghezza al suo riquadro, e
  /// il riquadro, che lo contiene e lo ritaglia, lo taglierebbe. Quei riquadri
  /// prendono lo spazio dei provini del banco (`bench/catalog.html`). Si guarda
  /// la geometria, non lo stile calcolato: un hook che esce dal suo riquadro è
  /// proprio quello che verrebbe tagliato, qualunque cosa ne dica il tema, e
  /// le misure di centinaia di riquadri costano un solo calcolo del layout.
  /// Quindi a pagina nel documento; un riquadro allargato non si restringe più
  /// (dentro ci sta, ora), finché la scheda non si ridisegna.
  const roomForFloating = (panel: HTMLElement): void => {
    const frames = [...panel.querySelectorAll<HTMLElement>(".dev-catalog-proof[data-label]")];
    const outside = frames.filter((frame) => {
      const hook = frame.firstElementChild;
      if (!(hook instanceof HTMLElement)) return false;
      const box = frame.getBoundingClientRect();
      const inner = hook.getBoundingClientRect();
      return inner.bottom > box.bottom + 0.5 || inner.right > box.right + 0.5;
    });
    for (const frame of outside) frame.classList.add("dev-catalog-proof--floating");
  };

  const drawPalette = (panel: HTMLElement): void => {
    const list = el("ul", "dev-swatches");
    for (const token of ROLE_SWATCHES) {
      const row = el("li", "dev-swatch");
      const chip = el("span", "dev-swatch-chip");
      chip.dataset.token = token;
      row.append(chip, el("code", undefined, `--${token}`));
      list.append(row);
    }
    const note = el("p", "muted");
    note.dataset.contrast = "";
    panel.append(list, note);
    measurePalette(panel);
  };

  const number = (value: number): string =>
    new Intl.NumberFormat(resolvedLanguage(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);

  const measurePalette = (panel: HTMLElement): void => {
    const note = panel.querySelector<HTMLElement>("[data-contrast]");
    if (!note) return;
    const text = renderedContrast("--text", "--sheet");
    const muted = renderedContrast("--muted", "--sheet");
    note.textContent = text === null || muted === null
      ? t("palette.unmeasured")
      : t("palette.contrast", { text: number(text), muted: number(muted), minimum: number(TEXT_MINIMUM) });
  };

  const FONTS = [
    ["ui", "--font-ui", "fonts.sample.ui"],
    ["reading", "--font-reading", "fonts.sample.reading"],
    ["mono", "--font-mono", "fonts.sample.mono"],
  ] as const;

  const drawFonts = (panel: HTMLElement): void => {
    for (const [name, token, sample] of FONTS) {
      const section = el("section", "dev-font");
      section.dataset.font = name;
      const label = el("h3", "dev-catalog-name", token);
      const stack = el("span", "muted");
      stack.dataset.stack = token;
      label.append(" ", stack);
      section.append(label, el("p", "dev-font-sample", t(sample)));
      panel.append(section);
    }
    measureFonts(panel);
  };

  const measureFonts = (panel: HTMLElement): void => {
    const style = getComputedStyle(document.documentElement);
    for (const stack of panel.querySelectorAll<HTMLElement>("[data-stack]")) {
      const [first, second] = fontStack(style.getPropertyValue(stack.dataset.stack!));
      stack.textContent = first === undefined
        ? ""
        : second === undefined
          ? t("fonts.stack.one", { first })
          : t("fonts.stack", { first, second });
    }
  };

  const drawKit = (panel: HTMLElement, life: Lifetime): void => {
    const box = el("div", "dev-catalog-kit");
    let sections = 0;
    renderKit({
      // Il popover, il dialogo e la scheda al passaggio ci sono anche qui: la
      // loro ancora sta dentro un dialogo (`aria-modal`), e il kit li alza sul
      // piano delle modali (`kit/popover.ts`, `kit/dialog.ts`).
      lifetime: life,
      section(sectionTitle, _column, ...content) {
        const node = el("section", "sezione");
        const h = el("h3", undefined, sectionTitle);
        sections += 1;
        h.id = `dev-kit-sezione-${sections}`;
        node.setAttribute("aria-labelledby", h.id);
        node.append(h, ...content);
        box.append(node);
      },
    });
    panel.append(box);
  };

  const DRAW: Readonly<Record<TabId, (panel: HTMLElement, life: Lifetime) => void>> = {
    componenti: drawComponents,
    tavolozza: drawPalette,
    caratteri: drawFonts,
    kit: drawKit,
  };

  function draw(id: TabId): void {
    shown = id;
    // Il riquadro del componente scelto è della scheda «Componenti»: le altre
    // prendono tutta la larghezza.
    body.dataset.tab = id;
    info.hidden = id !== "componenti";
    if (drawn.has(id)) return;
    const life = openLifetime();
    drawn.set(id, life);
    DRAW[id](panels.get(id)!, life);
  }
  lifetime.add(() => {
    for (const life of drawn.values()) life.close();
    drawn.clear();
  });

  // ── La lingua ──────────────────────────────────────────────────────────────
  const label = (): void => {
    title.textContent = t("page.title");
    lights.setAttribute("aria-label", t("page.light"));
    for (const button of lightButtons) {
      button.textContent = t(button.dataset.light === "light" ? "page.light.light" : "page.light.dark");
    }
    contrastText.textContent = t("page.contrast");
    labelButton(closeButton, t("page.close"));
    tablist.setAttribute("aria-label", t("page.tabs"));
    for (const [id, key] of TABS) {
      const text = tabs.tab(id)?.querySelector(".kit-tab-label");
      if (text) text.textContent = t(key);
    }
    copyButton.textContent = t("info.copy");
  };

  /// Un cambio di lingua: la testata si rinomina, e le schede già disegnate
  /// si rifanno, col fuoco e la scheda dove stavano.
  const relabel = (): void => {
    label();
    for (const [id, life] of [...drawn]) {
      life.close();
      drawn.delete(id);
      panels.get(id)!.replaceChildren();
    }
    pickedItem = null;
    draw(shown);
    sync();
  };

  // ── La luce, il contrasto, il tema ─────────────────────────────────────────
  let offered: readonly Theme[] = ["light", "dark"];
  let reloadedAt: number | null = null;
  let diagnosed = "";

  const sync = (): void => {
    const options = currentThemeOptions();
    const name = options.themeName || options.themeId;
    const trust = shellText(TRUST_LABELS[themeTrust(options.themeId)]);
    subtitle.textContent = reloadedAt === null
      ? t("page.subtitle", { theme: name, trust })
      : t("page.subtitle.reloaded", {
          theme: name,
          trust,
          time: new Date(reloadedAt).toLocaleTimeString(resolvedLanguage(), {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
        });
    const light = currentTheme();
    for (const button of lightButtons) {
      const value = button.dataset.light as Theme;
      const chosen = value === light;
      button.setAttribute("aria-checked", String(chosen));
      button.tabIndex = chosen ? 0 : -1;
      button.disabled = !offered.includes(value);
      button.title = button.disabled
        ? t("page.light.missing", { theme: name, light: button.textContent ?? value })
        : "";
    }
    contrastInput.checked = currentContrast() === "high";
    // La diagnosi è un avviso (`role="alert"`): si ridisegna solo quando
    // cambia, o ogni rimontaggio la riannuncerebbe.
    const found = themeDiagnoses();
    const key = JSON.stringify(found.map((diagnosis) => [diagnosis.name, diagnosis.at, diagnosis.text]));
    if (key !== diagnosed) {
      diagnosed = key;
      diagnoses.replaceChildren(...found.map(renderDiagnosis));
    }
    if (drawn.has("tavolozza")) measurePalette(panels.get("tavolozza")!);
    if (drawn.has("caratteri")) measureFonts(panels.get("caratteri")!);
  };

  const readOffered = async (): Promise<void> => {
    const id = currentThemeOptions().themeId;
    if (id === SERIES_THEME_ID) {
      offered = ["light", "dark"];
    } else {
      const installed = await themeCatalog().catch(() => []);
      offered = installed.find((theme) => theme.manifest.id === id)?.manifest.lights ?? [currentTheme()];
    }
    if (!lifetime.closed) sync();
  };

  const tryLook = (light: Theme, contrast: ContrastLevel): void => {
    touched = true;
    const id = currentThemeOptions().themeId;
    previewTheme(id, light, contrast)
      .catch((error: unknown) => {
        if (!lifetime.closed) notify(t("page.preview_failed", { reason: errorText(error) }), "guasto");
      })
      .finally(() => {
        if (!lifetime.closed) sync();
      });
  };

  for (const button of lightButtons) {
    lifetime.listen(button, "click", () => {
      const light = button.dataset.light as Theme;
      if (button.disabled || light === currentTheme()) return;
      tryLook(light, currentContrast());
    });
    lifetime.listen(button, "keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const other = lightButtons.find((candidate) => candidate !== button && !candidate.disabled);
      if (!other) return;
      other.focus();
      other.click();
    });
  }
  lifetime.listen(contrastInput, "change", () => tryLook(currentTheme(), contrastInput.checked ? "high" : "normal"));
  // Invio come lo Spazio: un interruttore si accende con tutti e due.
  lifetime.listen(contrastInput, "keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    contrastInput.click();
  });

  // Ogni rimontaggio del tema (un'anteprima, un tema che cambia sul disco, un
  // tema rifiutato) ridisegna la testata, la diagnosi e le misure.
  lifetime.add(
    on("theme", () => {
      reloadedAt = Date.now();
      void readOffered();
    }),
  );
  lifetime.add(onLanguage(relabel));

  // Gli stati forzati prima dei campioni, così nascono già fermi.
  holdForcedStates(lifetime);
  label();
  draw("componenti");
  sync();
  void readOffered();

  document.body.append(root);
  lifetime.add(() => root.remove());
  roomForFloating(panels.get("componenti")!);
  enterSurface(root);
  const release = trapFocus(root, () => close());
  lifetime.add(release);
  tabs.tab("componenti")?.focus();

  const close = (): void => {
    if (lifetime.closed) return;
    lifetime.close();
    // La scelta di Aspetto torna com'era: un'anteprima di prima si rimette,
    // altrimenti torna il tema salvato.
    if (touched) {
      const back = before
        ? previewTheme(before.id, before.light, before.contrast)
        : cancelThemePreview();
      back.catch(() => cancelThemePreview()).catch(() => {});
    }
  };

  return { element: root, close };
}

const PART_LAYERS = new Map(PARTS.map((part) => [part.part, part.layer]));

/// Lo strato che il componente dichiara, o quello del suo pezzo.
function layerOf(component: (typeof COMPONENTS)[number]): string {
  return component.layer ?? PART_LAYERS.get(component.part) ?? "cornice";
}
