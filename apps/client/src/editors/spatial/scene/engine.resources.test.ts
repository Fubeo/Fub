// Il motore delle operazioni sulle risorse: i riferimenti e la raccolta, gli
// stili, i simboli e le ripetizioni.
import { describe, expect, it } from "vitest";
import { mergeUndo, SceneEngine } from "./engine";
import { parseWireOp, type Op } from "./ops";
import { MAX_RESOURCES, readScene } from "./read";
import type { Elem } from "./serialize";
import {
  apply,
  applied,
  END,
  END_G,
  L1,
  L2,
  L2_LOCKED,
  lf,
  PAPER,
  R2,
  R3,
  R4_ELEM,
  rejects,
  ROOT,
  TITLE,
} from "./engine/test-support";

describe("le risorse", () => {
  const DEFS = '  <defs id="fub-defs">';
  const END_DEFS = "  </defs>";
  /// Una sfumatura nella `defs`, col suo ciclo di vita.
  const gradient = (id: string, role: string | null): string[] => [
    `    <linearGradient id="${id}"${role === null ? "" : ` fub:role="${role}"`} x1="0" y1="0" x2="1" y2="0">`,
    '      <stop offset="0" stop-color="#0072b2"/>',
    '      <stop offset="1" stop-color="#56b4e9"/>',
    "    </linearGradient>",
  ];
  /// Un rettangolo nel livello che usa `ref` per il riempimento.
  const user = (id: string, ref: string): string => `    <rect id="${id}" x="500" y="100" width="200" height="120" fill="url(#${ref}) #0072b2"/>`;
  const G = "r1a2b3c4d";
  const PRIVATE = lf(ROOT, TITLE, DEFS, ...gradient(G, "private"), END_DEFS, PAPER, L1, user("o2b3c4d5e", G), R3, END_G, END);
  const PLAIN = lf(ROOT, TITLE, PAPER, L1, R2, R3, END_G, END);

  it("una risorsa condivisa resta finché qualcuno la usa, poi se ne va con la defs", () => {
    const source = lf(ROOT, TITLE, DEFS, ...gradient(G, "shared"), END_DEFS, PAPER, L1, user("o2b3c4d5e", G), user("o3c4d5e6f", G), END_G, END);
    const engine = SceneEngine.open(source);
    const first = apply(engine, { op: "remove", target: "o2b3c4d5e" });
    expect(first.forward).toEqual({ op: "remove", target: "o2b3c4d5e" });
    expect(first.text).toBe(lf(ROOT, TITLE, DEFS, ...gradient(G, "shared"), END_DEFS, PAPER, L1, user("o3c4d5e6f", G), END_G, END));
    const second = apply(engine, { op: "remove", target: "o3c4d5e6f" });
    expect(second.text).toBe(lf(ROOT, TITLE, PAPER, L1, END_G, END));
    expect(second.forward).toEqual({
      op: "batch",
      ops: [{ op: "remove", target: "o3c4d5e6f" }, { op: "remove", target: G }, { op: "remove", target: "fub-defs" }],
    });
    expect([...second.touched].sort()).toEqual(["fub-defs", "o3c4d5e6f", G].sort());
    expect(applied(engine.undo(second.undo)).text).toBe(first.text);
  });

  it("la raccolta tocca solo ciò che l'operazione lascia solo", () => {
    // Una sfumatura privata che nessuno usava resta anche se l'operazione la
    // cambia.
    const source = lf(ROOT, TITLE, DEFS, ...gradient(G, "private"), END_DEFS, PAPER, L1, R2, END_G, END);
    const engine = SceneEngine.open(source);
    const out = apply(engine, { op: "set", id: G, attrs: { x2: "0.5" } });
    expect(out.text).toBe(source.replace('x2="1"', 'x2="0.5"'));
    expect(out.forward).toEqual({ op: "set", id: G, attrs: { x2: "0.5" } });
  });

  it("un riferimento da un elemento estraneo o da un foglio di stile tiene la risorsa", () => {
    const foreign = '    <path style="fill:url(#r1a2b3c4d)" d="M0 0h10v10z"/>';
    const withForeign = lf(ROOT, TITLE, DEFS, ...gradient(G, "private"), END_DEFS, PAPER, L1, user("o2b3c4d5e", G), foreign, END_G, END);
    const engine = SceneEngine.open(withForeign);
    const out = apply(engine, { op: "remove", target: "o2b3c4d5e" });
    expect(out.text).toBe(lf(ROOT, TITLE, DEFS, ...gradient(G, "private"), END_DEFS, PAPER, L1, foreign, END_G, END));
    rejects(out.text, { op: "remove", target: G }, "in-use");

    const sheet = "  <style>.sole { fill: url(#r1a2b3c4d) }</style>";
    const withSheet = lf(ROOT, TITLE, DEFS, ...gradient(G, "private"), END_DEFS, sheet, PAPER, L1, user("o2b3c4d5e", G), END_G, END);
    expect(apply(SceneEngine.open(withSheet), { op: "remove", target: "o2b3c4d5e" }).text).toContain(`<linearGradient id="${G}"`);
  });

  it("chi usa e la risorsa si tolgono insieme, in un batch", () => {
    const engine = SceneEngine.open(PRIVATE);
    const out = apply(engine, { op: "batch", label: "Via", ops: [{ op: "remove", target: "o2b3c4d5e" }, { op: "remove", target: G }] });
    expect(out.text).toBe(lf(ROOT, TITLE, PAPER, L1, R3, END_G, END));
    // La raccolta toglie la `defs` rimasta vuota, nello stesso batch.
    expect(out.forward).toEqual({
      op: "batch",
      label: "Via",
      ops: [{ op: "remove", target: "o2b3c4d5e" }, { op: "remove", target: G }, { op: "remove", target: "fub-defs" }],
    });
    expect(out.inverse).toMatchObject({ op: "batch", label: "Via" });
    expect(applied(SceneEngine.open(out.text).apply(out.inverse)).text).toBe(PRIVATE);
  });

  it("una defs non si toglie se qualcosa fuori usa le sue risorse", () => {
    rejects(PRIVATE, { op: "remove", target: "fub-defs" }, "in-use");
    // Un motivo che usa una sfumatura della stessa defs non la trattiene.
    const pattern = [
      '    <pattern id="r2b3c4d5e" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">',
      `      <rect x="0" y="0" width="20" height="20" fill="url(#${G}) #0072b2"/>`,
      "    </pattern>",
    ];
    const source = lf(ROOT, TITLE, DEFS, ...gradient(G, null), ...pattern, END_DEFS, PAPER, L1, R2, END_G, END);
    expect(apply(SceneEngine.open(source), { op: "remove", target: "fub-defs" }).text).toBe(lf(ROOT, TITLE, PAPER, L1, R2, END_G, END));
  });

  it("ident non toglie l'id a una risorsa usata; a una che non lo è sì, e diventa estranea", () => {
    rejects(PRIVATE, { op: "ident", path: [1, 0], tag: "linearGradient", id: null }, "in-use");
    const unused = lf(ROOT, TITLE, DEFS, ...gradient(G, "private"), END_DEFS, PAPER, L1, R2, END_G, END);
    const engine = SceneEngine.open(unused);
    const out = apply(engine, { op: "ident", path: [1, 0], tag: "linearGradient", id: null });
    expect(out.text).toBe(unused.replace(` id="${G}"`, ""));
    expect(engine.scene().some((item) => item.kind === "foreign")).toBe(true);
  });

  it("una risorsa si sposta solo fra le defs della radice; chi la usa si sposta e resta modificabile", () => {
    const other = ['  <defs id="defs2">', "  </defs>"];
    const source = lf(ROOT, TITLE, DEFS, ...gradient(G, "private"), END_DEFS, ...other, PAPER, L1, user("o2b3c4d5e", G), END_G, L2, R3, END_G, END);
    rejects(source, { op: "move", target: G, parent: "l3f8a0c2d", pos: { last: true } }, "invalid-elem");
    const engine = SceneEngine.open(source);
    const moved = apply(engine, { op: "move", target: G, parent: "defs2", pos: { last: true } });
    // La `defs` di FubDraw rimasta vuota se ne va con lo spostamento.
    expect(moved.text).toBe(lf(ROOT, TITLE, '  <defs id="defs2">', ...gradient(G, "private"), "  </defs>", PAPER, L1, user("o2b3c4d5e", G), END_G, L2, R3, END_G, END));
    const user2 = apply(engine, { op: "move", target: "o2b3c4d5e", parent: "l9k8j7h6g", pos: { last: true } });
    expect(user2.text).toBe(lf(ROOT, TITLE, '  <defs id="defs2">', ...gradient(G, "private"), "  </defs>", PAPER, L1, END_G, L2, R3, user("o2b3c4d5e", G), END_G, END));
    expect(engine.scene().every((item) => item.kind !== "foreign")).toBe(true);
  });

  it("set su una risorsa la lascia modificabile", () => {
    const engine = SceneEngine.open(PRIVATE);
    expect(apply(engine, { op: "set", id: G, attrs: { "fub:role": "shared" } }).text).toBe(PRIVATE.replace('fub:role="private"', 'fub:role="shared"'));
    rejects(PRIVATE, { op: "set", id: G, attrs: { href: "#altro" } }, "invalid-elem");
    rejects(PRIVATE, { op: "set", id: G, attrs: { spreadMethod: "sideways" } }, "invalid-elem");
  });

  it("set con part cambia una parte della risorsa: il punto di un campione, in un passo", () => {
    const S = "r5e6f7g8h";
    const swatch = (color: string): string[] => [
      `    <linearGradient id="${S}" fub:role="swatch" fub:name="Blu" gradientUnits="userSpaceOnUse">`,
      "      <title>Il blu del titolo</title>",
      `      <stop stop-color="${color}"/>`,
      "    </linearGradient>",
    ];
    // Chi lo usa sta anche in un livello bloccato: la risorsa no.
    const source = lf(ROOT, TITLE, DEFS, ...swatch("#0072b2"), END_DEFS, PAPER, L1, user("o2b3c4d5e", S), END_G, L2_LOCKED, user("o3c4d5e6f", S), END_G, END);
    const engine = SceneEngine.open(source);
    const out = apply(engine, { op: "set", id: S, part: [1], attrs: { "stop-color": "#d55e00" } });
    expect(out.text).toBe(lf(ROOT, TITLE, DEFS, ...swatch("#d55e00"), END_DEFS, PAPER, L1, user("o2b3c4d5e", S), END_G, L2_LOCKED, user("o3c4d5e6f", S), END_G, END));
    expect(out.inverse).toEqual({ op: "set", id: S, part: [1], attrs: { "stop-color": "#0072b2" } });
    expect(out.touched).toEqual([S]);
    expect(engine.scene().every((item) => item.kind !== "foreign")).toBe(true);
    expect(applied(SceneEngine.open(out.text).apply(out.inverse)).text).toBe(source);
    expect(applied(engine.undo(out.undo)).text).toBe(source);

    // Due cambi della stessa parte, uno dopo l'altro, sono un passo solo;
    // di due parti diverse no.
    const again = SceneEngine.open(source);
    const first = apply(again, { op: "set", id: S, part: [1], attrs: { "stop-color": "#d55e00" } });
    const second = apply(again, { op: "set", id: S, part: [1], attrs: { "stop-color": "#cc79a7" } });
    const merged = mergeUndo(first.undo, second.undo)!;
    expect(merged.inverse).toEqual({ op: "set", id: S, part: [1], attrs: { "stop-color": "#0072b2" } });
    expect(applied(again.undo(merged)).text).toBe(source);
    // Le parti contano anche il titolo, il cui contenuto è testo.
    rejects(source, { op: "set", id: S, part: [0], attrs: { "stop-color": "#d55e00" } }, "invalid-elem");
    rejects(source, { op: "set", id: S, part: [0, 0], attrs: { "stop-color": "#d55e00" } }, "missing-target");
    const third = SceneEngine.open(source);
    const one = apply(third, { op: "set", id: S, part: [1], attrs: { "stop-color": "#d55e00" } });
    const other = apply(third, { op: "set", id: S, attrs: { "fub:name": "Arancio" } });
    expect(mergeUndo(one.undo, other.undo)).toBeNull();
  });

  it("set con part vale soltanto su una parte che c'è di una risorsa, e la lascia modificabile", () => {
    rejects(PRIVATE, { op: "set", id: G, part: [2], attrs: { offset: "0.5" } }, "missing-target");
    rejects(PRIVATE, { op: "set", id: G, part: [0, 0], attrs: { offset: "0.5" } }, "missing-target");
    rejects(PRIVATE, { op: "set", id: "o2b3c4d5e", part: [0], attrs: { fill: "#000000" } }, "invalid-elem");
    rejects(PRIVATE, { op: "set", id: "#root", part: [0], attrs: { "fub:units": "mm" } }, "invalid-elem");
    for (const part of [[], [-1], [0.5], ["0"], 0, null]) rejects(PRIVATE, { op: "set", id: G, part, attrs: { offset: "0.5" } }, "invalid-elem");
    rejects(PRIVATE, { op: "set", id: G, part: [0], attrs: { id: "r0a0b0c0d" } }, "invalid-elem");
    rejects(PRIVATE, { op: "set", id: G, part: [0], attrs: { "stop-color": "none" } }, "invalid-elem");
    rejects(PRIVATE, { op: "set", id: G, part: [0], attrs: { href: "#altro" } }, "invalid-elem");
    rejects(PRIVATE, { op: "set", id: G, part: [0], attrs: { offset: "0.5", "offset ": "0.6" } }, "invalid-elem");
    const engine = SceneEngine.open(PRIVATE);
    const out = apply(engine, { op: "set", id: G, part: [1], attrs: { offset: "0.5", "stop-opacity": "0.25" } });
    expect(out.text).toBe(PRIVATE.replace('<stop offset="1" stop-color="#56b4e9"/>', '<stop offset="0.5" stop-color="#56b4e9" stop-opacity="0.25"/>'));
    expect(out.inverse).toEqual({ op: "set", id: G, part: [1], attrs: { offset: "1", "stop-opacity": null } });
    expect(parseWireOp({ op: "set", id: G, part: [1], attrs: { offset: "0.5" } })).toEqual({ op: { op: "set", id: G, part: [1], attrs: { offset: "0.5" } } });
  });

  it("set su chi usa un ritaglio e un filtro lo lascia modificabile", () => {
    const C = "r2b3c4d5e";
    const F = "r3c4d5e6f";
    const clip = [`    <clipPath id="${C}" fub:role="private">`, '      <circle cx="600" cy="160" r="50"/>', "    </clipPath>"];
    const blur = [`    <filter id="${F}" fub:role="shared">`, '      <feGaussianBlur stdDeviation="4"/>', "    </filter>"];
    const rect = (attrs: string): string => `    <rect id="o2b3c4d5e" x="500" y="100" width="200" height="120" fill="#e69f00"${attrs}/>`;
    const source = lf(ROOT, TITLE, DEFS, ...clip, ...blur, END_DEFS, PAPER, L1, rect(` clip-path="url(#${C})" filter="url(#${F})"`), END_G, END);
    const engine = SceneEngine.open(source);
    expect(apply(engine, { op: "set", id: "o2b3c4d5e", attrs: { opacity: "0.5", transform: "rotate(10 600 160)" } }).text).toBe(
      lf(ROOT, TITLE, DEFS, ...clip, ...blur, END_DEFS, PAPER, L1, rect(` clip-path="url(#${C})" filter="url(#${F})" opacity="0.5" transform="rotate(10 600 160)"`), END_G, END),
    );
    // Il ritaglio e il filtro che nessuno usa più se ne vanno, e la defs con loro.
    const cleared = apply(engine, { op: "set", id: "o2b3c4d5e", attrs: { "clip-path": null, filter: null } });
    expect(cleared.text).toBe(lf(ROOT, TITLE, PAPER, L1, rect(' opacity="0.5" transform="rotate(10 600 160)"'), END_G, END));
    expect(engine.scene().every((item) => item.kind !== "foreign")).toBe(true);
  });

  it("in un batch la risorsa viene prima di chi la usa", () => {
    const elem: Elem = { tag: "linearGradient", attrs: { id: G, x1: "0", y1: "0", x2: "1", y2: "0" } };
    const add: Op = { op: "add", parent: "#root", pos: { first: true }, elem: { tag: "defs", attrs: { id: "fub-defs" }, children: [elem] } };
    const use: Op = { op: "set", id: "o2b3c4d5e", attrs: { fill: `url(#${G}) #0072b2` } };
    expect(SceneEngine.open(PLAIN).apply({ op: "batch", ops: [use, add] })).toMatchObject({ outcome: "rejected", reason: "invalid-elem", index: 0 });
    expect(apply(SceneEngine.open(PLAIN), { op: "batch", ops: [add, use] }).text).toContain(`fill="url(#${G}) #0072b2"`);
  });

  it("gli id delle risorse e del loro contenuto", () => {
    const add = (elem: Elem): Op => ({ op: "add", parent: "#root", pos: { first: true }, elem });
    const defs = (...children: Elem[]): Elem => ({ tag: "defs", attrs: { id: "fub-defs" }, children });
    const stop: Elem = { tag: "stop", attrs: { offset: "0", "stop-color": "#0072b2" } };
    rejects(PLAIN, add({ tag: "defs", attrs: { id: "defs2" } }), "invalid-elem");
    rejects(PLAIN, add(defs({ tag: "linearGradient", attrs: { x2: "1" }, children: [stop] })), "invalid-elem");
    rejects(PLAIN, add(defs({ tag: "linearGradient", attrs: { id: "o1a2b3c4d" }, children: [stop] })), "invalid-elem");
    rejects(PLAIN, add(defs({ tag: "linearGradient", attrs: { id: G }, children: [{ ...stop, attrs: { ...stop.attrs, id: "o1a2b3c4d" } }] })), "invalid-elem");
    const named = apply(SceneEngine.open(PLAIN), add(defs({ tag: "linearGradient", attrs: { id: G }, children: [{ ...stop, attrs: { ...stop.attrs, id: "r0a0b0c0d" } }] })));
    expect(named.text).toContain('<stop id="r0a0b0c0d" offset="0" stop-color="#0072b2"/>');
    // Il contenuto di un motivo è senza id, anche un gruppo.
    const pattern: Elem = {
      tag: "pattern",
      attrs: { id: G, x: "0", y: "0", width: "40", height: "40", patternUnits: "userSpaceOnUse" },
      children: [{ tag: "g", attrs: {}, children: [{ tag: "rect", attrs: { width: "20", height: "20", fill: "#0072b2" } }] }],
    };
    expect(apply(SceneEngine.open(PLAIN), add(defs(pattern))).text).toContain("      <g>\n        <rect width=\"20\" height=\"20\" fill=\"#0072b2\"/>\n      </g>");
  });

  it("first sotto la radice: una defs va prima della carta, il resto dopo le defs e la carta in testa", () => {
    const layer: Op = { op: "add", parent: "#root", pos: { first: true }, elem: { tag: "g", attrs: { id: "l0a1b2c3d", "fub:layer": "Sfondo" } } };
    const engine = SceneEngine.open(PRIVATE);
    expect(apply(engine, layer).text).toBe(
      lf(ROOT, TITLE, DEFS, ...gradient(G, "private"), END_DEFS, PAPER, '  <g id="l0a1b2c3d" fub:layer="Sfondo">', "  </g>", L1, user("o2b3c4d5e", G), R3, END_G, END),
    );
    // Una defs in fondo, come la scrive Figma, non sta in testa.
    const figma = lf(ROOT, L1, R2, END_G, '  <defs id="defs1">', ...gradient(G, null), "  </defs>", END);
    expect(apply(SceneEngine.open(figma), layer).text).toBe(
      lf(ROOT, '  <g id="l0a1b2c3d" fub:layer="Sfondo">', "  </g>", L1, R2, END_G, '  <defs id="defs1">', ...gradient(G, null), "  </defs>", END),
    );
    const defs: Op = { op: "add", parent: "#root", pos: { first: true }, elem: { tag: "defs", attrs: { id: "fub-defs" } } };
    expect(apply(SceneEngine.open(lf(ROOT, PAPER, L1, R2, END_G, END)), defs).text).toBe(lf(ROOT, '  <defs id="fub-defs"/>', PAPER, L1, R2, END_G, END));
  });

  it("una risorsa privata raccolta da una defs che non è di FubDraw lascia la defs", () => {
    const source = lf(ROOT, '  <defs id="defs2">', ...gradient(G, "private"), "  </defs>", PAPER, L1, user("o2b3c4d5e", G), END_G, END);
    const out = apply(SceneEngine.open(source), { op: "set", id: "o2b3c4d5e", attrs: { fill: "#e69f00" } });
    expect(out.text).toBe(lf(ROOT, '  <defs id="defs2">', "  </defs>", PAPER, L1, R2, END_G, END));
  });

  it("l'undo della raccolta che non è esatto rimette risorse e riferimenti", () => {
    const engine = SceneEngine.open(PRIVATE);
    const out = apply(engine, { op: "set", id: "o2b3c4d5e", attrs: { fill: "#e69f00" } });
    apply(engine, { op: "set", id: "o3c4d5e6f", attrs: { fill: "#111111" } });
    const undone = applied(engine.undo(out.undo));
    expect(undone.text).toBe(PRIVATE.replace('fill="#009e73"', 'fill="#111111"'));
    expect(engine.scene()).toEqual(readScene(undone.text).items);
    // Il ripeti, dopo un altro cambiamento, raccoglie di nuovo.
    apply(engine, { op: "set", id: "o3c4d5e6f", attrs: { fill: "#009e73" } });
    expect(applied(engine.undo(undone.undo)).text).toBe(lf(ROOT, TITLE, PAPER, L1, R2, R3, END_G, END));
  });

  it("due set di cui il secondo raccoglie non si fondono", () => {
    const engine = SceneEngine.open(PRIVATE);
    const first = apply(engine, { op: "set", id: "o2b3c4d5e", attrs: { fill: `url(#${G}) #000000` } });
    const second = apply(engine, { op: "set", id: "o2b3c4d5e", attrs: { fill: "#e69f00" } });
    expect(mergeUndo(first.undo, second.undo)).toBeNull();
  });

  it("un documento non riceve risorse oltre il limite, ma si modifica", () => {
    const many = (count: number): string => {
      const lines: string[] = [];
      for (let i = 0; i < count; i++) lines.push(`    <linearGradient id="r${i.toString(36).padStart(8, "0")}"/>`);
      return lf(ROOT, DEFS, ...lines, END_DEFS, PAPER, L1, R2, END_G, END);
    };
    const one: Op = { op: "add", parent: "fub-defs", pos: { last: true }, elem: { tag: "linearGradient", attrs: { id: "rzzzzzzzz" } } };
    rejects(many(MAX_RESOURCES), one, "limit");
    const full = SceneEngine.open(many(MAX_RESOURCES + 1));
    expect(full.apply({ op: "set", id: "o2b3c4d5e", attrs: { fill: "#000000" } }).outcome).toBe("applied");
    expect(full.apply(one)).toMatchObject({ outcome: "rejected", reason: "limit" });
    expect(SceneEngine.open(many(MAX_RESOURCES - 1)).apply(one).outcome).toBe("applied");
  });
});

describe("gli stili", () => {
  const DEFS = '  <defs id="fub-defs">';
  const END_DEFS = "  </defs>";
  const S = "r5e6f7a8b";
  const STYLE = `    <polyline id="${S}" fub:role="style" fub:name="Riquadro" points="0,0 100,0 100,100" fill="#0072b2" stroke="#1a1a1a" stroke-width="2"/>`;
  /// Un rettangolo nel livello che segue lo stile.
  const follower = (id: string): string => `    <rect id="${id}" fub:style="${S}" x="500" y="100" width="200" height="120" fill="#0072b2" stroke="#1a1a1a" stroke-width="2"/>`;
  const FOLLOWED = lf(ROOT, TITLE, DEFS, STYLE, END_DEFS, PAPER, L1, follower("o2b3c4d5e"), END_G, END);
  const ALONE = lf(ROOT, TITLE, DEFS, STYLE, END_DEFS, PAPER, L1, R2, END_G, END);

  it("uno stile seguito non si toglie, né con la sua defs, né togliendogli l'id", () => {
    rejects(FOLLOWED, { op: "remove", target: S }, "in-use");
    rejects(FOLLOWED, { op: "remove", target: "fub-defs" }, "in-use");
    rejects(FOLLOWED, { op: "ident", path: [1, 0], tag: "polyline", id: null }, "in-use");
  });

  it("uno stile che nessuno segue non si raccoglie, e si toglie", () => {
    const engine = SceneEngine.open(ALONE);
    expect(apply(engine, { op: "remove", target: "o2b3c4d5e" }).text).toBe(lf(ROOT, TITLE, DEFS, STYLE, END_DEFS, PAPER, L1, END_G, END));
    const out = apply(SceneEngine.open(ALONE), { op: "remove", target: S });
    expect(out.text).toBe(lf(ROOT, TITLE, PAPER, L1, R2, END_G, END));
    expect(applied(SceneEngine.open(out.text).apply(out.inverse)).text).toBe(ALONE);
  });

  it("chi comincia a seguire uno stile lo trattiene, chi smette lo lascia", () => {
    const engine = SceneEngine.open(ALONE);
    apply(engine, { op: "set", id: "o2b3c4d5e", attrs: { "fub:style": S } });
    expect(engine.apply({ op: "remove", target: S })).toMatchObject({ outcome: "rejected", reason: "in-use" });
    apply(engine, { op: "set", id: "o2b3c4d5e", attrs: { "fub:style": null } });
    expect(engine.apply({ op: "remove", target: S }).outcome).toBe("applied");
  });

  it("uno stile nuovo ha l'id di una risorsa, con elem e con raw", () => {
    const text: Elem = { tag: "text", attrs: { id: "r6f7a8b9c", "fub:role": "style", "fub:name": "Nota", "fub:leading": "1.4", "font-size": "14", fill: "#1a1a1a" } };
    const engine = SceneEngine.open(FOLLOWED);
    const out = apply(engine, { op: "add", parent: "fub-defs", pos: { last: true }, elem: text });
    expect(out.text).toBe(
      lf(ROOT, TITLE, DEFS, STYLE, '    <text id="r6f7a8b9c" fub:role="style" fub:name="Nota" fub:leading="1.4" fill="#1a1a1a" font-size="14"/>', END_DEFS, PAPER, L1, follower("o2b3c4d5e"), END_G, END),
    );
    expect(engine.scene().find((item) => item.kind === "element" && item.id === "r6f7a8b9c")).toMatchObject({ lifecycle: "style", style: { name: "Nota", kind: "text" } });
    const raw = '<polyline id="r7a8b9c0d" fub:role="style" fub:name="Avviso" points="0,0 100,0 100,100" stroke="#d55e00"><title>Per gli avvisi</title></polyline>';
    expect(apply(engine, { op: "add", parent: "fub-defs", pos: { last: true }, raw }).text).toContain(raw);
    rejects(FOLLOWED, { op: "add", parent: "fub-defs", pos: { last: true }, elem: { ...text, attrs: { ...text.attrs, id: "o6f7a8b9c" } } }, "invalid-elem");
    rejects(FOLLOWED, { op: "add", parent: "fub-defs", pos: { last: true }, raw: raw.replace("r7a8b9c0d", "o7a8b9c0d") }, "invalid-elem");
  });

  it("uno stile non entra con l'id che un oggetto segue già", () => {
    const dangling = lf(ROOT, TITLE, DEFS, '    <linearGradient id="r1a2b3c4d"/>', END_DEFS, PAPER, L1, follower("o2b3c4d5e"), END_G, END);
    const elem: Elem = { tag: "polyline", attrs: { id: S, "fub:role": "style", "fub:name": "Riquadro", points: "0,0 100,0 100,100" } };
    rejects(dangling, { op: "add", parent: "fub-defs", pos: { last: true }, elem }, "duplicate-id");
  });

  it("fub:style verso una risorsa che non è uno stile non la trattiene", () => {
    const swatch = '    <linearGradient id="r5e6f7a8b" fub:role="swatch" fub:name="Blu" gradientUnits="userSpaceOnUse"><stop stop-color="#0072b2"/></linearGradient>';
    const wrong = lf(ROOT, TITLE, DEFS, swatch, END_DEFS, PAPER, L1, follower("o2b3c4d5e"), END_G, END);
    expect(apply(SceneEngine.open(wrong), { op: "remove", target: S }).text).toBe(lf(ROOT, TITLE, PAPER, L1, follower("o2b3c4d5e"), END_G, END));
    expect(apply(SceneEngine.open(wrong), { op: "ident", path: [1, 0], tag: "linearGradient", id: null }).text).toBe(wrong.replace(` id="${S}"`, ""));
    // Una sfumatura entra anche con l'id che un oggetto segue: chi segue
    // resta com'era, con S018.
    const dangling = lf(ROOT, TITLE, PAPER, L1, follower("o2b3c4d5e"), END_G, END);
    const gradient: Elem = { tag: "linearGradient", attrs: { id: S }, children: [{ tag: "stop", attrs: { offset: "0", "stop-color": "#000000" } }] };
    const out = apply(SceneEngine.open(dangling), {
      op: "batch",
      ops: [
        { op: "add", parent: "#root", pos: { first: true }, elem: { tag: "defs", attrs: { id: "fub-defs" } } },
        { op: "add", parent: "fub-defs", pos: { last: true }, elem: gradient },
      ],
    });
    expect(readScene(out.text).diagnostics.map((d) => d.code)).toContain("S018");
  });
});

describe("i simboli", () => {
  const DEFS = '  <defs id="fub-defs">';
  const END_DEFS = "  </defs>";
  const Y = "r5e6f7a8b";
  const Z = "r6f7a8b9c";
  /// Un simbolo nella `defs` con `body` dentro.
  const symbol = (id: string, ...body: string[]): string[] => [`    <symbol id="${id}" overflow="visible">`, ...body, "    </symbol>"];
  const BULB = '      <circle id="o9a8b7c6d" cx="0" cy="0" r="20" fill="#f0e442"/>';
  /// Un'istanza di `of` nel livello.
  const instance = (id: string, of = Y): string => `    <use id="${id}" transform="translate(200 150)" href="#${of}"/>`;
  const USED = lf(ROOT, TITLE, DEFS, ...symbol(Y, "      <title>Lampadina</title>", BULB), END_DEFS, PAPER, L1, instance("o2b3c4d5e"), END_G, END);
  const ALONE = lf(ROOT, TITLE, DEFS, ...symbol(Y, "      <title>Lampadina</title>", BULB), END_DEFS, PAPER, L1, R2, END_G, END);
  const roleOf = (engine: SceneEngine, id: string): string | undefined => {
    const item = engine.scene().find((each) => each.kind === "element" && each.id === id);
    return item?.kind === "element" ? item.role : undefined;
  };

  it("un simbolo usato non si toglie, né con la sua defs, né togliendogli l'id", () => {
    rejects(USED, { op: "remove", target: Y }, "in-use");
    rejects(USED, { op: "remove", target: "fub-defs" }, "in-use");
    rejects(USED, { op: "ident", path: [1, 0], tag: "symbol", id: null }, "in-use");
  });

  it("un simbolo che nessuno usa non si raccoglie, e si toglie; l'undo lo rimette", () => {
    const engine = SceneEngine.open(USED);
    expect(apply(engine, { op: "remove", target: "o2b3c4d5e" }).text).toBe(
      lf(ROOT, TITLE, DEFS, ...symbol(Y, "      <title>Lampadina</title>", BULB), END_DEFS, PAPER, L1, END_G, END),
    );
    const out = apply(SceneEngine.open(ALONE), { op: "remove", target: Y });
    expect(out.text).toBe(lf(ROOT, TITLE, PAPER, L1, R2, END_G, END));
    const back = SceneEngine.open(out.text);
    expect(applied(back.apply(out.inverse)).text).toBe(ALONE);
    expect(roleOf(back, Y)).toBe("symbol");
    expect(roleOf(back, "o9a8b7c6d")).toBe("circle");
  });

  it("chi usa e il simbolo si tolgono insieme, in un batch, e tornano insieme", () => {
    const engine = SceneEngine.open(USED);
    const out = apply(engine, { op: "batch", ops: [{ op: "remove", target: "o2b3c4d5e" }, { op: "remove", target: Y }] });
    expect(out.text).toBe(lf(ROOT, TITLE, PAPER, L1, END_G, END));
    const back = SceneEngine.open(out.text);
    expect(applied(back.apply(out.inverse)).text).toBe(USED);
    expect(roleOf(back, "o2b3c4d5e")).toBe("instance");
  });

  it("un simbolo nuovo ha l'id di una risorsa e il suo contenuto quelli degli oggetti, con elem e con raw", () => {
    const rect: Elem = { tag: "rect", attrs: { id: "o7a8b9c0d", width: "10", height: "10", fill: "#0072b2" } };
    const elem: Elem = { tag: "symbol", attrs: { id: Z, overflow: "visible" }, children: [{ tag: "title", attrs: {}, text: "Quadro" }, rect] };
    const engine = SceneEngine.open(USED);
    const out = apply(engine, { op: "add", parent: "fub-defs", pos: { last: true }, elem });
    expect(out.text).toBe(
      lf(
        ROOT,
        TITLE,
        DEFS,
        ...symbol(Y, "      <title>Lampadina</title>", BULB),
        ...symbol(Z, "      <title>Quadro</title>", '      <rect id="o7a8b9c0d" width="10" height="10" fill="#0072b2"/>'),
        END_DEFS,
        PAPER,
        L1,
        instance("o2b3c4d5e"),
        END_G,
        END,
      ),
    );
    expect(roleOf(engine, Z)).toBe("symbol");
    expect(roleOf(engine, "o7a8b9c0d")).toBe("rect");
    const raw = `<symbol id="r7a8b9c0d" overflow="visible"><use id="o8b9c0d1e" href="#${Y}"/></symbol>`;
    apply(engine, { op: "add", parent: "fub-defs", pos: { last: true }, raw });
    expect(roleOf(engine, "r7a8b9c0d")).toBe("symbol");
    expect(roleOf(engine, "o8b9c0d1e")).toBe("instance");
    rejects(USED, { op: "add", parent: "fub-defs", pos: { last: true }, elem: { ...elem, attrs: { ...elem.attrs, id: "o6f7a8b9c" } } }, "invalid-elem");
    rejects(USED, { op: "add", parent: "fub-defs", pos: { last: true }, elem: { ...elem, children: [{ ...rect, attrs: { ...rect.attrs, id: "r7a8b9c0d" } }] } }, "invalid-elem");
    rejects(USED, { op: "add", parent: "fub-defs", pos: { last: true }, elem: { ...elem, children: [{ ...rect, attrs: { width: "10", height: "10" } }] } }, "invalid-elem");
    // Fuori da una defs un simbolo è estraneo.
    rejects(USED, { op: "add", parent: "l3f8a0c2d", pos: { last: true }, elem }, "invalid-elem");
  });

  it("un simbolo scrive l'origine dalla libreria subito dopo l'id, e overflow dopo la presentazione", () => {
    const source = "Simboli/Impianti.svg#r00000004 0123456789abcdef";
    const rect: Elem = { tag: "rect", attrs: { id: "o7a8b9c0d", width: "10", height: "10" } };
    const elem: Elem = { tag: "symbol", attrs: { overflow: "visible", "fub:source": source, id: Z }, children: [rect] };
    const out = apply(SceneEngine.open(ALONE), { op: "add", parent: "fub-defs", pos: { last: true }, elem });
    expect(out.text).toContain(`    <symbol id="${Z}" fub:source="${source}" overflow="visible">\n      <rect id="o7a8b9c0d" width="10" height="10"/>\n    </symbol>\n`);
  });

  it("in un batch il simbolo viene prima delle sue istanze", () => {
    const PLAIN = lf(ROOT, TITLE, PAPER, L1, R2, END_G, END);
    const elem: Elem = { tag: "symbol", attrs: { id: Y, overflow: "visible" }, children: [{ tag: "circle", attrs: { id: "o9a8b7c6d", cx: "0", cy: "0", r: "20", fill: "#f0e442" } }] };
    const add: Op = { op: "add", parent: "#root", pos: { first: true }, elem: { tag: "defs", attrs: { id: "fub-defs" }, children: [elem] } };
    const use: Op = { op: "add", parent: "l3f8a0c2d", pos: { last: true }, elem: { tag: "use", attrs: { id: "o1b2c3d4e", href: `#${Y}`, transform: "translate(200 150)" } } };
    expect(SceneEngine.open(PLAIN).apply({ op: "batch", ops: [use, add] })).toMatchObject({ outcome: "rejected", index: 0, reason: "invalid-elem" });
    const engine = SceneEngine.open(PLAIN);
    expect(apply(engine, { op: "batch", ops: [add, use] }).text).toBe(lf(ROOT, TITLE, DEFS, ...symbol(Y, BULB), END_DEFS, PAPER, L1, R2, instance("o1b2c3d4e"), END_G, END));
    expect(roleOf(engine, "o1b2c3d4e")).toBe("instance");
  });

  it("un simbolo non contiene mai sé stesso, nemmeno attraverso un altro", () => {
    const self: Op = { op: "add", parent: Y, pos: { last: true }, elem: { tag: "use", attrs: { id: "o1b2c3d4e", href: `#${Y}` } } };
    rejects(USED, self, "cycle");
    rejects(USED, { op: "move", target: "o2b3c4d5e", parent: Y, pos: { last: true } }, "cycle");
    // A usa B, e B non può usare A: né con una nuova istanza, né cambiando
    // quella che ha, né spostandoci dentro un'istanza di A.
    const TWO = lf(
      ROOT,
      TITLE,
      DEFS,
      ...symbol(Y, BULB),
      ...symbol(Z, '      <use id="o3c4d5e6f" href="#r5e6f7a8b"/>', '      <use id="o4d5e6f7a" href="#r5e6f7a8b"/>'),
      END_DEFS,
      PAPER,
      L1,
      instance("o2b3c4d5e", Z),
      END_G,
      END,
    );
    rejects(TWO, { op: "add", parent: Y, pos: { last: true }, elem: { tag: "use", attrs: { id: "o1b2c3d4e", href: `#${Z}` } } }, "cycle");
    rejects(TWO, { op: "set", id: "o3c4d5e6f", attrs: { href: `#${Z}` } }, "cycle");
    rejects(TWO, { op: "move", target: "o2b3c4d5e", parent: Y, pos: { last: true } }, "cycle");
    // Un'istanza di B dentro A, se B non usa più A, va bene.
    const engine = SceneEngine.open(TWO);
    apply(engine, {
      op: "batch",
      ops: [
        { op: "remove", target: "o3c4d5e6f" },
        { op: "remove", target: "o4d5e6f7a" },
        { op: "move", target: "o2b3c4d5e", parent: Y, pos: { last: true } },
      ],
    });
    expect(roleOf(engine, "o2b3c4d5e")).toBe("instance");
  });

  it("il contenuto di un simbolo si modifica come quello di un gruppo, e le istanze restano", () => {
    const engine = SceneEngine.open(USED);
    expect(apply(engine, { op: "set", id: "o9a8b7c6d", attrs: { fill: "#e69f00" } }).text).toBe(USED.replace('fill="#f0e442"', 'fill="#e69f00"'));
    const out = apply(engine, { op: "add", parent: Y, pos: { last: true }, elem: R4_ELEM });
    expect(out.text).toContain(`${BULB.replace("#f0e442", "#e69f00")}\n      <rect id="o4d5e6f7g" x="10" y="20" width="30" height="40"/>\n    </symbol>`);
    expect(roleOf(engine, "o2b3c4d5e")).toBe("instance");
    // Un'istanza si sposta e si trasforma come un oggetto.
    expect(apply(engine, { op: "set", id: "o2b3c4d5e", attrs: { transform: "translate(10 20) rotate(45)" } }).text).toContain('transform="translate(10 20) rotate(45)"');
    rejects(USED, { op: "set", id: "o2b3c4d5e", attrs: { x: "10" } }, "invalid-elem");
    rejects(USED, { op: "set", id: "o2b3c4d5e", attrs: { fill: "#000000" } }, "invalid-elem");
  });

  it("un simbolo si sposta soltanto fra le defs della radice, e chi lo usa resta un'istanza", () => {
    const other = ['  <defs id="defs2">', "  </defs>"];
    const source = lf(ROOT, TITLE, DEFS, ...symbol(Y, BULB), END_DEFS, ...other, PAPER, L1, instance("o2b3c4d5e"), END_G, END);
    rejects(source, { op: "move", target: Y, parent: "l3f8a0c2d", pos: { last: true } }, "invalid-elem");
    const engine = SceneEngine.open(source);
    const moved = apply(engine, { op: "move", target: Y, parent: "defs2", pos: { last: true } });
    expect(moved.text).toBe(lf(ROOT, TITLE, '  <defs id="defs2">', ...symbol(Y, BULB), "  </defs>", PAPER, L1, instance("o2b3c4d5e"), END_G, END));
    expect(roleOf(engine, Y)).toBe("symbol");
    expect(roleOf(engine, "o2b3c4d5e")).toBe("instance");
    const back = SceneEngine.open(moved.text);
    expect(applied(back.apply(moved.inverse)).text).toBe(source);
    expect(roleOf(back, Y)).toBe("symbol");
  });

  it("i simboli contano fra le risorse", () => {
    const many = lf(ROOT, TITLE, DEFS, ...Array.from({ length: MAX_RESOURCES }, (_, k) => `    <symbol id="r${k.toString(16).padStart(8, "0")}" overflow="visible"/>`), END_DEFS, PAPER, L1, R2, END_G, END);
    rejects(many, { op: "add", parent: "fub-defs", pos: { last: true }, elem: { tag: "symbol", attrs: { id: Y, overflow: "visible" } } }, "limit");
  });
});

describe("le ripetizioni", () => {
  const GROUP = "o5e6f7a8b";
  const ORIGINAL = "o6f7a8b9c";
  const C1 = "o7a8b9c0d";
  const C2 = "o8b9c0d1e";
  const group = (repeat: string | null, ...body: string[]): string[] => [`    <g id="${GROUP}"${repeat === null ? "" : ` fub:repeat="${repeat}"`}>`, ...body, "    </g>"];
  const ORIG = `      <rect id="${ORIGINAL}" x="100" y="100" width="200" height="120" fill="#0072b2"/>`;
  /// Una copia `id` dell'originale, spostata di `dx`.
  const copy = (id: string, dx: number, of = ORIGINAL): string => `      <use id="${id}" transform="translate(${dx} 0)" href="#${of}"/>`;
  const ROW = lf(ROOT, TITLE, PAPER, L1, ...group("grid 3 1 300 0", ORIG, copy(C1, 300), copy(C2, 600)), END_G, END);
  const item = (engine: SceneEngine, id: string) => engine.scene().find((each) => each.kind === "element" && each.id === id);
  const roleOf = (engine: SceneEngine, id: string): string | undefined => {
    const found = item(engine, id);
    return found?.kind === "element" ? found.role : undefined;
  };

  it("un originale con copie non si toglie, non esce dal gruppo e non perde l'id", () => {
    rejects(ROW, { op: "remove", target: ORIGINAL }, "in-use");
    rejects(ROW, { op: "move", target: ORIGINAL, parent: "l3f8a0c2d", pos: { last: true } }, "in-use");
    rejects(ROW, { op: "ident", path: [2, 0, 0], tag: "rect", id: null }, "in-use");
    const path = [2, 0, 0];
    rejects(ROW, { op: "batch", ops: [{ op: "ident", path, tag: "rect", id: null }, { op: "ident", path, tag: "rect", id: "o9c0d1e2f" }] }, "in-use");
  });

  it("un gruppo con copie resta una ripetizione", () => {
    rejects(ROW, { op: "set", id: GROUP, attrs: { "fub:repeat": null } }, "in-use");
    rejects(ROW, { op: "set", id: GROUP, attrs: { "fub:repeat": "radial 1 0 0" } }, "in-use");
    rejects(ROW, { op: "set", id: GROUP, attrs: { "fub:repeat": "spiral 3 0 0" } }, "in-use");
    // Cambia tipo, e le copie restano copie.
    const engine = SceneEngine.open(ROW);
    const out = apply(engine, { op: "set", id: GROUP, attrs: { "fub:repeat": "radial 3 400 160" } });
    expect(out.text).toBe(ROW.replace('fub:repeat="grid 3 1 300 0"', 'fub:repeat="radial 3 400 160"'));
    expect(item(engine, GROUP)).toMatchObject({ repeat: { kind: "radial", count: 3, center: [400, 160] } });
    expect([roleOf(engine, C1), roleOf(engine, C2)]).toEqual(["copy", "copy"]);
    // Senza copie il gruppo smette di essere una ripetizione quando vuole.
    const alone = SceneEngine.open(lf(ROOT, TITLE, PAPER, L1, ...group("grid 3 1 300 0", ORIG), END_G, END));
    expect(apply(alone, { op: "set", id: GROUP, attrs: { "fub:repeat": null } }).text).toBe(lf(ROOT, TITLE, PAPER, L1, ...group(null, ORIG), END_G, END));
  });

  it("la ripetizione si toglie intera, o le copie prima dell'originale, e l'undo la rimette", () => {
    const whole = apply(SceneEngine.open(ROW), { op: "remove", target: GROUP });
    expect(whole.text).toBe(lf(ROOT, TITLE, PAPER, L1, END_G, END));
    const back = SceneEngine.open(whole.text);
    expect(applied(back.apply(whole.inverse)).text).toBe(ROW);
    expect([roleOf(back, ORIGINAL), roleOf(back, C1), roleOf(back, C2)]).toEqual(["rect", "copy", "copy"]);
    const engine = SceneEngine.open(ROW);
    const out = apply(engine, {
      op: "batch",
      ops: [
        { op: "remove", target: C1 },
        { op: "remove", target: C2 },
        { op: "remove", target: ORIGINAL },
        { op: "set", id: GROUP, attrs: { "fub:repeat": null } },
      ],
    });
    expect(out.text).toBe(lf(ROOT, TITLE, PAPER, L1, ...group(null), END_G, END));
    const again = SceneEngine.open(out.text);
    expect(applied(again.apply(out.inverse)).text).toBe(ROW);
    expect(roleOf(again, C2)).toBe("copy");
  });

  it("una copia nuova si aggiunge in una ripetizione che ha il suo originale, con elem e con raw", () => {
    const engine = SceneEngine.open(lf(ROOT, TITLE, PAPER, L1, ...group("grid 3 1 300 0", ORIG), END_G, END));
    const use = (id: string, dx: number, more: Record<string, string> = {}): Elem => ({ tag: "use", attrs: { id, transform: `translate(${dx} 0)`, href: `#${ORIGINAL}`, ...more } });
    apply(engine, { op: "add", parent: GROUP, pos: { last: true }, elem: use(C1, 300) });
    const out = apply(engine, { op: "add", parent: GROUP, pos: { last: true }, raw: `<use id="${C2}" transform="translate(600 0)" href="#${ORIGINAL}"/>` });
    expect(out.text).toBe(ROW);
    expect([roleOf(engine, C1), roleOf(engine, C2)]).toEqual(["copy", "copy"]);
    expect(item(engine, C1)).toMatchObject({ original: ORIGINAL });
    // Una copia non ha altri attributi, e fuori da una ripetizione non c'è.
    rejects(ROW, { op: "add", parent: GROUP, pos: { last: true }, elem: use("o9c0d1e2f", 900, { fill: "#000000" }) }, "invalid-elem");
    rejects(ROW, { op: "add", parent: GROUP, pos: { last: true }, elem: use("o9c0d1e2f", 900, { opacity: "0.5" }) }, "invalid-elem");
    rejects(ROW, { op: "add", parent: "l3f8a0c2d", pos: { last: true }, elem: use("o9c0d1e2f", 900) }, "invalid-elem");
    rejects(lf(ROOT, TITLE, PAPER, L1, ...group(null, ORIG), END_G, END), { op: "add", parent: GROUP, pos: { last: true }, elem: use(C1, 300) }, "invalid-elem");
  });

  it("in un batch la ripetizione e l'originale vengono prima delle copie", () => {
    const PLAIN = lf(ROOT, TITLE, PAPER, L1, ...group(null, ORIG), END_G, END);
    const repeat: Op = { op: "set", id: GROUP, attrs: { "fub:repeat": "grid 3 1 300 0" } };
    const add = (id: string, dx: number): Op => ({ op: "add", parent: GROUP, pos: { last: true }, elem: { tag: "use", attrs: { id, transform: `translate(${dx} 0)`, href: `#${ORIGINAL}` } } });
    expect(SceneEngine.open(PLAIN).apply({ op: "batch", ops: [add(C1, 300), repeat] })).toMatchObject({ outcome: "rejected", index: 0, reason: "invalid-elem" });
    const engine = SceneEngine.open(PLAIN);
    expect(apply(engine, { op: "batch", ops: [repeat, add(C1, 300), add(C2, 600)] }).text).toBe(ROW);
    expect(roleOf(engine, C2)).toBe("copy");
    // Un gruppo nuovo con l'originale e le copie, in un add solo: fub:repeat
    // dopo l'id.
    const elem: Elem = {
      tag: "g",
      attrs: { "fub:repeat": "grid 3 1 300 0", id: GROUP },
      children: [
        { tag: "rect", attrs: { id: ORIGINAL, x: "100", y: "100", width: "200", height: "120", fill: "#0072b2" } },
        { tag: "use", attrs: { href: `#${ORIGINAL}`, transform: "translate(300 0)", id: C1 } },
        { tag: "use", attrs: { href: `#${ORIGINAL}`, transform: "translate(600 0)", id: C2 } },
      ],
    };
    const fresh = SceneEngine.open(lf(ROOT, TITLE, PAPER, L1, END_G, END));
    expect(apply(fresh, { op: "add", parent: "l3f8a0c2d", pos: { last: true }, elem }).text).toBe(ROW);
    expect(roleOf(fresh, C1)).toBe("copy");
  });

  it("un use estraneo non diventa una copia perché un fratello diventa il suo originale", () => {
    const FOREIGN = '      <use transform="translate(300 0)" href="#o6f7a8b9c"/>';
    const loose = lf(ROOT, TITLE, PAPER, L1, ...group(null, ORIG, FOREIGN), END_G, END);
    expect(readScene(loose).items.some((each) => each.kind === "foreign")).toBe(true);
    rejects(loose, { op: "set", id: GROUP, attrs: { "fub:repeat": "grid 2 1 300 0" } }, "duplicate-id");
    const RECT = '      <rect x="100" y="100" width="200" height="120" fill="#0072b2"/>';
    const nameless = lf(ROOT, TITLE, PAPER, L1, ...group("grid 2 1 300 0", RECT, FOREIGN), END_G, END);
    rejects(nameless, { op: "ident", path: [2, 0, 0], tag: "rect", id: ORIGINAL }, "duplicate-id");
  });

  it("una copia si trasforma e si sposta fra i fratelli, ma non esce dalla ripetizione", () => {
    const engine = SceneEngine.open(ROW);
    expect(apply(engine, { op: "set", id: C1, attrs: { transform: "matrix(-1 0 0 1 800 0)" } }).text).toBe(ROW.replace("translate(300 0)", "matrix(-1 0 0 1 800 0)"));
    expect(roleOf(engine, C1)).toBe("copy");
    rejects(ROW, { op: "set", id: C1, attrs: { fill: "#000000" } }, "invalid-elem");
    rejects(ROW, { op: "set", id: C1, attrs: { href: "#o9c0d1e2f" } }, "invalid-elem");
    rejects(ROW, { op: "move", target: C1, parent: "l3f8a0c2d", pos: { last: true } }, "invalid-elem");
    const first = apply(SceneEngine.open(ROW), { op: "move", target: C2, parent: GROUP, pos: { first: true } });
    expect(first.text).toBe(lf(ROOT, TITLE, PAPER, L1, ...group("grid 3 1 300 0", copy(C2, 600), ORIG, copy(C1, 300)), END_G, END));
    const moved = SceneEngine.open(first.text);
    expect(roleOf(moved, C2)).toBe("copy");
  });

  it("la ripetizione si sposta intera, e nell'altro livello le copie restano copie", () => {
    const source = lf(ROOT, TITLE, PAPER, L1, ...group("grid 3 1 300 0", ORIG, copy(C1, 300), copy(C2, 600)), END_G, L2, R3, END_G, END);
    const engine = SceneEngine.open(source);
    const out = apply(engine, { op: "move", target: GROUP, parent: "l9k8j7h6g", pos: { last: true } });
    expect(out.text).toBe(lf(ROOT, TITLE, PAPER, L1, END_G, L2, R3, ...group("grid 3 1 300 0", ORIG, copy(C1, 300), copy(C2, 600)), END_G, END));
    expect([roleOf(engine, C1), roleOf(engine, C2)]).toEqual(["copy", "copy"]);
    // Dentro un altro gruppo cambia il rientro, anche dentro una copia.
    const named = (indent: string): string[] => [`${indent}<use id="${C1}" transform="translate(300 0)" href="#${ORIGINAL}">`, `${indent}  <title>Seconda</title>`, `${indent}</use>`];
    const deep = (lines: string[]): string[] => lines.map((line) => `  ${line}`);
    const titled = lf(ROOT, TITLE, PAPER, L1, ...group("grid 2 1 300 0", ORIG, ...named("      ")), END_G, L2, '    <g id="o4d5e6f7a">', "    </g>", END_G, END);
    const inside = apply(SceneEngine.open(titled), { op: "move", target: GROUP, parent: "o4d5e6f7a", pos: { last: true } });
    expect(inside.text).toBe(lf(ROOT, TITLE, PAPER, L1, END_G, L2, '    <g id="o4d5e6f7a">', ...deep(group("grid 2 1 300 0", ORIG, ...named("      "))), "    </g>", END_G, END));
    const back = SceneEngine.open(inside.text);
    expect(roleOf(back, C1)).toBe("copy");
    expect(applied(back.apply(inside.inverse)).text).toBe(titled);
  });
});
