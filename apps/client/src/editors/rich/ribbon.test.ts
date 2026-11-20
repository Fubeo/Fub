// @vitest-environment happy-dom
//
// La barra multifunzione del documento: ogni comando di oggi ha la sua casa,
// le lettere non si confondono, e il catalogo spegne con la ragione.
import { afterEach, describe, expect, it } from "vitest";
import { groupControls } from "../../kit/ribbon/types";
import { activeMotions, createManualDriver, liveState, setMotionDriver, setMotionPreference, type ManualDriver } from "../../moto";
import { t } from "../../i18n/strings";
import { reservedChord } from "../../ui/commands";
import { closeContextMenu } from "../../ui/menu";
import { SHELL_KEYS } from "../../ui/shell-keys.generated";
import { RichEngine } from "./engine";
import type { Block } from "./projection";
import { RICH_PANEL_IDS } from "./panels";
import { mountRichRibbon, ribbonIds, RICH_MINI, RICH_QUICK, RICH_RIBBON_COMMANDS, RICH_TABS, type RichView } from "./ribbon";
import { RICH_ACTION_IDS, RICH_CHORDS } from "./surface";

let engines: RichEngine[] = [];
afterEach(() => {
  for (const engine of engines) engine.destroy();
  engines = [];
  document.body.replaceChildren();
});

function engine(blocks: readonly Block[], track = false): RichEngine {
  const parent = document.createElement("div");
  document.body.append(parent);
  const made = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
  made.setDoc(JSON.stringify({ format: "fub-rich", version: 1, blocks, ...(track ? { track: true } : {}) }));
  engines.push(made);
  return made;
}

const para = (x: string): Block => ({ t: "para", role: { kind: "body" }, c: [{ t: "text", x }] }) as Block;

const VIEW: RichView = {
  look: { font: null, size: null, color: null, hl: null } as unknown as RichView["look"],
  style: "body",
  active: new Set(),
  inTable: false,
  inList: false,
  painter: false,
  finding: false,
  tracking: false,
  mode: "document",
  adapted: false,
  page: null,
  ink: { tool: "select", color: "#000000", width: 1, pen: "ballpoint", penOnly: false, whole: true },
  object: null,
};

/// Le azioni del motore che la barra non mostra, ciascuna col posto dove sta.
const ELSEWHERE: Readonly<Record<string, string>> = {
  // L'evidenziatore è la tavolozza di `rich.highlight`.
  "markdown.highlight": "rich.highlight",
  // In un elenco il rientro cambia il livello: una coppia sola.
  "markdown.list.indent": "rich.indent.increase",
  "markdown.list.dedent": "rich.indent.decrease",
  // Un link si toglie dal suo riquadro.
  "rich.link.remove": "rich.link",
};

describe("la barra del documento", () => {
  it("dà soltanto comandi che il motore, la barra o un riquadro conoscono", () => {
    for (const id of ribbonIds(VIEW)) {
      expect(RICH_ACTION_IDS.has(id) || RICH_RIBBON_COMMANDS.has(id) || RICH_PANEL_IDS.has(id), `«${id}» non è di nessuno`).toBe(true);
    }
    for (const id of RICH_MINI) expect(ribbonIds(VIEW), id).toContain(id);
  });

  it("ha un posto per ogni azione del motore", () => {
    const ids = new Set(ribbonIds(VIEW));
    for (const id of RICH_ACTION_IDS) {
      const home = ELSEWHERE[id] ?? id;
      expect(ids.has(home), `«${id}» non ha un posto nella barra`).toBe(true);
    }
  });

  it("ha lettere che non si confondono, nelle schede e dentro una scheda", () => {
    const top = [...RICH_TABS.map((tab) => tab.keytip), ...RICH_QUICK.map((control) => control.keytip)];
    expect(new Set(top).size, "una lettera doppia fra le schede").toBe(top.length);
    for (const a of top) for (const b of top) if (a !== b) expect(b.startsWith(a), `${a} e ${b}`).toBe(false);
    for (const tab of RICH_TABS) {
      const all = [...tab.groups.map((group) => group.keytip), ...tab.groups.flatMap(groupControls).map((control) => control.keytip)];
      const tips = [...new Set(all)];
      expect(all.length, `una lettera doppia nella scheda ${tab.id}`).toBe(tips.length);
      for (const a of tips) {
        expect(a).toMatch(/^[A-Z0-9]{1,2}$/);
        for (const b of tips) if (a !== b) expect(b.startsWith(a), `${tab.id}: ${a} è l'inizio di ${b}`).toBe(false);
      }
    }
  });

  it("Ctrl+F1 non è già una scorciatoia della shell, del documento o del sistema", () => {
    const taken = [...Object.values(SHELL_KEYS), ...Object.values(RICH_CHORDS)].flatMap((binding) => String(binding).split(/\s*,\s*/));
    expect(taken).not.toContain("Mod-F1");
    expect(taken).not.toContain("Ctrl-F1");
    expect(reservedChord("Mod-F1", "other")).toBeNull();
    expect(reservedChord("Mod-F1", "mac")).toBeNull();
  });

  it("mentre si registra spegne il formato col perché, e lascia scrivere", () => {
    const e = engine([para("testo")], true);
    expect(e.tracking()).toBe(true);
    const ribbon = mountRichRibbon(e, () => null, { review: true });
    document.body.append(ribbon.element);
    const font = ribbon.element.querySelector<HTMLSelectElement>('[data-command="rich.font"] select')!;
    expect(font.disabled).toBe(true);
    const painter = ribbon.element.querySelector<HTMLButtonElement>('[data-command="rich.painter"] button')!;
    expect(painter.getAttribute("aria-disabled")).toBe("true");
    painter.focus();
    expect(document.getElementById(painter.getAttribute("aria-describedby")!)!.textContent).toBe(
      t("rich.ribbon.unavailable", { command: t("rich.painter"), reason: t("rich.ribbon.tracking") }),
    );
    painter.click();
    expect(e.painterArmed()).toBe(false);
    expect(ribbon.element.querySelector('[data-command="markdown.bold"] button')!.hasAttribute("aria-disabled")).toBe(false);
    ribbon.destroy();
  });

  it("la scheda Tabella c'è soltanto col cursore in una tabella", () => {
    const e = engine([para("prima")]);
    const ribbon = mountRichRibbon(e, () => null);
    document.body.append(ribbon.element);
    const tabs = () => [...ribbon.element.querySelectorAll<HTMLElement>('[role="tab"]')].filter((tab) => !tab.hidden).map((tab) => tab.textContent);
    expect(tabs()).not.toContain(t("rich.ribbon.tab.table"));
    e.select(2);
    expect(e.run("markdown.table")).toBe(true);
    expect(tabs()).toContain(t("rich.ribbon.tab.table"));
    ribbon.destroy();
  });

  it("lo zoom c'è soltanto se la shell lo dà, e lo chiede a lei", () => {
    const e = engine([para("testo")]);
    const asked: string[] = [];
    const bare = mountRichRibbon(e, () => null);
    expect(bare.element.querySelector<HTMLElement>('[data-command="shell.zoom.in"]')!.hidden).toBe(true);
    bare.destroy();
    const ribbon = mountRichRibbon(e, () => null, {}, { shell: (id) => () => asked.push(id) });
    document.body.append(ribbon.element);
    ribbon.element.querySelector<HTMLButtonElement>('[data-command="shell.zoom.in"] button')!.click();
    expect(asked).toEqual(["shell.zoom.in"]);
    ribbon.destroy();
  });

  it("Visualizza chiede la modalità e la carta alla superficie, e in Scrittura spegne la carta col perché", () => {
    const e = engine([para("testo")]);
    let mode = "document";
    let look: "file" | "adattato" | "tema" = "file";
    const asked: string[] = [];
    const display = {
      mode: () => mode,
      setMode: (next: string) => asked.push(`mode:${next}`),
      look: () => look,
      setLook: (next: "file" | "adattato" | "tema") => asked.push(`look:${next}`),
    };
    const ribbon = mountRichRibbon(e, () => null, {}, { display });
    document.body.append(ribbon.element);
    const press = (id: string) => ribbon.element.querySelector<HTMLButtonElement>(`[data-command="${id}"] button`)!;
    expect(press("rich.mode.document").getAttribute("aria-pressed")).toBe("true");
    expect(press("rich.mode.writing").getAttribute("aria-pressed")).toBe("false");
    press("rich.mode.reading").click();
    press("rich.look.adapted").click();
    expect(asked).toEqual(["mode:reading", "look:adattato"]);
    mode = "writing";
    look = "tema";
    ribbon.refresh();
    expect(press("rich.mode.writing").getAttribute("aria-pressed")).toBe("true");
    const adapted = press("rich.look.adapted");
    expect(adapted.getAttribute("aria-disabled")).toBe("true");
    adapted.focus();
    expect(document.getElementById(adapted.getAttribute("aria-describedby")!)!.textContent).toBe(
      t("rich.ribbon.unavailable", { command: t("rich.look.adapted"), reason: t("rich.look.adapted.writing") }),
    );
    adapted.click();
    expect(asked).toHaveLength(2);
    ribbon.destroy();
  });

  it("Disegna sceglie la penna, mette il velo e lo toglie con Seleziona", () => {
    const e = engine([para("testo")]);
    const ribbon = mountRichRibbon(e, () => null);
    document.body.append(ribbon.element);
    expect(RICH_TABS.map((tab) => tab.id)).toContain("draw");
    const press = (id: string) => ribbon.element.querySelector<HTMLButtonElement>(`[data-command="${id}"] button`)!;
    press("rich.ink.pen").click();
    expect(press("rich.ink.pen").getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector(".rich-ink-veil")).not.toBeNull();
    press("rich.ink.select").click();
    expect(document.querySelector(".rich-ink-veil")).toBeNull();
    press("rich.ink.pen").click();
    ribbon.destroy();
    expect(document.querySelector(".rich-ink-veil")).toBeNull();
  });

  it("Tipo di penna sceglie una penna della galleria del disegno", () => {
    const ribbon = mountRichRibbon(engine([para("testo")]), () => null);
    document.body.append(ribbon.element);
    const kind = [...ribbon.element.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label") === t("rich.ink.kind") || b.textContent === t("rich.ink.kind"))!;
    const items = () => [...document.querySelectorAll<HTMLElement>("#context-menu [role=menuitemradio]")];
    kind.click();
    expect(items().map((el) => el.textContent)).toContain(t("rich.ink.kind.fountain"));
    expect(items().find((el) => el.getAttribute("aria-checked") === "true")!.textContent).toContain(t("rich.ink.kind.ballpoint"));
    items().find((el) => el.textContent?.startsWith(t("rich.ink.kind.fountain")))!.click();
    closeContextMenu();
    kind.click();
    expect(items().find((el) => el.getAttribute("aria-checked") === "true")!.textContent).toContain(t("rich.ink.kind.fountain"));
    // La penna sceglie anche la Penna, come in Word.
    const pen = ribbon.element.querySelector<HTMLButtonElement>('[data-command="rich.ink.pen"] button')!;
    expect(pen.getAttribute("aria-pressed")).toBe("true");
    closeContextMenu();
    ribbon.destroy();
  });

  it("a 700 px apre sul posto un gruppo raccolto, ed Esc lo richiude col fuoco sul suo bottone", async () => {
    const e = engine([para("testo")]);
    const ribbon = mountRichRibbon(e, () => null);
    document.body.append(ribbon.element);
    const panel = ribbon.element.querySelector<HTMLElement>('.rich-ribbon-panel[data-tab="home"]')!;
    const toolbar = panel.querySelector<HTMLElement>(".rich-ribbon-toolbar")!;
    // happy-dom non misura: un foglietto aperto è largo 200 (140 se il
    // pannello è fitto), uno raccolto 60, e la barra è larga 700 meno i
    // margini del foglio.
    Object.defineProperty(toolbar, "clientWidth", { configurable: true, get: () => 660 });
    Object.defineProperty(toolbar, "scrollWidth", {
      configurable: true,
      get: () =>
        [...toolbar.children]
          .filter((group) => !(group as HTMLElement).hidden)
          .reduce((sum, group) => sum + ((group as HTMLElement).dataset.collapsed === "true" ? 60 : panel.dataset.dense === "true" ? 140 : 200), 0),
    });
    const scroll = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = () => {};
    try {
      ribbon.refresh();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const groups = [...toolbar.querySelectorAll<HTMLElement>(":scope > .rich-ribbon-group")];
      const folded = groups.find((group) => group.dataset.collapsed === "true")!;
      expect(folded, "a 700 px almeno un gruppo si raccoglie").toBeDefined();
      const toggle = folded.querySelector<HTMLButtonElement>(".rich-ribbon-group-toggle")!;
      expect(toggle.hasAttribute("aria-haspopup")).toBe(false);
      toggle.click();
      expect(folded.dataset.open).toBe("true");
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      // Il corpo resta nel gruppo: nessun riquadro sospeso.
      expect(document.querySelector(".rich-ribbon-popup-group")).toBeNull();
      const inside = document.activeElement as HTMLElement;
      expect(folded.contains(inside)).toBe(true);
      inside.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      expect(folded.hasAttribute("data-open")).toBe(false);
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(toggle);
    } finally {
      HTMLElement.prototype.scrollIntoView = scroll;
      ribbon.destroy();
    }
  });

  it("senza chi le dia, la barra non mostra modalità né carta", () => {
    const ribbon = mountRichRibbon(engine([para("testo")]), () => null);
    expect(ribbon.element.querySelector<HTMLElement>('[data-command="rich.mode.document"]')!.hidden).toBe(true);
    expect(ribbon.element.querySelector<HTMLElement>('[data-command="rich.look.adapted"]')!.hidden).toBe(true);
    ribbon.destroy();
  });
});

/// La barra nella sua superficie, col moto vero: l'ospite, la ricerca e la
/// pagina in colonna, come le monta `surface.ts`. happy-dom non ha un layout:
/// chi si vede ha un riquadro, e la pagina sta sotto il vassoio quando si
/// vede, subito sotto le schede quando no.
interface Moving {
  readonly driver: ManualDriver;
  readonly ribbon: ReturnType<typeof mountRichRibbon>;
  readonly surface: HTMLElement;
  readonly page: HTMLElement;
  readonly panels: HTMLElement;
  restore(): void;
}

function moving(): Moving {
  const driver = createManualDriver();
  setMotionDriver(driver);
  const surface = document.createElement("div");
  surface.className = "rich-surface";
  const host = document.createElement("div");
  host.className = "rich-ribbon-host";
  const page = document.createElement("div");
  page.className = "rich-page";
  surface.append(host, page);
  document.body.append(surface);
  const ribbon = mountRichRibbon(engine([para("testo")]), () => null, {}, { host });
  surface.insertBefore(ribbon.findBar, page);
  const panels = ribbon.element.querySelector<HTMLElement>(".rich-ribbon-panels")!;
  const hiddenUp = (el: Element): boolean => {
    if (!el.isConnected) return true;
    for (let at: Element | null = el; at; at = at.parentElement) if ((at as HTMLElement).hidden) return true;
    return false;
  };
  const rect = HTMLElement.prototype.getBoundingClientRect;
  const rects = HTMLElement.prototype.getClientRects;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (hiddenUp(this)) return new DOMRect();
    const top = this === page ? (panels.hidden ? 40 : 140) : 40;
    const pose = liveState(this)?.pose;
    return new DOMRect(pose?.x ?? 0, top + (pose?.y ?? 0), 400, this === page ? 400 : 60);
  };
  HTMLElement.prototype.getClientRects = function (this: HTMLElement) {
    return (hiddenUp(this) ? [] : [this.getBoundingClientRect()]) as unknown as DOMRectList;
  };
  const restore = (): void => {
    ribbon.destroy();
    HTMLElement.prototype.getBoundingClientRect = rect;
    HTMLElement.prototype.getClientRects = rects;
    driver.advance(5000);
    setMotionDriver(null);
    setMotionPreference("system");
  };
  return { driver, ribbon, surface, page, panels, restore };
}

const tabNamed = (ribbon: Moving["ribbon"], key: Parameters<typeof t>[0]): HTMLElement =>
  [...ribbon.element.querySelectorAll<HTMLElement>('[role="tab"]')].find((tab) => tab.textContent === t(key))!;
const ctrlF1 = (surface: HTMLElement): boolean => surface.dispatchEvent(new KeyboardEvent("keydown", { key: "F1", ctrlKey: true, bubbles: true, cancelable: true }));

describe("il movimento della barra del documento", () => {
  it("cambiando scheda i foglietti della scheda nuova entrano uno dopo l'altro, come nei fogli", () => {
    const { driver, ribbon, restore } = moving();
    try {
      tabNamed(ribbon, "rich.ribbon.tab.insert").click();
      const panel = ribbon.element.querySelector<HTMLElement>('.rich-ribbon-panel[data-tab="insert"]')!;
      expect(panel.hidden).toBe(false);
      const groups = [...panel.querySelectorAll<HTMLElement>(".rich-ribbon-group")].filter((group) => !group.hidden);
      expect(groups.length).toBeGreaterThan(1);
      const starts = groups.map((group) => driver.plays.find((play) => play.el === group));
      expect(starts.every(Boolean), "ogni foglietto entra").toBe(true);
      expect(starts[1]!.timing.delay ?? 0).toBeGreaterThan(starts[0]!.timing.delay ?? 0);
    } finally {
      restore();
    }
    expect(activeMotions()).toBe(0);
  });

  it("Ctrl+F1 muove la tenda: la pagina sale sull'immagine del vassoio, e scende alla riapertura", () => {
    const { driver, ribbon, surface, page, panels, restore } = moving();
    try {
      ctrlF1(surface);
      expect(panels.hidden).toBe(true);
      expect(ribbon.element.querySelectorAll("[inert]"), "l'immagine del vassoio svanisce").toHaveLength(1);
      expect(driver.plays.some((play) => play.el === page), "la pagina sale").toBe(true);
      driver.advance(400);
      expect(ribbon.element.querySelectorAll("[inert]")).toHaveLength(0);
      const before = driver.plays.length;
      ctrlF1(surface);
      expect(panels.hidden).toBe(false);
      expect(driver.plays.slice(before).some((play) => play.el === page), "la pagina scende").toBe(true);
    } finally {
      restore();
    }
    expect(activeMotions()).toBe(0);
  });

  it("col moto ridotto lo stato cambia subito, senza corse", () => {
    const { driver, ribbon, surface, page, panels, restore } = moving();
    try {
      setMotionPreference("reduced");
      tabNamed(ribbon, "rich.ribbon.tab.insert").click();
      expect(ribbon.element.querySelector<HTMLElement>('.rich-ribbon-panel[data-tab="insert"]')!.hidden).toBe(false);
      ctrlF1(surface);
      expect(panels.hidden).toBe(true);
      expect(driver.plays).toHaveLength(0);
      expect(liveState(page)).toBeNull();
    } finally {
      restore();
    }
  });
});
