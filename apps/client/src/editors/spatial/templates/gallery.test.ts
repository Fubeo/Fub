// @vitest-environment happy-dom
//
// La galleria di «Nuovo disegno», sull'host finto: le schede coi nomi del
// comando, le anteprime dei file nella lingua dell'interfaccia, «Dal vault»,
// l'ultima scelta, e il gesto che crea — il salvataggio prima, gli argomenti
// del comando, l'esito consegnato come la palette, gli errori vicino al nome.
// In happy-dom non c'è CSS né misura: si asserisce su *cosa* c'è.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry } from "../../../host/contract";
import type { FakeHost } from "../../../host/fake";
import type { Gallery } from "./gallery";

const box = vi.hoisted(() => ({ host: null as FakeHost | null }));

vi.mock("../../../host/ipc", () => ({
  api: new Proxy(
    {},
    {
      get: (_target, name: string) => (...args: unknown[]) => {
        if (!box.host) throw new Error("l'host finto non è stato montato");
        return (box.host.module.api as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!(...args);
      },
    },
  ),
}));

const { createFakeHost, drawingCreateSpec } = await import("../../../host/fake");
const { checkAccessibility, formatIssues } = await import("../../../ui/a11y-check");
const { openCommandForm, registerCommandForm, resetCommandForms, newDrawing } = await import("../../../ui/commands");
const { setCommandSpecs } = await import("../../../state/store");
const { setReducedMotionPreference } = await import("../../../theme/reduced-motion");
const { openGallery } = await import("./gallery");
const { LANGS, TEMPLATE_IDS } = await import("./content");
const { CHOICE_KEY } = await import("./choices");


/// Un disegno qualunque, per i file del vault.
const DRAWING = [
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 100 100">',
  "  <title>Lavagna</title>",
  '  <g id="l1" fub:layer="Livello 1"><rect id="o1a2b3c4d" x="0" y="0" width="10" height="10"/></g>',
  "</svg>",
  "",
].join("\n");

/// Le schede, per id, nell'ordine in cui compaiono.
const cardIds = (): string[] => [...document.querySelectorAll<HTMLElement>(".draw-new-card")].map((card) => card.dataset.template!);
/// La scheda di `id`.
const card = (id: string): HTMLElement => document.querySelector<HTMLElement>(`.draw-new-card[data-template="${id}"]`)!;
/// Il pulsante di scelta di una scheda o di una riga del vault.
const radioOf = (row: HTMLElement): HTMLInputElement => row.querySelector<HTMLInputElement>("input[type=radio]")!;
/// Il pulsante di scelta spuntato adesso, col valore che porta.
const checked = (): string | undefined => document.querySelector<HTMLInputElement>(".draw-new input[type=radio]:checked")?.value;
const nameInput = (): HTMLInputElement => document.querySelector<HTMLInputElement>(".draw-new-field input")!;
const folderInput = (): HTMLInputElement => document.querySelectorAll<HTMLInputElement>(".draw-new-field input")[1]!;
const alertBox = (): HTMLElement => document.querySelector<HTMLElement>(".draw-new-alert")!;
const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>(".shell-dialog");

async function settle(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function until(thing: string, cond: () => boolean, within = 2000): Promise<void> {
  const deadline = Date.now() + within;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`non è mai successo: ${thing}`);
}

/// I file dei modelli, uno per id e lingua, che registrano quali si leggono.
function templateFiles(log: string[] = []): Record<string, () => Promise<string>> {
  return Object.fromEntries(
    TEMPLATE_IDS.flatMap((id) =>
      LANGS.map((lang) => {
        const path = `/crates/fub-features/templates/${id}.${lang}.svg`;
        return [
          path,
          async () => {
            log.push(path);
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>${id}</title></svg>`;
          },
        ] as const;
      }),
    ),
  );
}

/// Senza caratteri da incorporare: l'anteprima non aspetta i file dell'app.
const FONTS = { now: () => "", load: () => Promise.resolve("") };

/// L'impostazione `draw.templates` con questo valore.
const templatesSetting = (value: string): SettingEntry => ({ spec: { key: "draw.templates" }, value, source: "vault" }) as unknown as SettingEntry;

function host() {
  return {
    onEffect: vi.fn(async () => {}),
    notify: vi.fn(),
    flushPendingSave: vi.fn(async (): Promise<string[]> => []),
  };
}

let opener: HTMLButtonElement;
let opened: Gallery | null = null;

function mount(options: { file?: Record<string, string>; settings?: SettingEntry[] } = {}): FakeHost {
  const fake = createFakeHost({ draw: true, file: options.file ?? {}, settings: options.settings ?? [], commands: [drawingCreateSpec()] });
  box.host = fake;
  setCommandSpecs([drawingCreateSpec()]);
  return fake;
}

/// Apre la galleria e aspetta che sia arrivato tutto.
async function open(prefill: Record<string, string> = {}, shell = host(), files = templateFiles()): Promise<ReturnType<typeof host>> {
  opened = openGallery(prefill, shell, { fonts: FONTS, files });
  await opened.ready;
  await settle();
  return shell;
}

const submit = (): void => {
  document.querySelector<HTMLFormElement>(".draw-new-form")!.requestSubmit();
};

beforeEach(() => {
  document.body.innerHTML = "";
  opener = document.createElement("button");
  opener.textContent = "Nuovo";
  document.body.append(opener);
  opener.focus();
  vi.spyOn(navigator, "language", "get").mockReturnValue("it-IT");
  // Senza moto la finestra se ne va subito: i banchi non aspettano l'uscita.
  setReducedMotionPreference(true);
});

afterEach(async () => {
  opened?.close();
  opened = null;
  await until("la finestra chiusa", () => dialog() === null).catch(() => {});
  document.body.innerHTML = "";
  resetCommandForms();
  setCommandSpecs([]);
  localStorage.clear();
  vi.restoreAllMocks();
  setReducedMotionPreference(false);
  box.host = null;
});

describe("la finestra", () => {
  it("è un dialogo con nome, e il fuoco sta sul nome", async () => {
    mount();
    await open();
    const root = dialog()!;
    expect(root.getAttribute("role")).toBe("dialog");
    expect(root.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(root.getAttribute("aria-labelledby")!)?.textContent).toBe("Nuovo disegno");
    expect(document.activeElement).toBe(nameInput());
    expect(nameInput().placeholder).toBe("Disegno");
  });

  it("riempie la cartella da `prefill.folder` e la lascia vuota senza", async () => {
    mount();
    await open({ folder: "Lezioni/Fisica" });
    expect(folderInput().value).toBe("Lezioni/Fisica");
    opened!.close();
    await until("la finestra chiusa", () => dialog() === null);
    await open({});
    expect(folderInput().value).toBe("");
  });

  it("non ha niente che la tecnologia assistiva non possa nominare", async () => {
    mount({ file: { "Templates/Atomo.svg": DRAWING } });
    await open();
    const issues = checkAccessibility(dialog()!);
    expect(issues, formatIssues(issues)).toEqual([]);
  });

  it("ce n'è una sola: un secondo gesto riporta il fuoco, e il nome scritto resta", async () => {
    mount();
    await open();
    nameInput().value = "A metà";
    opener.focus();
    const again = openGallery({}, host(), { fonts: FONTS, files: templateFiles() });
    expect(again).toBe(opened);
    expect(document.querySelectorAll(".shell-dialog")).toHaveLength(1);
    expect(nameInput().value).toBe("A metà");
    expect(document.activeElement).toBe(nameInput());
  });
});

describe("le schede", () => {
  it("sono quelle del comando, nell'ordine del comando, coi suoi titoli", async () => {
    mount();
    await open();
    expect(cardIds()).toEqual(["blank", "a4-portrait", "a4-landscape", "slide", "diagram", "lesson", "storyboard", "concept-map"]);
    const titles = [...document.querySelectorAll(".draw-new-card-name")].map((title) => title.textContent);
    expect(titles).toEqual([
      "Vuoto",
      "A4 verticale",
      "A4 orizzontale",
      "Diapositiva 16:9",
      "Diagramma di flusso",
      "Lavagna per la lezione",
      "Storyboard",
      "Mappa concettuale",
    ]);
  });

  it("stanno in un gruppo di scelta con nome, e ognuna dice a che cosa serve", async () => {
    mount();
    await open();
    const group = document.querySelector<HTMLElement>(".draw-new-cards")!;
    expect(group.getAttribute("role")).toBe("radiogroup");
    expect(document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent).toBe("Modello");
    for (const id of cardIds()) {
      const input = radioOf(card(id));
      expect(document.getElementById(input.getAttribute("aria-labelledby")!)?.textContent, id).toBe(card(id).querySelector(".draw-new-card-name")!.textContent);
      const note = document.getElementById(input.getAttribute("aria-describedby")!)!;
      expect(note.textContent!.trim().length, id).toBeGreaterThan(10);
    }
    // Un gruppo solo: se ne sceglie una, e le frecce vanno dall'una all'altra.
    expect(new Set([...document.querySelectorAll<HTMLInputElement>(".draw-new input[type=radio]")].map((input) => input.name)).size).toBe(1);
  });

  it("la prima volta è scelto «Vuoto»", async () => {
    mount();
    await open();
    expect(checked()).toBe("blank");
    expect(card("blank").hasAttribute("data-selected")).toBe(true);
  });

  it("scegliere una scheda toglie la scelta alle altre", async () => {
    mount();
    await open();
    const slide = radioOf(card("slide"));
    slide.checked = true;
    slide.dispatchEvent(new Event("change", { bubbles: true }));
    expect(checked()).toBe("slide");
    expect(card("slide").hasAttribute("data-selected")).toBe(true);
    expect(card("blank").hasAttribute("data-selected")).toBe(false);
  });

  it("Home e Fine scelgono la prima e l'ultima scheda, e le danno il fuoco", async () => {
    mount();
    await open();
    const grid = document.querySelector<HTMLElement>('.draw-new-cards[role="radiogroup"]')!;
    const press = (key: string): void => {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    };
    radioOf(card("blank")).focus();
    press("End");
    const cards = grid.querySelectorAll<HTMLElement>(".draw-new-card");
    const last = cards[cards.length - 1]!;
    expect(checked()).toBe(last.dataset.template);
    expect(document.activeElement).toBe(radioOf(last));
    press("Home");
    expect(checked()).toBe("blank");
    expect(document.activeElement).toBe(radioOf(card("blank")));
  });

  it("senza spec del comando ci sono comunque gli otto modelli, coi nomi della lingua", async () => {
    mount();
    setCommandSpecs([]);
    await open();
    expect(cardIds()).toHaveLength(8);
    expect(card("storyboard").querySelector(".draw-new-card-name")!.textContent).toBe("Storyboard");
    expect(card("lesson").querySelector(".draw-new-card-name")!.textContent).toBe("Lavagna per la lezione");
  });

  it("un comando senza il parametro `template` offre soltanto «Vuoto», e senza `from` non c'è «Dal vault»", async () => {
    mount();
    const spec = drawingCreateSpec();
    setCommandSpecs([{ ...spec, params: spec.params.filter((param) => param.name === "name" || param.name === "folder") }]);
    await open();
    expect(cardIds()).toEqual(["blank"]);
    expect(document.querySelector(".draw-new-vault")).toBeNull();
    expect([...document.querySelectorAll(".draw-new-group-title")].map((title) => title.textContent)).toEqual(["Modello"]);
  });

  it("un modello che questa versione non conosce c'è, col nome del comando e senza anteprima", async () => {
    mount();
    const spec = drawingCreateSpec();
    setCommandSpecs([
      {
        ...spec,
        params: spec.params.map((param) =>
          param.name === "template" ? { ...param, kind: { kind: "choice" as const, value: [{ value: "blank", title: "Vuoto" }, { value: "poster", title: "Manifesto" }] } } : param,
        ),
      },
    ]);
    await open();
    expect(cardIds()).toEqual(["blank", "poster"]);
    expect(card("poster").querySelector("img")).toBeNull();
    expect(card("poster").querySelector(".draw-new-card-note")).toBeNull();
  });
});

describe("le anteprime", () => {
  it("sono i file dei modelli nella lingua dell'interfaccia, e il vuoto non ne ha", async () => {
    mount();
    const log: string[] = [];
    await open({}, host(), templateFiles(log));
    expect(log.sort()).toEqual(TEMPLATE_IDS.map((id) => `/crates/fub-features/templates/${id}.it.svg`).sort());
    for (const id of TEMPLATE_IDS) {
      const image = card(id).querySelector("img")!;
      expect(image.getAttribute("alt"), id).toBe("");
      expect(image.getAttribute("src"), id).toMatch(/^blob:/);
    }
    expect(card("blank").querySelector("img")).toBeNull();
    expect(card("blank").querySelector(".draw-new-blank")).not.toBeNull();
  });

  it("con l'interfaccia in inglese sono i file inglesi", async () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("en-GB");
    mount();
    const log: string[] = [];
    await open({}, host(), templateFiles(log));
    expect(log.sort()).toEqual(TEMPLATE_IDS.map((id) => `/crates/fub-features/templates/${id}.en.svg`).sort());
    expect(document.querySelector(".draw-new-group-title")!.textContent).toBe("Template");
    expect(nameInput().placeholder).toBe("Drawing");
    expect(document.querySelector(".palette-actions button.primary")!.textContent).toBe("Create");
  });

  it("con ogni altra lingua sono i file italiani", async () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("fr-FR");
    mount();
    const log: string[] = [];
    await open({}, host(), templateFiles(log));
    expect(log.every((path) => path.endsWith(".it.svg"))).toBe(true);
    expect(log).toHaveLength(TEMPLATE_IDS.length);
  });

  it("sono i file veri distribuiti con Fub, tutti e sette", async () => {
    mount();
    opened = openGallery({}, host(), { fonts: FONTS });
    await opened.ready;
    await until("le sette anteprime", () => TEMPLATE_IDS.every((id) => card(id).querySelector("img")?.getAttribute("src")?.startsWith("blob:") === true));
  });

  it("un file che non si legge lascia la scheda senza immagine, e la scelta resta possibile", async () => {
    mount();
    const files = templateFiles();
    files["/crates/fub-features/templates/slide.it.svg"] = () => Promise.reject(new Error("non c'è"));
    await open({}, host(), files);
    expect(card("slide").querySelector("img")!.hasAttribute("src")).toBe(false);
    expect(radioOf(card("slide")).disabled).toBe(false);
  });

  it("si liberano alla chiusura", async () => {
    mount();
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    await open();
    opened!.close();
    expect(revoke).toHaveBeenCalledTimes(TEMPLATE_IDS.length);
  });
});

describe("«Dal vault»", () => {
  it("elenca i disegni della cartella `Templates`, per nome, e non i file di altre specie né le sottocartelle", async () => {
    mount({
      file: {
        "Templates/Zeta.svg": DRAWING,
        "Templates/Atomo.svg": DRAWING,
        "Templates/nota.md": "# nota",
        "Templates/Sotto/Dentro.svg": DRAWING,
        "Altro/Fuori.svg": DRAWING,
      },
    });
    await open();
    const rows = [...document.querySelectorAll<HTMLElement>(".draw-new-vault-item")];
    expect(rows.map((row) => row.querySelector(".draw-new-vault-name")!.textContent)).toEqual(["Atomo", "Zeta"]);
    expect(rows.map((row) => radioOf(row).value)).toEqual(["from:Templates/Atomo.svg", "from:Templates/Zeta.svg"]);
    const group = document.querySelector<HTMLElement>(".draw-new-vault")!;
    expect(group.getAttribute("role")).toBe("radiogroup");
    expect(document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent).toBe("Dal vault");
    expect(document.querySelector(".draw-new-group-hint")!.textContent).toContain("«Templates»");
  });

  it("usa la cartella che le impostazioni dicono", async () => {
    mount({ file: { "Templates/Vecchio.svg": DRAWING, "Modelli/Nuovo.svg": DRAWING }, settings: [templatesSetting("/Modelli/")] });
    await open();
    expect([...document.querySelectorAll(".draw-new-vault-name")].map((name) => name.textContent)).toEqual(["Nuovo"]);
    expect(document.querySelector(".draw-new-group-hint")!.textContent).toContain("«Modelli»");
  });

  it("con la cartella vuota o assente dice dove metterli", async () => {
    mount();
    await open();
    expect(document.querySelector(".draw-new-vault")!.hasAttribute("hidden")).toBe(true);
    const hint = document.querySelector(".draw-new-group-hint")!.textContent!;
    expect(hint).toContain("«Templates»");
    expect(hint).toContain("non c’è ancora nessun disegno");
  });

  it("con la radice come cartella lo dice senza nominare una cartella", async () => {
    mount({ settings: [templatesSetting("")] });
    await open();
    expect(document.querySelector(".draw-new-group-hint")!.textContent).toContain("radice del vault");
  });

  it("un vault che non risponde è una cartella vuota, non una finestra rotta", async () => {
    const fake = mount();
    fake.fault("queryIndex");
    await open();
    expect(cardIds()).toHaveLength(8);
    expect(document.querySelector(".draw-new-group-hint")!.textContent).toContain("non c’è ancora nessun disegno");
  });

  it("scegliere un disegno copia quello: `from`, senza `template`", async () => {
    const fake = mount({ file: { "Templates/Atomo.svg": DRAWING } });
    const shell = await open();
    const row = document.querySelector<HTMLElement>(".draw-new-vault-item")!;
    radioOf(row).checked = true;
    radioOf(row).dispatchEvent(new Event("change", { bubbles: true }));
    expect(checked()).toBe("from:Templates/Atomo.svg");
    expect(card("blank").hasAttribute("data-selected")).toBe(false);
    nameInput().value = "Copia";
    submit();
    await until("il disegno creato", () => "Copia.svg" in fake.files());
    expect(fake.atGate("invokeCommand").map((call) => call.args)).toEqual([["drawing.create", { name: "Copia", from: "Templates/Atomo.svg" }, "apply"]]);
    expect(fake.files()["Copia.svg"]).toContain("<title>Copia</title>");
    expect(shell.onEffect).toHaveBeenCalledWith({ kind: "navigate", doc: "Copia.svg" });
  });
});

describe("l'ultima scelta", () => {
  it("si ricorda per la prossima apertura", async () => {
    const fake = mount();
    await open();
    radioOf(card("storyboard")).checked = true;
    radioOf(card("storyboard")).dispatchEvent(new Event("change", { bubbles: true }));
    submit();
    await until("la finestra chiusa", () => dialog() === null);
    expect(await fake.module.api.viewState(CHOICE_KEY)).toBe("storyboard");
    await open();
    expect(checked()).toBe("storyboard");
  });

  it("riparte da quella ricordata anche se è arrivata dopo l'apertura, ma non copre una scelta fatta", async () => {
    const fake = mount();
    await fake.module.api.setViewState(CHOICE_KEY, "diagram");
    await open();
    expect(checked()).toBe("diagram");
    opened!.close();
    await until("la finestra chiusa", () => dialog() === null);

    const release = fake.throttle("viewState");
    opened = openGallery({}, host(), { fonts: FONTS, files: templateFiles() });
    radioOf(card("lesson")).checked = true;
    radioOf(card("lesson")).dispatchEvent(new Event("change", { bubbles: true }));
    release();
    await opened.ready;
    expect(checked()).toBe("lesson");
  });

  it("un disegno del vault ricordato torna se c'è ancora, altrimenti «Vuoto»", async () => {
    const fake = mount({ file: { "Templates/Atomo.svg": DRAWING } });
    await fake.module.api.setViewState(CHOICE_KEY, "from:Templates/Atomo.svg");
    await open();
    expect(checked()).toBe("from:Templates/Atomo.svg");
    opened!.close();
    await until("la finestra chiusa", () => dialog() === null);
    await fake.module.api.setViewState(CHOICE_KEY, "from:Templates/Sparito.svg");
    await open();
    expect(checked()).toBe("blank");
  });

  it("un valore che non è un modello del comando, o non è un testo, vale «Vuoto»", async () => {
    const fake = mount();
    for (const memory of ["poster", 42, { template: "slide" }]) {
      await fake.module.api.setViewState(CHOICE_KEY, memory);
      await open();
      expect(checked(), JSON.stringify(memory)).toBe("blank");
      opened!.close();
      await until("la finestra chiusa", () => dialog() === null);
    }
  });
});

describe("il gesto che crea", () => {
  it("salva prima, chiama il comando con ciò che è riempito, e consegna l'esito come la palette", async () => {
    const fake = mount();
    const shell = await open({ folder: "Lezioni" });
    nameInput().value = "  Atomo ";
    radioOf(card("slide")).checked = true;
    radioOf(card("slide")).dispatchEvent(new Event("change", { bubbles: true }));
    submit();
    await until("la finestra chiusa", () => dialog() === null);
    expect(shell.flushPendingSave).toHaveBeenCalledTimes(1);
    expect(fake.atGate("invokeCommand").map((call) => call.args)).toEqual([["drawing.create", { name: "Atomo", folder: "Lezioni", template: "slide" }, "apply"]]);
    // Il salvataggio è venuto prima del comando.
    expect(shell.flushPendingSave.mock.invocationCallOrder[0]!).toBeLessThan(shell.onEffect.mock.invocationCallOrder[0]!);
    expect(shell.notify).toHaveBeenCalledWith("Creato il disegno «Lezioni/Atomo.svg»", "info");
    expect(shell.onEffect).toHaveBeenCalledWith({ kind: "navigate", doc: "Lezioni/Atomo.svg" });
    expect(fake.files()["Lezioni/Atomo.svg"]).toContain("<title>Atomo</title>");
    expect(fake.files()["Lezioni/Atomo.svg"]).toContain('fub:board="');
  });

  it("senza niente di riempito chiama il comando senza argomenti: il vuoto è l'assenza di `template`", async () => {
    const fake = mount();
    const shell = await open();
    submit();
    await until("la finestra chiusa", () => dialog() === null);
    expect(fake.atGate("invokeCommand").map((call) => call.args)).toEqual([["drawing.create", {}, "apply"]]);
    expect(shell.onEffect).toHaveBeenCalledWith({ kind: "navigate", doc: "Disegno.svg" });
  });

  it("Invio da un pulsante di scelta crea", async () => {
    const fake = mount();
    await open();
    const input = radioOf(card("diagram"));
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.focus();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await until("il disegno creato", () => "Disegno.svg" in fake.files());
    expect(fake.atGate("invokeCommand").map((call) => call.args)).toEqual([["drawing.create", { template: "diagram" }, "apply"]]);
  });

  it("due gesti di fila creano una volta sola", async () => {
    const fake = mount();
    const shell = await open();
    submit();
    submit();
    await until("la finestra chiusa", () => dialog() === null);
    expect(fake.atGate("invokeCommand")).toHaveLength(1);
    expect(shell.flushPendingSave).toHaveBeenCalledTimes(1);
  });

  it("se un buffer non si salva il comando non parte, e la finestra resta con la frase", async () => {
    const fake = mount();
    const shell = host();
    shell.flushPendingSave.mockResolvedValue(["Nota.md", "Idee.md"]);
    await open({}, shell);
    submit();
    await until("l'avviso", () => alertBox().textContent !== "");
    expect(alertBox().textContent).toContain("Nota.md, Idee.md");
    expect(fake.atGate("invokeCommand")).toHaveLength(0);
    expect(dialog()).not.toBeNull();
    expect(document.activeElement).toBe(nameInput());
    expect(shell.onEffect).not.toHaveBeenCalled();
  });

  it("un nome preso resta nella finestra, vicino al nome, e il fuoco torna al nome", async () => {
    const fake = mount({ file: { "Atomo.svg": DRAWING } });
    const shell = await open();
    folderInput().focus();
    nameInput().value = "Atomo";
    submit();
    await until("l'avviso", () => alertBox().textContent !== "");
    const message = alertBox().querySelector(".palette-error")!;
    expect(message.textContent).toContain("«Atomo.svg» c'è già");
    expect(alertBox().getAttribute("role")).toBe("alert");
    expect(nameInput().getAttribute("aria-invalid")).toBe("true");
    expect(nameInput().getAttribute("aria-describedby")).toBe(message.id);
    expect(document.activeElement).toBe(nameInput());
    expect(dialog()).not.toBeNull();
    expect(shell.onEffect).not.toHaveBeenCalled();
    expect(Object.keys(fake.files())).toEqual(["Atomo.svg"]);
    // Ritentare con un altro nome riesce, e l'avviso se ne va.
    nameInput().value = "Atomo 2";
    submit();
    await until("la finestra chiusa", () => dialog() === null);
    expect(shell.onEffect).toHaveBeenCalledWith({ kind: "navigate", doc: "Atomo 2.svg" });
  });

  it("l'avviso precedente si toglie al gesto successivo, mentre il comando è in corso", async () => {
    const fake = mount({ file: { "Atomo.svg": DRAWING } });
    await open();
    nameInput().value = "Atomo";
    submit();
    await until("l'avviso", () => alertBox().textContent !== "");
    const release = fake.throttle("invokeCommand");
    submit();
    await until("il comando in corso", () => fake.atGate("invokeCommand").length === 2);
    expect(alertBox().textContent).toBe("");
    expect(nameInput().hasAttribute("aria-invalid")).toBe(false);
    expect(document.querySelector<HTMLButtonElement>(".palette-actions button[type=submit]")!.disabled).toBe(true);
    expect(document.querySelector(".draw-new-form")!.getAttribute("aria-busy")).toBe("true");
    release();
    await until("l'avviso di nuovo", () => alertBox().textContent !== "");
    expect(document.querySelector<HTMLButtonElement>(".palette-actions button[type=submit]")!.disabled).toBe(false);
    expect(document.querySelector(".draw-new-form")!.hasAttribute("aria-busy")).toBe(false);
  });

  it("un errore dopo che la finestra si è chiusa è un avviso della shell, non si perde", async () => {
    const fake = mount();
    const shell = host();
    let release: () => void = () => {};
    shell.flushPendingSave.mockImplementation(() => new Promise<string[]>((resolve) => { release = () => resolve([]); }));
    fake.fault("invokeCommand", "il disco è pieno");
    await open({}, shell);
    submit();
    opened!.close();
    release();
    await until("l'avviso", () => shell.notify.mock.calls.length > 0);
    expect(shell.notify.mock.calls[0]![0]).toContain("il disco è pieno");
    expect(shell.notify.mock.calls[0]![1]).toBe("guasto");
  });
});

describe("i tasti e il fuoco", () => {
  it("Esc chiude senza creare, e il fuoco torna a chi l'ha aperta", async () => {
    const fake = mount();
    const shell = await open();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await until("la finestra chiusa", () => dialog() === null);
    expect(document.activeElement).toBe(opener);
    expect(fake.atGate("invokeCommand")).toHaveLength(0);
    expect(shell.onEffect).not.toHaveBeenCalled();
  });

  it("Annulla e il clic fuori chiudono allo stesso modo", async () => {
    mount();
    await open();
    document.querySelector<HTMLButtonElement>(".palette-actions button[type=button]")!.click();
    await until("la finestra chiusa", () => dialog() === null);
    await open();
    dialog()!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await until("la finestra chiusa", () => dialog() === null);
    expect(document.activeElement).toBe(opener);
  });

  it("dopo la chiusura se ne può aprire un'altra", async () => {
    mount();
    await open();
    opened!.close();
    await until("la finestra chiusa", () => dialog() === null);
    await open();
    expect(document.querySelectorAll(".shell-dialog")).toHaveLength(1);
  });
});

describe("le porte del comando", () => {
  it("il modulo registrato apre la galleria, e «Nuovo disegno qui» le porta la cartella", async () => {
    mount();
    registerCommandForm("drawing.create", (prefill) => {
      opened = openGallery(prefill, host(), { fonts: FONTS, files: templateFiles() });
    });
    expect(newDrawing("Lezioni/Fisica")).toBe(true);
    await opened!.ready;
    expect(folderInput().value).toBe("Lezioni/Fisica");
    opened!.close();
    await until("la finestra chiusa", () => dialog() === null);
    expect(openCommandForm("drawing.create")).toBe(true);
    await opened!.ready;
    expect(folderInput().value).toBe("");
  });
});
