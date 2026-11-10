// Il motore delle operazioni: ciò che segue un'operazione, il testo in area e
// su tracciato, le tavole con le loro carte.
import { describe, expect, it } from "vitest";
import { FOLLOW_ROUNDS, SceneEngine } from "./engine";
import type { Op, Reason } from "./ops";
import { MAX_BOARDS, readScene } from "./read";
import type { Elem } from "./serialize";
import {
  apply,
  applied,
  BASE,
  E1,
  END,
  END_G,
  L1,
  lf,
  PAPER,
  R2,
  R3,
  rejects,
  ROOT,
  TITLE,
} from "./engine/test-support";

describe("ciò che segue", () => {
  const DEFS = '  <defs id="fub-defs">';
  const END_DEFS = "  </defs>";
  const G = "r1a2b3c4d";
  const GRADIENT = [
    `    <linearGradient id="${G}" fub:role="shared" x1="0" y1="0" x2="1" y2="0">`,
    '      <stop offset="0" stop-color="#0072b2"/>',
    '      <stop offset="1" stop-color="#56b4e9"/>',
    "    </linearGradient>",
  ];
  const E1_BLACK = E1.replace('stroke="#0072b2"', 'stroke="#000000"');
  const R2_BLACK = R2.replace('fill="#e69f00"', 'fill="#000000"');
  const R3_USER = `    <rect id="o3c4d5e6f" x="800" y="100" width="200" height="120" fill="url(#${G}) #0072b2"/>`;
  const stroke: Op = { op: "set", id: "o1a2b3c4d", attrs: { stroke: "#000000" } };
  const fill = (id: string, value: string): Op => ({ op: "set", id, attrs: { fill: value } });
  const MISSING = fill("o9z9z9z9z", "#000000");

  /// Un motore su `source` che, a ogni operazione che tocca l'ellisse,
  /// aggiunge `extra`, e conta le volte in cui lo chiede.
  const following = (source: string, extra: () => Op | null): { engine: SceneEngine; calls: ReadonlySet<string>[] } => {
    const engine = SceneEngine.open(source);
    const calls: ReadonlySet<string>[] = [];
    engine.follow = (_model, touched) => {
      calls.push(new Set(touched));
      return touched.has("o1a2b3c4d") ? extra() : null;
    };
    return { engine, calls };
  };

  it("va nello stesso passo, e un undo solo lo toglie, byte per byte", () => {
    const { engine, calls } = following(BASE, () => fill("o2b3c4d5e", "#000000"));
    const out = apply(engine, stroke);
    expect(out.text).toBe(lf(ROOT, TITLE, PAPER, L1, E1_BLACK, R2_BLACK, R3, END_G, END));
    expect(out.forward).toEqual({ op: "batch", ops: [stroke, fill("o2b3c4d5e", "#000000")] });
    expect([...out.touched].sort()).toEqual(["o1a2b3c4d", "o2b3c4d5e"]);
    // Il secondo giro vede ciò che ha toccato il primo, e non dice niente.
    expect(calls).toEqual([new Set(["o1a2b3c4d"]), new Set(["o2b3c4d5e"])]);
    expect(applied(engine.undo(out.undo)).text).toBe(BASE);
    expect(calls).toHaveLength(2);
  });

  it("annullato dall'inversa, non si chiede di nuovo: l'inversa porta già la sua", () => {
    const { engine, calls } = following(BASE, () => fill("o2b3c4d5e", "#000000"));
    const out = apply(engine, stroke);
    expect(calls).toHaveLength(2);
    apply(engine, fill("o3c4d5e6f", "#111111"));
    expect(calls).toHaveLength(3);
    const undone = applied(engine.undo(out.undo));
    expect(undone.text).toBe(lf(ROOT, TITLE, PAPER, L1, E1, R2, R3.replace("#009e73", "#111111"), END_G, END));
    expect(calls).toHaveLength(3);
  });

  it("null lascia l'operazione com'è", () => {
    const { engine, calls } = following(BASE, () => null);
    const out = apply(engine, stroke);
    expect(out.forward).toEqual(stroke);
    expect(out.text).toBe(lf(ROOT, TITLE, PAPER, L1, E1_BLACK, R2, R3, END_G, END));
    expect(calls).toEqual([new Set(["o1a2b3c4d"])]);
  });

  it("il passo resta col nome dell'operazione chiesta", () => {
    const { engine } = following(BASE, () => ({ op: "batch", label: "Seguito", ops: [fill("o2b3c4d5e", "#000000")] }));
    expect(apply(engine, stroke).forward).toEqual({ op: "batch", ops: [stroke, fill("o2b3c4d5e", "#000000")] });
    const named: Op = { op: "batch", label: "Colore", ops: [fill("o1a2b3c4d", "#000000")] };
    const out = apply(engine, named);
    expect(out.forward).toEqual({ op: "batch", label: "Colore", ops: [fill("o1a2b3c4d", "#000000"), fill("o2b3c4d5e", "#000000")] });
    expect(out.inverse).toMatchObject({ op: "batch", label: "Colore" });
  });

  it("un seguito rifiutato non c'è, nemmeno a metà, e l'operazione resta con ciò che ha toccato", () => {
    for (const extra of [MISSING, { op: "batch", ops: [fill("o2b3c4d5e", "#000000"), MISSING] } as Op]) {
      const { engine } = following(BASE, () => extra);
      const out = apply(engine, stroke);
      expect(out.forward).toEqual(stroke);
      expect(out.text).toBe(lf(ROOT, TITLE, PAPER, L1, E1_BLACK, R2, R3, END_G, END));
      expect(out.touched).toEqual(["o1a2b3c4d"]);
      expect(applied(engine.undo(out.undo)).text).toBe(BASE);
    }
  });

  it("un seguito che non si sa calcolare non c'è", () => {
    const { engine } = following(BASE, () => {
      throw new Error("guasto");
    });
    const out = apply(engine, stroke);
    expect(out.forward).toEqual(stroke);
    expect(out.text).toBe(lf(ROOT, TITLE, PAPER, L1, E1_BLACK, R2, R3, END_G, END));
  });

  it("un'operazione rifiutata non lo chiede", () => {
    const { engine, calls } = following(BASE, () => fill("o2b3c4d5e", "#000000"));
    expect(engine.apply({ op: "batch", ops: [stroke, MISSING] })).toMatchObject({ outcome: "rejected", reason: "missing-target" });
    expect(engine.text).toBe(BASE);
    expect(calls).toEqual([]);
  });

  it("la raccolta prende, nello stesso passo, ciò che il seguito lascia solo", () => {
    const source = lf(ROOT, TITLE, DEFS, ...GRADIENT, END_DEFS, PAPER, L1, E1, R2, R3_USER, END_G, END);
    const { engine } = following(source, () => fill("o3c4d5e6f", "#000000"));
    const out = apply(engine, stroke);
    expect(out.text).toBe(lf(ROOT, TITLE, PAPER, L1, E1_BLACK, R2, R3.replace("#009e73", "#000000"), END_G, END));
    expect(out.forward).toEqual({
      op: "batch",
      ops: [stroke, fill("o3c4d5e6f", "#000000"), { op: "remove", target: G }, { op: "remove", target: "fub-defs" }],
    });
    expect(applied(engine.undo(out.undo)).text).toBe(source);
  });

  it("un seguito rifiutato non fa raccogliere la risorsa che aveva ripreso", () => {
    // La sfumatura non la usa nessuno già prima: la raccolta guarda solo ciò
    // che le operazioni applicate lasciano solo.
    const source = lf(ROOT, TITLE, DEFS, ...GRADIENT, END_DEFS, PAPER, L1, E1, R2, R3, END_G, END);
    const { engine } = following(source, () => ({ op: "batch", ops: [fill("o2b3c4d5e", `url(#${G}) #0072b2`), MISSING] }));
    const out = apply(engine, stroke);
    expect(out.forward).toEqual(stroke);
    expect(out.text).toBe(lf(ROOT, TITLE, DEFS, ...GRADIENT, END_DEFS, PAPER, L1, E1_BLACK, R2, R3, END_G, END));
  });

  describe("a giri", () => {
    const R3_BLACK = R3.replace("#009e73", "#000000");

    /// Un motore su `BASE` che, a ogni giro, dà `rounds[giro]` finché ce ne
    /// sono, e registra ciò che gli si chiede.
    const rounding = (
      rounds: readonly (Op | null)[],
    ): { engine: SceneEngine; calls: { touched: ReadonlySet<string>; op: Op }[] } => {
      const engine = SceneEngine.open(BASE);
      const calls: { touched: ReadonlySet<string>; op: Op }[] = [];
      engine.follow = (_model, touched, op) => {
        calls.push({ touched: new Set(touched), op });
        return rounds[calls.length - 1] ?? null;
      };
      return { engine, calls };
    };

    it("un secondo giro vede soltanto ciò che ha toccato il primo, e la stessa operazione chiesta", () => {
      const { engine, calls } = rounding([fill("o2b3c4d5e", "#000000"), fill("o3c4d5e6f", "#000000"), null]);
      const out = apply(engine, stroke);
      expect(calls.map((call) => call.touched)).toEqual([new Set(["o1a2b3c4d"]), new Set(["o2b3c4d5e"]), new Set(["o3c4d5e6f"])]);
      // Ogni giro riceve l'operazione chiesta, la stessa oggetto per oggetto.
      for (const call of calls) expect(call.op).toBe(stroke);
      expect(out.text).toBe(lf(ROOT, TITLE, PAPER, L1, E1_BLACK, R2_BLACK, R3_BLACK, END_G, END));
      // Le operazioni dei giri vanno in ordine, in un `batch` solo.
      expect(out.forward).toEqual({ op: "batch", ops: [stroke, fill("o2b3c4d5e", "#000000"), fill("o3c4d5e6f", "#000000")] });
      expect(out.inverse).toEqual({
        op: "batch",
        ops: [fill("o3c4d5e6f", "#009e73"), fill("o2b3c4d5e", "#e69f00"), { op: "set", id: "o1a2b3c4d", attrs: { stroke: "#0072b2" } }],
      });
      expect([...out.touched]).toEqual(["o1a2b3c4d", "o2b3c4d5e", "o3c4d5e6f"]);
      expect(applied(engine.undo(out.undo)).text).toBe(BASE);
    });

    it("un giro che non tocca niente di nuovo ferma il seguito", () => {
      // Il secondo giro rifà il colore del primo: niente id nuovi, e il terzo non si chiede.
      const { engine, calls } = rounding([fill("o2b3c4d5e", "#000000"), fill("o2b3c4d5e", "#111111"), fill("o3c4d5e6f", "#000000")]);
      const out = apply(engine, stroke);
      expect(calls.map((call) => call.touched)).toEqual([new Set(["o1a2b3c4d"]), new Set(["o2b3c4d5e"])]);
      expect(out.text).toBe(lf(ROOT, TITLE, PAPER, L1, E1_BLACK, R2.replace("#e69f00", "#111111"), R3, END_G, END));
      expect(out.forward).toEqual({ op: "batch", ops: [stroke, fill("o2b3c4d5e", "#000000"), fill("o2b3c4d5e", "#111111")] });
      expect(applied(engine.undo(out.undo)).text).toBe(BASE);
    });

    it("dopo tre giri ci si ferma, anche se il seguito ha ancora altro", () => {
      let next = 0;
      const engine = SceneEngine.open(BASE);
      let calls = 0;
      engine.follow = () => {
        calls++;
        // Ogni giro aggiunge un rettangolo nuovo, e quindi ha sempre qualcosa di nuovo da seguire.
        const id = `o000000${++next}a`;
        return { op: "add", parent: "l3f8a0c2d", pos: { last: true }, elem: { tag: "rect", attrs: { id, x: "0", y: "0", width: "10", height: "10" } } };
      };
      const out = apply(engine, stroke);
      expect(FOLLOW_ROUNDS).toBe(3);
      expect(calls).toBe(FOLLOW_ROUNDS);
      expect(out.forward).toMatchObject({ op: "batch" });
      expect((out.forward as { ops: readonly Op[] }).ops).toHaveLength(1 + FOLLOW_ROUNDS);
      expect([...out.touched]).toEqual(["o1a2b3c4d", "o0000001a", "o0000002a", "o0000003a"]);
      expect(applied(engine.undo(out.undo)).text).toBe(BASE);
    });

    it("un giro rifiutato non c'è: i giri prima restano, in un passo solo, e l'undo li toglie tutti", () => {
      for (const bad of [MISSING, { op: "batch", ops: [fill("o3c4d5e6f", "#000000"), MISSING] } as Op]) {
        const { engine, calls } = rounding([fill("o2b3c4d5e", "#000000"), bad, fill("o3c4d5e6f", "#222222")]);
        const out = apply(engine, stroke);
        // Il giro dopo il rifiuto non si chiede: ci si ferma.
        expect(calls).toHaveLength(2);
        expect(out.text).toBe(lf(ROOT, TITLE, PAPER, L1, E1_BLACK, R2_BLACK, R3, END_G, END));
        expect(out.forward).toEqual({ op: "batch", ops: [stroke, fill("o2b3c4d5e", "#000000")] });
        expect([...out.touched]).toEqual(["o1a2b3c4d", "o2b3c4d5e"]);
        expect(applied(engine.undo(out.undo)).text).toBe(BASE);
      }
    });

    it("un giro che non si sa calcolare ferma il seguito e lascia i giri prima", () => {
      const engine = SceneEngine.open(BASE);
      let calls = 0;
      engine.follow = () => {
        if (++calls === 2) throw new Error("guasto");
        return fill("o2b3c4d5e", "#000000");
      };
      const out = apply(engine, stroke);
      expect(calls).toBe(2);
      expect(out.forward).toEqual({ op: "batch", ops: [stroke, fill("o2b3c4d5e", "#000000")] });
      expect(out.text).toBe(lf(ROOT, TITLE, PAPER, L1, E1_BLACK, R2_BLACK, R3, END_G, END));
      expect(applied(engine.undo(out.undo)).text).toBe(BASE);
    });

    it("l'inversa non ha seguito: nemmeno a giri", () => {
      const { engine, calls } = rounding([fill("o2b3c4d5e", "#000000"), fill("o3c4d5e6f", "#000000"), null]);
      const out = apply(engine, stroke);
      expect(calls).toHaveLength(3);
      // Un'altra modifica sposta la scena: l'undo non è più esatto e passa dall'inversa.
      engine.follow = null;
      apply(engine, { op: "set", id: "o1a2b3c4d", attrs: { "stroke-width": "6" } });
      let asked = 0;
      engine.follow = () => {
        asked++;
        return fill("o2b3c4d5e", "#333333");
      };
      const undone = applied(engine.undo(out.undo));
      expect(asked).toBe(0);
      expect(undone.text).toBe(lf(ROOT, TITLE, PAPER, L1, E1.replace('stroke-width="4"', 'stroke-width="6"'), R2, R3, END_G, END));
    });
  });
});

describe("il testo in area e su tracciato", () => {
  const DEFS = '  <defs id="fub-defs">';
  const END_DEFS = "  </defs>";
  const P = "r1a2b3c4d";
  const CURVE = `    <path id="${P}" fub:role="private" d="M100 400 C250 250 450 250 600 400"/>`;
  const along = (content: string): string[] => [
    '    <text id="o5e6f7g8h" fill="#000000" font-size="32" text-anchor="middle">',
    `      <textPath startOffset="50%" href="#${P}">${content}</textPath>`,
    "    </text>",
  ];
  const ALONG = lf(ROOT, TITLE, DEFS, CURVE, END_DEFS, PAPER, L1, ...along("Il testo segue"), R3, END_G, END);
  const area = (...lines: string[]): string[] => [
    '    <text id="o5e6f7g8h" fub:wrap="320" x="100" y="200" font-size="32">',
    ...lines.map((line) => `      ${line}`),
    "    </text>",
  ];
  const AREA = lf(
    ROOT,
    TITLE,
    PAPER,
    L1,
    ...area('<tspan x="100" dy="0">Il testo in area va a</tspan>', '<tspan fub:join="space" x="100" dy="40">capo da solo.</tspan>'),
    END_G,
    END,
  );

  it("text su un testo su tracciato cambia il contenuto del textPath, coi pezzi, e l'undo lo rimette", () => {
    const engine = SceneEngine.open(ALONG);
    const out = apply(engine, { op: "text", id: "o5e6f7g8h", lines: [["Il testo ", { text: "segue", attrs: { "font-weight": "bold" } }, " la linea"]] });
    expect(out.text).toBe(lf(ROOT, TITLE, DEFS, CURVE, END_DEFS, PAPER, L1, ...along('Il testo <tspan font-weight="bold">segue</tspan> la linea'), R3, END_G, END));
    expect(out.inverse).toEqual({ op: "text", id: "o5e6f7g8h", lines: ["Il testo segue"] });
    const back = applied(engine.apply(out.inverse));
    expect(back.text).toBe(ALONG);
    expect(back.inverse).toEqual({
      op: "text",
      id: "o5e6f7g8h",
      lines: [["Il testo ", { text: "segue", attrs: { "font-weight": "bold" } }, " la linea"]],
    });
  });

  it("un testo su tracciato ha una riga sola, e non va a capo", () => {
    rejects(ALONG, { op: "text", id: "o5e6f7g8h", lines: ["Uno", "Due"] }, "invalid-elem");
    rejects(ALONG, { op: "text", id: "o5e6f7g8h", lines: [] }, "invalid-elem");
    rejects(ALONG, { op: "text", id: "o5e6f7g8h", lines: ["Uno"], joins: [null] }, "invalid-elem");
  });

  it("joins scrive fub:join riga per riga, e l'inversa rimette quelli di prima", () => {
    const engine = SceneEngine.open(AREA);
    const out = apply(engine, { op: "text", id: "o5e6f7g8h", lines: ["Il testo in area", "va a capo da", "solo."], joins: [null, "space", "space"] });
    expect(out.text).toBe(
      lf(
        ROOT,
        TITLE,
        PAPER,
        L1,
        ...area(
          '<tspan x="100" dy="0">Il testo in area</tspan>',
          '<tspan fub:join="space" x="100" dy="40">va a capo da</tspan>',
          '<tspan fub:join="space" x="100" dy="40">solo.</tspan>',
        ),
        END_G,
        END,
      ),
    );
    expect(out.inverse).toEqual({ op: "text", id: "o5e6f7g8h", lines: ["Il testo in area va a", "capo da solo."], joins: [null, "space"] });
    expect(applied(engine.apply(out.inverse)).text).toBe(AREA);
    // Un a capo dentro una parola, e un paragrafo nuovo.
    const word = apply(SceneEngine.open(AREA), { op: "text", id: "o5e6f7g8h", lines: ["Il testo in area va a", "ca", "po."], joins: [null, "space", "word"] });
    expect(word.text).toContain('<tspan fub:join="word" x="100" dy="40">po.</tspan>');
    const split = apply(SceneEngine.open(AREA), { op: "text", id: "o5e6f7g8h", lines: ["Il testo in area va a", "capo da solo."], joins: [null, null] });
    expect(split.text).toContain('<tspan x="100" dy="40">capo da solo.</tspan>');
  });

  it("senza joins le righe tengono il loro fub:join, e una riga nuova comincia un paragrafo", () => {
    const out = apply(SceneEngine.open(AREA), { op: "text", id: "o5e6f7g8h", lines: ["Il testo in area va a", "capo da solo.", "Fine."] });
    expect(out.text).toBe(
      lf(
        ROOT,
        TITLE,
        PAPER,
        L1,
        ...area(
          '<tspan x="100" dy="0">Il testo in area va a</tspan>',
          '<tspan fub:join="space" x="100" dy="40">capo da solo.</tspan>',
          '<tspan x="100" dy="40">Fine.</tspan>',
        ),
        END_G,
        END,
      ),
    );
    expect(out.inverse).toEqual({ op: "text", id: "o5e6f7g8h", lines: ["Il testo in area va a", "capo da solo."], joins: [null, "space"] });
  });

  it("senza joins l'inversa rimette il fub:join di una riga che se ne va", () => {
    const engine = SceneEngine.open(AREA);
    const out = apply(engine, { op: "text", id: "o5e6f7g8h", lines: ["Il testo in area va a capo da solo."] });
    expect(out.inverse).toEqual({ op: "text", id: "o5e6f7g8h", lines: ["Il testo in area va a", "capo da solo."], joins: [null, "space"] });
    expect(apply(engine, out.inverse).text).toBe(AREA);
    // Un testo senza fub:join ha l'inversa senza joins.
    const plain = SceneEngine.open(AREA.replace(/ fub:join="space"/g, ""));
    expect(apply(plain, { op: "text", id: "o5e6f7g8h", lines: ["Uno"] }).inverse).not.toHaveProperty("joins");
  });

  it("joins vuole una voce per riga, un testo o null", () => {
    rejects(AREA, { op: "text", id: "o5e6f7g8h", lines: ["Uno", "Due"], joins: [null] }, "invalid-elem");
    rejects(AREA, { op: "text", id: "o5e6f7g8h", lines: ["Uno"], joins: "space" }, "invalid-elem");
    rejects(AREA, { op: "text", id: "o5e6f7g8h", lines: ["Uno", "Due"], joins: [null, 1] }, "invalid-elem");
    rejects(AREA, { op: "text", id: "o5e6f7g8h", lines: ["Uno", "Due"], joins: [null, "a\u0001"] }, "invalid-elem");
  });

  it("il tracciato di un testo è una risorsa: lo trattiene, e se ne va con lui", () => {
    rejects(ALONG, { op: "remove", target: P }, "in-use");
    rejects(ALONG, { op: "ident", path: [1, 0], tag: "path", id: null }, "in-use");
    const engine = SceneEngine.open(ALONG);
    const out = apply(engine, { op: "remove", target: "o5e6f7g8h" });
    expect(out.text).toBe(lf(ROOT, TITLE, PAPER, L1, R3, END_G, END));
    expect(out.forward).toEqual({
      op: "batch",
      ops: [{ op: "remove", target: "o5e6f7g8h" }, { op: "remove", target: P }, { op: "remove", target: "fub-defs" }],
    });
    expect(applied(engine.undo(out.undo)).text).toBe(ALONG);
  });

  it("set sul tracciato ne cambia la forma; un attributo fuori dal formato lo renderebbe estraneo", () => {
    const engine = SceneEngine.open(ALONG);
    expect(apply(engine, { op: "set", id: P, attrs: { d: "M600 400 C450 250 250 250 100 400" } }).text).toBe(
      ALONG.replace("M100 400 C250 250 450 250 600 400", "M600 400 C450 250 250 250 100 400"),
    );
    rejects(ALONG, { op: "set", id: P, attrs: { transform: "rotate(10)" } }, "invalid-elem");
    rejects(ALONG, { op: "set", id: P, attrs: { d: "M100 Q" } }, "invalid-elem");
  });

  it("add porta il tracciato nella defs e il testo che lo segue, coi pezzi", () => {
    const PLAIN = lf(ROOT, TITLE, PAPER, L1, R3, END_G, END);
    const defs: Op = {
      op: "add",
      parent: "#root",
      pos: { first: true },
      elem: { tag: "defs", attrs: { id: "fub-defs" }, children: [{ tag: "path", attrs: { id: P, "fub:role": "private", d: "M100 400 C250 250 450 250 600 400" } }] },
    };
    const text: Op = {
      op: "add",
      parent: "l3f8a0c2d",
      pos: { first: true },
      elem: {
        tag: "text",
        attrs: { id: "o5e6f7g8h", fill: "#000000", "font-size": "32", "text-anchor": "middle" },
        children: [{ tag: "textPath", attrs: { href: `#${P}`, startOffset: "50%" }, runs: ["Il testo segue"] }],
      },
    };
    const out = apply(SceneEngine.open(PLAIN), { op: "batch", ops: [defs, text] });
    expect(out.text).toBe(ALONG);
    // Con raw, allo stesso modo: il testo resta com'è scritto.
    const raw: Op = { op: "add", parent: "#root", pos: { first: true }, raw: `<defs id="fub-defs">\n${CURVE}\n${END_DEFS}` };
    expect(apply(SceneEngine.open(PLAIN), { op: "batch", ops: [raw, text] }).text).toBe(ALONG);
    // Un tracciato fra gli oggetti vuole un id da oggetto; nella defs, da risorsa.
    rejects(PLAIN, { ...defs, elem: { tag: "defs", attrs: { id: "fub-defs" }, children: [{ tag: "path", attrs: { id: "o1a2b3c4d", d: "M0 0 L10 10" } }] } }, "invalid-elem");
    rejects(PLAIN, { op: "add", parent: "l3f8a0c2d", pos: { last: true }, elem: { tag: "path", attrs: { id: P, d: "M0 0 L10 10" } } }, "invalid-elem");
    // Un textPath fuori da un testo, o con dei figli, non si scrive.
    rejects(PLAIN, { op: "add", parent: "l3f8a0c2d", pos: { last: true }, elem: { tag: "textPath", attrs: { href: `#${P}` }, text: "No" } }, "invalid-elem");
    // Un testo che segue un tracciato che non c'è è estraneo.
    rejects(PLAIN, text, "invalid-elem");
  });
});

describe("le tavole", () => {
  const P1 = '  <rect id="fub-paper" fub:role="paper" fub:board="b1a2b3c4d" x="0" y="0" width="1600" height="1000" fill="#ffffff"/>';
  const P2 = '  <rect id="c5e6f7g8h" fub:role="paper" fub:board="b9i0j1k2l" x="1680" y="0" width="1600" height="1000" fill="#ffffff"/>';
  const V1 = ['  <view id="b1a2b3c4d" fub:role="board" viewBox="0 0 1600 1000">', "    <title>Tavola 1</title>", "  </view>"];
  const V2 = ['  <view id="b9i0j1k2l" fub:role="board" viewBox="1680 0 1600 1000">', "    <title>Tavola 2</title>", "  </view>"];
  const TWO = lf(ROOT, TITLE, P1, P2, ...V1, ...V2, L1, R2, END_G, END);
  const paper = (id: string, board: string, x = "1680"): Elem => ({
    tag: "rect",
    attrs: { id, "fub:role": "paper", "fub:board": board, x, y: "0", width: "1600", height: "1000", fill: "#ffffff" },
  });
  const board = (id: string, x = "3360"): Elem => ({ tag: "view", attrs: { id, "fub:role": "board", viewBox: `${x} 0 1600 1000` } });
  const add = (parent: string, elem: Elem): Op => ({ op: "add", parent, pos: { last: true }, elem });

  /// Il motivo per cui `op` si rifiuta su `source`, che resta com'era.
  function refused(source: string, op: unknown, reason: Reason): string {
    rejects(source, op, reason);
    const outcome = SceneEngine.open(source).apply(op as Op);
    return outcome.outcome === "rejected" ? outcome.detail : "";
  }

  it("la carta della pagina cambia solo con page, o diventa quella di una tavola", () => {
    expect(refused(BASE, { op: "set", id: "fub-paper", attrs: { "fub:board": "b1a2b3c4d", fill: "#000000" } }, "locked")).toMatch(/fill/);
    refused(BASE, { op: "set", id: "fub-paper", attrs: { "fub:board": null } }, "locked");
    refused(BASE, { op: "move", target: "fub-paper", parent: "#root", pos: { last: true } }, "locked");
    // Da sola, senza la tavola, non diventa niente.
    expect(refused(BASE, { op: "set", id: "fub-paper", attrs: { "fub:board": "b1a2b3c4d" } }, "invalid-elem")).toMatch(/b1a2b3c4d/);
  });

  it("la carta di una tavola cambia in geometria e tavola, e si toglie da sola", () => {
    refused(TWO, { op: "set", id: "c5e6f7g8h", attrs: { fill: "#000000" } }, "locked");
    refused(TWO, { op: "set", id: "c5e6f7g8h", attrs: { "fub:role": null } }, "locked");
    // Una tavola senza carta si legge, e si disegna senza fondo.
    const out = apply(SceneEngine.open(TWO), { op: "remove", target: "c5e6f7g8h" });
    expect(out.text).toBe(lf(ROOT, TITLE, P1, ...V1, ...V2, L1, R2, END_G, END));
    // Né la carta né la tavola vanno in un livello.
    refused(TWO, { op: "move", target: "c5e6f7g8h", parent: "l3f8a0c2d", pos: { last: true } }, "invalid-elem");
    refused(TWO, { op: "move", target: "b9i0j1k2l", parent: "l3f8a0c2d", pos: { last: true } }, "invalid-elem");
  });

  it("una carta nuova è di una tavola, sotto la radice, con gli id delle tavole", () => {
    const free: Elem = { tag: "rect", attrs: { id: "c0a1b2c3d", "fub:role": "paper", x: "0", y: "0", width: "1", height: "1" } };
    refused(TWO, add("#root", free), "invalid-elem");
    refused(TWO, add("l3f8a0c2d", paper("c0a1b2c3d", "b9i0j1k2l")), "invalid-elem");
    expect(refused(TWO, { op: "batch", ops: [add("#root", paper("o0a1b2c3d", "b0a1b2c3d", "3360")), add("#root", board("b0a1b2c3d"))] }, "invalid-elem")).toMatch(/carta di una tavola/);
    expect(refused(TWO, { op: "batch", ops: [add("#root", paper("c0a1b2c3d", "o0a1b2c3d", "3360")), add("#root", board("o0a1b2c3d"))] }, "invalid-elem")).toMatch(/una tavola/);
    // Con gli id giusti entra, dove la mette `last`.
    const out = apply(SceneEngine.open(TWO), { op: "batch", ops: [add("#root", paper("c0a1b2c3d", "b0a1b2c3d", "3360")), add("#root", board("b0a1b2c3d"))] });
    expect(readScene(out.text).summary.boards).toEqual(["Tavola 1", "Tavola 2", "b0a1b2c3d"]);
  });

  it("ogni tavola toccata ha al più una carta, con la sua geometria, e ogni carta la sua tavola", () => {
    expect(refused(TWO, add("#root", paper("c0a1b2c3d", "b0z0z0z0z")), "invalid-elem")).toMatch(/b0z0z0z0z, che non c'è/);
    expect(refused(TWO, add("#root", paper("c0a1b2c3d", "b9i0j1k2l")), "invalid-elem")).toMatch(/più di una carta/);
    expect(refused(TWO, { op: "set", id: "c5e6f7g8h", attrs: { "fub:board": "b1a2b3c4d" } }, "invalid-elem")).toMatch(/più di una carta/);
    expect(refused(TWO, { op: "set", id: "c5e6f7g8h", attrs: { "fub:board": null } }, "invalid-elem")).toMatch(/non ha una tavola/);
    // Una tavola che perde l'id è estranea: la sua carta resterebbe sola.
    expect(refused(TWO, { op: "ident", path: [4], tag: "view", id: null }, "invalid-elem")).toMatch(/b9i0j1k2l, che non c'è/);
  });

  it("un file già fuori regola altrove si modifica lo stesso, e page riporta la carta libera", () => {
    const extra = '  <rect fub:role="paper" x="0" y="0" width="10" height="10" fill="#ffffff"/>';
    const second = '  <rect id="c0a1b2c3d" fub:role="paper" fub:board="b1a2b3c4d" x="0" y="0" width="1600" height="1000" fill="#ffffff"/>';
    const out = lf(ROOT, TITLE, P1, second, extra, P2, ...V1, ...V2, L1, R2, END_G, END);
    const engine = SceneEngine.open(out);
    apply(engine, { op: "set", id: "o2b3c4d5e", attrs: { fill: "#0072b2" } });
    // Sulla seconda tavola, che va con la sua carta, si lavora.
    apply(engine, { op: "batch", ops: [{ op: "set", id: "b9i0j1k2l", attrs: { viewBox: "1700 0 1600 1000" } }, { op: "set", id: "c5e6f7g8h", attrs: { x: "1700" } }] });
    // Sulla prima, che ha due carte, no; togliere la seconda sì.
    refused(engine.text, { op: "set", id: "b1a2b3c4d", attrs: { viewBox: "0 0 1600 1000" } }, "invalid-elem");
    apply(engine, { op: "remove", target: "c0a1b2c3d" });
    // page riscrive la carta senza tavola, non quelle delle tavole.
    const paged = apply(engine, { op: "page", viewBox: "0 0 3300 1000" });
    expect(paged.text).toContain('<rect fub:role="paper" x="0" y="0" width="3300" height="1000" fill="#ffffff"/>');
    expect(paged.text).toContain(P1);
  });

  it("le inverse rimettono anche uno stato fuori regola", () => {
    const second = '  <rect id="c0a1b2c3d" fub:role="paper" fub:board="b1a2b3c4d" x="0" y="0" width="1600" height="1000" fill="#ffffff"/>';
    const out = lf(ROOT, TITLE, P1, second, ...V1, L1, R2, END_G, END);
    const engine = SceneEngine.open(out);
    const removed = apply(engine, { op: "remove", target: "c0a1b2c3d" });
    apply(engine, { op: "set", id: "o2b3c4d5e", attrs: { fill: "#0072b2" } });
    // Non è più esatto: passa dall'inversa, che non si guarda.
    const undone = applied(engine.undo(removed.undo));
    expect(undone.text).toContain(second);
  });

  it("first sotto la radice va dopo le carte e le tavole", () => {
    const layer: Op = { op: "add", parent: "#root", pos: { first: true }, elem: { tag: "g", attrs: { id: "l0a1b2c3d", "fub:layer": "Sfondo" } } };
    const out = apply(SceneEngine.open(TWO), layer);
    expect(out.text).toBe(lf(ROOT, TITLE, P1, P2, ...V1, ...V2, '  <g id="l0a1b2c3d" fub:layer="Sfondo">', END_G, L1, R2, END_G, END));
  });

  it(`il documento non riceve oltre ${MAX_BOARDS} tavole, e uno che ne ha di più si modifica`, () => {
    const views = (count: number): string[] =>
      Array.from({ length: count }, (_, i) => `  <view id="b${i.toString(36).padStart(8, "0")}" fub:role="board" viewBox="${i * 10} 0 5 5"/>`);
    const full = lf(ROOT, TITLE, ...views(MAX_BOARDS), L1, R2, END_G, END);
    expect(refused(full, add("#root", board("bzzzzzzzz")), "limit")).toMatch(new RegExp(`${MAX_BOARDS}`));
    const over = lf(ROOT, TITLE, ...views(MAX_BOARDS + 1), L1, R2, END_G, END);
    apply(SceneEngine.open(over), { op: "remove", target: "b00000000" });
    apply(SceneEngine.open(over), { op: "set", id: "b00000001", attrs: { viewBox: "0 0 9 9" } });
  });
});
