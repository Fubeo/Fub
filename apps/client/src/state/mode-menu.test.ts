// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry } from "../host/contract";
import type { SurfaceMode } from "../editors/core/registry";

// I riquadri e la modalità li tiene il controller: qui un doppio che ne ha
// soltanto le tre domande che il menu fa, e che si segna in quale riquadro
// `setMode` cambia, leggendo `layout.focus` come il vero.
const fake = vi.hoisted(() => ({
  panes: new Map<string, { id: string; surface?: { modes: readonly SurfaceMode[] }; mode?: string }>(),
  calls: [] as [string, string][],
}));
vi.mock("./document-controller", async () => {
  const layout = await import("./layout");
  return {
    paneOf: (id: string) => fake.panes.get(id),
    selectedMode: (r: { surface?: { modes: readonly SurfaceMode[] }; mode?: string } | undefined) =>
      r?.surface?.modes.find((mode) => mode.id === r.mode) ?? r?.surface?.modes[0],
    setMode: async (mode: string) => {
      fake.calls.push([layout.layout.focus, mode]);
    },
  };
});

/// Le scorciatoie cambiate dalla persona arrivano dalle impostazioni.
const fromBackend = vi.fn(async (): Promise<SettingEntry[]> => []);
vi.mock("../host/query", async (original) => ({
  ...(await original<typeof import("../host/query")>()),
  settings: () => fromBackend(),
}));

import { MARKDOWN_MODES } from "../editors/text/profiles/markdown/surface";
import { SVG_MODES } from "../editors/text/profiles/svg";
import { RICH_MODES } from "../editors/rich/surface";
import { useRichIcons } from "../editors/rich/icons";
import { PDF_MODES, VECTOR_MODES } from "../editors/spatial/modes";
import { loadKeyOverrides, registerShellCommand, resetShellCommands } from "../ui/commands";
import { icon, registerIcon } from "../ui/icons";
import { closeContextMenu } from "../ui/menu";
import { defaultLayout, layout, setLayout, split } from "./layout";
import { modeIcon, modeMenuItems, openModeMenu } from "./mode-menu";

function settingEntry(key: string, value: string): SettingEntry {
  return {
    spec: {
      key,
      label: key,
      description: "",
      group: "",
      scope: "machine",
      kind: { kind: "text", default: "" },
      program_writable: false,
    },
    value,
    source: "machine",
  } as SettingEntry;
}

/// I quattro comandi delle modalità, con gli accordi della tabella generata.
/// I veri li registra il controller, che qui è un doppio.
function registerModeCommands(): void {
  for (const id of ["shell.mode.reading", "shell.mode.live", "shell.mode.source", "shell.mode.blocks"] as const) {
    registerShellCommand({ id, title: "commands.mode.live", description: "commands.mode.live.desc", layer: "profile", run: () => {} });
  }
}

function paneWith(id: string, modes: readonly SurfaceMode[], mode?: string): void {
  fake.panes.set(id, { id, surface: { modes }, mode });
}

const labels = (paneId: string) => modeMenuItems(paneId).map((item) => item.label);
const separators = (paneId: string) => modeMenuItems(paneId).flatMap((item, index) => (item.separator ? [index] : []));

beforeEach(async () => {
  fake.panes.clear();
  fake.calls.length = 0;
  setLayout(defaultLayout());
  resetShellCommands();
  registerModeCommands();
  fromBackend.mockResolvedValue([]);
  await loadKeyOverrides();
  document.body.innerHTML = "";
});

afterEach(() => {
  closeContextMenu();
});

describe("l'ordine del menu delle modalità", () => {
  it("Markdown: Live, Blocchi, Sorgente, poi la riga e Lettura", () => {
    paneWith(layout.focus, MARKDOWN_MODES);
    expect(labels(layout.focus)).toEqual(["Live", "Blocchi", "Sorgente", "Lettura"]);
    expect(separators(layout.focus)).toEqual([3]);
  });

  it("SVG: Diviso, Sorgente, la riga, Anteprima", () => {
    paneWith(layout.focus, SVG_MODES);
    expect(labels(layout.focus)).toEqual(["Diviso", "Sorgente", "Anteprima"]);
    expect(separators(layout.focus)).toEqual([2]);
  });

  it("il documento: Pagina, Scrittura, la riga, Lettura", () => {
    paneWith(layout.focus, RICH_MODES);
    expect(labels(layout.focus)).toEqual(["Pagina", "Scrittura", "Lettura"]);
    expect(separators(layout.focus)).toEqual([2]);
  });

  it("il disegno: Disegno, la riga, Lettura; le annotazioni: Annota, la riga, Lettura", () => {
    paneWith(layout.focus, VECTOR_MODES);
    expect(labels(layout.focus)).toEqual(["Disegno", "Lettura"]);
    expect(separators(layout.focus)).toEqual([1]);
    paneWith(layout.focus, PDF_MODES);
    expect(labels(layout.focus)).toEqual(["Annota", "Lettura"]);
  });

  it("senza lettura non c'è la riga", () => {
    paneWith(layout.focus, MARKDOWN_MODES.filter((mode) => mode.contextMode !== "reading"));
    expect(labels(layout.focus)).toEqual(["Live", "Blocchi", "Sorgente"]);
    expect(separators(layout.focus)).toEqual([]);
  });

  it("una modalità sola, o nessun riquadro: nessuna voce", () => {
    paneWith(layout.focus, [MARKDOWN_MODES[0]!]);
    expect(modeMenuItems(layout.focus)).toEqual([]);
    expect(modeMenuItems("nessuno")).toEqual([]);
  });

  it("la voce accesa è scelta e segnata, le altre no; ognuna è una scelta fra alternative", () => {
    paneWith(layout.focus, MARKDOWN_MODES, "blocks");
    const items = modeMenuItems(layout.focus);
    expect(items.every((item) => item.choice === "radio")).toBe(true);
    expect(items.filter((item) => item.checked).map((item) => item.label)).toEqual(["Blocchi"]);
    expect(items.filter((item) => item.selected).map((item) => item.label)).toEqual(["Blocchi"]);
  });
});

describe("le icone delle modalità", () => {
  it("le dichiarate, e per le altre quella del ruolo", () => {
    paneWith(layout.focus, MARKDOWN_MODES);
    expect(modeMenuItems(layout.focus).map((item) => item.icon)).toEqual(["pen", "blocks", "code", "eye"]);
    paneWith(layout.focus, VECTOR_MODES);
    expect(modeMenuItems(layout.focus).map((item) => item.icon)).toEqual(["pen", "eye"]);
  });

  it("il Diviso dell'SVG ha `split`, che disegna la cornice; senza la cornice, la penna del suo ruolo", () => {
    paneWith(layout.focus, SVG_MODES);
    expect(modeMenuItems(layout.focus).map((item) => item.icon)).toEqual(["pen", "code", "eye"]);
    const retire = registerIcon("split", ["M5 4h14v16H5z", "M12 4v16"]);
    try {
      expect(modeMenuItems(layout.focus).map((item) => item.icon)).toEqual(["split", "code", "eye"]);
    } finally {
      retire();
    }
  });

  it("il documento ha le sue, quando il documento le ha registrate", () => {
    paneWith(layout.focus, RICH_MODES);
    const retire = useRichIcons();
    try {
      expect(modeMenuItems(layout.focus).map((item) => item.icon)).toEqual(["rc-mode-page", "rc-mode-writing", "rc-mode-reading"]);
    } finally {
      retire();
    }
  });

  it("un'icona che il set non sa disegnare vale quella del ruolo", () => {
    const mode: SurfaceMode = { ...MARKDOWN_MODES[1]!, icon: "nessuna-figura" };
    expect(modeIcon(mode)).toBe("pen");
    expect(modeIcon({ ...MARKDOWN_MODES[0]!, icon: undefined })).toBe("code");
  });

  it("ogni icona di serie delle modalità e del cassetto si disegna", () => {
    for (const name of ["pen", "blocks", "code", "eye", "compose", "sort", "clock", "chevron-up"]) {
      expect(icon(name), name).not.toBe("");
    }
  });
});

describe("le scorciatoie delle modalità", () => {
  it("sono quelle dei comandi: Blocchi e Lettura hanno un tasto, Live e Sorgente no", () => {
    paneWith(layout.focus, MARKDOWN_MODES);
    const hints = Object.fromEntries(modeMenuItems(layout.focus).map((item) => [item.label, item.hint]));
    expect(hints).toEqual({ Live: undefined, Blocchi: "Ctrl+Shift+B", Sorgente: undefined, Lettura: "Ctrl+E" });
  });

  it("una scorciatoia cambiata dalla persona compare al posto della dichiarata", async () => {
    fromBackend.mockResolvedValue([settingEntry("keys.shell.mode.source", "Mod-Alt-s"), settingEntry("keys.shell.mode.reading", "")]);
    await loadKeyOverrides();
    paneWith(layout.focus, MARKDOWN_MODES);
    const hints = Object.fromEntries(modeMenuItems(layout.focus).map((item) => [item.label, item.hint]));
    expect(hints).toEqual({ Live: undefined, Blocchi: "Ctrl+Shift+B", Sorgente: "Ctrl+Alt+S", Lettura: undefined });
  });

  it("del documento solo la prima scrittura porta il tasto della Live", async () => {
    fromBackend.mockResolvedValue([settingEntry("keys.shell.mode.live", "Mod-Alt-l")]);
    await loadKeyOverrides();
    paneWith(layout.focus, RICH_MODES);
    expect(modeMenuItems(layout.focus).map((item) => item.hint)).toEqual(["Ctrl+Alt+L", undefined, "Ctrl+E"]);
  });
});

describe("la scelta cambia il riquadro del menu", () => {
  it("il riquadro senza fuoco, col bottone che non prende il fuoco: cambia lui e non l'altro", () => {
    const left = layout.focus;
    const right = split(left, "row")!;
    paneWith(left, MARKDOWN_MODES);
    paneWith(right, MARKDOWN_MODES);
    expect(layout.focus).toBe(right);
    const anchor = document.createElement("button");
    document.body.append(anchor);
    openModeMenu(anchor, left);
    expect(layout.focus).toBe(left);
    expect(anchor.getAttribute("aria-expanded")).toBe("true");
    // Il menu, chiudendosi, rende il fuoco all'editor dell'altro riquadro.
    const sorgente = [...document.querySelectorAll<HTMLElement>("#context-menu [role=menuitemradio]")]
      .find((item) => item.querySelector(".menu-label")?.textContent === "Sorgente")!;
    layout.focus = right;
    sorgente.click();
    expect(fake.calls).toEqual([[left, "source"]]);
    expect(anchor.getAttribute("aria-expanded")).toBe("false");
  });

  it("il riquadro chiuso col menu aperto: la voce non fa niente e non lancia", () => {
    const left = layout.focus;
    paneWith(left, MARKDOWN_MODES);
    const items = modeMenuItems(left);
    fake.panes.delete(left);
    expect(() => items[2]!.run!()).not.toThrow();
    expect(fake.calls).toEqual([]);
  });

  it("chiuso senza scegliere, l'ancora torna chiusa e `onClose` lo sa", () => {
    paneWith(layout.focus, MARKDOWN_MODES);
    const anchor = document.createElement("button");
    document.body.append(anchor);
    const onClose = vi.fn();
    openModeMenu(anchor, layout.focus, { onClose });
    closeContextMenu();
    expect(anchor.getAttribute("aria-expanded")).toBe("false");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fake.calls).toEqual([]);
  });
});
