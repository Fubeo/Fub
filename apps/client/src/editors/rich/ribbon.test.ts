// @vitest-environment happy-dom
//
// La barra multifunzione del documento: ogni comando di oggi ha la sua casa,
// le lettere non si confondono, e il catalogo spegne con la ragione.
import { afterEach, describe, expect, it } from "vitest";
import { groupControls } from "../../kit/ribbon/types";
import { t } from "../../i18n/strings";
import { reservedChord } from "../../ui/commands";
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

  it("senza chi le dia, la barra non mostra modalità né carta", () => {
    const ribbon = mountRichRibbon(engine([para("testo")]), () => null);
    expect(ribbon.element.querySelector<HTMLElement>('[data-command="rich.mode.document"]')!.hidden).toBe(true);
    expect(ribbon.element.querySelector<HTMLElement>('[data-command="rich.look.adapted"]')!.hidden).toBe(true);
    ribbon.destroy();
  });
});
