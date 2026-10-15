// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import type { SettingEntry, SettingKind, SettingValue, ThemeSetting } from "../host/contract";
import {
  applyThemeOptions,
  mountMirroredOptions,
  mountedThemeOptions,
  resolveThemeOptions,
  themeOptionKey,
} from "./options";

const THEME = "com.acme.notte";

function setting(name: string, kind: SettingKind): ThemeSetting {
  return { name, label: name, description: "", kind };
}

const BORDERS = setting("bordi", { kind: "toggle", default: true });
const RADIUS = setting("raggio", { kind: "number", default: 8, min: 0, max: 16 });
const GRAIN = setting("trama", {
  kind: "choice",
  default: "fine",
  options: [
    { value: "fine", label: "Fine" },
    { value: "grossa", label: "Grossa" },
  ],
});

/// Una riga del registro per un'impostazione del tema, come la dà l'host.
function entry(of: ThemeSetting, value: SettingValue, source: SettingEntry["source"] = "machine"): SettingEntry {
  return {
    spec: {
      key: themeOptionKey(THEME, of.name),
      label: of.label,
      description: of.description,
      group: "Notte",
      scope: "machine",
      kind: of.kind,
      program_writable: false,
    },
    value,
    source,
  };
}

const root = (): HTMLElement => document.documentElement;

beforeEach(() => {
  for (const name of root().getAttributeNames()) root().removeAttribute(name);
});

describe("le scelte di un tema, risolte", () => {
  it("la chiave sta dentro l'id del tema", () => {
    expect(themeOptionKey(THEME, "bordi")).toBe("com.acme.notte:bordi");
  });

  it("senza il registro vale il default dichiarato, e si sa che non è scrivibile", () => {
    const options = resolveThemeOptions(THEME, [BORDERS, RADIUS, GRAIN], []);
    expect(options.map((option) => [option.key, option.value, option.declared, option.chosen])).toEqual([
      ["com.acme.notte:bordi", true, false, false],
      ["com.acme.notte:raggio", 8, false, false],
      ["com.acme.notte:trama", "fine", false, false],
    ]);
  });

  it("il valore del registro vince sul default, e una riga di default non è una scelta", () => {
    const options = resolveThemeOptions(THEME, [BORDERS, RADIUS, GRAIN], [
      entry(BORDERS, false),
      entry(RADIUS, 8, "default"),
      entry(GRAIN, "grossa"),
    ]);
    expect(options.map((option) => [option.value, option.declared, option.chosen])).toEqual([
      [false, true, true],
      [8, true, false],
      ["grossa", true, true],
    ]);
  });

  it("un valore che non regge lo schema non arriva alla pelle: vale il default", () => {
    const options = resolveThemeOptions(THEME, [BORDERS, RADIUS, GRAIN], [
      entry(BORDERS, "sì"),
      entry(RADIUS, 40),
      entry(GRAIN, "ruvida"),
    ]);
    expect(options.map((option) => [option.value, option.chosen])).toEqual([
      [true, false],
      [8, false],
      ["fine", false],
    ]);
  });

  it("le righe di un altro tema non contano", () => {
    const other = { ...entry(GRAIN, "grossa"), spec: { ...entry(GRAIN, "grossa").spec, key: "altro.tema:trama" } };
    expect(resolveThemeOptions(THEME, [GRAIN], [other])[0]!.value).toBe("fine");
  });

  it("ciò che un tema non può dichiarare non entra", () => {
    const options = resolveThemeOptions(THEME, [
      setting("Bordi Larghi", { kind: "toggle", default: true }),
      setting("motto", { kind: "text", default: "" }),
      setting("elenco", { kind: "list", default: [] }),
      setting("fuori", { kind: "number", default: 40, min: 0, max: 16 }),
      setting("aperto", { kind: "number", default: 4, min: 0, max: null }),
      setting("orfana", { kind: "choice", default: "x", options: [] }),
      BORDERS,
      setting("bordi", { kind: "toggle", default: false }),
    ], []);
    expect(options.map((option) => option.setting.name)).toEqual(["bordi"]);
    expect(options[0]!.value).toBe(true);
  });

  it("un tema senza impostazioni non ne ha", () => {
    expect(resolveThemeOptions(THEME, undefined, [])).toEqual([]);
  });
});

describe("le scelte di un tema, sulla radice", () => {
  it("scrive un attributo per scelta, e per i numeri anche la proprietà", () => {
    applyThemeOptions(root(), resolveThemeOptions(THEME, [BORDERS, RADIUS, GRAIN], [entry(GRAIN, "grossa")]));
    expect(root().getAttribute("data-opt-bordi")).toBe("true");
    expect(root().getAttribute("data-opt-raggio")).toBe("8");
    expect(root().getAttribute("data-opt-trama")).toBe("grossa");
    expect(root().style.getPropertyValue("--opt-raggio")).toBe("8");
    expect(root().style.getPropertyValue("--opt-bordi")).toBe("");
  });

  it("cambiato tema non resta niente del precedente", () => {
    root().dataset.theme = "dark";
    root().style.setProperty("--altro", "1");
    applyThemeOptions(root(), resolveThemeOptions(THEME, [BORDERS, RADIUS, GRAIN], []));
    applyThemeOptions(root(), resolveThemeOptions("altro.tema", [GRAIN], []));
    expect(root().hasAttribute("data-opt-bordi")).toBe(false);
    expect(root().hasAttribute("data-opt-raggio")).toBe(false);
    expect(root().style.getPropertyValue("--opt-raggio")).toBe("");
    expect(root().getAttribute("data-opt-trama")).toBe("fine");
    // Ciò che non è una scelta di tema resta dov'era.
    expect(root().dataset.theme).toBe("dark");
    expect(root().style.getPropertyValue("--altro")).toBe("1");

    applyThemeOptions(root(), []);
    expect(root().getAttributeNames().filter((name) => name.startsWith("data-opt-"))).toEqual([]);
  });

  it("non riscrive ciò che c'è già", () => {
    const options = resolveThemeOptions(THEME, [BORDERS, RADIUS], []);
    applyThemeOptions(root(), options);
    let writes = 0;
    const set = root().setAttribute.bind(root());
    root().setAttribute = (name: string, value: string) => {
      writes++;
      set(name, value);
    };
    try {
      applyThemeOptions(root(), options);
      expect(writes).toBe(0);
    } finally {
      delete (root() as { setAttribute?: unknown }).setAttribute;
    }
  });

  it("un'altra finestra rispecchia le stesse scelte", () => {
    applyThemeOptions(root(), resolveThemeOptions(THEME, [BORDERS, RADIUS, GRAIN], []));
    const mirrored = mountedThemeOptions(root());
    expect(mirrored).toEqual({
      attributes: { bordi: "true", raggio: "8", trama: "fine" },
      properties: { raggio: "8" },
    });

    applyThemeOptions(root(), []);
    mountMirroredOptions(root(), mirrored);
    expect(root().getAttribute("data-opt-trama")).toBe("fine");
    expect(root().style.getPropertyValue("--opt-raggio")).toBe("8");

    mountMirroredOptions(root(), undefined);
    expect(mountedThemeOptions(root())).toEqual({ attributes: {}, properties: {} });
  });

  it("rispecchiando scarta ciò che non ha la forma di una scelta", () => {
    mountMirroredOptions(root(), {
      attributes: { "Bordi Larghi": "true", trama: "a b", raggio: "8", bordi: "false" },
      properties: { raggio: "url(x)", passo: "2", "": "1" },
    });
    expect(mountedThemeOptions(root())).toEqual({
      attributes: { raggio: "8", bordi: "false" },
      properties: { passo: "2" },
    });
  });
});
