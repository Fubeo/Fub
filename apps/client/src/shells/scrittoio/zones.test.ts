// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { focusZone } from "../../ui/a11y";

/// La superficie finta: due zone sue, la barra e la pagina, come un documento.
let surfaceZones: string[] | null = ["bar", "page"];
const focusEditor = vi.fn(() => document.getElementById("page")?.focus());

function surfaceStep(step: 1 | -1): boolean | null {
  if (!surfaceZones) return null;
  const elements = surfaceZones.map((id) => document.getElementById(id)!);
  const at = elements.findIndex((element) => element.contains(document.activeElement));
  const next = at < 0 ? (step > 0 ? 0 : elements.length - 1) : at + step;
  const target = elements[next];
  if (!target) return false;
  if (target.id === "page") target.focus();
  else focusZone(target);
  return true;
}

vi.mock("../../state/document-controller", () => ({
  focusEditor: () => focusEditor(),
  stepSurfaceZone: (step: 1 | -1) => surfaceStep(step),
}));
vi.mock("../../state/layout", () => ({ layout: { focus: "p1" } }));

const { stepZone, zones } = await import("./zones");

beforeEach(() => {
  surfaceZones = ["bar", "page"];
  focusEditor.mockClear();
  document.body.innerHTML = `
    <aside id="sidebar"><input id="filter" /></aside>
    <div class="pane" data-pane="p1">
      <div id="bar"><button id="tab-home">Home</button></div>
      <div id="page" tabindex="0"></div>
    </div>
    <section id="right-pane"><button id="comments">Commenti</button></section>
    <footer id="status-band"><button id="words">38 parole</button></footer>`;
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/// Il giro di F6 a partire da dove sta il fuoco, `count` passi.
function ring(step: 1 | -1, count: number): string[] {
  const seen: string[] = [];
  for (let turn = 0; turn < count; turn++) {
    stepZone(step);
    seen.push(document.activeElement?.id ?? "");
  }
  return seen;
}

describe("F6 fra le zone della finestra", () => {
  it("gira i file, la barra, il foglio, il pannello e la banda, e ricomincia", () => {
    document.getElementById("page")!.focus();
    expect(ring(1, 6)).toEqual(["comments", "words", "filter", "tab-home", "page", "comments"]);
  });

  it("Maiusc+F6 fa lo stesso giro al contrario, ed entra nel foglio dalla pagina", () => {
    document.getElementById("comments")!.focus();
    expect(ring(-1, 6)).toEqual(["page", "tab-home", "filter", "words", "comments", "page"]);
  });

  it("una zona chiusa non si conta", () => {
    document.getElementById("sidebar")!.hidden = true;
    document.getElementById("right-pane")!.hidden = true;
    document.getElementById("page")!.focus();
    expect(ring(1, 3)).toEqual(["words", "tab-home", "page"]);
  });

  it("un foglio senza zone sue prende il fuoco come sempre", () => {
    surfaceZones = null;
    document.getElementById("words")!.focus();
    expect(ring(1, 2)).toEqual(["filter", "page"]);
    expect(focusEditor).toHaveBeenCalledTimes(1);
  });

  it("dal nulla F6 parte dalla prima zona, Maiusc+F6 dall'ultima", () => {
    (document.activeElement as HTMLElement | null)?.blur();
    stepZone(1);
    expect(document.activeElement?.id).toBe("filter");
    (document.activeElement as HTMLElement | null)?.blur();
    stepZone(-1);
    expect(document.activeElement?.id).toBe("words");
  });

  it("una zona senza niente da premere prende il fuoco lei", () => {
    document.getElementById("status-band")!.replaceChildren();
    document.getElementById("comments")!.focus();
    stepZone(1);
    expect(document.activeElement?.id).toBe("status-band");
    expect(zones().map((zone) => zone.element.id || "pane")).toEqual(["sidebar", "pane", "right-pane", "status-band"]);
  });
});
