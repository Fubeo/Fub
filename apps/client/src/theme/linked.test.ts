// @vitest-environment happy-dom
//
// Il tema collegato (PA T37): l'autore collega la cartella del suo tema in
// modalità sviluppatore, e a ogni salvataggio l'host suona
// `fub://theme-changed`. `theme/theme.ts` rilegge il tema in sviluppo, lo
// passa dal cancello della shell e, solo se regge, lo rimonta. Qui si prova
// ciò che la persona vede: un salvataggio rotto lascia montato l'ultimo buono
// e la diagnosi lo dice; la cartella sparita torna alla serie con un avviso;
// cinquanta salvataggi di fila non fanno cinquanta rimontaggi in volo; il
// campanello si stacca quando il montaggio del tema finisce.
//
// Il catalogo e il cancello sono quelli veri; l'host è il finto, con la
// cartella collegata che si può cambiare fra un campanello e l'altro.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry, ThemeInfo, ThemePayload } from "../host/contract";
import type { FakeHost, ThemeFolderFake } from "../host/fake";

const box = vi.hoisted(() => ({
  host: null as FakeHost | null,
  notify: vi.fn(),
  trouble: vi.fn(),
}));

vi.mock("../host/ipc", () => ({
  api: new Proxy(
    {},
    {
      get: (_target, name: string) => (...args: unknown[]) => {
        if (!box.host) throw new Error("host finto non montato");
        const method = box.host.module.api[name as keyof typeof box.host.module.api] as (
          ...values: unknown[]
        ) => unknown;
        return method(...args);
      },
    },
  ),
}));
vi.mock("../state/kernel", () => ({ onEvent: () => () => {} }));
vi.mock("../ui/notify", () => ({ notify: box.notify, reportThemeTrouble: box.trouble }));

const { createFakeHost, developerModeSetting, extendingTheme } = await import("../host/fake");
const { currentThemeId, linkedTheme, mountTheme, themeFolderChanged } = await import("./theme");
const { openLifetime } = await import("../ui/lifetime");
const { linkedDiagnosis } = await import("../panels/theme-folder");

const FOLDER = "/temi/carta";
const ID = "acme.carta";

/// Il tema della cartella, con un segno nella pelle per riconoscere quale
/// versione è montata.
function carta(mark: string, skin = `.shell-tooltip { white-space: nowrap; }\n/* ${mark} */\n`): ThemeFolderFake {
  const manifest: ThemeInfo["manifest"] = { ...extendingTheme(ID).info.manifest, name: "Carta", version: "0.1.0" };
  const payload = (light: "light" | "dark"): ThemePayload => ({ manifest, light, sheet: null, skin, assets: {} });
  return {
    info: { manifest, trust: "community" },
    payloads: { [`${ID}:light`]: payload("light"), [`${ID}:dark`]: payload("dark") },
  };
}

/// Un salvataggio a metà: la pelle usa un hook che l'anatomia non dichiara.
function broken(): ThemeFolderFake {
  return carta("rotto", ".rotto-titolo { color: red; }\n/* rotto */\n");
}

function entry(key: string, value: string): SettingEntry {
  return {
    spec: {
      key,
      label: key,
      description: "",
      group: "Aspetto",
      scope: "machine",
      kind: { kind: "text", default: "" },
      program_writable: false,
    },
    value,
    source: "machine",
  };
}

type Folders = Record<string, ThemeFolderFake>;

function start(folders: Folders, linked: string | null = FOLDER) {
  box.host = createFakeHost({
    settings: [developerModeSetting(true), entry("appearance.theme", "light"), entry("appearance.theme-id", ID)],
    themeFolders: folders,
    linkedThemeFolder: linked,
  });
  const lifetime = openLifetime();
  mountTheme(lifetime, () => {});
  return lifetime;
}

const skin = () => document.head.querySelector('style[data-fub="pelle-tema"]')?.textContent ?? "";
const settle = () => vi.waitFor(() => expect(linkedTheme()?.goodAt ?? null).not.toBeNull());

beforeEach(() => {
  vi.clearAllMocks();
  document.head.innerHTML = "";
  document.documentElement.dataset.theme = "light";
  localStorage.clear();
});

describe("il tema collegato si rimonta a ogni salvataggio", () => {
  it("un salvataggio buono rimonta il tema e la riga dice dopo quale file", async () => {
    const folders: Folders = { [FOLDER]: carta("v1") };
    const lifetime = start(folders);
    await vi.waitFor(() => expect(skin()).toContain("v1"));
    await settle();
    expect(currentThemeId()).toBe(ID);

    folders[FOLDER] = carta("v2");
    expect(box.host!.themeFolderChanged(["skin.css"])).toBe(true);

    await vi.waitFor(() => expect(skin()).toContain("v2"));
    expect(linkedTheme()!.reloaded?.changed).toEqual(["skin.css"]);
    expect(linkedTheme()!.attemptAt).toBeNull();
    expect(linkedDiagnosis(linkedTheme())).toBeNull();
    lifetime.close();
  });

  it("un fascio rifiutato a metà salvataggio lascia montato l'ultimo buono, e la diagnosi lo dice", async () => {
    const folders: Folders = { [FOLDER]: carta("v1") };
    const lifetime = start(folders);
    await vi.waitFor(() => expect(skin()).toContain("v1"));
    await settle();
    const goodAt = linkedTheme()!.goodAt!;

    folders[FOLDER] = broken();
    box.host!.themeFolderChanged(["skin.css"]);

    await vi.waitFor(() => expect(linkedTheme()!.rejection).not.toBeNull());
    // Il tema in uso non cambia: la pelle è ancora quella di prima.
    expect(skin()).toContain("v1");
    expect(skin()).not.toContain("rotto");
    expect(currentThemeId()).toBe(ID);
    expect(box.notify).toHaveBeenCalledWith(expect.stringContaining("Carta"), "guasto");

    const diagnosis = linkedDiagnosis(linkedTheme())!;
    expect(diagnosis.name).toBe("Carta");
    expect(diagnosis.lastGood).toBe(goodAt);
    expect(diagnosis.mounted).toBe(true);
    expect(diagnosis.text.some((reason) => reason.includes(".rotto-titolo"))).toBe(true);

    // Il salvataggio dopo, sistemato, rimonta e la diagnosi sparisce.
    folders[FOLDER] = carta("v3");
    box.host!.themeFolderChanged(["skin.css"]);
    await vi.waitFor(() => expect(skin()).toContain("v3"));
    expect(linkedDiagnosis(linkedTheme())).toBeNull();
    lifetime.close();
  });

  it("la cartella sparita torna alla serie e lo dice una volta", async () => {
    const folders: Folders = { [FOLDER]: carta("v1") };
    const lifetime = start(folders);
    await vi.waitFor(() => expect(skin()).toContain("v1"));
    await settle();

    delete folders[FOLDER];
    box.host!.themeFolderChanged([]);

    await vi.waitFor(() => expect(skin()).not.toContain("v1"));
    expect(linkedTheme()!.link.state).toBe("missing");
    const missing = box.notify.mock.calls.filter(([, kind]) => kind === "guasto");
    expect(missing).toHaveLength(1);
    expect(String(missing[0]![0])).toContain("non c'è più");
    lifetime.close();
  });

  it("all'avvio una cartella collegata che non c'è più si dice, e l'avvio non si ferma", async () => {
    const lifetime = start({});
    await vi.waitFor(() =>
      expect(box.notify).toHaveBeenCalledWith(expect.stringContaining(FOLDER), "guasto"),
    );
    expect(document.head.querySelector('style[data-fub="foglio"]')).not.toBeNull();
    lifetime.close();
  });

  it("cinquanta salvataggi di fila: al più un rimontaggio in volo, e l'ultimo vince", async () => {
    const folders: Folders = { [FOLDER]: carta("v1") };
    const lifetime = start(folders);
    await vi.waitFor(() => expect(skin()).toContain("v1"));
    await settle();
    const reads = () => box.host!.calls.filter((call) => call.gate === "listThemes").length;
    const before = reads();

    for (let save = 0; save < 50; save += 1) {
      folders[FOLDER] = carta(`s${save}`);
      box.host!.themeFolderChanged(["skin.css"]);
    }

    await vi.waitFor(() => expect(skin()).toContain("s49"));
    // Il primo in volo, e al più uno che aspetta: l'ultimo.
    expect(reads() - before).toBeLessThanOrEqual(2);
    lifetime.close();
  });

  it("chiuso il montaggio del tema, il campanello non c'è più", async () => {
    const folders: Folders = { [FOLDER]: carta("v1") };
    const first = start(folders);
    await vi.waitFor(() => expect(box.host!.calls.some((call) => call.gate === "onThemeChanged")).toBe(true));
    await settle();
    first.close();
    expect(box.host!.themeFolderChanged(["skin.css"])).toBe(false);

    // Un secondo montaggio ha il suo campanello, uno solo.
    const second = openLifetime();
    mountTheme(second, () => {});
    await vi.waitFor(() => expect(box.host!.themeFolderChanged([])).toBe(true));
    second.close();
    expect(box.host!.themeFolderChanged([])).toBe(false);
  });

  it("un campanello arrivato dopo uno scollegamento non rimonta niente", async () => {
    const folders: Folders = { [FOLDER]: carta("v1") };
    const lifetime = start(folders);
    await vi.waitFor(() => expect(skin()).toContain("v1"));
    await settle();
    const stale = { ...(await box.host!.module.api.themeLink())!, changed: ["skin.css"] };
    const { themeLinkChanged } = await import("./theme");
    await box.host!.module.api.unlinkThemeFolder();
    await themeLinkChanged(null);
    folders[FOLDER] = carta("vecchio");
    await themeFolderChanged(stale);
    expect(skin()).not.toContain("vecchio");
    expect(linkedTheme()).toBeNull();
    lifetime.close();
  });
});
