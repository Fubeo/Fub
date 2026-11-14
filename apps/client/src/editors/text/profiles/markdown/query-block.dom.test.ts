// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";

const api = vi.hoisted(() => ({
  listViews: vi.fn(),
  queryIndex: vi.fn(),
  readDocument: vi.fn(),
  invokeCommand: vi.fn(),
}));

vi.mock("../../../../host/ipc", () => ({ api }));

import type { IndexQuery } from "../../../../host/contract";
import { openLifetime } from "../../../../ui/lifetime";
import { createTextEngine } from "../../engine";
import { markdownGrammar } from "./grammar";
import { livePreview } from "./livepreview";
import { claimQueryBlocks, fillQueryBlock, markTaskDues } from "./query-block";

const MOSTRA = [
  "# Mostra di primavera",
  "",
  "- [ ] Chiedere il preventivo per le cornici 📅 2026-11-13",
  "- [ ] Mandare l'elenco delle opere 📅 2026-11-18",
  "- [ ] Prenotare il trasporto 📅 2026-12-20",
  "- [x] Scegliere la sala 📅 2026-11-10",
].join("\n");
const CASA = "- [ ] Pagare la bolletta 📅 2026-11-16\n- [ ] Senza data\n";

/// Il vault finto: due note, e ciò che l'indice risponde a una ricerca.
let files: Record<string, string>;
let documents: string[];

function view(id: string) {
  return { id, title: id, surface: "right_sidebar" };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 14, 10, 0));
  files = { "Progetti/Mostra di primavera.md": MOSTRA, "Casa.md": CASA };
  documents = ["Progetti/Mostra di primavera.md", "Casa.md"];
  api.listViews.mockReset().mockResolvedValue([view("outline"), view("tasks")]);
  api.queryIndex.mockReset().mockImplementation((q: IndexQuery) => {
    if (q.kind !== "documents") throw new Error(`non so rispondere a ${q.kind}`);
    const items = documents.map((doc) => ({ doc }));
    return Promise.resolve({ kind: "documents", value: { items, offset: 0, total: items.length } });
  });
  api.readDocument.mockReset().mockImplementation((id: string) =>
    files[id] === undefined
      ? Promise.reject(new Error(`«${id}» non c'è`))
      : Promise.resolve({ text: files[id], revision: "1", format_id: "markdown", source_kind: "text", text_kind: "prose" }));
  api.invokeCommand.mockReset().mockResolvedValue({ notify: null, effect: null, undo: null, partial: null });
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

/// Un recinto ```tasks``` reso come lo rende la Lettura, e riempito.
async function fence(body: string) {
  const container = document.createElement("div");
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.className = "language-tasks";
  code.textContent = body;
  pre.append(code);
  container.append(pre);
  document.body.append(container);
  const claimed = claimQueryBlocks(container);
  expect(claimed).toHaveLength(1);
  const { block, query } = claimed[0]!;
  expect(block.classList.contains("block-tasks")).toBe(true);
  const life = openLifetime();
  await fillQueryBlock(block, query, (promise) => promise, life);
  return { block, life };
}

const notes = (block: HTMLElement) => [...block.querySelectorAll(".block-query-note")].map((p) => p.textContent);
const rows = (block: HTMLElement) =>
  [...block.querySelectorAll<HTMLElement>(".tasks-item")].map((item) => ({
    text: item.querySelector(".tasks-text")?.textContent,
    note: item.querySelector<HTMLElement>("a.internal-path")?.dataset.path,
    near: item.querySelector(".task-due")?.classList.contains("task-due-near") ?? null,
  }));

/// Aspetta che il recinto finisca il giro dopo una spunta.
async function settled(block: HTMLElement) {
  await vi.waitFor(() => expect(block.getAttribute("aria-busy")).toBeNull());
}

describe("il recinto ```tasks```", () => {
  it("mostra i compiti che rispondono, con la scadenza e la nota, e dice la riga che salta", async () => {
    const { block } = await fence("not done\ndue before 2026-11-20\nsort by due");
    const asked = api.queryIndex.mock.calls[0]![0] as Extract<IndexQuery, { kind: "documents" }>;
    expect(asked.matching.any[0]!.all.map((literal) => literal.predicate)).toEqual([
      { kind: "task", status: "open" },
      { kind: "task_due", min: null, max: { date: "2026-11-20", inclusive: false } },
    ]);
    expect(notes(block)).toEqual(["Riga 3 non capita, saltata: sort by due", "3 compiti"]);
    expect(rows(block)).toEqual([
      { text: "Chiedere il preventivo per le cornici 📅 2026-11-13", note: "Progetti/Mostra di primavera.md", near: true },
      { text: "Pagare la bolletta 📅 2026-11-16", note: "Casa.md", near: true },
      { text: "Mandare l'elenco delle opere 📅 2026-11-18", note: "Progetti/Mostra di primavera.md", near: true },
    ]);
    expect(block.querySelector("a.internal-path")?.textContent).toBe("Mostra di primavera");
    expect(block.getAttribute("aria-busy")).toBeNull();
  });

  it("senza righe sullo stato mostra anche i fatti, e la scadenza lontana è grigia", async () => {
    const { block } = await fence("path includes Progetti");
    expect(rows(block).map((row) => [row.text, row.near])).toEqual([
      ["Scegliere la sala 📅 2026-11-10", false],
      ["Chiedere il preventivo per le cornici 📅 2026-11-13", true],
      ["Pagare la bolletta 📅 2026-11-16", true],
      ["Mandare l'elenco delle opere 📅 2026-11-18", true],
      ["Prenotare il trasporto 📅 2026-12-20", false],
      ["Senza data", null],
    ]);
    expect(block.querySelector<HTMLInputElement>(".tasks-done .tasks-check")?.checked).toBe(true);
  });

  it("la spunta chiama note.task.toggle sulla nota d'origine, nel byte del compito, e rilegge", async () => {
    const { block } = await fence("not done\ndue before 2026-11-15");
    const box = block.querySelector<HTMLInputElement>(".tasks-check")!;
    expect(box.getAttribute("aria-label")).toBe("Segna come fatto: Chiedere il preventivo per le cornici 📅 2026-11-13");
    // Il comando scrive nella nota: la lettura dopo la vede spuntata.
    api.invokeCommand.mockImplementationOnce(() => {
      files["Progetti/Mostra di primavera.md"] = MOSTRA.replace("- [ ] Chiedere", "- [x] Chiedere");
      return Promise.resolve({ notify: null, effect: null, undo: null, partial: null });
    });
    const at = new TextEncoder().encode(MOSTRA.slice(0, MOSTRA.indexOf("[ ] Chiedere") + 1)).length;
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    expect(box.disabled).toBe(true);
    await vi.waitFor(() => expect(api.invokeCommand).toHaveBeenCalledTimes(1));
    expect(api.invokeCommand).toHaveBeenCalledWith("note.task.toggle", { doc: "Progetti/Mostra di primavera.md", at: [at] }, "apply");
    await settled(block);
    // Riletto: il compito spuntato non risponde più a «not done».
    await vi.waitFor(() => expect(notes(block)).toEqual(["Nessun compito risponde a queste righe."]));
  });

  it("Invio sulla casella spunta come Spazio", async () => {
    const { block } = await fence("not done\ndue before 2026-11-15");
    const box = block.querySelector<HTMLInputElement>(".tasks-check")!;
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(api.invokeCommand).toHaveBeenCalledTimes(1));
    await settled(block);
  });

  it("non spunta un compito che nel frattempo è cambiato, e lo dice", async () => {
    const { block } = await fence("not done\ndue before 2026-11-15");
    // La nota è aperta in un altro riquadro e il compito ha cambiato testo.
    files["Progetti/Mostra di primavera.md"] = MOSTRA.replace("le cornici", "i telai");
    const box = block.querySelector<HTMLInputElement>(".tasks-check")!;
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(block.querySelector(".tasks-notice")).not.toBeNull());
    await settled(block);
    expect(api.invokeCommand).not.toHaveBeenCalled();
    expect(block.querySelector(".tasks-notice")?.getAttribute("role")).toBe("status");
    expect(block.querySelector(".tasks-notice")?.textContent).toContain("Il compito è cambiato nel frattempo");
    expect(rows(block)[0]!.text).toBe("Chiedere il preventivo per i telai 📅 2026-11-13");
  });

  it("una nota in sola lettura non si spunta, e il recinto dice perché", async () => {
    const { block } = await fence("not done\ndue before 2026-11-15");
    api.invokeCommand.mockRejectedValueOnce(new Error("la nota è in sola lettura"));
    const box = block.querySelector<HTMLInputElement>(".tasks-check")!;
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(block.querySelector(".tasks-notice")).not.toBeNull());
    await settled(block);
    expect(block.querySelector(".tasks-notice")?.textContent).toBe("Non ho spuntato il compito: la nota è in sola lettura");
    expect(block.querySelector<HTMLInputElement>(".tasks-check")?.checked).toBe(false);
  });

  it("con il componente spento dice che manca, senza cercare", async () => {
    api.listViews.mockResolvedValue([view("outline")]);
    const { block } = await fence("not done");
    expect(notes(block)).toEqual(["Il componente «Compiti» è spento: si accende nella pagina Componenti delle impostazioni."]);
    expect(api.queryIndex).not.toHaveBeenCalled();
  });

  it("un recinto vuoto lo dice", async () => {
    const { block } = await fence("");
    expect(notes(block)).toEqual(["Recinto dei compiti vuoto: scrivi una riga del plugin Tasks, per esempio «not done»."]);
  });

  it("una nota che non si legge si conta, le altre restano", async () => {
    documents = ["Sparita.md", "Casa.md"];
    const { block } = await fence("not done");
    expect(notes(block)).toEqual(["1 nota non si legge.", "2 compiti"]);
  });

  it("chiuso prima della risposta non scrive niente", async () => {
    const container = document.createElement("div");
    container.innerHTML = '<pre><code class="language-tasks">not done</code></pre>';
    const [{ block, query }] = claimQueryBlocks(container) as [{ block: HTMLElement; query: string }];
    const life = openLifetime();
    const filling = fillQueryBlock(block, query, (promise) => promise, life);
    life.close();
    await filling;
    expect(block.childElementCount).toBe(0);
    expect(block.getAttribute("aria-busy")).toBe("true");
  });
});

describe("la pastiglia della scadenza", () => {
  it("in Lettura è arancio quando è vicina, grigia lontana o fatta", () => {
    const container = document.createElement("div");
    container.innerHTML = [
      "<ul>",
      '<li class="task" data-task=""><input type="checkbox" disabled>Vicina 📅 2026-11-16</li>',
      '<li class="task" data-task="x"><input type="checkbox" checked disabled>Fatta 📅 2026-11-16</li>',
      '<li class="task" data-task=""><input type="checkbox" disabled>Lontana 📅 2027-01-01 <code>📅 2026-11-15</code></li>',
      '<li>Non un compito 📅 2026-11-16</li>',
      "</ul>",
    ].join("");
    markTaskDues(container, "2026-11-14");
    const pills = [...container.querySelectorAll<HTMLElement>(".task-due")];
    expect(pills.map((pill) => [pill.textContent, pill.classList.contains("task-due-near")])).toEqual([
      ["📅 2026-11-16", true],
      ["📅 2026-11-16", false],
      ["📅 2027-01-01", false],
    ]);
    // Il testo resta quello del file, e una seconda passata non ne aggiunge.
    expect(container.querySelector("li")?.textContent).toBe("Vicina 📅 2026-11-16");
    markTaskDues(container, "2026-11-14");
    expect(container.querySelectorAll(".task-due")).toHaveLength(3);
  });

  it("nella Live è un segno sul testo, arancio quando è vicina", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const engine = createTextEngine(parent, {
      onChange() {},
      onSelectionChange() {},
      extensions: () => [markdown({ base: markdownGrammar }), livePreview({ openWikilink() {}, searchTag() {} })],
    });
    try {
      engine.setDoc("Testo\n\n- [ ] Vicina 📅 2026-11-16\n- [x] Fatta 📅 2026-11-16\n- [ ] Lontana 📅 2027-01-01\n- Non un compito 📅 2026-11-16");
      const pills = [...parent.querySelectorAll<HTMLElement>(".cm-fub-due")];
      expect(pills.map((pill) => [pill.textContent, pill.classList.contains("cm-fub-due-near")])).toEqual([
        ["📅 2026-11-16", true],
        ["📅 2026-11-16", false],
        ["📅 2027-01-01", false],
      ]);
      // Il testo del documento non cambia.
      expect(engine.getDoc()).toContain("- [ ] Vicina 📅 2026-11-16");
    } finally {
      engine.destroy();
      parent.remove();
    }
  });
});
