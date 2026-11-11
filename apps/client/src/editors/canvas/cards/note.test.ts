// @vitest-environment happy-dom
// La scheda di nota con una porta finta: viva, ferma, mai stata viva, errore,
// file mancante, cambio del file da ferma e da viva, e le risposte tardive
// (dopo `destroy`, dopo un cambio di modo, fra due rese) che non toccano il DOM.
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../i18n/strings";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import type {
  CardContext,
  CardEditor,
  CardEditorOptions,
  CardEditorPort,
  CardEditorState,
  CardMode,
  CardView,
  CardWriting,
} from "../cards";
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

function mount(
  port: FakePort,
  mode: CardMode,
  path = "Corsi/nota.md",
  subpath: string | null = null,
  extra: Partial<CardContext> = {},
): Mounted {
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
    ...extra,
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

// --- scrivere nella scheda (T41) ---------------------------------------------

interface OpenCall {
  readonly path: string;
  readonly host: HTMLElement;
  readonly options: CardEditorOptions;
  resolve(editor: CardEditor | null): void;
  reject(error: unknown): void;
}

/// Un editor finto: dice lo stato che gli si dà, conta uscite e smontaggi.
class FakeEditor implements CardEditor {
  current: CardEditorState = "salvato";
  /// Il perché della sola lettura che la porta darebbe; `undefined`: la porta
  /// non lo sa dire (niente `readOnlyWhy`).
  why: string | null | undefined = undefined;
  /// La sessione chiusa sotto l'editor (il file tolto).
  gone = false;
  focused = 0;
  left = 0;
  destroyed = 0;
  readonly listeners = new Set<(state: CardEditorState) => void>();
  readonly bar = document.createElement("div");
  leaving: Promise<void> = Promise.resolve();
  constructor(
    readonly host: HTMLElement,
    life: Lifetime,
  ) {
    const cm = document.createElement("div");
    cm.className = "cm-editor";
    host.append(cm);
    this.bar.className = "format-bar";
    // Come la porta: chiusa la vita della scheda, l'editor si smonta.
    life.add(() => this.destroy());
  }
  focus(): void {
    this.focused += 1;
  }
  leave(): Promise<void> {
    this.left += 1;
    return this.leaving;
  }
  state(): CardEditorState {
    return this.current;
  }
  onState(listener: (state: CardEditorState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  set(state: CardEditorState): void {
    this.current = state;
    for (const listener of [...this.listeners]) listener(state);
  }
  readonly readOnlyWhy = (): string | null => this.why ?? null;
  closed(): boolean {
    return this.gone;
  }
  toolbar(): HTMLElement {
    return this.bar;
  }
  destroy(): void {
    // Una volta sola, come la porta.
    if (this.destroyed > 0) return;
    this.destroyed = 1;
    this.host.replaceChildren();
  }
}

class FakeEditors implements CardEditorPort {
  readonly calls: OpenCall[] = [];
  open(path: string, host: HTMLElement, options: CardEditorOptions): Promise<CardEditor | null> {
    return new Promise((resolve, reject) => this.calls.push({ path, host, options, resolve, reject }));
  }
  last(): OpenCall {
    const call = this.calls[this.calls.length - 1];
    if (!call) throw new Error("open non è stato chiamato");
    return call;
  }
  /// Risponde all'ultima apertura con un editor finto montato nel suo host.
  give(): FakeEditor {
    const call = this.last();
    const editor = new FakeEditor(call.host, call.options.lifetime);
    call.resolve(editor);
    return editor;
  }
}

interface Writing {
  readonly writings: (CardWriting | null)[];
  readonly states: { state: CardEditorState | null; reason: string | undefined }[];
  readonly extra: Partial<CardContext>;
}

function writing(editors: CardEditorPort | undefined): Writing {
  const writings: (CardWriting | null)[] = [];
  const states: { state: CardEditorState | null; reason: string | undefined }[] = [];
  return {
    writings,
    states,
    extra: {
      ...(editors ? { editors } : {}),
      writing: (value) => writings.push(value),
      editState: (state, reason) => states.push({ state, reason }),
    },
  };
}

/// Una scheda viva con la resa arrivata, pronta a scrivere.
async function shown(port: FakePort, editors: FakeEditors | undefined, path = "Corsi/nota.md", subpath: string | null = null) {
  const spy = writing(editors);
  const mounted = mount(port, "live", path, subpath, spy.extra);
  port.last().resolve("<h1>Titolo</h1><p>testo</p>");
  await settle();
  return { ...mounted, ...spy };
}

const writers = (host: HTMLElement): HTMLElement[] =>
  [...host.querySelectorAll<HTMLElement>('.canvas-card-note[data-card-state="editing"]')];

describe("scrivere nella scheda di nota (T41)", () => {
  it("edit() chiede l'editor alla porta e lo mette al posto della resa", async () => {
    const port = new FakePort();
    const editors = new FakeEditors();
    const card = await shown(port, editors, "Corsi/nota.md", "#Titolo");

    expect(card.view.edit?.()).toBe(true);
    expect(editors.calls).toHaveLength(1);
    const call = editors.last();
    expect(call.path).toBe("Corsi/nota.md");
    expect(call.options.readOnly).toBe(false);
    // Con `Nota#Titolo` la nota intera, vista dal titolo.
    expect(call.options.heading).toBe("Titolo");
    // Finché l'editor non c'è si vede la resa.
    expect(writers(card.host)[0]!.hidden).toBe(true);
    expect(root(card.host).hidden).toBe(false);
    // Un secondo edit() mentre si apre non apre un altro editor.
    expect(card.view.edit?.()).toBe(true);
    expect(editors.calls).toHaveLength(1);

    const editor = editors.give();
    await settle();
    expect(root(card.host).hidden).toBe(true);
    expect(writers(card.host)[0]!.hidden).toBe(false);
    expect(writers(card.host)[0]!.querySelector(".cm-editor")).not.toBeNull();
    expect(card.writings).toEqual([{ toolbar: editor.bar }]);
    expect(editor.focused).toBe(1);

    // Lo stato della sessione va alla riga del titolo, ognuno com'è (T96).
    editor.set("in_corso");
    editor.set("non_salvato");
    editor.set("fallito");
    editor.set("conflitto");
    editor.set("salvato");
    expect(card.states).toEqual([
      { state: "salvato", reason: undefined },
      { state: "in_corso", reason: undefined },
      { state: "non_salvato", reason: undefined },
      { state: "fallito", reason: undefined },
      { state: "conflitto", reason: undefined },
      { state: "salvato", reason: undefined },
    ]);
  });

  it("leave() porta il testo alla sessione, smonta l'editor e rifà la resa col testo nuovo", async () => {
    const port = new FakePort();
    const editors = new FakeEditors();
    const card = await shown(port, editors);
    card.view.edit?.();
    const editor = editors.give();
    let saved!: () => void;
    editor.leaving = new Promise((resolve) => (saved = resolve));
    await settle();
    const before = port.calls.length;

    card.view.leave?.();
    expect(editor.left).toBe(1);
    // Fino al salvataggio l'editor resta, fermo.
    expect(editor.destroyed).toBe(0);
    expect(writers(card.host)[0]!.inert).toBe(true);
    // Uno stato che arriva dopo l'uscita non scrive più nella riga del titolo.
    const states = card.states.length;
    editor.set("non_salvato");
    expect(card.states).toHaveLength(states);

    saved();
    await settle();
    expect(editor.destroyed).toBe(1);
    expect(writers(card.host)).toHaveLength(0);
    expect(root(card.host).hidden).toBe(false);
    expect(port.calls.length).toBe(before + 1);
    port.last().resolve("<p>testo nuovo</p>");
    await settle();
    expect(root(card.host).textContent).toBe("testo nuovo");
  });

  it("mentre si scrive i cambi del file non rifanno la resa", async () => {
    const port = new FakePort();
    const editors = new FakeEditors();
    const card = await shown(port, editors);
    card.view.edit?.();
    editors.give();
    await settle();
    const before = port.calls.length;
    port.change("Corsi/nota.md");
    expect(port.calls.length).toBe(before);
    expect(card.writings).toHaveLength(1);
  });

  it("senza editor per il file la scheda resta a leggere", async () => {
    const port = new FakePort();
    const editors = new FakeEditors();
    const card = await shown(port, editors);
    card.view.edit?.();
    editors.last().resolve(null);
    await settle();
    expect(card.writings).toEqual([null]);
    expect(writers(card.host)).toHaveLength(0);
    expect(root(card.host).hidden).toBe(false);
    expect(root(card.host).textContent).toBe("Titolotesto");
  });

  it("una nota di sola lettura non si scrive e dice perché, con le parole della porta (T96)", async () => {
    const port = new FakePort();
    const editors = new FakeEditors();
    const card = await shown(port, editors);
    card.view.edit?.();
    const call = editors.last();
    const editor = new FakeEditor(call.host, call.options.lifetime);
    editor.current = "readonly";
    editor.why = "Aperto in Craft. Fub non lo modifica finché non lo riprendi.";
    call.resolve(editor);
    await settle();
    expect(editor.destroyed).toBe(1);
    expect(card.writings).toEqual([null]);
    expect(card.states).toEqual([{ state: "readonly", reason: editor.why }]);
    expect(root(card.host).hidden).toBe(false);
    // Una porta che non sa dire perché: la frase della scheda.
    const plain = await shown(port, editors);
    plain.view.edit?.();
    const next = editors.last();
    const quiet = new FakeEditor(next.host, next.options.lifetime);
    quiet.current = "readonly";
    next.resolve(quiet);
    await settle();
    expect(plain.states).toEqual([{ state: "readonly", reason: t("canvas.card.readonly_why", { name: "nota.md" }) }]);
  });

  it("la sola lettura che arriva mentre si scrive resta nella riga del titolo, col perché", async () => {
    const port = new FakePort();
    const editors = new FakeEditors();
    const card = await shown(port, editors);
    card.view.edit?.();
    const editor = editors.give();
    await settle();
    editor.why = "«nota.md» è in sola lettura: aspetta la tua risposta sulla cancellazione.";
    editor.set("readonly");
    expect(card.states[card.states.length - 1]).toEqual({ state: "readonly", reason: editor.why });
    // La scheda continua a mostrare l'editor (fermo): si legge e si copia.
    expect(editor.destroyed).toBe(0);
    expect(card.writings).toHaveLength(1);
    editor.why = null;
    editor.set("non_salvato");
    expect(card.states[card.states.length - 1]).toEqual({ state: "non_salvato", reason: undefined });
  });

  it("il file tolto mentre si scrive: la scheda torna alla resa, che dice che manca", async () => {
    const port = new FakePort();
    const editors = new FakeEditors();
    const card = await shown(port, editors);
    card.view.edit?.();
    const editor = editors.give();
    await settle();
    const before = port.calls.length;
    editor.gone = true;
    editor.set("readonly");
    expect(editor.destroyed).toBe(1);
    expect(card.writings).toEqual([{ toolbar: editor.bar }, null]);
    expect(card.states[card.states.length - 1]).toEqual({ state: null, reason: undefined });
    expect(writers(card.host)).toHaveLength(0);
    expect(port.calls.length).toBe(before + 1);
    port.last().reject({ kind: "not_found", message: "il file non c'è" });
    await settle();
    expect(state(card.host)).toBe("missing");
    expect(card.context.missed).toBe(1);
  });

  it("un avviso che la porta mette in cima all'editor si vede nella scheda", async () => {
    const port = new FakePort();
    // La porta vera disegna gli avvisi di un riquadro nel contenitore
    // dell'editor (`state/card-editors.ts`): qui li mette a mano.
    const editors: CardEditorPort = {
      open: (_path, host, options) => {
        const notices = document.createElement("div");
        notices.className = "sheet-notices";
        notices.textContent = "Bozza ritrovata.";
        host.prepend(notices);
        return Promise.resolve(new FakeEditor(host, options.lifetime));
      },
    };
    const spy = writing(editors);
    const writer = mount(port, "live", "Corsi/nota.md", null, spy.extra);
    port.last().resolve("<p>testo</p>");
    await settle();
    expect(writer.view.edit?.()).toBe(true);
    await settle();
    const box = writers(writer.host)[0]!;
    expect(box.hidden).toBe(false);
    expect(box.firstElementChild?.className).toBe("sheet-notices");
    expect(box.querySelector(".cm-editor")).not.toBeNull();
  });

  it("non scrive senza porta, in un documento Word, da ferma o senza resa", async () => {
    const port = new FakePort();
    const editors = new FakeEditors();
    expect((await shown(port, undefined)).view.edit?.()).toBe(false);
    expect((await shown(port, editors, "Corsi/lettera.docx")).view.edit?.()).toBe(false);
    const still = mount(port, "snapshot", "Corsi/nota.md", null, writing(editors).extra);
    expect(still.view.edit?.()).toBe(false);
    const failing = mount(port, "live", "Corsi/rotta.md", null, writing(editors).extra);
    port.last().reject(new Error("guasto"));
    await settle();
    expect(failing.view.edit?.()).toBe(false);
    expect(editors.calls).toHaveLength(0);
  });

  it("Esc prima che l'editor arrivi ferma l'apertura; l'editor tardivo si smonta", async () => {
    const port = new FakePort();
    const editors = new FakeEditors();
    const card = await shown(port, editors);
    card.view.edit?.();
    const call = editors.last();
    card.view.leave?.();
    expect(call.options.lifetime.closed).toBe(true);
    expect(writers(card.host)).toHaveLength(0);
    const late = new FakeEditor(call.host, openLifetime());
    call.resolve(late);
    await settle();
    expect(late.destroyed).toBe(1);
    expect(card.writings).toEqual([]);
  });

  it("ferma o distrutta, la scheda smette di scrivere e smonta l'editor", async () => {
    const port = new FakePort();
    const editors = new FakeEditors();
    const card = await shown(port, editors);
    card.view.edit?.();
    const editor = editors.give();
    await settle();
    card.view.setMode("snapshot");
    expect(editor.destroyed).toBe(1);
    expect(root(card.host).hidden).toBe(false);

    card.view.setMode("live");
    port.last().resolve("<p>di nuovo</p>");
    await settle();
    card.view.edit?.();
    const second = editors.give();
    await settle();
    card.view.destroy();
    expect(second.destroyed).toBe(1);
    expect(card.host.childNodes).toHaveLength(0);
  });
});
