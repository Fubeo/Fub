// **Il presidio del banco del moto**: l'elenco delle coreografie è chiuso, e i
// confronti delle quattro regole fanno ciò che dicono.
//
// Il banco vero (`motion.mjs`) apre un browser e non gira qui. Qui gira la sua
// parte pura, `motion-rules.mjs`, per la ragione di `scene.test.ts`: un elenco
// che si svuota e un elenco che passa danno lo stesso verde, e un confronto
// sbagliato dà verde a tutte le coreografie insieme.
//
// # Perché l'elenco è chiuso sui file e non sulle chiamate
//
// Si contano i file che importano `moto` e ne fanno partire una corsa. Un file
// nuovo deve avere una coreografia o una ragione scritta: è il punto in cui chi
// aggiunge un movimento incontra il banco. Contare le chiamate una per una
// legherebbe il presidio ai numeri di riga.
import { describe, expect, it } from "vitest";

import { SCENE as scenes } from "./scene.mjs";
import {
  ALLOWED,
  CHOREOGRAPHIES as choreographies,
  EXIT_LIMIT_MS,
  UNCOVERED as uncovered,
  cssName,
  family,
  foreignInKeyframes,
  foreignProperties,
  jumps,
  longExits,
  midpoint,
  residue,
} from "./motion-rules.mjs";

/// I sorgenti della shell, dei pannelli, del kit e dell'editor dei documenti, come Vite li vede: il percorso dalla
/// radice del client e il testo.
const sources = new Map(
  Object.entries(
    import.meta.glob(["../src/shells/scrittoio/**/*.ts", "../src/panels/**/*.ts", "../src/kit/**/*.ts", "../src/editors/rich/**/*.ts", "../src/ui/motion.ts"], {
      eager: true,
      query: "?raw",
      import: "default",
    }) as Record<string, string>,
  ).map(([path, text]) => [path.replace(/^\.\.\//, ""), text]),
);

/// Un file «si muove» se importa `moto` e chiama una delle sue partenze.
const IMPORTS_MOTO = /from\s+"(\.\.?\/)+moto(\/[\w-]+)?"/;
const STARTS = /\b(animate|springValue|flip|exitGhost|prepareExit|stagger|enter|drag)\(/;
const moving = [...sources]
  .filter(([path, text]) => !path.endsWith(".test.ts") && IMPORTS_MOTO.test(text) && STARTS.test(text))
  .map(([path]) => path)
  .sort();

/// Sotto questo numero l'elenco ha smesso di coprire ciò che il piano chiama
/// per nome: linguette, binario, luce, popover, più le primitive del kit.
const MINIMUM = 10;

describe("l'elenco delle coreografie", () => {
  it("non è vuoto, e non si svuota in silenzio", () => {
    expect(choreographies.length).toBeGreaterThanOrEqual(MINIMUM);
  });

  it("ha un id per coreografia, scritto come un nome di file, e nessuno ripetuto", () => {
    const ids = choreographies.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, `«${id}» non è un id`).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("dice per ognuna che cosa si muove, da dove si parte e come si arriva", () => {
    const known = new Set(scenes.map((s) => s.id));
    for (const c of choreographies) {
      expect(c.title, `${c.id} non ha un titolo`).toBeTruthy();
      expect(known.has(c.scene), `${c.id} parte da una scena che non c'è: ${c.scene}`).toBe(true);
      expect(typeof c.arrived, `${c.id} non dice come si riconosce l'arrivo`).toBe("function");
      if (c.mount) expect(c.act, `${c.id} parte al montaggio e dichiara un gesto`).toBeNull();
      else expect(typeof c.act, `${c.id} non ha un gesto`).toBe("function");
    }
  });

  it("ha un ritorno per ogni gesto che si disfa, e una ragione per ogni gesto che no", () => {
    for (const c of choreographies) {
      if (c.undo === null) {
        expect(c.irreversible, `${c.id} non si inverte e non dice perché`).toBeTruthy();
      } else {
        expect(typeof c.undo).toBe("function");
        expect(typeof c.returned, `${c.id} non dice come si riconosce il ritorno`).toBe("function");
      }
    }
  });

  it("nomina sorgenti che esistono, e ne ha almeno una se non è ferma", () => {
    for (const c of choreographies) {
      if (!c.still) expect(c.sources.length, `${c.id} non dice da dove parte`).toBeGreaterThan(0);
      for (const source of c.sources) {
        expect(sources.has(source), `${c.id} nomina un file che non c'è: ${source}`).toBe(true);
      }
    }
  });
});

describe("la copertura", () => {
  it("vede dei file che si muovono: il presidio non è cieco", () => {
    expect(moving).toContain("src/shells/scrittoio/sheets/tab-strip.ts");
    expect(moving).toContain("src/kit/popover.ts");
  });

  it("ha una coreografia, o una ragione scritta, per ogni file che fa partire una corsa", () => {
    const covered = new Set([...choreographies.flatMap((c) => c.sources), ...uncovered.map((u) => u.source)]);
    const missing = moving.filter((path) => !covered.has(path));
    expect(
      missing,
      "un movimento che il banco non guarda: aggiungi una coreografia a `motion-rules.mjs`, o una riga a `UNCOVERED` con la ragione",
    ).toEqual([]);
  });

  it("non tiene fra gli scoperti un file che non c'è più, o che una coreografia già guarda", () => {
    const watched = new Set(choreographies.flatMap((c) => c.sources));
    for (const u of uncovered) {
      expect(u.reason, `${u.source} non dice perché`).toBeTruthy();
      expect(moving, `${u.source} non fa più partire corse`).toContain(u.source);
      expect(watched.has(u.source), `${u.source} ha già una coreografia`).toBe(false);
    }
  });
});

describe("la regola 3: solo le proprietà ammesse", () => {
  it("ammette `transform`, `opacity` e le proprietà singole, e nient'altro", () => {
    expect([...ALLOWED].sort()).toEqual(["opacity", "rotate", "scale", "transform", "translate"]);
  });

  it("non conta i nomi di servizio di un fotogramma chiave", () => {
    const frames = [
      { offset: 0, easing: "linear", composite: "replace", computedOffset: 0, transform: "none", opacity: "0" },
      { offset: 1, transform: "translateX(4px)", opacity: "1" },
    ];
    expect(foreignInKeyframes(frames)).toEqual([]);
  });

  it("nomina ogni proprietà estranea una volta, come la scrive il CSS", () => {
    const frames = [
      { offset: 0, backgroundColor: "red", width: "10px", opacity: "0" },
      { offset: 1, backgroundColor: "blue", width: "20px", opacity: "1" },
    ];
    expect(foreignInKeyframes(frames)).toEqual(["background-color", "width"]);
    expect(foreignProperties(["background-color", "backgroundColor", "translate"])).toEqual(["background-color"]);
  });

  it("legge allo stesso modo i nomi dei fotogrammi e quelli degli eventi", () => {
    expect(cssName("borderTopColor")).toBe("border-top-color");
    expect(cssName("border-top-color")).toBe("border-top-color");
    expect(cssName("cssFloat")).toBe("float");
    expect(cssName("--accent")).toBe("--accent");
  });

  it("distingue una transizione di colore da un'animazione di geometria", () => {
    expect(family("transform")).toBe("allowed");
    expect(family("backgroundColor")).toBe("paint");
    expect(family("box-shadow")).toBe("paint");
    expect(family("border-left-color")).toBe("paint");
    expect(family("width")).toBe("layout");
    expect(family("flex-basis")).toBe("layout");
    // Ciò che non si conosce costa come un layout: non passa per pittura.
    expect(family("--qualcosa")).toBe("layout");
  });
});

describe("la regola 2: nessun residuo", () => {
  const notch = { path: "#rail-notch", property: "translate", value: "0px 54px" };

  it("non chiama residuo ciò che anche il moto ridotto lascia", () => {
    expect(residue([notch], [{ ...notch, value: " 0px 54px " }])).toEqual([]);
  });

  it("chiama residuo una proprietà che il moto ridotto non lascia", () => {
    const scale = { path: "#kit > button:nth-child(1)", property: "scale", value: "0.97" };
    expect(residue([notch, scale], [notch])).toEqual([{ ...scale, still: null }]);
  });

  it("chiama residuo anche un valore diverso: è un altro stato finale", () => {
    expect(residue([notch], [{ ...notch, value: "0px 14px" }])).toEqual([{ ...notch, still: "0px 14px" }]);
  });
});

describe("la regola 4: l'inversione non riparte da zero", () => {
  const flying = { key: "pannello", left: 100, top: 50, width: 200, height: 80, opacity: 0.5 };

  it("accetta lo stesso riquadro, a meno dell'arrotondamento", () => {
    expect(jumps([flying], [{ ...flying, left: 100.6, opacity: 0.51 }])).toEqual([]);
  });

  it("accetta l'immagine che ne ha preso il posto", () => {
    const rest = { ...flying, key: "riposo", left: 400, opacity: 1 };
    const ghost = { ...flying, key: "immagine" };
    expect(jumps([flying], [rest, ghost])).toEqual([]);
  });

  it("chiama salto una corsa ripartita dalla posa di partenza", () => {
    const restarted = { ...flying, left: 112, opacity: 0 };
    expect(jumps([flying], [restarted])).toEqual([{ key: "pannello", px: 12, opacity: 0.5, nearest: "pannello" }]);
  });

  it("chiama salto ciò che sparisce senza lasciare un'immagine", () => {
    expect(jumps([flying], [])).toEqual([{ key: "pannello", px: null, opacity: null, nearest: null }]);
  });
});

describe("la metà corsa", () => {
  const frame = 1000 / 60;

  it("è la metà della corsa più breve, così tutte sono ancora in viaggio", () => {
    const half = midpoint([220, 600]);
    expect(half).toBeLessThan(220);
    expect(half / frame).toBeCloseTo(Math.round(110 / frame), 9);
  });

  it("senza corse vale il ripiego, e non scende mai sotto un fotogramma", () => {
    expect(midpoint([], 50)).toBeCloseTo(3 * frame, 9);
    expect(midpoint([4])).toBeCloseTo(frame, 9);
  });
});

describe("la regola 5: le uscite sono brevi", () => {
  it("tiene il limite del piano, e conta anche il ritardo", () => {
    expect(EXIT_LIMIT_MS).toBe(140);
    const runs = [
      { target: "#a", duration: 140, delay: 0 },
      { target: "#b", duration: 100, delay: 60 },
      { target: "#c", pseudo: "::after", duration: 220, delay: 0 },
    ];
    expect(longExits(runs)).toEqual([
      { target: "#b", length: 160 },
      { target: "#c::after", length: 220 },
    ]);
  });

  it("vale per qualche coreografia: un elenco di uscite vuoto non prova niente", () => {
    expect(choreographies.filter((c) => c.exit).length).toBeGreaterThanOrEqual(3);
    for (const c of choreographies.filter((c) => c.exit)) {
      expect(typeof c.undo, `${c.id} esce senza un gesto che disfa`).toBe("function");
    }
  });
});
