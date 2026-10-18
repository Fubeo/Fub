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
  neighbour,
  openWay,
  pillPose,
  previewFits,
  read,
} from "./model";

describe("il prefisso sceglie il modo", () => {
  it("senza prefisso il modo resta quello che è, e il testo è tutto domanda", () => {
    expect(read("files", "nota")).toEqual({ mode: "files", text: "nota" });
    expect(read("search", "banco visivo")).toEqual({ mode: "search", text: "banco visivo" });
    expect(read("templates", "")).toEqual({ mode: "templates", text: "" });
  });

  it("ogni prefisso porta nel suo modo e non resta nella domanda", () => {
    expect(read("files", ">apri")).toEqual({ mode: "commands", text: "apri" });
    expect(read("files", "?testo")).toEqual({ mode: "search", text: "testo" });
    expect(read("files", "@Titoli")).toEqual({ mode: "headings", text: "Titoli" });
    expect(read("files", "#tema")).toEqual({ mode: "tags", text: "tema" });
    expect(read("files", ":12")).toEqual({ mode: "line", text: "12" });
  });

  it("vale da ogni modo, anche da quello che il prefisso nomina già", () => {
    expect(read("commands", "@a")).toEqual({ mode: "headings", text: "a" });
    expect(read("tags", "#tema")).toEqual({ mode: "tags", text: "tema" });
  });

  it("conta solo in testa: più in là è testo", () => {
    expect(read("line", "12:5")).toEqual({ mode: "line", text: "12:5" });
    expect(read("files", "a>b")).toEqual({ mode: "files", text: "a>b" });
    expect(read("files", " #tema")).toEqual({ mode: "files", text: " #tema" });
  });

  it("un prefisso solo non porta via quello che segue", () => {
    expect(read("files", ">>")).toEqual({ mode: "commands", text: ">" });
  });

  it("i file e i modelli non hanno prefisso, e nessun prefisso è di due modi", () => {
    expect(PREFIX.files).toBeNull();
    expect(PREFIX.templates).toBeNull();
    const written = MODES.map((mode) => PREFIX[mode]).filter((each): each is string => each !== null);
    expect(new Set(written).size).toBe(written.length);
    expect(written.every((each) => each.length === 1)).toBe(true);
  });
});

describe("il modo accanto", () => {
  it("va avanti e indietro nell'ordine della fila", () => {
    expect(neighbour("files", 1)).toBe("commands");
    expect(neighbour("commands", -1)).toBe("files");
  });

  it("gira in tondo ai due capi", () => {
    expect(neighbour("templates", 1)).toBe("files");
    expect(neighbour("files", -1)).toBe("templates");
  });

  it("un giro intero torna al punto di partenza passando per tutti", () => {
    const seen = [];
    let mode = MODES[0]!;
    do {
      seen.push(mode);
      mode = neighbour(mode, 1);
    } while (mode !== MODES[0]);
    expect(seen).toEqual(MODES);
  });
});

describe("la memoria dei modi", () => {
  it("ogni modo ricorda la sua domanda, e solo la sua", () => {
    const memory = createMemory();
    memory.remember("files", "nota");
    memory.remember("commands", "apri");
    expect(memory.recall("files")).toBe("nota");
    expect(memory.recall("commands")).toBe("apri");
    expect(memory.recall("search")).toBe("");
  });

  it("l'ultima domanda sostituisce la precedente, anche vuota", () => {
    const memory = createMemory();
    memory.remember("tags", "tema");
    memory.remember("tags", "");
    expect(memory.recall("tags")).toBe("");
  });

  it("due memorie non si parlano", () => {
    const first = createMemory();
    first.remember("files", "nota");
    expect(createMemory().recall("files")).toBe("");
  });
});

describe("dove si apre", () => {
  it("Invio qui, Mod-Invio dividendo, Maiusc-Invio in una linguetta", () => {
    expect(openWay({}, true)).toBe("here");
    expect(openWay({ ctrlKey: true }, true)).toBe("split");
    expect(openWay({ metaKey: true }, true)).toBe("split");
    expect(openWay({ shiftKey: true }, true)).toBe("tab");
  });

  it("Alt-Invio apre una finestra solo dove ce n'è più d'una", () => {
    expect(openWay({ altKey: true }, true)).toBe("window");
    expect(openWay({ altKey: true }, false)).toBe("here");
    expect(openWay({ altKey: true, ctrlKey: true }, false)).toBe("split");
  });

  it("di due modificatori vince la finestra, poi la divisione", () => {
    expect(openWay({ altKey: true, ctrlKey: true, shiftKey: true }, true)).toBe("window");
    expect(openWay({ ctrlKey: true, shiftKey: true }, true)).toBe("split");
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
