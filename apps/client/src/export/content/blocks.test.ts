// @vitest-environment happy-dom
// I compiti fatti, i ripiegabili, le note riportate e le Basi sulla carta
// (T74): ogni cambio si disfa e la resa torna com'era.

import { describe, expect, it } from "vitest";
import { applyBases, basesPending } from "./bases";
import { ContentChanges } from "./changes";
import { applyFolds } from "./folds";
import { applyTasks, doneTasks } from "./tasks";
import { applyTransclusions, notePathText, provenanceText } from "./transclusions";

function page(html: string): HTMLElement {
  const root = document.createElement("article");
  root.className = "print-page";
  root.innerHTML = `<h1>Nota</h1><div class="print-body markdown-rendered">${html}</div>`;
  document.body.append(root);
  return root;
}

describe("i compiti fatti", () => {
  const TASKS = `<ul>
    <li class="task" data-task><input type="checkbox" disabled checked> fatto<ul><li class="task"><input type="checkbox" disabled> passo</li></ul></li>
    <li class="task" data-task><input type="checkbox" disabled> da fare</li>
    <li>voce</li>
  </ul>`;

  it("«Mostra» li lascia", () => {
    const root = page(TASKS);
    expect(applyTasks(root, true, new ContentChanges())).toBe(0);
    expect(root.querySelectorAll("li[hidden]")).toHaveLength(0);
  });

  it("«Togli» li toglie coi passi che tengono dentro, e si rimettono", () => {
    const root = page(TASKS);
    expect(doneTasks(root)).toHaveLength(1);
    const changes = new ContentChanges();
    expect(applyTasks(root, false, changes)).toBe(1);
    const [done, open] = root.querySelectorAll<HTMLLIElement>(":scope .print-body > ul > li");
    expect(done!.hidden).toBe(true);
    expect(open!.hidden).toBe(false);
    changes.undo();
    expect(done!.hidden).toBe(false);
  });
});

describe("i ripiegabili", () => {
  const FOLDS = `<details class="fub-details"><summary>Chiuso</summary><p>dentro</p></details>
    <details class="fub-details" open><summary>Aperto</summary><details class="fub-details"><summary>Interno</summary><p>x</p></details></details>`;

  it("aperti: tutti, anche quelli dentro un altro", () => {
    const root = page(FOLDS);
    const changes = new ContentChanges();
    expect(applyFolds(root, "aperti", changes)).toBe(2);
    expect([...root.querySelectorAll("details")].every((d) => d.open)).toBe(true);
    changes.undo();
    expect([...root.querySelectorAll("details")].map((d) => d.open)).toEqual([false, true, false]);
  });

  it("solo il titolo: tutti chiusi", () => {
    const root = page(FOLDS);
    applyFolds(root, "chiusi", new ContentChanges());
    expect([...root.querySelectorAll("details")].some((d) => d.open)).toBe(false);
  });
});

describe("le note riportate", () => {
  it("dicono da dove vengono: la nota con le cartelle, la sezione o il blocco", () => {
    expect(notePathText("Riunioni/2026-11-04.md")).toBe("Riunioni / 2026-11-04");
    expect(provenanceText("Riunioni/2026-11-04.md", "Decisioni", null)).toBe("da Riunioni / 2026-11-04 › Decisioni");
    expect(provenanceText("Idee", null, "a1b2")).toBe("da Idee › blocco a1b2");
    expect(provenanceText("Idee", null, null)).toBe("da Idee");
  });

  it("la riga sta sotto il testo riportato; schede, media e link rotti non ne hanno", () => {
    const root = page(`
      <div class="embed embed-loaded" data-embed-page="Riunioni/2026-11-04" data-embed-heading="Decisioni"><p>Si parte lunedì.</p></div>
      <div class="embed" data-embed-page="Contratto.pdf"></div>
      <div class="embed embed-media" data-embed-page="foto.png"></div>
      <div class="embed unresolved" data-embed-page="Manca"></div>`);
    const changes = new ContentChanges();
    expect(applyTransclusions(root, "Nota", changes)).toBe(1);
    expect(root.querySelector(".export-source")!.textContent).toBe("da Riunioni / 2026-11-04 › Decisioni");
    changes.undo();
    expect(root.querySelector(".export-source")).toBeNull();
  });

  it("una nota che riporta sé stessa non si svolge, e la riga dice perché", () => {
    const root = page(`<div class="embed embed-cycle" data-embed-page="" data-embed-heading="Sopra" data-embed-note="si riporta da sola"></div>`);
    const changes = new ContentChanges();
    applyTransclusions(root, "Nota", changes);
    const slot = root.querySelector<HTMLElement>(".embed")!;
    expect(slot.querySelector(".export-source")!.textContent).toBe("da Nota › Sopra · si riporta da sola");
    expect(slot.hasAttribute("data-print-told")).toBe(true);
    changes.undo();
    expect(slot.hasAttribute("data-print-told")).toBe(false);
  });
});

describe("le Basi", () => {
  function baseHtml(rows: number): string {
    const body = Array.from({ length: rows }, (_, i) => `<tr data-doc="Opere/${i}.md"><td>${i}</td></tr>`).join("");
    return `<div class="embed" data-embed-page="Opere.base" data-embed-heading="Arrivate"><div class="ui-slot" data-custom-kind="base"><div class="base-surface">
      <div class="base-bar"></div><div class="base-search-row"></div><div class="base-strip"></div>
      <div class="base-body"><div class="base-table-viewport" style="max-height:560px;overflow:auto;"><table class="base-table"><thead><tr><th>Nome</th></tr></thead><tbody>${body}<tr class="base-add-row"><td>Nuova</td></tr></tbody></table></div></div>
      <details class="base-written"></details>
    </div></div></div>`;
  }

  it("una Base che non ha ancora disegnato aspetta", () => {
    const root = page(`<div class="ui-slot" data-custom-kind="base"></div>`);
    expect(basesPending(root)).toBe(true);
    expect(applyBases(root, new ContentChanges()).pending).toBe(true);
  });

  it("si distende senza la barra, si misura come una tabella e dice quale Base e quale vista", () => {
    const root = page(baseHtml(3));
    const viewport = root.querySelector<HTMLElement>(".base-table-viewport")!;
    let scrolled = 0;
    viewport.addEventListener("scroll", () => scrolled++);
    const changes = new ContentChanges();
    const applied = applyBases(root, changes);
    expect(applied).toEqual({ tables: 1, pending: false });
    expect(scrolled).toBe(1);
    expect(viewport.style.maxHeight).toBe("none");
    expect(root.querySelector<HTMLElement>(".base-bar")!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>(".base-add-row")!.hidden).toBe(true);
    expect(root.querySelector(".export-base-caption")!.textContent).toBe("Base «Opere» · vista «Arrivate» · 3 righe");
    const block = root.querySelector<HTMLElement>(".print-body > .embed")!;
    expect(block.hasAttribute("data-print-table")).toBe(true);
    changes.undo();
    expect(viewport.style.maxHeight).toBe("560px");
    expect(block.hasAttribute("data-print-table")).toBe(false);
    expect(root.querySelector(".export-base-caption")).toBeNull();
    expect(root.querySelector<HTMLElement>(".base-bar")!.hidden).toBe(false);
  });
});
