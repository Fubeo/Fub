// @vitest-environment happy-dom
// Il campo «Testo» del pannello delle proprietà (K5 T22): le parole di un
// testo libero scelto da solo, che il pannello scrive con l'operazione
// `text`, come gli altri campi della sezione del testo. Svuotato, il testo se
// ne va; un testo che `text` non riscrive senza perdite non ha il campo.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openLifetime, type Lifetime } from "../../../../ui/lifetime";
import { closeContextMenu } from "../../../../ui/menu";
import { SceneEngine } from "../../scene/engine";
import { doc } from "../../scene/test-support";
import { createDrawEditor, type DrawChange, type DrawEditor } from "../editor";
import { LAYER } from "../test-support";

const T = "ot1t1t1t1";
const FREE = `<text id="${T}" x="40" y="80" fill="#000000" font-family="Inter, sans-serif" font-size="32"><tspan x="40" dy="0">Ciao</tspan><tspan x="40" dy="40">a tutti</tspan></text>`;

let host: HTMLElement;
let owner: Lifetime;
let editor: DrawEditor;
let changes: DrawChange[];

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  owner = openLifetime();
  changes = [];
});

afterEach(() => {
  closeContextMenu();
  for (const open of document.querySelectorAll(".context-menu")) open.remove();
  owner.close();
  host.remove();
});

/// Un disegno con `body` nel livello (e `before` prima del livello), il
/// pannello aperto e `id` scelto.
function mountOn(body: string, id: string, before = ""): void {
  editor = createDrawEditor(host, SceneEngine.open(doc(`${before}${LAYER}${body}</g>`)), owner, { onChange: (change) => changes.push(change) });
  host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Proprietà"]')!.click();
  editor.select([id]);
}

const field = (): HTMLTextAreaElement | null => host.querySelector<HTMLTextAreaElement>('.draw-properties .draw-properties-field[data-field="content"] textarea');

/// Scrive `value` nel campo e lo lascia, come chi scrive e passa oltre.
function write(value: string): void {
  const area = field()!;
  area.focus();
  area.value = value;
  area.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
}

describe("il campo «Testo» del pannello", () => {
  it("mostra le righe di un testo libero, in testa alla sezione del testo", () => {
    mountOn(FREE, T);
    const area = field()!;
    expect(area.value).toBe("Ciao\na tutti");
    const section = area.closest<HTMLElement>(".draw-properties-field")!.parentElement!;
    expect(section.querySelector(".draw-properties-field")).toBe(area.closest(".draw-properties-field"));
  });

  it("scrive le righe con l'operazione `text`, in un passo di annulla", () => {
    mountOn(FREE, T);
    write("Buongiorno\n\n  a   voi  ");
    expect(changes).toHaveLength(1);
    expect(changes[0]!.op).toEqual({ op: "text", id: T, lines: ["Buongiorno", " ", "a voi"] });
    expect(editor.engine.text).toContain(">Buongiorno</tspan>");
    expect(editor.selection).toEqual([T]);
    expect(field()!.value).toBe("Buongiorno\n\na voi");
    editor.undo();
    expect(editor.engine.text).toContain(">a tutti</tspan>");
  });

  it("le stesse righe non scrivono niente", () => {
    mountOn(FREE, T);
    write("Ciao\na tutti ");
    expect(changes).toHaveLength(0);
  });

  it("svuotato, il testo se ne va", () => {
    mountOn(FREE, T);
    write("  \n ");
    expect(changes).toHaveLength(1);
    expect(changes[0]!.op).toMatchObject({ op: "remove" });
    expect(editor.engine.text).not.toContain(T);
    expect(editor.selection).toEqual([]);
  });

  it("non c'è per un testo su tracciato, in area, coi pezzi, con righe di stili diversi, o per una forma", () => {
    const P = "op1p1p1p1";
    const curve = `<defs id="fub-defs"><path id="${P}" fub:role="private" d="M10 50 C30 20 60 20 90 50"/></defs>`;
    const cases: ReadonlyArray<readonly [string, string, string?]> = [
      [`<text id="${T}" fill="#000000" font-size="10" text-anchor="middle"><textPath startOffset="50%" href="#${P}">Il testo segue</textPath></text>`, T, curve],
      [`<text id="${T}" fub:wrap="320" x="40" y="80" font-size="32"><tspan x="40" dy="0">In area</tspan></text>`, T],
      [`<text id="${T}" x="40" y="80" font-size="32"><tspan x="40" dy="0">Uno <tspan font-weight="700">due</tspan></tspan></text>`, T],
      [`<text id="${T}" x="40" y="80" font-size="32"><tspan x="40" dy="0">Uno</tspan><tspan x="40" dy="40" fill="#ff0000">Due</tspan></text>`, T],
      [`<rect id="${P}" x="10" y="10" width="40" height="30" fill="#000000"/>`, P],
    ];
    for (const [body, id, before] of cases) {
      mountOn(body, id, before);
      expect(editor.selection, body).toEqual([id]);
      expect(field(), body).toBeNull();
      editor.dispose();
      host.replaceChildren();
    }
  });
});
