// @vitest-environment happy-dom
// Il visore web dalla finestra principale: un sito nuovo si apre soltanto dopo
// il sì, che lo ricorda; uno rifiutato non si apre e non si richiede a ogni
// redirect; ciò che non è https va al browser; la pagina si salva come nota
// dall'host.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry, ViewerEvent } from "../host/contract";

const fake = vi.hoisted(() => ({
  open: vi.fn(),
  control: vi.fn(),
  invoke: vi.fn(),
  setSetting: vi.fn(),
  settings: vi.fn(),
  heard: null as null | ((event: ViewerEvent) => void),
}));
vi.mock("../host/ipc", () => ({
  api: {
    viewerOpen: fake.open,
    viewerControl: fake.control,
    invokeCommand: fake.invoke,
    setSetting: fake.setSetting,
    onViewer: (handler: (event: ViewerEvent) => void) => {
      fake.heard = handler;
      return Promise.resolve(() => { fake.heard = null; });
    },
  },
}));
vi.mock("../host/query", () => ({ settings: fake.settings }));
vi.mock("../state/kernel", () => ({ onEvent: () => () => {} }));

import { mountWebViewer, openWebLink, openWebPage, viewerSite, type WebViewerPorts } from "./web-viewer";
import { openLifetime } from "./lifetime";

const entry = (key: string, value: SettingEntry["value"]): SettingEntry =>
  ({ spec: { key }, value, source: "default" }) as unknown as SettingEntry;

type Mocked = { [K in keyof WebViewerPorts]: ReturnType<typeof vi.fn<WebViewerPorts[K]>> };

function ports(answer = true): Mocked {
  return {
    confirm: vi.fn<WebViewerPorts["confirm"]>(async () => answer),
    notify: vi.fn<WebViewerPorts["notify"]>(),
    show: vi.fn<WebViewerPorts["show"]>(async () => {}),
    openExternal: vi.fn<WebViewerPorts["openExternal"]>(),
  };
}

let approved: string[] = [];
let links = false;

beforeEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
  approved = [];
  links = false;
  fake.settings.mockImplementation(async () => [entry("viewer.hosts", [...approved]), entry("viewer.links", links)]);
  fake.setSetting.mockImplementation(async (_key: string, value: string[]) => { approved = value; });
  fake.open.mockResolvedValue("fub-viewer");
  fake.control.mockResolvedValue(undefined);
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const bar = () => document.querySelector<HTMLElement>(".web-viewer-bar")!;

describe("visore web", () => {
  it("il sito è quello che il visore apre: https, porta 443, senza credenziali", () => {
    expect(viewerSite("https://It.Wikipedia.org/wiki/Lago?x#y")).toBe("it.wikipedia.org");
    expect(viewerSite("https://esempio.it:443/")).toBe("esempio.it");
    expect(viewerSite("http://esempio.it/")).toBeNull();
    expect(viewerSite("https://esempio.it:8443/")).toBeNull();
    expect(viewerSite("https://io@esempio.it/")).toBeNull();
    expect(viewerSite("javascript:alert(1)")).toBeNull();
  });

  it("un sito nuovo si apre dopo il sì, che lo ricorda; la volta dopo non si chiede", async () => {
    const p = ports(true);
    const viewer = mountWebViewer(openLifetime(), document.body, p);
    expect(await viewer.open("https://esempio.it/lago")).toBe(true);
    expect(p.confirm).toHaveBeenCalledTimes(1);
    expect(fake.setSetting).toHaveBeenCalledWith("viewer.hosts", ["esempio.it"]);
    expect(fake.open).toHaveBeenCalledWith("https://esempio.it/lago", "esempio.it", {
      allowRemote: true,
      allowlist: ["esempio.it"],
    });
    expect(bar().hidden).toBe(false);
    expect(bar().textContent).toContain("https://esempio.it/lago");

    expect(await viewer.open("https://esempio.it/monti")).toBe(true);
    expect(p.confirm).toHaveBeenCalledTimes(1);
  });

  it("un no non apre niente e non ricorda niente", async () => {
    const p = ports(false);
    const viewer = mountWebViewer(openLifetime(), document.body, p);
    expect(await viewer.open("https://esempio.it/")).toBe(false);
    expect(fake.open).not.toHaveBeenCalled();
    expect(fake.setSetting).not.toHaveBeenCalled();
    expect(bar().hidden).toBe(true);
  });

  it("ciò che non è https va al browser di sistema, senza domande", async () => {
    const p = ports(true);
    const viewer = mountWebViewer(openLifetime(), document.body, p);
    expect(await viewer.open("http://esempio.it/")).toBe(false);
    expect(p.openExternal).toHaveBeenCalledWith("http://esempio.it/");
    expect(p.confirm).not.toHaveBeenCalled();
    expect(fake.open).not.toHaveBeenCalled();
  });

  it("una pagina fermata su un altro sito chiede una volta; rifiutato, tace", async () => {
    approved = ["esempio.it"];
    const p = ports(false);
    mountWebViewer(openLifetime(), document.body, p);
    await settle();
    fake.heard?.({ kind: "blocked", url: "https://altro.it/a" });
    await settle();
    fake.heard?.({ kind: "blocked", url: "https://altro.it/b" });
    await settle();
    expect(p.confirm).toHaveBeenCalledTimes(1);
    expect(p.confirm).toHaveBeenCalledWith(expect.stringContaining("altro.it"), expect.anything());
    expect(fake.open).not.toHaveBeenCalled();
  });

  it("i link delle note vanno al browser, al visore con l'Alt o con la preferenza", async () => {
    approved = ["esempio.it"];
    const p = ports(true);
    const life = openLifetime();
    mountWebViewer(life, document.body, p);
    await settle();
    openWebLink("https://esempio.it/", false);
    expect(p.openExternal).toHaveBeenCalledWith("https://esempio.it/");
    openWebLink("https://esempio.it/", true);
    await settle();
    expect(fake.open).toHaveBeenCalledTimes(1);
    life.close();

    links = true;
    const again = ports(true);
    mountWebViewer(openLifetime(), document.body, again);
    await settle();
    openWebLink("https://esempio.it/", false);
    await settle();
    expect(again.openExternal).not.toHaveBeenCalled();
    expect(fake.open).toHaveBeenCalledTimes(2);
  });

  it("salva la pagina mostrata come nota dall'host e la apre", async () => {
    approved = ["esempio.it"];
    fake.invoke.mockResolvedValue({ notify: "Pagina salvata in Web/Lago.md.", effect: { kind: "navigate", doc: "Web/Lago.md" } });
    const p = ports(true);
    mountWebViewer(openLifetime(), document.body, p);
    await settle();
    fake.heard?.({ kind: "navigated", url: "https://esempio.it/lago" });
    const save = Array.from(bar().querySelectorAll("button")).find((button) => button.textContent === "Salva come nota")!;
    save.click();
    await settle();
    expect(fake.invoke).toHaveBeenCalledWith("web.clip", { url: "https://esempio.it/lago" }, "apply");
    expect(p.notify).toHaveBeenCalledWith("Pagina salvata in Web/Lago.md.", "info");
    expect(p.show).toHaveBeenCalledWith("Web/Lago.md");

    fake.heard?.({ kind: "closed" });
    expect(bar().hidden).toBe(true);
  });

  it("i gesti della barra arrivano alla finestra; smontato, il visore se ne va", async () => {
    const life = openLifetime();
    mountWebViewer(life, document.body, ports());
    await settle();
    fake.heard?.({ kind: "navigated", url: "https://esempio.it/" });
    const press = (label: string) =>
      Array.from(bar().querySelectorAll("button")).find((button) => button.textContent === label)!.click();
    press("Indietro");
    press("Ricarica");
    press("Chiudi");
    expect(fake.control.mock.calls.map(([action]) => action)).toEqual(["back", "reload", "close"]);
    life.close();
    expect(document.querySelector(".web-viewer-bar")).toBeNull();
    expect(fake.heard).toBeNull();
    const external = vi.spyOn(window, "open").mockReturnValue(null);
    await openWebPage("https://esempio.it/");
    expect(external).toHaveBeenCalled();
    external.mockRestore();
  });
});
