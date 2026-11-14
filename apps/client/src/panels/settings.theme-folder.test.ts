// @vitest-environment happy-dom
//
// Installare un tema da una cartella, e leggere perché è rifiutato (PA T36):
// il bottone c'è solo con la modalità sviluppatore, la cartella la sceglie la
// persona nella finestra nativa (la shell non passa path), il tema installato
// entra in «Temi installati» con la fiducia «Della comunità», un id già
// installato chiede «Sostituisci» (uno revocato no), una sostituzione che si
// ferma lascia il vecchio (o lo dice, se il vecchio non torna), e un tema
// rifiutato (dal cancello del catalogo o dall'host, con un motivo tipizzato)
// non arriva nella cartella dei temi: mostra una riga per motivo e un avviso
// solo.
//
// Il catalogo dei temi è quello vero (`theme/theme.ts` col cancello del
// loader), servito dall'host finto: il rifiuto del loader è quello vero.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginError, SettingEntry, ThemeBlock, ThemeFolderRefusal } from "../host/contract";
import type { FakeHost, ThemeFolderFake } from "../host/fake";

const box = vi.hoisted(() => ({
  host: null as FakeHost | null,
  folder: null as string | null,
  teardown: null as (() => void) | null,
  notify: vi.fn(),
  tooltip: vi.fn(),
  trouble: vi.fn(),
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
  // La cartella del tema non passa da qui: la sceglie la finestra nativa che
  // l'app apre dentro `check_theme_folder` (`pickThemeFolder` del finto).
  pickFolder: () => Promise.reject(new Error("pickFolder non serve all'installazione da cartella")),
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
vi.mock("../ui/tooltip", () => ({ setTooltip: box.tooltip }));
vi.mock("../ui/notify", () => ({ notify: box.notify, reportThemeTrouble: box.trouble }));
vi.mock("../platform/clipboard", () => ({ writeClipboardText: box.clipboard }));

const { createFakeHost, developerModeSetting, folderTheme, rejectedTheme } = await import("../host/fake");
const { mountSettings } = await import("./settings");
const { currentThemeId, reloadThemeCatalog, themeCatalog } = await import("../theme/theme");
const { settings } = await import("../host/query");
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

/// La scelta salvata del tema (`appearance.theme-id`), scritta dalle Impostazioni.
function themeIdEntry(id: string): SettingEntry {
  return {
    spec: {
      key: "appearance.theme-id",
      label: "Tema scelto",
      description: "",
      group: "Aspetto",
      scope: "machine",
      kind: { kind: "text", default: "fub.serie" },
      program_writable: false,
    },
    value: id,
    source: "machine",
  };
}

async function open(options: {
  developer: boolean;
  folders?: Record<string, ThemeFolderFake | ThemeFolderRefusal | PluginError>;
  installed?: ThemeFolderFake[];
  revoked?: string[];
  blocked?: Record<string, ThemeBlock>;
  inUse?: string;
}): Promise<void> {
  document.querySelector<HTMLButtonElement>("#settings-close")?.click();
  const installed = options.installed ?? [];
  box.host = createFakeHost({
    settings: [
      themeEntry(),
      developerModeSetting(options.developer),
      ...(options.inUse ? [themeIdEntry(options.inUse)] : []),
    ],
    themes: installed.map((theme) => theme.info),
    themePayloads: Object.assign({}, ...installed.map((theme) => theme.payloads)),
    themeFolders: options.folders ?? {},
    revokedThemes: options.revoked,
    blockedThemes: options.blocked,
    pickThemeFolder: () => box.folder,
  });
  await reloadThemeCatalog();
  document.body.innerHTML = `
    <button id="open-settings"></button>
    <section id="settings-panel" hidden>
      <div id="settings-tabs"><button data-tab="settings"></button></div>
      <button id="settings-close"></button>
      <div id="settings-body"></div>
    </section>`;
  box.teardown = mountSettings({ openVault: async () => {}, reloadProvider: async () => {} });
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
const gates = (gate: string) => box.host!.calls.filter((call) => call.gate === gate).map((call) => call.args);
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
    // Prima la scelta nella finestra nativa e la lettura senza scrivere, poi
    // l'installazione con la sua impronta: la shell non passa mai un path.
    const digest = expect.stringMatching(/^fake-/);
    // Il titolo della finestra non lo dà la shell: lo scrive l'host.
    expect(gates("checkThemeFolder")).toEqual([[]]);
    expect(gates("installThemeFromFolder")).toEqual([[false, digest]]);
    expect(diagnoses()).toEqual([]);
  });

  it("annullare la scelta della cartella non installa niente e non dice niente", async () => {
    await open({ developer: true });
    box.folder = null;
    installButton()!.click();
    await vi.waitFor(() => expect(installButton()!.disabled).toBe(false));
    expect(gates("checkThemeFolder")).toHaveLength(1);
    expect(gates("installThemeFromFolder")).toEqual([]);
    expect(box.notify).not.toHaveBeenCalled();
    expect(diagnoses()).toEqual([]);
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
    const digest = expect.stringMatching(/^fake-/);
    expect(gates("installThemeFromFolder")).toEqual([
      [false, digest],
      [true, digest],
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
    // Il «no» scarta il permesso del controllo: una richiesta di sostituire che
    // arriva dopo, senza il gesto, non tocca niente.
    await vi.waitFor(() => expect(gates("discardThemeFolder")).toHaveLength(1));
    const [[, digest]] = gates("installThemeFromFolder") as [[boolean, string]];
    expect(await box.host!.module.api.installThemeFromFolder(true, digest)).toEqual({ outcome: "unchecked" });
    expect((await box.host!.module.api.listThemes())[0]!.manifest.version).toBe("0.3.2");
  });

  it("un controllo che non vale più ha la sua frase, non «cartella cambiata»", async () => {
    await open({
      developer: true,
      installed: [folderTheme("acme.carta", "Carta", "0.3.2")],
      folders: { "/temi/carta": folderTheme("acme.carta", "Carta", "0.4.0") },
    });
    box.folder = "/temi/carta";
    installButton()!.click();
    await vi.waitFor(() => expect(dialog()).not.toBeNull());
    // Il permesso si perde mentre la domanda è aperta (un altro controllo).
    await box.host!.module.api.discardThemeFolder();
    dialog()!.querySelector<HTMLButtonElement>('[data-action="replace"]')!.click();

    await vi.waitFor(() => expect(box.notify).toHaveBeenCalledTimes(1));
    expect(box.notify.mock.calls).toEqual([
      [
        "Il controllo di «carta» non vale più: ne è arrivato uno più recente, o è già stato usato. Non ho scritto niente: scegli di nuovo la cartella. Quello installato resta com'era.",
        "guasto",
      ],
    ]);
    expect((await box.host!.module.api.listThemes())[0]!.manifest.version).toBe("0.3.2");
  });

  it("un rifiuto delle porte dell'installazione è una diagnosi, non un avviso generico", async () => {
    await open({
      developer: true,
      folders: { "/temi/carta": { ...folderTheme(), installRefusal: { reason: "traversal", path: "font/carta.woff2" } } },
    });
    box.folder = "/temi/carta";
    installButton()!.click();

    await vi.waitFor(() => expect(diagnoses()).toHaveLength(1));
    expect(rowsOf(diagnoses()[0]!)).toEqual([
      [
        "font/carta.woff2",
        "—",
        "traversal",
        "È un collegamento, o porta fuori dalla cartella: un tema è fatto solo di file suoi.",
      ],
    ]);
    expect(box.notify.mock.calls).toEqual([
      ["«Carta» non è installato: 1 motivo, lo trovi sotto «Temi installati».", "guasto"],
    ]);
    expect(await box.host!.module.api.listThemes()).toEqual([]);
  });

  it("una sostituzione che si ferma lascia il vecchio com'era, e lo dice una volta", async () => {
    const failing = {
      ...folderTheme("acme.carta", "Carta", "0.4.0"),
      replaceError: { kind: "io", message: "I/O error: /config/themes/acme.carta: No space left on device" } as PluginError,
      replaceCause: "full" as const,
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

    // Non è un rifiuto del tema: un avviso solo, col perché tipizzato in
    // italiano (mai la frase del disco), che dice anche che il vecchio resta.
    await vi.waitFor(() => expect(box.notify).toHaveBeenCalledTimes(1));
    expect(box.notify.mock.calls).toEqual([
      ["Il disco è pieno: il tema non si è installato. Quello installato resta com'era.", "guasto"],
    ]);
    expect(diagnoses()).toEqual([]);
    expect((await box.host!.module.api.listThemes())[0]!.manifest.version).toBe("0.3.2");
    expect(catalogOptions()).toContain("Carta · chiaro · Della comunità");
  });

  it("una sostituzione che non riesce a rimettere il vecchio lo dice, e la cartella resta", async () => {
    const failing = {
      ...folderTheme("acme.carta", "Carta", "0.4.0"),
      replaceError: { kind: "io", message: "I/O error: kept in /config/themes/.tmp-old-1-2" } as PluginError,
      replaceLost: true,
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
    const body = dialog()!.querySelector(".kit-dialog-description")!.textContent!;
    expect(body).toBe(
      "Il nuovo non è entrato, e il vecchio non è tornato al suo posto: è rimasto nella cartella dei temi, col nome «.tmp-old-1-2». La cartella /temi/carta resta dov'è: installalo di nuovo.",
    );
    // Il guasto del disco dell'host (inglese, coi percorsi della macchina) non
    // arriva nella finestra: la dice la shell, col nome tipizzato.
    expect(body).not.toContain(failing.replaceError.message);
    expect(body).not.toContain("I/O error");
    dialog()!.querySelector<HTMLButtonElement>('[data-action="ok"]')!.click();
    await vi.waitFor(() => expect(dialog()).toBeNull());
    expect(catalogOptions()).toEqual([]);
  });

  it("la cartella cambiata fra il controllo e «Sostituisci»: niente si scrive, e lo si dice", async () => {
    const next = folderTheme("acme.carta", "Carta", "0.4.0");
    await open({
      developer: true,
      installed: [folderTheme("acme.carta", "Carta", "0.3.2")],
      folders: { "/temi/carta": next },
    });
    box.folder = "/temi/carta";
    installButton()!.click();
    await vi.waitFor(() => expect(dialog()).not.toBeNull());
    // Chi scrive il tema salva la pelle mentre la domanda è aperta.
    for (const payload of Object.values(next.payloads)) payload.skin = ".carta-nuova { color: red; }\n";
    dialog()!.querySelector<HTMLButtonElement>('[data-action="replace"]')!.click();

    await vi.waitFor(() =>
      expect(box.notify).toHaveBeenCalledWith(
        "La cartella «carta» è cambiata dopo il controllo: non ho scritto niente. Riprova. Quello installato resta com'era.",
        "guasto",
      ),
    );
    expect(box.notify).toHaveBeenCalledTimes(1);
    expect((await box.host!.module.api.listThemes())[0]!.manifest.version).toBe("0.3.2");
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

  it("un tema installato revocato non si sostituisce: niente domanda, una riga e un avviso", async () => {
    await open({
      developer: true,
      revoked: ["acme.carta"],
      folders: { "/temi/carta": folderTheme("acme.carta", "Carta", "0.4.0") },
    });
    box.folder = "/temi/carta";
    installButton()!.click();

    await vi.waitFor(() => expect(diagnoses()).toHaveLength(1));
    expect(dialog()).toBeNull();
    const [block] = diagnoses();
    expect(block!.querySelector(".setting-label")!.textContent).toBe("«Carta» è rifiutato: 1 motivo");
    // Il tema ritirato resta sul disco com'era, come per ogni rifiuto davanti
    // a un tema installato.
    expect(block!.querySelector(".muted")!.textContent).toMatch(/Il tema installato resta com'era\.$/);
    expect(rowsOf(block!)).toEqual([
      ["revoked", "«Carta» è stato ritirato dal catalogo e Fub non lo installa, nemmeno da una cartella."],
    ]);
    // Un motivo di tutto il tema: niente colonne vuote.
    expect(block!.querySelector(".tema-diagnosi-riga")!.classList.contains("tema-diagnosi-riga--tema")).toBe(true);
    expect(box.notify.mock.calls).toEqual([
      ["«Carta» non è installato: 1 motivo, lo trovi sotto «Temi installati».", "guasto"],
    ]);
    expect(gates("installThemeFromFolder")).toHaveLength(1);
    expect(await box.host!.module.api.listThemes()).toEqual([]);
  });

  it("un tema installato che non si tocca è una riga col suo perché e il posto, senza domanda", async () => {
    await open({
      developer: true,
      blocked: { "acme.carta": "pointer" },
      folders: { "/temi/carta": folderTheme("acme.carta", "Carta", "0.4.0") },
    });
    box.folder = "/temi/carta";
    installButton()!.click();

    await vi.waitFor(() => expect(diagnoses()).toHaveLength(1));
    expect(dialog()).toBeNull();
    const [block] = diagnoses();
    expect(block!.querySelector(".setting-label")!.textContent).toBe("«Carta» è rifiutato: 1 motivo");
    expect(rowsOf(block!)).toEqual([
      [
        "blocked_pointer",
        "Il tema già installato con lo stesso id ha il file della versione rotto, o che non si apre: potrebbe essere ritirato dal catalogo, quindi Fub non lo sostituisce. Toglilo a mano da /config/themes/acme.carta e riprova.",
      ],
    ]);
    expect(block!.querySelector(".tema-diagnosi-riga")!.classList.contains("tema-diagnosi-riga--tema")).toBe(true);
    expect(gates("installThemeFromFolder")).toHaveLength(1);
    expect(await box.host!.module.api.listThemes()).toEqual([]);
  });

  it("la sostituzione fallita del tema in uso: l'aspetto torna a Scrittoio, la scelta salvata resta", async () => {
    const failing: ThemeFolderFake = {
      ...folderTheme("acme.carta", "Carta", "0.4.0"),
      replaceError: { kind: "io", message: "I/O error: kept in /config/themes/.tmp-old-1-2" },
      replaceLost: true,
    };
    await open({
      developer: true,
      inUse: "acme.carta",
      installed: [folderTheme("acme.carta", "Carta", "0.3.2")],
      folders: { "/temi/carta": failing },
    });
    expect(currentThemeId()).toBe("acme.carta");
    box.folder = "/temi/carta";
    installButton()!.click();
    await vi.waitFor(() => expect(dialog()).not.toBeNull());
    dialog()!.querySelector<HTMLButtonElement>('[data-action="replace"]')!.click();

    await vi.waitFor(() => expect(dialog()?.getAttribute("role")).toBe("alertdialog"));
    expect(dialog()!.querySelector(".kit-dialog-description")!.textContent).toContain(
      "Per ora torna Scrittoio; la tua scelta resta, e torna quando lo installi di nuovo.",
    );
    dialog()!.querySelector<HTMLButtonElement>('[data-action="ok"]')!.click();
    await vi.waitFor(() => expect(dialog()).toBeNull());
    expect(currentThemeId()).toBe("fub.serie");
    const saved = () => settings().then((entries) => entries.find((entry) => entry.spec.key === "appearance.theme-id")!);
    expect(await saved()).toMatchObject({ value: "acme.carta", source: "machine" });
    expect(gates("setSetting")).toEqual([]);

    // Installato di nuovo, il tema scelto torna in uso da sé.
    delete failing.replaceError;
    installButton()!.click();
    await vi.waitFor(() =>
      expect(box.notify).toHaveBeenCalledWith("«Carta» installato: lo trovi fra i temi installati.", "info"),
    );
    expect(currentThemeId()).toBe("acme.carta");
  });

  it("le Impostazioni smontate mentre «Sostituisci» lavora: il catalogo si rilegge, niente si disegna né si dice", async () => {
    await open({
      developer: true,
      installed: [folderTheme("acme.carta", "Carta", "0.3.2")],
      folders: { "/temi/carta": folderTheme("acme.carta", "Carta", "0.4.0") },
    });
    box.folder = "/temi/carta";
    installButton()!.click();
    await vi.waitFor(() => expect(dialog()).not.toBeNull());
    const release = box.host!.throttle("installThemeFromFolder");
    dialog()!.querySelector<HTMLButtonElement>('[data-action="replace"]')!.click();
    await vi.waitFor(() => expect(gates("installThemeFromFolder")).toHaveLength(2));
    box.teardown!();
    const listed = gates("listThemes").length;
    release();

    await vi.waitFor(() => expect(gates("listThemes").length).toBeGreaterThan(listed));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await themeCatalog())[0]!.manifest.version).toBe("0.4.0");
    expect(box.notify).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
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
    expect(block!.querySelector(".setting-label")!.textContent).toBe("«Rotto» è rifiutato: 3 motivi");
    expect(block!.querySelector(".muted")!.textContent).toMatch(/Il tema resta fuori dai temi installati\.$/);
    const rows = rowsOf(block!);
    // Le due luci hanno gli stessi motivi: una riga per motivo, non per luce.
    expect(rows).toHaveLength(3);
    expect(rows).toContainEqual(["manifest.json", "—", "manifest", "engine theme-1 incompatibile, serve theme-2"]);
    expect(rows.some(([file, where, code]) => file === "skin.css" && /^\d+:\d+$/.test(where!) && code !== "")).toBe(true);
    // Un esito solo, e vero: il tema non è arrivato nella cartella dei temi,
    // l'host non è stato chiamato a installarlo, e l'avviso dice ciò che dice
    // la diagnosi. Il permesso del controllo è scartato.
    expect(gates("installThemeFromFolder")).toEqual([]);
    expect(gates("discardThemeFolder")).toHaveLength(1);
    expect(await box.host!.module.api.listThemes()).toEqual([]);
    expect(catalogOptions()).toEqual([]);
    expect(box.notify.mock.calls).toEqual([
      ["«Rotto» non è installato: 3 motivi, li trovi sotto «Temi installati».", "guasto"],
    ]);
    expect(box.trouble).not.toHaveBeenCalled();

    block!.querySelector<HTMLButtonElement>(".settings-actions button")!.click();
    await vi.waitFor(() => expect(box.clipboard).toHaveBeenCalledTimes(1));
    const copied = box.clipboard.mock.calls[0]![0];
    expect(copied).toContain("«Rotto» è rifiutato");
    expect(copied).toContain("- manifest: engine theme-1 incompatibile, serve theme-2");
  });

  it("un tema rifiutato con l'id di uno installato lascia quello installato com'era", async () => {
    await open({
      developer: true,
      installed: [folderTheme("acme.rotto", "Rotto", "0.9.0")],
      folders: { "/temi/rotto": rejectedTheme("acme.rotto", "1.0.0") },
    });
    box.folder = "/temi/rotto";
    installButton()!.click();

    await vi.waitFor(() => expect(diagnoses()).toHaveLength(1));
    expect(diagnoses()[0]!.querySelector(".muted")!.textContent).toMatch(/Il tema installato resta com'era\.$/);
    expect(gates("installThemeFromFolder")).toEqual([]);
    expect(dialog()).toBeNull();
    expect((await box.host!.module.api.listThemes())[0]!.manifest.version).toBe("0.9.0");
    expect(catalogOptions()).toContain("Rotto · chiaro · Della comunità");
    expect(box.notify).toHaveBeenCalledTimes(1);
  });

  it("una cartella che l'host rifiuta (senza manifest.json) è una diagnosi di una riga, in italiano", async () => {
    await open({ developer: true, folders: { "/temi/vuota": { reason: "not_a_theme" } } });
    box.folder = "/temi/vuota";
    installButton()!.click();

    await vi.waitFor(() => expect(diagnoses()).toHaveLength(1));
    const [block] = diagnoses();
    expect(block!.querySelector(".setting-label")!.textContent).toBe("«vuota» è rifiutato: 1 motivo");
    expect(rowsOf(block!)).toEqual([
      ["manifest.json", "—", "not-a-theme", "Nella cartella non c'è manifest.json: non è la cartella di un tema."],
    ]);
    expect(box.notify.mock.calls).toEqual([
      ["«vuota» non è installato: 1 motivo, lo trovi sotto «Temi installati».", "guasto"],
    ]);
    expect(gates("installThemeFromFolder")).toEqual([]);
  });

  it("lo stato del catalogo nella cartella: la riga nomina il file", async () => {
    await open({ developer: true, folders: { "/temi/carta": { reason: "catalog_state", file: ".fub-current.json" } } });
    box.folder = "/temi/carta";
    installButton()!.click();

    await vi.waitFor(() => expect(diagnoses()).toHaveLength(1));
    expect(rowsOf(diagnoses()[0]!)).toEqual([
      [
        ".fub-current.json",
        "—",
        "catalog-state",
        "È lo stato del catalogo che scrive Fub, non parte del tema: toglilo dalla cartella.",
      ],
    ]);
    // Il nome non si spezza: stretto si accorcia, e intero sta nel suggerimento.
    const file = diagnoses()[0]!.querySelector<HTMLElement>(".tema-diagnosi-file")!;
    expect(box.tooltip).toHaveBeenCalledWith(file, ".fub-current.json");
    expect(await box.host!.module.api.listThemes()).toEqual([]);
  });

  it("un guasto dopo un rifiuto toglie la diagnosi vecchia anche dallo schermo, e lo dice una volta", async () => {
    await open({
      developer: true,
      folders: {
        "/temi/vuota": { reason: "not_a_theme" },
        "/temi/sparita": { kind: "io", message: "I/O error: /temi/sparita: no such folder" },
      },
    });
    box.folder = "/temi/vuota";
    installButton()!.click();
    await vi.waitFor(() => expect(diagnoses()).toHaveLength(1));
    box.notify.mockClear();

    box.folder = "/temi/sparita";
    await vi.waitFor(() => expect(installButton()!.disabled).toBe(false));
    installButton()!.click();
    await vi.waitFor(() => expect(box.notify).toHaveBeenCalledTimes(1));
    expect(box.notify.mock.calls[0]![1]).toBe("guasto");
    expect(box.notify.mock.calls[0]![0]).toMatch(/^Il tema non si è installato: /);
    await vi.waitFor(() => expect(diagnoses()).toEqual([]));
  });

  it("senza rifiuti la diagnosi non c'è", async () => {
    await open({ developer: false, installed: [folderTheme()] });
    expect(diagnoses()).toEqual([]);
    expect(catalogOptions()).toContain("Carta · chiaro · Della comunità");
  });
});

describe("l'host finto installa come quello vero", () => {
  // Gemello di `an_install_speaks_only_of_the_checked_bytes` (crates/fub-host/
  // tests/themes.rs): la stessa scena, lo stesso esito.
  it("l'esito parla solo dei byte controllati: un id cambiato dopo il controllo è «changed»", async () => {
    const next = folderTheme("acme.lino", "Lino", "1.0.0");
    await open({ developer: true, installed: [folderTheme("acme.carta", "Carta", "0.3.2")], folders: { "/temi/lino": next } });
    box.folder = "/temi/lino";
    const api = box.host!.module.api;
    const check = await api.checkThemeFolder();
    if (check.outcome !== "ready") throw new Error(check.outcome);
    const carta = folderTheme("acme.carta", "Carta", "1.0.0");
    next.info = carta.info;
    next.payloads = carta.payloads;
    expect(await api.installThemeFromFolder(false, check.digest)).toEqual({ outcome: "changed" });
    expect((await api.listThemes()).map((theme) => theme.manifest.version)).toEqual(["0.3.2"]);
  });

  // Gemello di `a_checked_folder_installs_once`.
  it("il controllo vale una volta, e dopo una collisione solo per «Sostituisci»", async () => {
    await open({
      developer: true,
      installed: [folderTheme("acme.carta", "Carta", "0.3.2")],
      folders: { "/temi/carta": folderTheme("acme.carta", "Carta", "0.4.0") },
    });
    box.folder = "/temi/carta";
    const api = box.host!.module.api;
    let check = await api.checkThemeFolder();
    if (check.outcome !== "ready") throw new Error(check.outcome);
    expect((await api.installThemeFromFolder(false, check.digest)).outcome).toBe("collision");
    expect(await api.installThemeFromFolder(false, check.digest)).toEqual({ outcome: "unchecked" });
    expect(await api.installThemeFromFolder(true, check.digest)).toEqual({ outcome: "unchecked" });

    check = await api.checkThemeFolder();
    if (check.outcome !== "ready") throw new Error(check.outcome);
    expect((await api.installThemeFromFolder(false, check.digest)).outcome).toBe("collision");
    expect((await api.installThemeFromFolder(true, check.digest)).outcome).toBe("installed");
    expect(await api.installThemeFromFolder(true, check.digest)).toEqual({ outcome: "unchecked" });
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

  it("il rifiuto tipizzato dell'host: il file che nomina, il motivo per codice, il perché della shell", () => {
    expect(refusalRow({ reason: "traversal", path: "font/fuori.woff2" })).toEqual({
      file: "font/fuori.woff2",
      where: null,
      code: "traversal",
      why: "È un collegamento, o porta fuori dalla cartella: un tema è fatto solo di file suoi.",
    });
    expect(refusalRow({ reason: "engine", declared: "theme-9" })).toEqual({
      file: "manifest.json",
      where: null,
      code: "engine",
      why: "Il manifest dichiara il motore «theme-9», che questo Fub non conosce.",
    });
    expect(refusalRow({ reason: "permissions" }).code).toBe("permissions");
    expect(refusalRow({ reason: "invalid_id", id: "Acme Carta" }).why).toBe(
      "L'id «Acme Carta» non si può usare come nome di una cartella.",
    );
    expect(refusalRow({ reason: "series" }).file).toBe("manifest.json");
    // Il motivo di una forma sbagliata è dell'host: arriva così com'è, dopo la frase della shell.
    expect(refusalRow({ reason: "malformed", detail: "missing `id`" })).toEqual({
      file: null,
      where: null,
      code: "malformed",
      why: "Il tema non è ben formato: missing `id`",
    });
  });
});
