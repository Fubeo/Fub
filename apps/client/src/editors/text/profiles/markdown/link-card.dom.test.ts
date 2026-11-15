// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { markdownGrammar } from "./grammar";
import { createTextEngine } from "../../engine";
import { livePreview } from "./livepreview";
import { bareUrl, bareWikilink, coverColor, linkCardsChanged, safeIcon, type LinkCardSource, type LinkCardView, type NoteCardView } from "./link-card";

describe("bareUrl", () => {
  it("riconosce soltanto un indirizzo web da solo nel paragrafo", () => {
    expect(bareUrl("https://esempio.it/a?b=1")).toBe("https://esempio.it/a?b=1");
    expect(bareUrl("  <http://esempio.it>  ")).toBe("http://esempio.it");
    expect(bareUrl("Vedi https://esempio.it")).toBeNull();
    expect(bareUrl("https://a.it https://b.it")).toBeNull();
    expect(bareUrl("[testo](https://esempio.it)")).toBeNull();
    expect(bareUrl("javascript:alert(1)")).toBeNull();
    expect(bareUrl("https:///x")).toBeNull();
    expect(bareUrl(`https://a.it/${"x".repeat(2100)}`)).toBeNull();
  });

  it("lascia passare soltanto icone raster inline", () => {
    expect(safeIcon("data:image/png;base64,iVBORw0K")).toBe("data:image/png;base64,iVBORw0K");
    expect(safeIcon("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull();
    expect(safeIcon("https://esempio.it/favicon.ico")).toBeNull();
    expect(safeIcon("")).toBeNull();
  });
});

describe("la scheda nella Live (K8)", () => {
  function editor(states: Map<string, LinkCardView>, requested: string[]) {
    const parent = document.createElement("div");
    document.body.append(parent);
    const source: LinkCardSource = {
      view: (url) => states.get(url) ?? { kind: "bare" },
      request: (url) => requested.push(url),
      watch: () => () => {},
    };
    const engine = createTextEngine(parent, {
      onChange() {},
      onSelectionChange() {},
      extensions: () => [markdown({ base: markdownGrammar }), livePreview({ openWikilink() {}, searchTag() {}, linkCard: source })],
    });
    return { parent, engine, destroy() { engine.destroy(); parent.remove(); } };
  }

  it("mostra la scheda fuori dal cursore e l'indirizzo col cursore dentro", () => {
    const states = new Map<string, LinkCardView>();
    const requested: string[] = [];
    const { parent, engine, destroy } = editor(states, requested);
    try {
      engine.setDoc("Primo\n\nhttps://esempio.it/pagina\n\nUltimo");
      const card = () => parent.querySelector<HTMLElement>(".cm-fub-link-card");
      expect(card()?.dataset.state).toBe("bare");
      expect(card()?.querySelector(".cm-fub-link-card-url")?.textContent).toBe("https://esempio.it/pagina");

      card()!.querySelector<HTMLButtonElement>(".cm-fub-link-card-fetch")!.click();
      expect(requested).toEqual(["https://esempio.it/pagina"]);

      states.set("https://esempio.it/pagina", {
        kind: "card",
        card: { url: "https://esempio.it/pagina", title: "Una pagina", description: "Breve", site: "esempio.it", icon: "data:image/png;base64,AAAA" },
      });
      engine.runViewCommand((view) => {
        view.dispatch({ effects: linkCardsChanged.of(null) });
        return true;
      });
      expect(card()?.dataset.state).toBe("card");
      expect(card()?.querySelector(".cm-fub-link-card-title")?.textContent).toBe("Una pagina");
      expect(card()?.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
      expect(card()?.getAttribute("aria-label")).toContain("Una pagina");

      engine.runViewCommand((view) => {
        view.dispatch({ selection: { anchor: 10 } });
        return true;
      });
      expect(card()).toBeNull();
      expect(parent.querySelector(".cm-content")?.textContent).toContain("https://esempio.it/pagina");
    } finally {
      destroy();
    }
  });

  it("senza sorgente, o con altro testo accanto, l'indirizzo resta un link", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const engine = createTextEngine(parent, {
      onChange() {},
      onSelectionChange() {},
      extensions: () => [markdown({ base: markdownGrammar }), livePreview({ openWikilink() {}, searchTag() {} })],
    });
    try {
      engine.setDoc("Primo\n\nhttps://esempio.it/pagina");
      expect(parent.querySelector(".cm-fub-link-card")).toBeNull();
    } finally {
      engine.destroy();
      parent.remove();
    }
    const { parent: other, engine: second, destroy } = editor(new Map(), []);
    try {
      second.setDoc("Primo\n\nVedi https://esempio.it/pagina");
      expect(other.querySelector(".cm-fub-link-card")).toBeNull();
    } finally {
      destroy();
    }
  });
});

describe("bareWikilink", () => {
  it("riconosce soltanto un wikilink da solo nel paragrafo", () => {
    expect(bareWikilink("[[Biblioteca civica]]")).toEqual({ page: "Biblioteca civica", heading: null, block: null, alias: null });
    expect(bareWikilink("  [[Nota#Sezione|Detto così]]  ")).toEqual({ page: "Nota", heading: "Sezione", block: null, alias: "Detto così" });
    expect(bareWikilink("Vedi [[Nota]]")).toBeNull();
    expect(bareWikilink("[[A]] [[B]]")).toBeNull();
    expect(bareWikilink("![[Immagine.png]]")).toBeNull();
    expect(bareWikilink("[[#Sezione]]")).toBeNull();
  });

  it("mette nello stile soltanto un colore scritto per intero", () => {
    expect(coverColor("#cfe7d6")).toBe("#cfe7d6");
    expect(coverColor("oklch(0.8 0.1 150)")).toBe("oklch(0.8 0.1 150)");
    expect(coverColor("url(https://esempio.it/a.png)")).toBeNull();
    expect(coverColor("red; background: url(x)")).toBeNull();
    expect(coverColor("immagini/copertina.png")).toBeNull();
  });
});

describe("la scheda della nota nella Live (E11)", () => {
  function editor(notes: Map<string, NoteCardView>, linkClick: "apri" | "sbircia" = "apri") {
    const parent = document.createElement("div");
    document.body.append(parent);
    const asked: string[] = [];
    const openWikilink = vi.fn();
    const peekWikilink = vi.fn();
    const source: LinkCardSource = {
      view: () => ({ kind: "bare" }),
      request: () => {},
      note: (page) => {
        asked.push(page);
        return notes.get(page) ?? { kind: "loading" };
      },
      watch: () => () => {},
    };
    const engine = createTextEngine(parent, {
      onChange() {},
      onSelectionChange() {},
      extensions: () => [
        markdown({ base: markdownGrammar }),
        livePreview({ openWikilink, peekWikilink, linkClick: () => linkClick, searchTag() {}, linkCard: source }),
      ],
    });
    const refresh = () => engine.runViewCommand((view) => {
      view.dispatch({ effects: linkCardsChanged.of(null) });
      return true;
    });
    return { parent, engine, asked, openWikilink, peekWikilink, refresh, destroy() { engine.destroy(); parent.remove(); } };
  }

  const CARD: NoteCardView = {
    kind: "card",
    card: { doc: "Luoghi/Biblioteca civica.md", title: "Biblioteca civica", icon: "📚", description: "Orari e sale", date: "10 novembre 2026", cover: "#cfe7d6" },
  };

  it("mostra la scheda fuori dal cursore e il wikilink col cursore dentro", () => {
    const notes = new Map<string, NoteCardView>();
    const e = editor(notes);
    try {
      e.engine.setDoc("Primo\n\n[[Biblioteca civica]]\n\nUltimo");
      const card = () => e.parent.querySelector<HTMLElement>(".cm-fub-note-card");
      // Finché la nota non è nota il paragrafo resta il suo link.
      expect(e.asked).toContain("Biblioteca civica");
      expect(card()).toBeNull();

      notes.set("Biblioteca civica", CARD);
      e.refresh();
      expect(card()?.dataset.wikilinkPage).toBe("Biblioteca civica");
      expect(card()?.querySelector(".cm-fub-note-card-title")?.textContent).toContain("Biblioteca civica");
      expect(card()?.querySelector(".cm-fub-note-card-desc")?.textContent).toBe("Orari e sale");
      expect(card()?.querySelector(".cm-fub-note-card-meta")?.textContent).toBe("10 novembre 2026");
      expect(card()?.querySelector<HTMLElement>(".cm-fub-note-card-cover")?.style.background).toContain("#cfe7d6");
      expect(card()?.getAttribute("aria-label")).toContain("Biblioteca civica");
      // Il file resta il wikilink.
      expect(e.engine.getDoc()).toBe("Primo\n\n[[Biblioteca civica]]\n\nUltimo");

      e.engine.runViewCommand((view) => {
        view.dispatch({ selection: { anchor: 10 } });
        return true;
      });
      expect(card()).toBeNull();
      expect(e.parent.querySelector(".cm-fub-wikilink")?.textContent).toContain("Biblioteca civica");
    } finally {
      e.destroy();
    }
  });

  it("una nota che non c'è, o un wikilink con altro testo, resta link", () => {
    const e = editor(new Map([["Altrove", { kind: "missing" }]]));
    try {
      e.engine.setDoc("Primo\n\n[[Altrove]]\n\nVedi [[Biblioteca civica]]");
      expect(e.parent.querySelector(".cm-fub-note-card")).toBeNull();
      expect(e.asked).not.toContain("Biblioteca civica");
    } finally {
      e.destroy();
    }
  });

  it("il clic segue editor.link-click, Alt sbircia, Ctrl apre", () => {
    for (const rule of ["apri", "sbircia"] as const) {
      const e = editor(new Map([["Biblioteca civica", CARD]]), rule);
      try {
        e.engine.setDoc("Primo\n\n[[Biblioteca civica#Orari]]");
        const main = e.parent.querySelector<HTMLElement>(".cm-fub-note-card-main")!;
        const click = (init: MouseEventInit) => main.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
        click({});
        if (rule === "apri") expect(e.openWikilink).toHaveBeenLastCalledWith("Biblioteca civica", "Orari", null);
        else expect(e.peekWikilink).toHaveBeenLastCalledWith("Biblioteca civica", "Orari", null);
        e.openWikilink.mockClear();
        e.peekWikilink.mockClear();
        click({ altKey: true });
        expect(e.peekWikilink).toHaveBeenCalledTimes(1);
        click({ ctrlKey: true });
        expect(e.openWikilink).toHaveBeenCalledTimes(1);
        // Il mousedown non porta il cursore dentro: la scheda resta scheda.
        const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
        main.dispatchEvent(down);
        expect(down.defaultPrevented).toBe(true);
        expect(e.parent.querySelector(".cm-fub-note-card")).not.toBeNull();
      } finally {
        e.destroy();
      }
    }
  });

});
