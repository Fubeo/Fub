// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { markdownGrammar } from "./grammar";
import { createTextEngine } from "../../engine";
import { livePreview } from "./livepreview";
import { bareUrl, linkCardsChanged, safeIcon, type LinkCardSource, type LinkCardView } from "./link-card";

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
