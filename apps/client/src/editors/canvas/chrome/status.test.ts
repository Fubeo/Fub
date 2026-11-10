// @vitest-environment happy-dom
// La banda di stato della lavagna (T52): le voci che la shell disegna, la
// cartella dei file trascinati come la scrive il deposito, e il menu dello zoom.
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../i18n/strings";
import { closeContextMenu } from "../../../ui/menu";
import {
  BAND_FOLDER_KEY,
  canvasStatusItems,
  dropFolderOf,
  openZoomMenu,
  statusSignature,
  type CanvasStatusPort,
} from "./status";

afterEach(() => {
  closeContextMenu();
  document.body.replaceChildren();
});

interface Fake extends CanvasStatusPort {
  readonly zoomed: number[];
  readonly settings: string[];
  readonly ran: string[];
}

function fake(over: Partial<CanvasStatusPort> = {}): Fake {
  const zoomed: number[] = [];
  const settings: string[] = [];
  const ran: string[] = [];
  return {
    zoomed,
    settings,
    ran,
    zoomPercent: () => 100,
    chosenCount: () => 0,
    readOnlyWhy: () => null,
    folder: () => "attachments",
    zoomTo: (zoom) => {
      zoomed.push(zoom);
    },
    command: (id) => ({
      label: id === "canvas.fit" ? "Mostra tutta la lavagna" : "Inquadra la selezione",
      hint: id === "canvas.fit" ? "Shift+1" : "Shift+2",
      disabled: id === "canvas.fit_selection" ? "Scegli prima una scheda." : null,
      run: () => {
        ran.push(id);
      },
    }),
    zoomMenuAt: () => ({ x: 400, y: 300 }),
    ...over,
  };
}

const byId = (port: CanvasStatusPort) => new Map(canvasStatusItems(port).map((item) => [item.id, item]));

describe("le voci della banda", () => {
  it("lo zoom è la prima voce, col suo numero, e un clic apre il menu", () => {
    const items = canvasStatusItems(fake({ zoomPercent: () => 140 }));
    expect(items[0]).toMatchObject({ id: "zoom", text: "140%", hint: t("canvas.status.zoom", { n: 140 }) });
    expect(items[0]!.open).toBeTypeOf("function");
  });

  it("le schede scelte: nessuna voce con nessuna scelta, una o più con il numero", () => {
    expect(byId(fake()).has("chosen")).toBe(false);
    expect(byId(fake({ chosenCount: () => 1 })).get("chosen")?.text).toBe(t("canvas.status.chosen.one"));
    expect(byId(fake({ chosenCount: () => 3 })).get("chosen")?.text).toBe(t("canvas.status.chosen", { n: 3 }));
  });

  it("la sola lettura compare solo quando non si cambia, e dice perché", () => {
    expect(byId(fake()).has("readonly")).toBe(false);
    const why = t("canvas.status.readonly.panel");
    const readonly = byId(fake({ readOnlyWhy: () => why })).get("readonly");
    expect(readonly).toMatchObject({ text: t("canvas.status.readonly"), hint: why });
  });

  it("la cartella: il clic apre le Impostazioni su canvas.drop_folder, senza modo resta testo", () => {
    const opened: string[] = [];
    const clickable = byId(fake({ folder: () => "Corsi/Attachments", openSettings: (key) => opened.push(key) })).get("folder");
    expect(clickable?.text).toBe("Corsi/Attachments");
    expect(clickable?.hint).toBe(t("canvas.status.folder.open", { folder: "Corsi/Attachments" }));
    clickable?.open?.();
    expect(opened).toEqual([BAND_FOLDER_KEY]);
    expect(BAND_FOLDER_KEY).toBe("canvas.drop_folder");
    const text = byId(fake({ folder: () => "attachments" })).get("folder");
    expect(text).toMatchObject({ text: "attachments", hint: t("canvas.status.folder", { folder: "attachments" }) });
    expect(text?.open).toBeUndefined();
  });

  it("un nome di cartella lunghissimo resta intero nel dato: la forma la fa il CSS", () => {
    const long = "Università/Secondo anno/Statistica e probabilità/Materiale del corso/Allegati della lavagna";
    expect(byId(fake({ folder: () => long })).get("folder")?.text).toBe(long);
  });
});

describe("la cartella dei file trascinati", () => {
  it("segue la regola del deposito: il default è una cartella del vault, un «./» è accanto alla lavagna", () => {
    // Senza impostazione il deposito usa `attachments` alla radice del vault.
    // Con «notes» (o la scelta non ancora letta) segue la cartella delle note.
    const notes = { dropFolder: "notes", dropFolderPath: "Allegati" } as const;
    expect(dropFolderOf(null, null, "Corsi/Stat/Lezioni.canvas")).toBe("attachments");
    expect(dropFolderOf("./Foto", notes, "Corsi/Stat/Lezioni.canvas")).toBe("Corsi/Stat/Foto");
    expect(dropFolderOf("Materiale", notes, "Corsi/Stat/Lezioni.canvas")).toBe("Materiale");
  });

  it("una lavagna alla radice con «./» ha la cartella alla radice", () => {
    expect(dropFolderOf("./Foto", null, "Lezioni.canvas")).toBe("Foto");
  });

  it("segue canvas.drop_folder come il deposito (T34): accanto alla lavagna e dalla radice", () => {
    const board = { dropFolder: "board", dropFolderPath: "Allegati" } as const;
    const folder = { dropFolder: "folder", dropFolderPath: "Materiali/Foto" } as const;
    expect(dropFolderOf(null, board, "Corsi/Statistica/Lezioni.canvas")).toBe("Corsi/Statistica/Allegati");
    expect(dropFolderOf(null, board, "Lezioni.canvas")).toBe("Allegati");
    expect(dropFolderOf("./x", folder, "Corsi/Lezioni.canvas")).toBe("Materiali/Foto");
    // Un percorso che la pulizia svuota torna alla cartella delle note.
    expect(dropFolderOf(null, { dropFolder: "folder", dropFolderPath: "../fuori" }, "Corsi/Lezioni.canvas")).toBe("attachments");
  });
});

describe("il menu dello zoom", () => {
  it("elenca 50%, 100%, 200%, poi la lavagna e la selezione, e un clic cambia lo zoom", () => {
    const port = fake({ zoomPercent: () => 100 });
    openZoomMenu(port);
    const menu = document.querySelector("#context-menu");
    expect(menu).not.toBeNull();
    const labels = [...menu!.querySelectorAll("button")].map((button) => button.textContent?.trim() ?? "");
    expect(labels.some((label) => label.includes(t("canvas.zoom.preset", { n: 50 })))).toBe(true);
    expect(labels.some((label) => label.includes(t("canvas.zoom.preset", { n: 200 })))).toBe(true);
    expect(labels.some((label) => label.includes("Mostra tutta la lavagna"))).toBe(true);
    const at200 = [...menu!.querySelectorAll("button")].find((button) => button.textContent?.includes(t("canvas.zoom.preset", { n: 200 })));
    at200?.click();
    expect(port.zoomed).toEqual([2]);
  });

  it("la selezione spenta resta vista, col perché, e non lancia il comando", () => {
    const port = fake();
    openZoomMenu(port);
    const selection = [...document.querySelectorAll<HTMLButtonElement>("#context-menu button")].find((button) => button.textContent?.includes("Inquadra la selezione"));
    expect(selection).toBeDefined();
    expect(selection?.getAttribute("aria-disabled")).toBe("true");
    selection?.click();
    expect(port.ran).toEqual([]);
  });
});

describe("la firma delle voci", () => {
  it("cambia con lo zoom, la scelta e la cartella, e resta uguale senza cambiamenti", () => {
    const base = statusSignature(canvasStatusItems(fake()));
    expect(statusSignature(canvasStatusItems(fake()))).toBe(base);
    expect(statusSignature(canvasStatusItems(fake({ zoomPercent: () => 50 })))).not.toBe(base);
    expect(statusSignature(canvasStatusItems(fake({ chosenCount: () => 2 })))).not.toBe(base);
    expect(statusSignature(canvasStatusItems(fake({ folder: () => "Foto" })))).not.toBe(base);
  });
});
