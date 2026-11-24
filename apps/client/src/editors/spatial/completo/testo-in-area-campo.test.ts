// @vitest-environment happy-dom
// Il campo «Testo» dell'ispettore su un testo in area (K6 T16, correzioni):
// col Completo aperto e acceso, il campo mostra le parole dei paragrafi
// (le righe riunite come dice `fub:join`) e le manda al motore
// (`text.editRange`, `Completo.parole`), che rifà gli a capo nel riquadro.
// L'operazione `text` non parte mai: scriverebbe righe senza a capo. Senza
// motore il campo non c'è per un testo in area, come prima.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { SceneEngine } from "../scene/engine";
import { doc } from "../scene/test-support";
import type { Op } from "../scene/ops";
import { createDrawEditor, type DrawChange, type DrawEditor, type DrawEditorOptions } from "../tools/editor";
import { LAYER } from "../tools/test-support";
import type { MotoreDelDisegno } from "../motore/gesti";

vi.mock("../../../state/components", async (real) => ({
  ...(await real<typeof import("../../../state/components")>()),
  components: () => ({ on: (id: string) => id === "fub.disegno-completo" }),
  onComponents: () => () => undefined,
}));

/// Ciò che il Completo finto riceve: le parole mandate, e il `commit` dei tasti
/// dell'editor, con cui scrive le ops del motore come fa `eseguiVoce`.
const visto = vi.hoisted(() => ({
  parole: [] as Array<readonly [string, string]>,
  commit: null as ((ops: readonly unknown[], nome: string) => boolean) | null,
  /// Le ops che il motore finto rimanda per le parole mandate.
  risposta: null as readonly unknown[] | null,
}));

vi.mock("./index", () => ({
  apri: (_ctx: unknown, opzioni: { readonly tasti: { readonly commit: (ops: readonly unknown[], nome: string) => boolean } }) => {
    visto.commit = opzioni.tasti.commit;
    return {
      sezioni: { registra: () => false, di: () => [], ascolta: () => () => undefined, chiudi: () => undefined },
      livelli: null,
      spazio: () => undefined,
      colonna: () => [],
      strumentoMotore: () => null,
      ascoltaColonna: () => () => undefined,
      cassetto: () => undefined,
      preparaStrumento: () => Promise.resolve(false),
      clicStrumento: () => undefined,
      // Nessuno strumento del motore ha una fila sua in questa prova.
      fila: () => null,
      parole: (elemento: string, testo: string) => {
        visto.parole.push([elemento, testo]);
        if (visto.risposta !== null) visto.commit?.(visto.risposta, "Modifica testo");
      },
    };
  },
}));

const T = "oz1z1z1z1";
const AREA = `<text id="${T}" x="40" y="60" fill="#000000" font-family="Inter, sans-serif" font-size="20" fub:wrap="120"><tspan x="40" dy="0">Le onde  del</tspan><tspan fub:join="space" x="40" dy="24">mare</tspan><tspan x="40" dy="24"> </tspan><tspan x="40" dy="24">preci</tspan><tspan fub:join="word" x="40" dy="24">pitevolissimevolmente</tspan></text>`;
const PUNTO = `<text id="ot1t1t1t1" x="40" y="200" fill="#000000" font-family="Inter, sans-serif" font-size="20"><tspan x="40" dy="0">Pioggia</tspan><tspan x="40" dy="24">sul mare</tspan></text>`;
const SOURCE = doc(`${LAYER}${AREA}${PUNTO}</g>`);

/// Un motore che c'è e non risponde mai: al campo basta che ci sia.
const MOTORE = { adesso: () => null, pronta: () => new Promise(() => undefined), assente: () => null } as unknown as MotoreDelDisegno;

let host: HTMLElement;
let owner: Lifetime;
let editor: DrawEditor;
let changes: DrawChange[];

async function arrivati(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((ok) => setTimeout(ok, 0));
}

async function mountOn(id: string, options: DrawEditorOptions = { workspace: "full", motore: MOTORE }): Promise<void> {
  editor = createDrawEditor(host, SceneEngine.open(SOURCE), owner, { ...options, onChange: (change) => changes.push(change) });
  await arrivati();
  host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Proprietà"]')!.click();
  editor.select([id]);
}

const field = (): HTMLTextAreaElement | null => host.querySelector<HTMLTextAreaElement>('.draw-properties .draw-properties-field[data-field="content"] textarea');

function write(value: string): void {
  const area = field()!;
  area.focus();
  area.value = value;
  area.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  owner = openLifetime();
  changes = [];
  visto.parole = [];
  visto.commit = null;
  visto.risposta = null;
});

afterEach(() => {
  owner.close();
  host.remove();
});

describe("il campo «Testo» di un testo in area", () => {
  it("mostra i paragrafi come si leggono: le righe riunite, gli spazi come sono, il paragrafo vuoto vuoto", async () => {
    await mountOn(T);
    expect(field()!.value).toBe("Le onde  del mare\n\nprecipitevolissimevolmente");
  });

  it("manda le parole al motore come sono scritte, spazi e a capo compresi, e non scrive righe da sé", async () => {
    await mountOn(T);
    write("Le onde  del mare \r\n\r\nsera\u0001");
    expect(visto.parole).toEqual([[T, "Le onde  del mare \n\nsera"]]);
    expect(changes).toHaveLength(0);
  });

  it("le stesse parole non mandano niente; svuotato, il testo se ne va", async () => {
    await mountOn(T);
    write("Le onde  del mare\n\nprecipitevolissimevolmente");
    expect(visto.parole).toEqual([]);
    write(" \n ");
    expect(visto.parole).toEqual([]);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.op).toMatchObject({ op: "remove" });
    expect(editor.engine.text).not.toContain(T);
  });

  it("le ops del motore entrano in un passo, e Annulla torna al file di prima", async () => {
    await mountOn(T);
    const prima = editor.engine.text;
    // Le ops che il motore rimanda (qui una qualunque che riscrive il testo).
    const nuovo: Op = { op: "text", id: T, lines: ["Nuove", "parole"] };
    visto.risposta = [nuovo];
    write("Nuove parole");
    expect(visto.parole).toEqual([[T, "Nuove parole"]]);
    expect(editor.engine.text).not.toBe(prima);
    expect(editor.engine.text).toContain(">parole</tspan>");
    editor.undo();
    expect(editor.engine.text).toBe(prima);
  });

  it("un testo di punto resta com'era: l'operazione `text`, mai il motore", async () => {
    await mountOn("ot1t1t1t1");
    expect(field()!.value).toBe("Pioggia\nsul mare");
    write("Pioggia\nsul mare!");
    expect(visto.parole).toEqual([]);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.op).toEqual({ op: "text", id: "ot1t1t1t1", lines: ["Pioggia", "sul mare!"] });
  });

  it("senza motore, o nel Semplice, il campo non c'è per un testo in area", async () => {
    await mountOn(T, { workspace: "full" });
    expect(field()).toBeNull();
    editor.dispose();
    host.replaceChildren();
    await mountOn(T, { workspace: "simple", motore: MOTORE });
    expect(field()).toBeNull();
  });
});
