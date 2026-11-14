// @vitest-environment happy-dom
//
// Installare un tema da una cartella, e leggere perché è rifiutato (PA T36):
// il bottone c'è solo con la modalità sviluppatore, il tema installato entra
// in «Temi installati» con la fiducia «Della comunità», un id già installato
// chiede «Sostituisci», una sostituzione fallita a metà lo dice, e un tema
// rifiutato (dal loader o dall'host) mostra una riga per motivo.
//
// Il catalogo dei temi è quello vero (`theme/theme.ts` col cancello del
// loader), servito dall'host finto: il rifiuto del loader è quello vero.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginError, SettingEntry } from "../host/contract";
import type { FakeHost, ThemeFolderFake } from "../host/fake";

const box = vi.hoisted(() => ({
  host: null as FakeHost | null,
  folder: null as string | null,
  notify: vi.fn(),
  clipboard: vi.fn(async (_text: string) => {}),
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
vi.mock("../host/dialog", () => ({
  confirm: () => Promise.resolve(true),
  pickFile: () => Promise.resolve(null),
  pickFolder: () => Promise.resolve(box.folder),
}));
vi.mock("../state/kernel", () => ({ onEvent: vi.fn() }));
vi.mock("../ui/commands", () => ({
  allCommands: () => [],
  keybindingKey: (id: string) => id,
  newKinds: () => ["note"],
  registerComponentRow: () => () => {},
  showComponent: () => false,
}));
vi.mock("../ui/motion", () => ({
  enterSurface: () => {},
  exitSurface: (_element: HTMLElement, done: () => void) => done(),
}));
vi.mock("../ui/tooltip", () => ({ setTooltip: () => {} }));
vi.mock("../ui/notify", () => ({ notify: box.notify, reportThemeTrouble: vi.fn() }));
vi.mock("../platform/clipboard", () => ({ writeClipboardText: box.clipboard }));

const { createFakeHost, developerModeSetting, folderTheme, rejectedTheme } = await import("../host/fake");
const { mountSettings } = await import("./settings");
const { reloadThemeCatalog } = await import("../theme/theme");
const { diagnosisRows, forgetThemeRefusal, refusalRow } = await import("./theme-folder");

function themeEntry(): SettingEntry {
  return {
    spec: {
      key: "appearance.theme",
      label: "Tema",
      description: "",
      group: "Aspetto",
      scope: "machine",
      kind: {
        kind: "choice",
        default: "",
        options: [
          { value: "", label: "Come il sistema" },
          { value: "light", label: "Chiaro" },
          { value: "dark", label: "Scuro" },
        ],
      },
      program_writable: false,
    },
    value: "light",
    source: "machine",
  };
}

async function open(options: {
  developer: boolean;
  folders?: Record<string, ThemeFolderFake | PluginError>;
  installed?: ThemeFolderFake[];
}): Promise<void> {
  document.querySelector<HTMLButtonElement>("#settings-close")?.click();
  const installed = options.installed ?? [];
  box.host = createFakeHost({
    settings: [themeEntry(), developerModeSetting(options.developer)],
    themes: installed.map((theme) => theme.info),
    themePayloads: Object.assign({}, ...installed.map((theme) => theme.payloads)),
    themeFolders: options.folders ?? {},
  });
  await reloadThemeCatalog();
  document.body.innerHTML = `
    <button id="open-settings"></button>
    <section id="settings-panel" hidden>
      <div id="settings-tabs"><button data-tab="settings"></button></div>
      <button id="settings-close"></button>
      <div id="settings-body"></div>
    </section>`;
  mountSettings({ openVault: async () => {}, reloadProvider: async () => {} });
  document.querySelector<HTMLButtonElement>("#open-settings")!.click();
  await vi.waitFor(() => expect(document.querySelector('[data-setting-key="developer.mode"]')).not.toBeNull());
}

const installButton = () => document.querySelector<HTMLButtonElement>('[data-dev-action="install"]');
const catalogOptions = () =>
  [...document.querySelectorAll<HTMLButtonElement>("[data-theme-catalog] [role=radio]")].map(
    (radio) => radio.textContent,
  );
const dialog = () => document.querySelector<HTMLElement>(".kit-dialog");
const diagnoses = () => [...document.querySelectorAll<HTMLElement>(".tema-diagnosi")];
const rowsOf = (block: HTMLElement) =>
  [...block.querySelectorAll(".tema-diagnosi-riga")].map((row) =>
    [...row.children].map((cell) => cell.textContent),
  );

beforeEach(() => {
  vi.clearAllMocks();
  forgetThemeRefusal();
  box.folder = null;
  document.documentElement.dataset.theme = "light";
});

describe("installare un tema da una cartella", () => {
  it("il bottone c'è solo con la modalità sviluppatore accesa", async () => {
    await open({ developer: false });
    expect(installButton()).toBeNull();

    await open({ developer: true });
    expect(installButton()?.textContent).toBe("Installa da cartella…");
    // Senza temi installati il blocco c'è lo stesso: è da qui che se ne installa uno.
    expect(document.querySelector("[data-theme-catalog]")!.textContent).toContain("Nessun tema installato");
  });

  it("il tema installato entra in «Temi installati» con la fiducia «Della comunità»", async () => {
    await open({ developer: true, folders: { "/temi/carta": folderTheme("acme.carta", "Carta", "0.3.2") } });
    box.folder = "/temi/carta";
    installButton()!.click();

    await vi.waitFor(() => expect(catalogOptions()).toContain("Carta · chiaro · Della comunità"));
    expect(catalogOptions()).toContain("Carta · scuro · Della comunità");
    expect(box.notify).toHaveBeenCalledWith("«Carta» installato: lo trovi fra i temi installati.", "info");
    expect(box.host!.calls.filter((call) => call.gate === "installThemeFromFolder").map((call) => call.args)).toEqual([
      ["/temi/carta", false],
    ]);
    expect(diagnoses()).toEqual([]);
  });

  it("annullare la scelta della cartella non chiede niente all'host", async () => {
    await open({ developer: true });
    box.folder = null;
    installButton()!.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(box.host!.calls.some((call) => call.gate === "installThemeFromFolder")).toBe(false);
  });

  it("un id già installato chiede «Sostituisci», e Sostituisci installa il nuovo", async () => {
    await open({
      developer: true,
      installed: [folderTheme("acme.carta", "Carta", "0.3.2")],
      folders: { "/temi/carta": folderTheme("acme.carta", "Carta", "0.4.0") },
    });
    box.folder = "/temi/carta";
    installButton()!.click();

    await vi.waitFor(() => expect(dialog()).not.toBeNull());
    expect(dialog()!.querySelector(".kit-dialog-title")!.textContent).toBe("«Carta» è già installato");
    expect(dialog()!.querySelector(".kit-dialog-description")!.textContent).toBe(
      "La cartella /temi/carta ha lo stesso id, «acme.carta», con la versione 0.4.0 (installata: 0.3.2). La cartella nuova è già controllata: si può sostituire.",
    );
    dialog()!.querySelector<HTMLButtonElement>('[data-action="replace"]')!.click();

    await vi.waitFor(() =>
      expect(box.notify).toHaveBeenCalledWith("«Carta» sostituito con la versione 0.4.0.", "info"),
    );
    expect(box.host!.calls.filter((call) => call.gate === "installThemeFromFolder").map((call) => call.args)).toEqual([
      ["/temi/carta", false],
      ["/temi/carta", true],
    ]);
    expect(await box.host!.module.api.listThemes()).toEqual([
      expect.objectContaining({ manifest: expect.objectContaining({ version: "0.4.0" }) }),
    ]);
  });

  it("Annulla davanti alla collisione non tocca niente", async () => {
    await open({
      developer: true,
      installed: [folderTheme("acme.carta", "Carta", "0.3.2")],
      folders: { "/temi/carta": folderTheme("acme.carta", "Carta", "0.4.0") },
    });
    box.folder = "/temi/carta";
    installButton()!.click();
    await vi.waitFor(() => expect(dialog()).not.toBeNull());
    dialog()!.querySelector<HTMLButtonElement>('[data-action="cancel"]')!.click();

    await vi.waitFor(() => expect(dialog()).toBeNull());
    expect(box.host!.calls.filter((call) => call.gate === "installThemeFromFolder")).toHaveLength(1);
    expect((await box.host!.module.api.listThemes())[0]!.manifest.version).toBe("0.3.2");
  });

  it("la sostituzione fallita a metà lo dice, e la cartella resta", async () => {
    const failing = {
      ...folderTheme("acme.carta", "Carta", "0.4.0"),
      replaceError: { kind: "io", message: "I/O error: No space left on device" } as PluginError,
    };
    await open({
      developer: true,
      installed: [folderTheme("acme.carta", "Carta", "0.3.2")],
      folders: { "/temi/carta": failing },
    });
    box.folder = "/temi/carta";
    installButton()!.click();
    await vi.waitFor(() => expect(dialog()).not.toBeNull());
    dialog()!.querySelector<HTMLButtonElement>('[data-action="replace"]')!.click();

    await vi.waitFor(() => expect(dialog()?.getAttribute("role")).toBe("alertdialog"));
    expect(dialog()!.querySelector(".kit-dialog-title")!.textContent).toBe("«Carta» non si è installato");
    expect(dialog()!.querySelector(".kit-dialog-description")!.textContent).toBe(
      "Il tema vecchio è stato tolto, il nuovo si è fermato: I/O error: No space left on device. La cartella /temi/carta resta dov'è, quindi non hai perso niente: installalo di nuovo.",
    );
    dialog()!.querySelector<HTMLButtonElement>('[data-action="ok"]')!.click();
    await vi.waitFor(() => expect(dialog()).toBeNull());
    expect(catalogOptions()).toEqual([]);
  });

  it("la modalità spenta mentre la finestra di scelta è aperta: l'host rifiuta e lo si dice", async () => {
    await open({ developer: true, folders: { "/temi/carta": folderTheme() } });
    // La chiave si spegne dopo il disegno del bottone, prima della risposta.
    await box.host!.module.api.setSetting("developer.mode", false);
    box.folder = "/temi/carta";
    installButton()?.click();

    await vi.waitFor(() =>
      expect(box.notify).toHaveBeenCalledWith(
        "La modalità sviluppatore è spenta: accendila nel gruppo «Sviluppo» per installare da una cartella.",
        "guasto",
      ),
    );
    expect(await box.host!.module.api.listThemes()).toEqual([]);
  });
});

describe("la diagnosi di un tema rifiutato", () => {
  it("un tema che il loader rifiuta: una riga per motivo, con role=alert e «Copia la diagnosi»", async () => {
    await open({ developer: true, folders: { "/temi/rotto": rejectedTheme() } });
    expect(diagnoses()).toEqual([]);
    box.folder = "/temi/rotto";
    installButton()!.click();

    await vi.waitFor(() => expect(diagnoses().length).toBeGreaterThan(0));
    const [block] = diagnoses();
    expect(block!.getAttribute("role")).toBe("alert");
    expect(block!.querySelector(".setting-label")!.textContent).toMatch(/^«Rotto» è rifiutato: \d+ motivi$/);
    const rows = rowsOf(block!);
    expect(rows).toContainEqual(["manifest.json", "—", "manifest", "engine theme-1 incompatibile, serve theme-2"]);
    expect(rows.some(([file, where, code]) => file === "skin.css" && /^\d+:\d+$/.test(where!) && code !== "")).toBe(true);
    // Il tema resta fuori dal catalogo.
    expect(catalogOptions()).toEqual([]);

    block!.querySelector<HTMLButtonElement>(".settings-actions button")!.click();
    await vi.waitFor(() => expect(box.clipboard).toHaveBeenCalledTimes(1));
    const copied = box.clipboard.mock.calls[0]![0];
    expect(copied).toContain("«Rotto» è rifiutato");
    expect(copied).toContain("- manifest: engine theme-1 incompatibile, serve theme-2");
  });

  it("una cartella che l'host rifiuta (senza manifest.json) è una diagnosi di una riga", async () => {
    const refusal: PluginError = {
      kind: "bad_args",
      message: "invalid arguments: malformed theme manifest: missing theme file `/temi/vuota/manifest.json`",
    };
    await open({ developer: true, folders: { "/temi/vuota": refusal } });
    box.folder = "/temi/vuota";
    installButton()!.click();

    await vi.waitFor(() => expect(diagnoses()).toHaveLength(1));
    const [block] = diagnoses();
    expect(block!.querySelector(".setting-label")!.textContent).toBe("«vuota» è rifiutato: 1 motivo");
    expect(rowsOf(block!)).toEqual([["manifest.json", "—", "bad_args", refusal.message]]);
  });

  it("senza rifiuti la diagnosi non c'è", async () => {
    await open({ developer: false, installed: [folderTheme()] });
    expect(diagnoses()).toEqual([]);
    expect(catalogOptions()).toContain("Carta · chiaro · Della comunità");
  });
});

describe("i motivi si dividono in campi, non si riscrivono", () => {
  it("una violazione della pelle o del foglio, un motivo del manifest, un motivo senza file", () => {
    expect(
      diagnosisRows(
        [
          "pelle: selector-hook (12:3): hook .carta-titolo non dichiarato",
          "foglio: role-missing (1:1): ruolo --muted mancante",
          "manifest: engine theme-1 incompatibile, serve theme-2",
          "contrasto: --muted su --sheet è 3.10:1, sotto 4.5:1 (testo)",
          "fascio non leggibile: tema non leggibile: acme.x:light",
          "senza canale",
        ],
        "dark",
      ),
    ).toEqual([
      { file: "skin.css", where: "12:3", code: "selector-hook", why: "hook .carta-titolo non dichiarato" },
      { file: "sheet-dark.css", where: "1:1", code: "role-missing", why: "ruolo --muted mancante" },
      { file: "manifest.json", where: null, code: "manifest", why: "engine theme-1 incompatibile, serve theme-2" },
      { file: "sheet-dark.css", where: null, code: "contrasto", why: "--muted su --sheet è 3.10:1, sotto 4.5:1 (testo)" },
      { file: null, where: null, code: "fascio non leggibile", why: "tema non leggibile: acme.x:light" },
      { file: null, where: null, code: "", why: "senza canale" },
    ]);
  });

  it("il rifiuto dell'host porta il suo tipo, e il file quando il messaggio lo nomina", () => {
    expect(refusalRow({ kind: "io", message: "I/O error: /x/skin.css: permission denied" })).toEqual({
      file: "skin.css",
      where: null,
      code: "io",
      why: "I/O error: /x/skin.css: permission denied",
    });
    expect(refusalRow({ kind: "bad_args", message: "`acme` contains `/x/escape`, which escapes" }).file).toBeNull();
  });
});
