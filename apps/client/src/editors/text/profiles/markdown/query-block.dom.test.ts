// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { markdown } from "@codemirror/lang-markdown";

import { embeddedViewsDiscovered, setEmbeddedViewHost, type EmbeddedViewHost } from "../../../../ui/embedded-views";
import { openLifetime } from "../../../../ui/lifetime";
import { createTextEngine } from "../../engine";
import { markdownGrammar } from "./grammar";
import { livePreview } from "./livepreview";
import { embedTasksBlocks, markTaskDues, TASKS_QUERY_VIEW } from "./query-block";

/// Chi monta le view, finto: ricorda cosa gli si chiede.
let known: Set<string>;
let host: {
  known: EmbeddedViewHost["known"];
  mount: Mock<EmbeddedViewHost["mount"]>;
  unmount: Mock<EmbeddedViewHost["unmount"]>;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 14, 10, 0));
  known = new Set([TASKS_QUERY_VIEW]);
  host = {
    known: (view) => known.has(view),
    mount: vi.fn<EmbeddedViewHost["mount"]>(() => Promise.resolve()),
    unmount: vi.fn<EmbeddedViewHost["unmount"]>(),
  };
  setEmbeddedViewHost(host);
});

afterEach(() => {
  setEmbeddedViewHost(null);
  vi.useRealTimers();
  document.body.replaceChildren();
});

/// Un recinto come lo rende la Lettura: dichiarato o no.
function rendered(body: string, declared: boolean): HTMLElement {
  const container = document.createElement("div");
  const pre = document.createElement("pre");
  if (declared) pre.setAttribute("data-declared-fence", "");
  pre.dataset.mdFrom = "10";
  pre.dataset.mdTo = "40";
  const code = document.createElement("code");
  code.className = "language-tasks";
  code.textContent = body;
  pre.append(code);
  container.append(pre);
  document.body.append(container);
  return container;
}

describe("il recinto ```tasks```", () => {
  it("dichiarato, presta il posto alla vista del componente con le righe del recinto", () => {
    const container = rendered("not done\ndue before tomorrow\n", true);
    const life = openLifetime();
    embedTasksBlocks(container, life);

    const block = container.querySelector<HTMLElement>(".block-tasks");
    expect(block).not.toBeNull();
    expect(container.querySelector("pre")).toBeNull();
    expect(block!.dataset.mdFrom).toBe("10");
    expect(block!.dataset.mdTo).toBe("40");
    expect(host.mount).toHaveBeenCalledTimes(1);
    const [view, instance, target, params] = host.mount.mock.calls[0]!;
    expect(view).toBe(TASKS_QUERY_VIEW);
    expect(target).toBe(block);
    expect(params).toEqual({ query: "not done\ndue before tomorrow\n" });

    // Chiusa la resa, la vista se ne va con lei.
    life.close();
    expect(host.unmount).toHaveBeenCalledWith(TASKS_QUERY_VIEW, instance);
  });

  it("due recinti sono due esemplari", () => {
    const container = rendered("not done", true);
    container.append(rendered("done", true).firstElementChild!);
    embedTasksBlocks(container, openLifetime());
    const instances = host.mount.mock.calls.map((call) => call[1]);
    expect(instances).toHaveLength(2);
    expect(new Set(instances).size).toBe(2);
  });

  it("non dichiarato (componente spento) resta codice", () => {
    const container = rendered("not done", false);
    embedTasksBlocks(container, openLifetime());
    expect(container.querySelector("pre > code.language-tasks")).not.toBeNull();
    expect(container.querySelector(".block-tasks")).toBeNull();
    expect(host.mount).not.toHaveBeenCalled();
  });

  it("prima che le view siano note aspetta, e si monta alla scoperta", () => {
    known.clear();
    const container = rendered("not done", true);
    const life = openLifetime();
    embedTasksBlocks(container, life);
    expect(host.mount).not.toHaveBeenCalled();
    expect(container.querySelector(".block-tasks")?.textContent).toBe("Leggo i compiti…");

    known.add(TASKS_QUERY_VIEW);
    embeddedViewsDiscovered();
    expect(host.mount).toHaveBeenCalledTimes(1);
    embeddedViewsDiscovered();
    expect(host.mount).toHaveBeenCalledTimes(1);
  });

  it("spento il componente torna codice, riacceso torna vista", () => {
    const container = rendered("not done", true);
    const life = openLifetime();
    embedTasksBlocks(container, life);
    embeddedViewsDiscovered();
    expect(host.mount).toHaveBeenCalledTimes(1);
    const [, instance, block] = host.mount.mock.calls[0]!;

    // Il componente si spegne: la scoperta non trova più la view.
    known.clear();
    embeddedViewsDiscovered();
    expect(host.unmount).toHaveBeenCalledWith(TASKS_QUERY_VIEW, instance);
    expect(container.querySelector(".block-tasks")).toBeNull();
    expect(container.querySelector("pre > code.language-tasks")?.textContent).toBe("not done");

    // Un recinto reso mentre è spento resta codice, senza aspettare.
    const later = rendered("done", true);
    embedTasksBlocks(later, life);
    expect(later.querySelector("pre > code.language-tasks")).not.toBeNull();
    expect(later.querySelector(".block-tasks")).toBeNull();

    // Si riaccende: tutti e due tornano vista, il primo nello stesso posto.
    known.add(TASKS_QUERY_VIEW);
    embeddedViewsDiscovered();
    expect(host.mount).toHaveBeenCalledTimes(3);
    expect(container.querySelector(".block-tasks")).toBe(block);
    expect(container.querySelector("pre")).toBeNull();
    expect(later.querySelector(".block-tasks")).not.toBeNull();
    life.close();
    expect(host.unmount).toHaveBeenCalledTimes(3);
  });

  it("chiuso prima della scoperta non si monta più", () => {
    known.clear();
    const container = rendered("not done", true);
    const life = openLifetime();
    embedTasksBlocks(container, life);
    life.close();
    known.add(TASKS_QUERY_VIEW);
    embeddedViewsDiscovered();
    expect(host.mount).not.toHaveBeenCalled();
  });
});

describe("la pastiglia della scadenza", () => {
  it("in Lettura è arancio vicina, grigia lontana o fatta, segnata se la data non si legge", () => {
    const container = document.createElement("div");
    container.innerHTML = [
      "<ul>",
      '<li class="task" data-task=""><input type="checkbox" disabled>Vicina 📅 2026-11-16</li>',
      '<li class="task" data-task="x"><input type="checkbox" checked disabled>Fatta 📅 2026-11-16</li>',
      '<li class="task" data-task=""><input type="checkbox" disabled>Lontana 📅 2027-01-01</li>',
      '<li class="task" data-task=""><input type="checkbox" disabled>Refuso 📅 2026-02-30</li>',
      // Il testo dentro il codice conta: l'ultima 📅 è lì.
      '<li class="task" data-task=""><input type="checkbox" disabled>Nel codice 📅 2027-01-01 <code>📅 2026-11-15</code></li>',
      // Una sottovoce non è il compito.
      '<li class="task" data-task=""><input type="checkbox" disabled>Padre<ul><li>Figlio 📅 2026-11-16</li></ul></li>',
      '<li>Non un compito 📅 2026-11-16</li>',
      "</ul>",
    ].join("");
    markTaskDues(container, "2026-11-14");
    const pills = [...container.querySelectorAll<HTMLElement>(".task-due")];
    expect(pills.map((pill) => [pill.textContent, pill.className])).toEqual([
      ["📅 2026-11-16", "task-due task-due-near"],
      ["📅 2026-11-16", "task-due"],
      ["📅 2027-01-01", "task-due"],
      ["📅 2026-02-30", "task-due task-due-bad"],
      ["📅 2026-11-15", "task-due task-due-near"],
    ]);
    expect(pills[3]!.title).toContain("Data non leggibile");
    // Il testo resta quello del file, e una seconda passata non ne aggiunge.
    expect(container.querySelector("li")?.textContent).toBe("Vicina 📅 2026-11-16");
    markTaskDues(container, "2026-11-14");
    expect(container.querySelectorAll(".task-due")).toHaveLength(5);
  });

  it("in Lettura avvolge anche una data scritta fra due nodi", () => {
    const container = document.createElement("div");
    container.innerHTML = '<ul><li class="task" data-task=""><input type="checkbox" disabled>Pagare 📅 <code>2026-11-16</code> poi</li></ul>';
    markTaskDues(container, "2026-11-14");
    const pill = container.querySelector<HTMLElement>(".task-due");
    expect(pill?.textContent).toBe("📅 2026-11-16");
    expect(container.querySelector("li")?.textContent).toBe("Pagare 📅 2026-11-16 poi");
    // Il codice entra intero nella pastiglia: non se ne fa una copia.
    expect(container.querySelectorAll("code")).toHaveLength(1);
    expect(pill?.querySelector("code")?.textContent).toBe("2026-11-16");
  });

  it("in Lettura prende intero il link che porta la data, senza spezzarlo", () => {
    const container = document.createElement("div");
    container.innerHTML = '<ul><li class="task" data-task=""><input type="checkbox" disabled>Chiama <a class="wikilink" href="#" data-wikilink-page="Mario">Mario</a> 📅 <a class="wikilink" href="#" data-wikilink-page="2026-11-16">2026-11-16</a></li></ul>';
    markTaskDues(container, "2026-11-14");
    const pill = container.querySelector<HTMLElement>(".task-due");
    expect(pill?.className).toBe("task-due task-due-near");
    expect(pill?.textContent).toBe("📅 2026-11-16");
    const links = [...container.querySelectorAll("a")];
    expect(links.map((link) => [link.textContent, link.dataset.wikilinkPage])).toEqual([
      ["Mario", "Mario"],
      ["2026-11-16", "2026-11-16"],
    ]);
    expect(links[1]!.parentElement).toBe(pill);
  });

  it("in Lettura legge solo il primo paragrafo, anche di una voce stretta", () => {
    const container = document.createElement("div");
    container.innerHTML = [
      "<ul>",
      '<li class="task" data-task=""><input type="checkbox" disabled>Codice sotto<pre><code>📅 2026-11-16</code></pre></li>',
      '<li class="task" data-task=""><input type="checkbox" disabled>Citazione sotto<blockquote><p>📅 2026-11-16</p></blockquote></li>',
      '<li class="task" data-task=""><p><input type="checkbox" disabled>Larga</p><p>📅 2026-11-16</p></li>',
      '<li class="task" data-task=""><p><input type="checkbox" disabled>Larga 📅 2026-11-17</p><p>altro</p></li>',
      "</ul>",
    ].join("");
    markTaskDues(container, "2026-11-14");
    expect([...container.querySelectorAll(".task-due")].map((pill) => pill.textContent)).toEqual(["📅 2026-11-17"]);
  });

  it("nella Live è un segno sul testo, anche sulla riga del cursore", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const engine = createTextEngine(parent, {
      onChange() {},
      onSelectionChange() {},
      extensions: () => [markdown({ base: markdownGrammar }), livePreview({ openWikilink() {}, searchTag() {} })],
    });
    try {
      engine.setDoc([
        "- [ ] Vicina 📅 2026-11-16",
        "- [x] Fatta 📅 2026-11-16",
        "- [ ] Lontana 📅 2027-01-01",
        "- [ ] Refuso 📅 2026-02-30",
        "- [ ] Nel codice `📅 2026-11-15`",
        "- [ ] Un [link](https://esempio.it/📅/2026-11-15) non è una data",
        "- Non un compito 📅 2026-11-16",
      ].join("\n"));
      const pills = [...parent.querySelectorAll<HTMLElement>(".cm-fub-due")];
      expect(pills.map((pill) => [pill.textContent, pill.className.replace(/\s+/g, " ").trim()])).toEqual([
        ["📅 2026-11-16", "cm-fub-due cm-fub-due-near"],
        ["📅 2026-11-16", "cm-fub-due"],
        ["📅 2027-01-01", "cm-fub-due"],
        ["📅 2026-02-30", "cm-fub-due cm-fub-due-bad"],
        ["📅 2026-11-15", "cm-fub-due cm-fub-due-near"],
      ]);
      expect(pills[3]!.title).toContain("Data non leggibile");
      // Il testo del documento non cambia.
      expect(engine.getDoc()).toContain("- [ ] Vicina 📅 2026-11-16");
    } finally {
      engine.destroy();
      parent.remove();
    }
  });

  it("nella Live legge le righe che continuano il compito, i wikilink, e non spezza la pastiglia", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const engine = createTextEngine(parent, {
      onChange() {},
      onSelectionChange() {},
      extensions: () => [markdown({ base: markdownGrammar }), livePreview({ openWikilink() {}, searchTag() {} })],
    });
    try {
      engine.setDoc([
        "Sopra",
        "",
        "- [ ] Chiama [[Mario]] 📅 [[2026-11-16]]",
        "- [ ] Pagare 📅 `2026-11-17 mattina` poi",
        "- [ ] Su due righe",
        "  📅 2026-11-18",
        "- [ ] Padre",
        "  ```",
        "  📅 2026-11-19",
        "  ```",
        "",
      ].join("\n"));
      const pills = [...parent.querySelectorAll<HTMLElement>(".cm-fub-due")];
      expect(pills.map((pill) => [pill.textContent, pill.className.replace(/\s+/g, " ").trim()])).toEqual([
        ["📅 2026-11-16", "cm-fub-due cm-fub-due-near"],
        ["📅 2026-11-17 mattina", "cm-fub-due cm-fub-due-near"],
        ["📅 2026-11-18", "cm-fub-due cm-fub-due-near"],
      ]);
      // La pastiglia contiene il codice intero, non ne è tagliata.
      expect(pills[1]!.querySelector(".cm-fub-code")?.textContent).toBe("2026-11-17 mattina");
    } finally {
      engine.destroy();
      parent.remove();
    }
  });
});
