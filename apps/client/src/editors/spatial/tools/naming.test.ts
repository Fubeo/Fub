// Il nome di un oggetto: il suo primo `title`, dato, cambiato e tolto in un
// passo che il motore accetta così com'è e che un annulla disfa al byte.

import { describe, expect, it } from "vitest";
import { outline } from "../describe";
import type { ElementItem } from "../scene/classify";
import { readScene } from "../scene/read";
import { doc } from "../scene/test-support";
import { gesture, NewIds } from "./edit";
import { cleanName, NAME_MAX, nameable, nameOps } from "./naming";
import { LAYER, open, type Opened } from "./test-support";

const INKSCAPE = "http://www.inkscape.org/namespaces/inkscape";

function itemOf(opened: Opened, key: string): ElementItem {
  const found = opened.engine.scene().find((entry) => entry.kind === "element" && (entry.id ?? `@${entry.path.join(".")}`) === key);
  if (found?.kind !== "element") throw new Error(`nessun oggetto ${key}`);
  return found;
}

/// Dà all'oggetto `key` il nome `name`; verifica che un annulla riporti il
/// testo di prima e torna il testo di dopo, con la chiave dell'oggetto.
/// `null` se non c'è niente da scrivere.
function rename(opened: Opened, key: string, name: string): { text: string; key: string } | null {
  const change = nameOps(opened.engine.model!, itemOf(opened, key), name, new NewIds((id) => opened.engine.holder(id) !== null));
  if (change === "foreign") throw new Error("estraneo");
  if (change.ops.length === 0) return null;
  const before = opened.engine.text;
  const outcome = opened.engine.apply(gesture(change.ops)!);
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
  const after = opened.engine.text;
  expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
  expect(opened.engine.text).toBe(before);
  expect(opened.engine.apply(gesture(change.ops)!).outcome).toBe("applied");
  expect(change.keys).toHaveLength(1);
  return { text: after, key: change.keys[0]! };
}

/// I nomi degli oggetti del livello, come li dice l'albero.
function names(text: string): (string | null)[] {
  return outline(readScene(text).items)[0]!.children.map((node) => node.name);
}

describe("il nome di un oggetto", () => {
  it("una forma riceve il suo `title` per primo, e resta lei: stesso id, stesso posto, stessi attributi", () => {
    const opened = open(doc(`${LAYER}<circle id="o1" r="1"/><rect id="o2" x="1" y="2" width="3" height="4" fill="#e69f00"/><line id="o3" x2="1"/></g>`));
    const out = rename(opened, "o2", "Tetto")!;
    expect(out.key).toBe("o2");
    expect(names(out.text)).toEqual([null, "Tetto", null]);
    expect(out.text).toMatch(/<rect id="o2" x="1" y="2" width="3" height="4" fill="#e69f00">\s*<title>Tetto<\/title>\s*<\/rect>/);
    expect(opened.reindex().units.map((unit) => unit.key)).toEqual(["o1", "o2", "o3"]);
  });

  it("cambia soltanto il testo del primo `title`: i suoi attributi, le righe del testo e gli altri `title` restano", () => {
    const opened = open(
      doc(`${LAYER}<text id="t1" x="0" y="10"><title xml:lang="it">Insegna</title><title xml:lang="en">Sign</title><tspan x="0" dy="0">Bar</tspan></text></g>`),
    );
    const out = rename(opened, "t1", "Insegna del bar")!;
    expect(names(out.text)).toEqual(["Insegna del bar"]);
    expect(out.text).toContain('<title xml:lang="it">Insegna del bar</title>');
    expect(out.text).toContain('<title xml:lang="en">Sign</title>');
    expect(readScene(out.text).items.find((item) => item.kind === "element" && item.id === "t1")).toMatchObject({ lines: ["Bar"] });
  });

  it("un nome vuoto toglie il primo `title`; senza nome il testo torna a dirsi con le sue parole", () => {
    const opened = open(doc(`${LAYER}<text id="t1"><title>Insegna</title><tspan>Bar</tspan></text></g>`));
    const out = rename(opened, "t1", "")!;
    expect(out.text).not.toContain("<title>");
    expect(names(out.text)).toEqual(["Bar"]);
  });

  it("un gruppo cambia soltanto il suo `title`, dopo la descrizione se c'è; i figli non si toccano", () => {
    const inner = '<rect id="o1" width="1" height="1"/>';
    const opened = open(doc(`${LAYER}<g id="g1"><desc>Due case</desc>${inner}</g><g id="g2"><title>Vecchio</title>${inner.replace("o1", "o2")}</g></g>`));
    const first = rename(opened, "g1", "Casa")!;
    expect(first.text).toMatch(/<desc>Due case<\/desc>\s*<title>Casa<\/title>\s*<rect id="o1" width="1" height="1"\/>/);
    const second = rename(opened, "g2", "Nuovo")!;
    expect(names(second.text)).toEqual(["Casa", "Nuovo"]);
    expect(second.text).not.toContain("Vecchio");
    expect(rename(opened, "g2", "")!.text).not.toContain("Nuovo");
  });

  it("niente da scrivere se il nome è lo stesso, o se si toglie un nome che non c'è", () => {
    const opened = open(doc(`${LAYER}<rect id="o1" width="1" height="1"><title>  Tetto </title></rect><rect id="o2" width="1" height="1"/></g>`));
    expect(rename(opened, "o1", "Tetto")).toBeNull();
    expect(rename(opened, "o2", "")).toBeNull();
  });

  it("un oggetto senza id ne riceve uno", () => {
    const opened = open(doc(`${LAYER}<rect width="1" height="1"/></g>`));
    const rect = opened.engine.scene().find((entry) => entry.kind === "element" && entry.tag === "rect")!;
    expect(rect.kind === "element" && rect.id).toBeNull();
    const out = rename(opened, `@${(rect as ElementItem).path.join(".")}`, "Tetto")!;
    expect(out.key).toMatch(/^o/);
    expect(out.text).toContain(`<rect id="${out.key}" width="1" height="1">`);
  });

  it("un'unità con un prefisso dichiarato su di sé resta com'è", () => {
    const opened = open(doc(`${LAYER}<rect id="o1" xmlns:inkscape="${INKSCAPE}" inkscape:label="Tetto" width="1" height="1"/></g>`));
    expect(nameOps(opened.engine.model!, itemOf(opened, "o1"), "Casa", new NewIds(() => false))).toBe("foreign");
    // Lo si sa prima di chiedergli un nome, anche quello che ha già.
    expect(nameable(opened.engine.model!, itemOf(opened, "o1"))).toBe(false);
    expect(nameOps(opened.engine.model!, itemOf(opened, "o1"), "", new NewIds(() => false))).toEqual({ ops: [], keys: [] });
  });

  it("sa quando un oggetto può cambiare nome", () => {
    const opened = open(doc(`${LAYER}<rect id="o1" width="1" height="1"/><g id="o2"><rect width="1" height="1"/></g></g>`));
    expect(nameable(opened.engine.model!, itemOf(opened, "o1"))).toBe(true);
    expect(nameable(opened.engine.model!, itemOf(opened, "o2"))).toBe(true);
  });

  it("un gruppo il cui `title` ha attributi che un'operazione non sa scrivere ne riceve uno senza", () => {
    const opened = open(doc(`${LAYER}<g id="o1"><title xmlns:inkscape="${INKSCAPE}" inkscape:label="x">Casa</title><rect id="o2" width="1" height="1"/></g></g>`));
    const out = rename(opened, "o1", "Tetto")!;
    expect(out.text).toMatch(/<g id="o1">\s*<title>Tetto<\/title>/);
    expect(out.text).not.toContain("inkscape");
  });
});

describe("cleanName", () => {
  it("raccoglie gli spazi, toglie quelli ai bordi e taglia oltre il massimo", () => {
    expect(cleanName("  Porta \n d’ingresso\t")).toBe("Porta d’ingresso");
    expect(cleanName("   ")).toBe("");
    expect(Array.from(cleanName("é".repeat(NAME_MAX + 10)))).toHaveLength(NAME_MAX);
  });
});
