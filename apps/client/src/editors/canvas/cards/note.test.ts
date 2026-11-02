// @vitest-environment happy-dom
// La scheda di nota con una porta finta: viva, ferma, mai stata viva, errore,
// file mancante, cambio del file da ferma e da viva, e le risposte tardive
// (dopo `destroy`, dopo un cambio di modo, fra due rese) che non toccano il DOM.
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../i18n/strings";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import type { CardContext, CardMode, CardView } from "../cards";
import type { CanvasNode } from "../model";
import { noteCardRenderer, noteHeadingOf, type NoteCardPort } from "./note";

interface ShowCall {
  readonly path: string;
  readonly heading: string | null;
  readonly host: HTMLElement;
  readonly life: Lifetime;
  resolve(html?: string): void;
  reject(error: unknown): void;
}

class FakePort implements NoteCardPort {
  readonly calls: ShowCall[] = [];
  readonly watchers = new Map<string, Set<() => void>>();
  readonly opened: { path: string; subpath: string | null }[] = [];
  clicks = 0;
  throwNow: unknown = null;
  open?: (path: string, subpath: string | null) => void = (path, subpath) => {
    this.opened.push({ path, subpath });
  };

  show(path: string, heading: string | null, host: HTMLElement, life: Lifetime): Promise<void> {
    if (this.throwNow !== null) throw this.throwNow;
    return new Promise<void>((resolve, reject) => {
      this.calls.push({
        path,
        heading,
        host,
        life,
        // Come la shell: scrive la resa nell'elemento ricevuto e ci attacca
        // un ascoltatore che vive quanto `life`.
        resolve: (html = `<p>${path}</p><a href="#">link</a>`) => {
          host.innerHTML = html;
          const link = host.querySelector("a");
          if (link) life.listen(link, "click", () => (this.clicks += 1));
          resolve();
        },
        reject,
      });
    });
  }

  watch(path: string, changed: () => void): () => void {
    let set = this.watchers.get(path);
    if (!set) this.watchers.set(path, (set = new Set()));
    set.add(changed);
    return () => set.delete(changed);
  }

  change(path: string): void {
    for (const changed of [...(this.watchers.get(path) ?? [])]) changed();
  }

  last(): ShowCall {
    const call = this.calls[this.calls.length - 1];
    if (!call) throw new Error("show non è stato chiamato");
    return call;
  }
}

interface Mounted {
  readonly view: CardView;
  readonly host: HTMLElement;
  readonly context: CardContext & { missed: number };
  readonly lifetime: Lifetime;
}

function node(file: string): CanvasNode {
  return { id: `n-${file}`, type: "file", x: 0, y: 0, width: 300, height: 200, file };
}

function mount(port: FakePort, mode: CardMode, path = "Corsi/nota.md", subpath: string | null = null): Mounted {
  const host = document.createElement("div");
  document.body.append(host);
  const lifetime = openLifetime();
  const context = {
    path,
    subpath,
    documentId: "lavagna.canvas",
    lifetime,
    snapshots: { get: () => undefined, put: () => undefined, forget: () => undefined },
    size: () => ({ width: 300, height: 200 }),
    zoom: () => 1,
    missed: 0,
    missing() {
      context.missed += 1;
    },
  };
  const view = noteCardRenderer(port).mount(node(path), host, mode, context);
  return { view, host, context, lifetime };
}

function root(host: HTMLElement): HTMLElement {
  const element = host.querySelector<HTMLElement>(".canvas-card-note");
  if (!element) throw new Error("la scheda non c'è");
  return element;
}

function state(host: HTMLElement): string | undefined {
  return root(host).dataset.cardState;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await Promise.resolve();
}

function notFound(): unknown {
  return { kind: "not_found", message: "il file non c'è" };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("noteHeadingOf", () => {
  it("prende il titolo dal subpath, la nota intera per un blocco o niente", () => {
    expect(noteHeadingOf(null)).toBeNull();
    expect(noteHeadingOf("")).toBeNull();
    expect(noteHeadingOf("#")).toBeNull();
    expect(noteHeadingOf("#Titolo")).toBe("Titolo");
    expect(noteHeadingOf("# 1.2 Titolo ")).toBe("1.2 Titolo");
    expect(noteHeadingOf("#Capitolo#Sezione")).toBe("Sezione");
    expect(noteHeadingOf("#^blocco")).toBeNull();
  });
});

describe("noteCardRenderer", () => {
  it("mostra note e documenti", () => {
    expect(noteCardRenderer(new FakePort()).kinds).toEqual(["note", "document"]);
  });

  it("da viva dice «Apro…» e poi mostra la resa, con i suoi ascoltatori", async () => {
    const port = new FakePort();
    const { view, host } = mount(port, "live", "Corsi/nota.md", "#Titolo");
    expect(state(host)).toBe("loading");
    expect(root(host).textContent).toBe(t("canvas.card.loading"));
    expect(port.calls).toHaveLength(1);
    expect(port.last().path).toBe("Corsi/nota.md");
    expect(port.last().heading).toBe("Titolo");

    port.last().resolve();
    await settle();
    expect(state(host)).toBe("content");
    expect(root(host).inert).toBe(false);
    expect(root(host).textContent).toContain("Corsi/nota.md");
    host.querySelector("a")!.click();
    expect(port.clicks).toBe(1);
    expect(view.enter?.()).toBe(true);
    view.leave?.();
  });

  it("un blocco nel subpath chiede la nota intera", () => {
    const port = new FakePort();
    mount(port, "live", "nota.md", "#^abc123");
    expect(port.last().heading).toBeNull();
  });

  it("da ferma tiene la resa, inerte e senza ascoltatori", async () => {
    const port = new FakePort();
    const { view, host } = mount(port, "live");
    port.last().resolve();
    await settle();
    const shown = port.last();

    view.setMode("snapshot");
    expect(state(host)).toBe("content");
    expect(root(host).inert).toBe(true);
    expect(root(host).textContent).toContain("Corsi/nota.md");
    expect(shown.life.closed).toBe(true);
    host.querySelector("a")!.click();
    expect(port.clicks).toBe(0);
    expect(port.calls).toHaveLength(1);
    expect(view.enter?.()).toBe(false);
  });

  it("riaccesa rifà la resa e tiene quella di prima finché arriva", async () => {
    const port = new FakePort();
    const { view, host } = mount(port, "live");
    port.last().resolve("<p>prima</p>");
    await settle();
    view.setMode("snapshot");

    view.setMode("live");
    expect(port.calls).toHaveLength(2);
    expect(state(host)).toBe("content");
    expect(root(host).textContent).toBe("prima");
    port.last().resolve("<p>dopo</p>");
    await settle();
    expect(root(host).textContent).toBe("dopo");
    expect(root(host).inert).toBe(false);
  });

  it("mai stata viva mostra specie e percorso, senza chiedere la resa", () => {
    const port = new FakePort();
    const { view, host } = mount(port, "snapshot", "Corsi/nota.md");
    expect(state(host)).toBe("placeholder");
    expect(root(host).textContent).toBe(`${t("format.kind.note")} · Corsi/nota.md`);
    expect(root(host).inert).toBe(true);
    expect(port.calls).toHaveLength(0);
    expect(view.enter?.()).toBe(false);
  });

  it("un documento mai stato vivo dice la sua specie", () => {
    const { host } = mount(new FakePort(), "snapshot", "Relazione.docx");
    expect(root(host).textContent).toBe(`${t("format.kind.word")} · Relazione.docx`);
  });

  it("spenta mentre aspetta la prima resa torna al segnaposto e scarta la risposta", async () => {
    const port = new FakePort();
    const { view, host } = mount(port, "live");
    const pending = port.last();
    view.setMode("snapshot");
    expect(state(host)).toBe("placeholder");
    expect(pending.life.closed).toBe(true);

    pending.resolve();
    await settle();
    expect(state(host)).toBe("placeholder");
    expect(host.querySelector("a")).toBeNull();
  });

  it("se show lancia mostra la scheda di file con «Apri»", async () => {
    const port = new FakePort();
    const { view, host, context } = mount(port, "live", "Relazione.docx", "#Intro");
    port.last().reject(new Error("formato non reso"));
    await settle();
    expect(state(host)).toBe("unreadable");
    expect(root(host).textContent).toContain(t("canvas.card.unreadable", { name: "Relazione.docx" }));
    expect(port.last().life.closed).toBe(true);
    expect(context.missed).toBe(0);
    expect(view.enter?.()).toBe(false);

    const open = host.querySelector<HTMLButtonElement>("button")!;
    expect(open.textContent).toBe(t("canvas.card.open"));
    open.click();
    expect(port.opened).toEqual([{ path: "Relazione.docx", subpath: "#Intro" }]);

    // Da ferma il pulsante non ascolta più.
    view.setMode("snapshot");
    open.click();
    expect(port.opened).toHaveLength(1);
  });

  it("un errore lanciato subito da show è la stessa scheda di file", async () => {
    const port = new FakePort();
    port.throwNow = new Error("rotto");
    const { host } = mount(port, "live");
    await settle();
    expect(state(host)).toBe("unreadable");
  });

  it("senza open della porta non c'è il pulsante «Apri»", async () => {
    const port = new FakePort();
    port.open = undefined;
    const { host } = mount(port, "live");
    port.last().reject(new Error("no"));
    await settle();
    expect(state(host)).toBe("unreadable");
    expect(host.querySelector("button")).toBeNull();
  });

  it("il file che non c'è chiama missing", async () => {
    const port = new FakePort();
    const { host, context } = mount(port, "live");
    port.last().reject(notFound());
    await settle();
    expect(context.missed).toBe(1);
    expect(state(host)).toBe("missing");
    expect(host.querySelector("button")).toBeNull();
  });

  it("riaccesa dopo un errore riprova", async () => {
    const port = new FakePort();
    const { view, host } = mount(port, "live");
    port.last().reject(new Error("una volta"));
    await settle();
    view.setMode("snapshot");
    view.setMode("live");
    port.last().resolve();
    await settle();
    expect(state(host)).toBe("content");
  });

  it("la nota vuota è una resa vuota, non un errore", async () => {
    const port = new FakePort();
    const { host } = mount(port, "live");
    port.last().resolve("");
    await settle();
    expect(state(host)).toBe("content");
    expect(root(host).textContent).toBe("");
  });

  it("il file che cambia da viva si ridisegna", async () => {
    const port = new FakePort();
    const { host } = mount(port, "live");
    port.last().resolve("<p>uno</p>");
    await settle();
    const first = port.last();

    port.change("Corsi/nota.md");
    expect(port.calls).toHaveLength(2);
    port.last().resolve("<p>due</p>");
    await settle();
    expect(root(host).textContent).toBe("due");
    expect(first.life.closed).toBe(true);
    expect(port.last().life.closed).toBe(false);
  });

  it("il file che cambia da ferma si rifà alla prossima accensione", async () => {
    const port = new FakePort();
    const { view, host } = mount(port, "live");
    port.last().resolve("<p>uno</p>");
    await settle();
    view.setMode("snapshot");

    port.change("Corsi/nota.md");
    expect(port.calls).toHaveLength(1);
    expect(root(host).textContent).toBe("uno");

    view.setMode("live");
    expect(port.calls).toHaveLength(2);
    port.last().resolve("<p>due</p>");
    await settle();
    expect(root(host).textContent).toBe("due");
  });

  it("fra due rese vince l'ultima, anche se la prima arriva dopo", async () => {
    const port = new FakePort();
    const { host } = mount(port, "live");
    const old = port.last();
    port.change("Corsi/nota.md");
    const latest = port.last();

    latest.resolve("<p>nuova</p>");
    await settle();
    old.resolve("<p>vecchia</p>");
    await settle();
    expect(root(host).textContent).toBe("nuova");
    expect(old.life.closed).toBe(true);
    expect(latest.life.closed).toBe(false);
  });

  it("dopo destroy nessuna risposta tardiva scrive nel DOM", async () => {
    const port = new FakePort();
    const { view, host } = mount(port, "live");
    const pending = port.last();
    const card = root(host);
    view.destroy();
    expect(host.childNodes).toHaveLength(0);
    expect(pending.life.closed).toBe(true);
    expect(port.watchers.get("Corsi/nota.md")?.size ?? 0).toBe(0);

    pending.resolve();
    await settle();
    expect(host.childNodes).toHaveLength(0);
    expect(pending.host.isConnected).toBe(false);
    // Nemmeno la radice staccata riceve la resa: resta com'era a destroy.
    expect(card.dataset.cardState).toBe("loading");
    expect(card.contains(pending.host)).toBe(false);

    // Un secondo destroy e i cambi di modo dopo non fanno niente.
    view.destroy();
    view.setMode("snapshot");
    view.setMode("live");
    expect(port.calls).toHaveLength(1);
  });

  it("dopo destroy un errore tardivo non chiama missing", async () => {
    const port = new FakePort();
    const { view, host, context } = mount(port, "live");
    view.destroy();
    port.last().reject(notFound());
    await settle();
    expect(context.missed).toBe(0);
    expect(host.childNodes).toHaveLength(0);
  });

  it("destroy chiude la resa mostrata e smette di ascoltare il file", async () => {
    const port = new FakePort();
    const { view } = mount(port, "live");
    port.last().resolve();
    await settle();
    view.destroy();
    expect(port.last().life.closed).toBe(true);
    port.change("Corsi/nota.md");
    expect(port.calls).toHaveLength(1);
  });

  it("la vita del contesto chiusa vale come destroy", async () => {
    const port = new FakePort();
    const { host, lifetime } = mount(port, "live");
    const pending = port.last();
    lifetime.close();
    expect(host.childNodes).toHaveLength(0);
    pending.resolve();
    await settle();
    expect(host.childNodes).toHaveLength(0);
  });

  it("la stessa nota due volte: due schede indipendenti", async () => {
    const port = new FakePort();
    const a = mount(port, "live");
    const b = mount(port, "live");
    expect(port.calls).toHaveLength(2);
    port.calls[0]!.resolve("<p>a</p>");
    port.calls[1]!.resolve("<p>b</p>");
    await settle();

    a.view.destroy();
    expect(root(b.host).textContent).toBe("b");
    port.change("Corsi/nota.md");
    expect(port.calls).toHaveLength(3);
    port.last().resolve("<p>b2</p>");
    await settle();
    expect(root(b.host).textContent).toBe("b2");
    expect(a.host.childNodes).toHaveLength(0);
  });

  it("setMode allo stesso modo non fa niente", () => {
    const port = new FakePort();
    const { view } = mount(port, "live");
    view.setMode("live");
    expect(port.calls).toHaveLength(1);
  });
});
