// @vitest-environment happy-dom
//
// **I commenti di una nota**, sulla shell vera contro l'host finto (T22).
//
// Chi rivede una nota seleziona un passo, preme Ctrl Alt M e scrive; apre la
// discussione dal segno, risponde, la risolve; dal pannello «Commenti» svuota
// i risolti; annulla un gesto alla volta. Il file sul disco, riletto alla
// fine, ha ogni volta ciò che si vede: il commento in CriticMarkup, poi la
// discussione nell'archivio `%%` in fondo, poi la nota pulita. Il cablaggio è
// quello di `annotations.e2e.test.ts`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry, SyntaxForm } from "./host/contract";
import type { FakeHost } from "./host/fake";
import { MARKDOWN_SYNTAX } from "./rules/syntax.generated";
import { mountedTextEditors } from "./editors/text/test-support";
import { FIRST_IMPORT_MS, waiter } from "./test-wait";

vi.setConfig({ testTimeout: 30_000 });

const box = vi.hoisted(() => ({ host: null as FakeHost | null }));

let activeStop: (() => void) | null = null;

vi.mock("./host/ipc", () => {
  const now = () => {
    if (!box.host) throw new Error("l'host finto non è stato montato");
    return box.host.module;
  };
  return {
    api: new Proxy(
      {},
      {
        get: (_t, name: string) => (...args: unknown[]) =>
          (now().api as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args),
      },
    ),
    onKernelEvent: (handler: (n: unknown) => void) => now().onKernelEvent(handler as never),
    onClose: (first: () => Promise<boolean>, onFailure: (reason: unknown) => void) => now().onClose(first, onFailure),
    window: {
      minimize: async () => {},
      toggleMaximize: async () => {},
      close: async () => {},
      isMaximized: async () => false,
      setTitle: async () => {},
      onResize: async () => async () => {},
    },
  };
});

vi.mock("./host/dialog", () => ({
  confirm: () => Promise.resolve(true),
  pickFolder: () => Promise.resolve("/vault"),
  pickFile: () => Promise.resolve(null),
}));

vi.mock("mermaid", () => ({
  default: { initialize() {}, render: async () => ({ svg: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>" }) },
}));

const { createFakeHost } = await import("./host/fake");
const rawHtml = (await import("../index.html?raw")).default;

const NOTE = "Nota.md";
const TEXT = "# Prestiti\n\nLa conferma dei prestiti arriva entro venerdì.\n";

/// Le due impostazioni della firma, come le dichiara l'host (T22).
function signerRows(name: string): SettingEntry[] {
  return [
    {
      spec: {
        key: "profile.name", label: "Il tuo nome", description: "", group: "Profilo", scope: "machine",
        kind: { kind: "text", default: "" }, program_writable: false,
      },
      value: name,
      source: "machine",
    },
    {
      spec: {
        key: "comments.author", label: "Firma dei commenti in questo vault", description: "", group: "Profilo", scope: "vault",
        kind: { kind: "choice", default: "nome", options: [{ value: "nome", label: "Il nome" }, { value: "iniziali", label: "Le iniziali" }, { value: "niente", label: "Nessuna firma" }] },
        program_writable: false,
      },
      value: "nome",
      source: "default",
    },
  ] as SettingEntry[];
}

async function start(name: string): Promise<FakeHost> {
  vi.resetModules();
  const host = createFakeHost({
    file: { [NOTE]: TEXT },
    settings: signerRows(name),
    syntaxForms: MARKDOWN_SYNTAX.map((form) => ({ ...form })) as unknown as SyntaxForm[],
  });
  box.host = host;
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(rawHtml);
  if (!body) throw new Error("index.html non ha un body");
  document.body.innerHTML = body[1].replace(/<script[\s\S]*?<\/script>/g, "");
  const main = await import("./main");
  activeStop = await main.startup;
  await settle();
  return host;
}

async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

const waitFor = waiter(4000);

async function open(doc: string): Promise<void> {
  const { openDocument } = await import("./panels/document");
  await openDocument(doc);
  await settle();
  await waitFor(`${doc} montato`, () => mountedTextEditors().length > 0, FIRST_IMPORT_MS);
}

const popover = () => document.querySelector<HTMLElement>(".cm-fub-comment-popover");
const onDisk = (host: FakeHost) => (host.files()[NOTE] ?? "").replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/g, "DATA");

function typeAndSend(text: string): void {
  const input = popover()!.querySelector<HTMLTextAreaElement>(".cm-fub-comment-input")!;
  input.value = text;
  input.dispatchEvent(new Event("input"));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
}

function press(label: string): void {
  const button = [...popover()!.querySelectorAll<HTMLButtonElement>("button")].find((each) => each.textContent === label);
  if (!button) throw new Error(`nessun pulsante «${label}»`);
  button.click();
}

function key(target: Element, init: KeyboardEventInit): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
}

beforeEach(() => {
  activeStop?.();
  activeStop = null;
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("i commenti di una nota, dal primo messaggio al file pulito", () => {
  it("scrive, risponde, risolve, svuota, annulla, e il file riletto ha ogni volta ciò che si vede", async () => {
    const host = await start("Anna Bianchi");
    await open(NOTE);
    const view = mountedTextEditors()[0]!;
    await waitFor("le forme della nota", () => view.state.doc.length === TEXT.length);

    // Seleziona «conferma dei prestiti» e Ctrl Alt M.
    const from = TEXT.indexOf("conferma");
    // happy-dom manda `selectionchange` dentro l'aggiornamento di una vista
    // a fuoco, e CodeMirror rifiuta di rientrare: la selezione si mette a
    // vista ferma, come farebbe il mouse prima del fuoco.
    (document.activeElement as HTMLElement | null)?.blur();
    view.dispatch({ selection: { anchor: from, head: from + "conferma dei prestiti".length } });
    key(view.contentDOM, { key: "m", code: "KeyM", ctrlKey: true, altKey: true });
    await waitFor("il riquadro del primo messaggio", () => popover() !== null);
    expect(popover()!.querySelector(".cm-fub-comment-quote")!.textContent).toBe("conferma dei prestiti");
    typeAndSend("Il museo risponde entro venerdì?");
    const commented = "# Prestiti\n\nLa {==conferma dei prestiti==}{>>@Anna Bianchi DATA: Il museo risponde entro venerdì?<<} arriva entro venerdì.\n";
    await waitFor("il commento arriva al disco", () => onDisk(host) === commented);

    // La risposta, dalla discussione.
    const anchor = view.state.doc.toString().indexOf("conferma");
    await waitFor("il segno del commento", () => document.querySelector(`[data-anchor="${anchor}"]`) !== null);
    document.querySelector<HTMLElement>(`[data-anchor="${anchor}"]`)!.click();
    await waitFor("la discussione", () => popover()?.querySelector(".cm-fub-comment-message") !== null);
    typeAndSend("Sì, confermato.");
    const replied = commented.replace("?<<}", "?<<}{>>@Anna Bianchi DATA: Sì, confermato.<<}");
    await waitFor("la risposta arriva al disco", () => onDisk(host) === replied);

    // Risolvi: il paragrafo torna pulito, la discussione va in fondo.
    press("Risolvi");
    const resolved = "# Prestiti\n\nLa conferma dei prestiti arriva entro venerdì.\n\n"
      + "%%fub:risolto DATA: conferma dei prestiti%%\n"
      + "%%> @Anna Bianchi DATA: Il museo risponde entro venerdì?%%\n"
      + "%%> @Anna Bianchi DATA: Sì, confermato.%%\n";
    await waitFor("la risoluzione arriva al disco", () => onDisk(host) === resolved);
    expect(popover()).toBeNull();

    // «Svuota i risolti», dal pannello «Commenti» del documento, nell'ispettore.
    const panel = () => document.querySelector<HTMLElement>('.surface-panel[data-view-id="markdown.comments"]');
    await waitFor("il pannello «Commenti»", () => panel()?.querySelector(".cm-fub-comments-archived") != null);
    expect(panel()!.querySelector(".panel-title")!.textContent).toBe("Commenti");
    expect(panel()!.querySelector(".cm-fub-comments-archived")!.textContent).toBe("2 messaggi, archiviati in fondo alla nota in un commento %%");
    panel()!.querySelector<HTMLButtonElement>("[data-action=clear]")!.click();
    await waitFor("l'archivio esce dal disco", () => onDisk(host) === TEXT);

    // Annulla, un gesto alla volta: lo svuotamento, la risoluzione, la
    // risposta, il commento.
    for (const expected of [resolved, replied, commented, TEXT]) {
      key(view.contentDOM, { key: "z", code: "KeyZ", ctrlKey: true });
      await waitFor(`annullato fino a ${expected.slice(0, 40)}`, () => onDisk(host) === expected);
    }
  });
});
