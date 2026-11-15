import { describe, expect, it } from "vitest";
import {
  MODES,
  PREFIX,
  PREVIEW_MIN_HEIGHT,
  PREVIEW_MIN_WIDTH,
  SMALLEST_SCALE,
  createMemory,
  filterByText,
  linePlace,
  lineTarget,
  openWay,
  pillPose,
  previewFits,
  read,
} from "./model";

describe("il prefisso sceglie il modo", () => {
  it("senza prefisso il modo resta quello che è, e il testo è tutto domanda", () => {
    expect(read("all", "nota")).toEqual({ mode: "all", text: "nota" });
    expect(read("people", "Anna Bianchi")).toEqual({ mode: "people", text: "Anna Bianchi" });
    expect(read("all", "")).toEqual({ mode: "all", text: "" });
  });

  it("ogni prefisso porta nel suo modo e non resta nella domanda", () => {
    expect(read("all", ">apri")).toEqual({ mode: "commands", text: "apri" });
    expect(read("all", "#tema")).toEqual({ mode: "tags", text: "tema" });
    expect(read("all", "@Anna")).toEqual({ mode: "people", text: "Anna" });
    expect(read("all", "/tabella")).toEqual({ mode: "blocks", text: "tabella" });
    expect(read("all", "?tasti")).toEqual({ mode: "help", text: "tasti" });
    expect(read("all", ":12")).toEqual({ mode: "line", text: "12" });
  });

  it("un prefisso seguito da niente porta nel modo, con la domanda vuota", () => {
    expect(read("all", ">")).toEqual({ mode: "commands", text: "" });
    expect(read("all", "?")).toEqual({ mode: "help", text: "" });
    expect(read("all", "@")).toEqual({ mode: "people", text: "" });
    expect(read("all", "/")).toEqual({ mode: "blocks", text: "" });
  });

  it("vale da ogni modo, anche da quello che il prefisso nomina già", () => {
    expect(read("commands", "@a")).toEqual({ mode: "people", text: "a" });
    expect(read("tags", "#tema")).toEqual({ mode: "tags", text: "tema" });
  });

  it("conta solo in testa: più in là è testo", () => {
    expect(read("line", "12:5")).toEqual({ mode: "line", text: "12:5" });
    expect(read("all", "a>b")).toEqual({ mode: "all", text: "a>b" });
    // Un nome che comincia con `#` si scrive preceduto da uno spazio.
    expect(read("all", " #tema")).toEqual({ mode: "all", text: " #tema" });
  });

  it("un prefisso solo non porta via quello che segue", () => {
    expect(read("all", ">>")).toEqual({ mode: "commands", text: ">" });
  });

  it("«Tutto» non ha prefisso, e nessun prefisso è di due modi", () => {
    expect(PREFIX.all).toBeNull();
    const written = MODES.map((mode) => PREFIX[mode]).filter((each): each is string => each !== null);
    expect(new Set(written).size).toBe(written.length);
    expect(written.every((each) => each.length === 1)).toBe(true);
  });

  it("la fila ha Tutto per primo e i sei ambiti più la riga", () => {
    expect(MODES).toEqual(["all", "commands", "tags", "people", "blocks", "help", "line"]);
  });
});

describe("la memoria dei modi", () => {
  it("ogni modo ricorda la sua domanda, e solo la sua", () => {
    const memory = createMemory();
    memory.remember("all", "nota");
    memory.remember("commands", "apri");
    expect(memory.recall("all")).toBe("nota");
    expect(memory.recall("commands")).toBe("apri");
    expect(memory.recall("people")).toBe("");
  });

  it("l'ultima domanda sostituisce la precedente, anche vuota", () => {
    const memory = createMemory();
    memory.remember("tags", "tema");
    memory.remember("tags", "");
    expect(memory.recall("tags")).toBe("");
  });

  it("due memorie non si parlano", () => {
    const first = createMemory();
    first.remember("all", "nota");
    expect(createMemory().recall("all")).toBe("");
  });
});

describe("dove si apre", () => {
  it("Invio qui, Ctrl-Invio a lato, Maiusc-Invio in una linguetta", () => {
    expect(openWay({})).toBe("here");
    expect(openWay({ ctrlKey: true })).toBe("split");
    expect(openWay({ metaKey: true })).toBe("split");
    expect(openWay({ shiftKey: true })).toBe("tab");
  });

  it("Alt-Invio apre a lato finché la sbirciata non c'è, senza finestre", () => {
    expect(openWay({ altKey: true })).toBe("split");
  });

  it("di due modificatori vince Ctrl, poi Alt, poi Maiusc", () => {
    expect(openWay({ altKey: true, ctrlKey: true, shiftKey: true })).toBe("split");
    expect(openWay({ ctrlKey: true, shiftKey: true })).toBe("split");
    expect(openWay({ altKey: true, shiftKey: true })).toBe("split");
  });
});

describe("la posa sulla pillola", () => {
  const place = { left: 320, top: 48, width: 640, height: 452 };

  it("parte larga quanto la pillola, sul suo bordo alto, con una scala sola", () => {
    const pose = pillPose({ left: 430, top: 6, width: 420, height: 28 }, place);
    expect(pose.scale).toBeCloseTo(420 / 640, 6);
    // Con l'origine nell'angolo, la superficie rimpicciolita comincia dove
    // comincia la pillola.
    expect(pose.x).toBeCloseTo(110, 6);
    expect(pose.y).toBe(-42);
  });

  it("una pillola fuori centro tiene la superficie centrata su di sé", () => {
    const pill = { left: 500, top: 6, width: 320, height: 28 };
    const pose = pillPose(pill, place);
    const centre = place.left + pose.x + (place.width * pose.scale) / 2;
    expect(centre).toBeCloseTo(pill.left + pill.width / 2, 6);
  });

  it("da una pillola ridotta a un'icona non nasce come un punto", () => {
    const pill = { left: 624, top: 6, width: 32, height: 28 };
    const pose = pillPose(pill, place);
    expect(pose.scale).toBe(SMALLEST_SCALE);
    expect(place.left + pose.x + (place.width * pose.scale) / 2).toBeCloseTo(640, 6);
  });

  it("una pillola più larga della superficie non la ingrandisce", () => {
    expect(pillPose({ left: 200, top: 6, width: 900, height: 28 }, place).scale).toBe(1);
  });
});

describe("il posto per l'anteprima", () => {
  it("c'è da una finestra larga e alta abbastanza", () => {
    expect(previewFits(1280, 800)).toBe(true);
    expect(previewFits(PREVIEW_MIN_WIDTH, PREVIEW_MIN_HEIGHT)).toBe(true);
  });

  it("non c'è se manca una delle due misure", () => {
    expect(previewFits(800, 500)).toBe(false);
    expect(previewFits(PREVIEW_MIN_WIDTH - 1, 900)).toBe(false);
    expect(previewFits(1600, PREVIEW_MIN_HEIGHT - 1)).toBe(false);
  });
});

describe("la riga nominata", () => {
  it("legge la riga, e la colonna dopo due punti o una virgola", () => {
    expect(lineTarget("12")).toEqual({ line: 12, column: null });
    expect(lineTarget(" 12:5 ")).toEqual({ line: 12, column: 5 });
    expect(lineTarget("12, 5")).toEqual({ line: 12, column: 5 });
  });

  it("non legge ciò che non è una riga", () => {
    expect(lineTarget("")).toBeNull();
    expect(lineTarget("0")).toBeNull();
    expect(lineTarget("riga 3")).toBeNull();
    expect(lineTarget("3:")).toBeNull();
    expect(lineTarget("-3")).toBeNull();
    expect(lineTarget("1.5")).toBeNull();
  });

  it("una colonna zero non è una colonna", () => {
    expect(lineTarget("4:0")).toEqual({ line: 4, column: null });
  });

  it("trova l'inizio della riga nel testo", () => {
    const text = "uno\ndue\ntre";
    expect(linePlace(text, { line: 1, column: null })).toEqual({ line: 1, column: null, char: 0, lines: 3 });
    expect(linePlace(text, { line: 2, column: null }).char).toBe(4);
    expect(linePlace(text, { line: 3, column: 2 })).toEqual({ line: 3, column: 2, char: 9, lines: 3 });
  });

  it("oltre la fine si ferma all'ultima riga e alla fine della riga", () => {
    const text = "uno\ndue\ntre";
    expect(linePlace(text, { line: 99, column: null })).toMatchObject({ line: 3, char: 8 });
    expect(linePlace(text, { line: 2, column: 99 })).toMatchObject({ line: 2, column: 4, char: 7 });
  });

  it("il ritorno a capo di Windows non è una colonna", () => {
    const text = "uno\r\ndue\r\n";
    expect(linePlace(text, { line: 1, column: 99 })).toMatchObject({ column: 4, char: 3 });
    expect(linePlace(text, { line: 2, column: null }).char).toBe(5);
    // L'ultima riga, vuota dopo il ritorno a capo, esiste.
    expect(linePlace(text, { line: 3, column: null })).toMatchObject({ line: 3, char: 10, lines: 3 });
  });

  it("un testo vuoto ha una riga sola", () => {
    expect(linePlace("", { line: 5, column: 3 })).toEqual({ line: 1, column: 1, char: 0, lines: 1 });
  });
});

describe("il filtro per testo", () => {
  const names = ["Tema", "tema/colore", "Banco", "sistema"];
  const same = (item: string): string => item;

  it("a domanda vuota restano tutte, in una copia", () => {
    const kept = filterByText(names, "  ", same);
    expect(kept).toEqual(names);
    expect(kept).not.toBe(names);
  });

  it("tiene chi contiene ogni parola, senza badare alle maiuscole e all'ordine", () => {
    expect(filterByText(names, "TEMA", same)).toEqual(["Tema", "tema/colore", "sistema"]);
    expect(filterByText(names, "colore tema", same)).toEqual(["tema/colore"]);
    expect(filterByText(names, "nessuno", same)).toEqual([]);
  });

  it("su richiesta chi comincia con la domanda passa davanti, e fra pari l'ordine resta", () => {
    const shuffled = ["sistema", "tema/colore", "Banco", "Tema"];
    expect(filterByText(shuffled, "tema", same)).toEqual(["sistema", "tema/colore", "Tema"]);
    expect(filterByText(shuffled, "tema", same, true)).toEqual(["tema/colore", "Tema", "sistema"]);
  });

  it("legge il testo che gli si dice di leggere", () => {
    const tags = [{ name: "tema", count: 3 }, { name: "banco", count: 9 }];
    expect(filterByText(tags, "ban", (tag) => tag.name)).toEqual([{ name: "banco", count: 9 }]);
  });
});
