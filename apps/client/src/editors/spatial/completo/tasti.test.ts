// Le regole dei tasti del Completo (K6 T9b): la forma dei tasti del motore, chi
// vince su chi (D1 (a)), le modifiche dell'utente, il tasto che i menu mostrano,
// e quando un tasto parte o no.
import { describe, expect, it } from "vitest";
import { parseChords, type KeyChord } from "../../../ui/commands";
import {
  chiaveTasto,
  decidiTasto,
  normaTasto,
  risolviTasti,
  strumentoDelTasto,
  TASTI_DI_FUB,
  tastoDelComando,
  tastoFub,
  tastoStrumento,
  type RegolaTasti,
  type StatoTastiera,
  type VoceTasto,
} from "./tasti";

/// Un tasto premuto, come lo legge la tastiera.
function tasto(key: string, mods: Partial<Pick<KeyChord, "ctrlKey" | "metaKey" | "shiftKey" | "altKey">> = {}): KeyChord {
  return { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods };
}

const NESSUNO: StatoTastiera = { inCampo: false, vuoleTesto: false, componendo: false };

/// Il sorgente di `keys.ts` come testo (Vite lo legge con `?raw`).
const KEYS_TS = import.meta.glob("../tools/editor/keys.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("tastoFub", () => {
  it("scrive Cmd del motore come Mod, e Ctrl come Ctrl", () => {
    expect(tastoFub("Cmd+K")).toBe("Mod-K");
    expect(tastoFub("Cmd+Shift+G")).toBe("Mod-Shift-G");
    expect(tastoFub("Cmd+Alt+L")).toBe("Mod-Alt-L");
    expect(tastoFub("Ctrl+Alt+/")).toBe("Ctrl-Alt-/");
  });

  it("legge il tasto più (Cmd++) e il meno (Cmd+-)", () => {
    expect(tastoFub("Cmd++")).toBe("Mod-+");
    expect(tastoFub("Cmd+-")).toBe("Mod--");
  });

  it("tiene i tasti di funzione anche con Maiusc", () => {
    expect(tastoFub("Shift+F8")).toBe("Shift-F8");
    expect(tastoFub("Cmd+Alt+Shift+F9")).toBe("Mod-Alt-Shift-F9");
  });

  it("non dà un tasto che la shell non sa premere", () => {
    expect(tastoFub(null)).toBeNull();
    expect(tastoFub("")).toBeNull();
    expect(tastoFub("Cmd+")).toBeNull(); // il modificatore senza tasto
    expect(tastoFub("K")).toBeNull(); // nudo: il motore non ne ha, la shell non lo accetta
    expect(tastoFub("Cmd+K Cmd+D")).toBeNull(); // una sequenza non è un accordo solo
  });

  it("non dà un simbolo con Maiusc, che su un'altra tastiera è un altro tasto", () => {
    expect(tastoFub("Shift+9")).toBeNull();
    expect(tastoFub("Shift+~")).toBeNull();
    expect(tastoFub("Cmd+Shift+8")).toBeNull();
    expect(tastoFub("Cmd+Shift+]")).toBeNull();
    expect(tastoFub("Shift+M")).toBe("Shift-M"); // una lettera con Maiusc sì
  });
});

describe("chiaveTasto", () => {
  it("su macOS Cmd e Control sono due tasti", () => {
    expect(chiaveTasto("Mod-k", "mac")).toBe("mod-k");
    expect(chiaveTasto("Ctrl-k", "mac")).toBe("ctrl-k");
    expect(chiaveTasto("Mod-k", "mac")).not.toBe(chiaveTasto("Ctrl-k", "mac"));
  });

  it("altrove Ctrl e Mod sono lo stesso tasto", () => {
    expect(chiaveTasto("Ctrl-k", "other")).toBe("mod-k");
    expect(chiaveTasto("Mod-k", "other")).toBe("mod-k");
  });

  it("non confronta un tasto che non è un accordo solo", () => {
    expect(chiaveTasto("Mod-k d", "other")).toBeNull();
    expect(chiaveTasto("nonsense--", "other")).toBeNull();
  });

  it("ordina i modificatori in modo fisso", () => {
    expect(chiaveTasto("Shift-Mod-k", "other")).toBe(chiaveTasto("Mod-Shift-k", "other"));
  });
});

describe("normaTasto", () => {
  it("accetta solo un accordo solo", () => {
    expect(normaTasto("Mod-Shift-o")).toBe("Mod-Shift-o");
    expect(normaTasto("Mod-k d")).toBeNull();
    expect(normaTasto("  ")).toBeNull();
    expect(normaTasto(undefined)).toBeNull();
  });
});

describe("risolviTasti", () => {
  it("dà ai comandi del motore il loro tasto, nella forma di Fub", () => {
    const voci: VoceTasto[] = [
      { id: "shape.round", tasto: "Cmd+Alt+L" },
      { id: "shape.star", tasto: null },
    ];
    const regola = risolviTasti(voci, {}, "other");
    expect(tastoDelComando(regola, "shape.round")).toBe("Mod-Alt-L");
    expect(tastoDelComando(regola, "shape.star")).toBeNull();
    expect(regola.conflitti).toEqual([]);
    expect(regola.coperti).toEqual([]);
  });

  it("un tasto di Fub vince e il comando del motore resta senza tasto (D1 (a))", () => {
    // Cmd+Z è Annulla di Fub, Cmd+K è Collega, Cmd+P è Stampa, Ctrl+Tab è la scheda.
    const voci: VoceTasto[] = [
      { id: "edit.undo", tasto: "Cmd+Z" },
      { id: "file.link", tasto: "Cmd+K" },
      { id: "file.print", tasto: "Cmd+P" },
      { id: "view.tab", tasto: "Ctrl+Tab" },
      { id: "shape.round", tasto: "Cmd+Alt+L" },
    ];
    const regola = risolviTasti(voci, {}, "other");
    expect(tastoDelComando(regola, "edit.undo")).toBeNull();
    expect(tastoDelComando(regola, "file.link")).toBeNull();
    expect(tastoDelComando(regola, "file.print")).toBeNull();
    expect(tastoDelComando(regola, "view.tab")).toBeNull();
    expect(tastoDelComando(regola, "shape.round")).toBe("Mod-Alt-L");
    expect(regola.coperti.map((c) => c.comando)).toEqual(["edit.undo", "file.link", "file.print", "view.tab"]);
  });

  it("un tasto della shell è di Fub: il comando del motore non lo prende", () => {
    // Mod-Shift-p è la tavolozza della shell (`shell-keys.generated.ts`).
    const regola = risolviTasti([{ id: "x.cmd", tasto: "Cmd+Shift+P" }], {}, "other");
    expect(tastoDelComando(regola, "x.cmd")).toBeNull();
    expect(regola.coperti).toEqual([{ comando: "x.cmd", tasto: "Mod-Shift-P" }]);
  });

  it("due comandi del motore sullo stesso tasto: vince l'ultimo, e il conflitto si vede", () => {
    const voci: VoceTasto[] = [
      { id: "a.primo", tasto: "Cmd+Alt+M" },
      { id: "b.secondo", tasto: "Cmd+Alt+M" },
      { id: "c.altro", tasto: "Cmd+Alt+N" },
    ];
    const regola = risolviTasti(voci, {}, "other");
    expect(tastoDelComando(regola, "a.primo")).toBeNull();
    expect(tastoDelComando(regola, "b.secondo")).toBe("Mod-Alt-M");
    expect(tastoDelComando(regola, "c.altro")).toBe("Mod-Alt-N");
    expect(regola.conflitti).toEqual([{ tasto: "Mod-Alt-M", vince: "b.secondo", perde: ["a.primo"] }]);
  });

  it("le modifiche dell'utente valgono sopra quelle del motore", () => {
    const voci: VoceTasto[] = [{ id: "shape.round", tasto: "Cmd+Alt+L" }];
    const regola = risolviTasti(voci, { "shape.round": "Mod-Alt-R" }, "other");
    expect(tastoDelComando(regola, "shape.round")).toBe("Mod-Alt-R");
  });

  it("un tasto tolto dall'utente (null) non lascia il tasto del motore", () => {
    const voci: VoceTasto[] = [{ id: "shape.round", tasto: "Cmd+Alt+L" }];
    const regola = risolviTasti(voci, { "shape.round": null }, "other");
    expect(tastoDelComando(regola, "shape.round")).toBeNull();
  });

  it("l'utente che sceglie un tasto già del motore fa perdere il tasto al primo", () => {
    const voci: VoceTasto[] = [
      { id: "a.primo", tasto: "Cmd+Alt+M" },
      { id: "b.secondo", tasto: "Cmd+Alt+N" },
    ];
    const regola = risolviTasti(voci, { "b.secondo": "Mod-Alt-M" }, "other");
    expect(tastoDelComando(regola, "a.primo")).toBeNull();
    expect(tastoDelComando(regola, "b.secondo")).toBe("Mod-Alt-M");
    expect(regola.conflitti).toEqual([{ tasto: "Mod-Alt-M", vince: "b.secondo", perde: ["a.primo"] }]);
  });

  it("un tasto dell'utente che è di Fub non vale: il comando resta senza tasto", () => {
    const voci: VoceTasto[] = [{ id: "shape.round", tasto: "Cmd+Alt+L" }];
    const regola = risolviTasti(voci, { "shape.round": "Mod-w" }, "other");
    expect(tastoDelComando(regola, "shape.round")).toBeNull();
    expect(regola.coperti).toEqual([{ comando: "shape.round", tasto: "Mod-w" }]);
  });

  it("una modifica con un tasto che la shell non sa premere vale come tolto", () => {
    const voci: VoceTasto[] = [{ id: "shape.round", tasto: "Cmd+Alt+L" }];
    const regola = risolviTasti(voci, { "shape.round": "Mod-k d" }, "other");
    expect(tastoDelComando(regola, "shape.round")).toBeNull();
  });

  it("una modifica di un comando che non c'è nell'indice si ignora", () => {
    const regola = risolviTasti([{ id: "a", tasto: "Cmd+Alt+M" }], { nonce: "Mod-Alt-Q" }, "other");
    expect(regola.tasti.size).toBe(1);
    expect(tastoDelComando(regola, "nonce")).toBeNull();
  });

  it("su macOS Ctrl+K non è Cmd+K, e non copre il comando", () => {
    const voci: VoceTasto[] = [{ id: "x.ctrlk", tasto: "Ctrl+K" }];
    expect(tastoDelComando(risolviTasti(voci, {}, "mac"), "x.ctrlk")).toBe("Ctrl-K");
    // Su Linux e Windows Ctrl+K è Mod-K, cioè il Collega di Fub.
    expect(tastoDelComando(risolviTasti(voci, {}, "other"), "x.ctrlk")).toBeNull();
  });

  it("su macOS Cmd+K è Mod-K, e cade contro il tasto di Fub", () => {
    const voci: VoceTasto[] = [{ id: "x.cmdk", tasto: "Cmd+K" }];
    expect(tastoDelComando(risolviTasti(voci, {}, "mac"), "x.cmdk")).toBeNull();
  });

  it("la regola è pura: stessi argomenti, stesso risultato", () => {
    const voci: VoceTasto[] = [
      { id: "a", tasto: "Cmd+Alt+M" },
      { id: "b", tasto: "Cmd+Alt+M" },
    ];
    expect(risolviTasti(voci, { a: "Mod-Alt-Q" }, "other")).toEqual(risolviTasti(voci, { a: "Mod-Alt-Q" }, "other"));
  });
});

describe("TASTI_DI_FUB", () => {
  it("comprende i quattro tasti che si nominano sempre, e quelli della shell", () => {
    expect(TASTI_DI_FUB).toEqual(expect.arrayContaining(["Mod-p", "Mod-k", "Mod-w", "Ctrl-Tab", "Mod-Shift-p", "Mod-z"]));
  });

  it("comprende ogni tasto con modificatore che keys.ts scrive nelle sue righe", () => {
    // Un tasto aggiunto a `keys.ts` senza entrare qui farebbe perdere a Fub il
    // suo tasto contro un comando del motore: il test lo vede prima.
    const sorgente = KEYS_TS["../tools/editor/keys.ts"]!;
    const scritti = new Set<string>();
    for (const [, letterale] of sorgente.matchAll(/"([^"\n]*)"/g)) {
      for (const parte of letterale!.split(/\s+/)) {
        if (/^(Mod|Alt|Shift|Ctrl)-[^$\s]+$/.test(parte) && /^[\x20-\x7e]+$/.test(parte)) scritti.add(parte);
      }
    }
    expect(scritti.size).toBeGreaterThan(20);
    const coperti = new Set(TASTI_DI_FUB.map((t) => chiaveTasto(t, "other")));
    const mancanti = [...scritti].filter((t) => !coperti.has(chiaveTasto(t, "other")));
    expect(mancanti).toEqual([]);
  });
});

describe("decidiTasto", () => {
  // Un comando del motore sul Cmd+Alt+L (Mod-Alt-L), e uno sulla lettera.
  const regola: RegolaTasti = risolviTasti([{ id: "shape.round", tasto: "Cmd+Alt+L" }], {}, "other");

  it("fa partire il comando del motore con il suo tasto", () => {
    const e = tasto("l", { ctrlKey: true, altKey: true });
    expect(decidiTasto(e, regola, NESSUNO, "other")).toEqual({ tipo: "esegue", comando: "shape.round" });
  });

  it("non fa partire niente con un tasto che non è il suo", () => {
    expect(decidiTasto(tasto("m", { ctrlKey: true, altKey: true }), regola, NESSUNO, "other")).toEqual({ tipo: "passa" });
    expect(decidiTasto(tasto("l"), regola, NESSUNO, "other")).toEqual({ tipo: "passa" });
  });

  it("su macOS il tasto è Cmd (metaKey), e Control non basta", () => {
    const rmac = risolviTasti([{ id: "shape.round", tasto: "Cmd+Alt+L" }], {}, "mac");
    expect(decidiTasto(tasto("¬", { metaKey: true, altKey: true }), rmac, NESSUNO, "mac")).toEqual({ tipo: "passa" });
    expect(decidiTasto(tasto("l", { metaKey: true, altKey: true }), rmac, NESSUNO, "mac")).toEqual({ tipo: "esegue", comando: "shape.round" });
  });

  it("non parte dentro un campo di testo", () => {
    const e = tasto("l", { ctrlKey: true, altKey: true });
    expect(decidiTasto(e, regola, { ...NESSUNO, inCampo: true }, "other")).toEqual({ tipo: "passa" });
  });

  it("non parte mentre un IME compone", () => {
    const e = tasto("l", { ctrlKey: true, altKey: true });
    expect(decidiTasto(e, regola, { ...NESSUNO, componendo: true }, "other")).toEqual({ tipo: "passa" });
  });

  it("con lo strumento che vuole il testo, un tasto che scrive non parte", () => {
    const regolaLettera = risolviTasti([{ id: "shift.m", tasto: "Cmd+Shift+M" }], {}, "other");
    const lettera = tasto("M", { shiftKey: true });
    expect(decidiTasto(lettera, regolaLettera, { ...NESSUNO, vuoleTesto: true }, "other")).toEqual({ tipo: "passa" });
    expect(decidiTasto(lettera, regolaLettera, NESSUNO, "other")).toEqual({ tipo: "passa" }); // senza match: non è un tasto suo
    const conTasto = tasto("m", { ctrlKey: true, shiftKey: true });
    expect(decidiTasto(conTasto, regolaLettera, { ...NESSUNO, vuoleTesto: true }, "other")).toEqual({ tipo: "esegue", comando: "shift.m" });
  });

  it("con lo strumento che vuole il testo, un comando con Ctrl parte lo stesso", () => {
    const e = tasto("l", { ctrlKey: true, altKey: true });
    expect(decidiTasto(e, regola, { ...NESSUNO, vuoleTesto: true }, "other")).toEqual({ tipo: "esegue", comando: "shape.round" });
  });

  it("con Ctrl e Alt un tasto non scrive, e il comando parte anche col testo", () => {
    const regolaAlt = risolviTasti([{ id: "x.alt", tasto: "Cmd+Alt+L" }], {}, "other");
    const e = tasto("l", { ctrlKey: true, altKey: true });
    expect(decidiTasto(e, regolaAlt, { ...NESSUNO, vuoleTesto: true }, "other")).toEqual({ tipo: "esegue", comando: "x.alt" });
  });
});

describe("il tasto che il menu mostra è quello che parte", () => {
  it("per ogni comando con tasto, premere quel tasto fa partire quel comando", () => {
    const voci: VoceTasto[] = [
      { id: "shape.round", tasto: "Cmd+Alt+L" },
      { id: "shape.star", tasto: "Cmd+Alt+S" },
      { id: "edit.undo", tasto: "Cmd+Z" }, // di Fub: nessun tasto da mostrare
    ];
    const regola = risolviTasti(voci, { "shape.star": "Mod-Alt-R" }, "other");
    for (const id of ["shape.round", "shape.star"]) {
      const accordo = parseChords(tastoDelComando(regola, id)!)![0]!;
      const evento = { key: accordo.key, ctrlKey: accordo.mod, metaKey: false, shiftKey: accordo.shift, altKey: accordo.alt };
      expect(decidiTasto(evento, regola, NESSUNO, "other")).toEqual({ tipo: "esegue", comando: id });
    }
    expect(tastoDelComando(regola, "edit.undo")).toBeNull();
  });
});

describe("i tasti degli strumenti di VectorCraft nel Completo", () => {
  it("il tasto del catalogo diventa quello degli strumenti di Fub: lettera, Maiusc+lettera, segno", () => {
    expect(tastoStrumento("V")).toBe("v");
    expect(tastoStrumento("Shift+B")).toBe("Shift-b");
    expect(tastoStrumento("+")).toBe("+");
    expect(tastoStrumento("\\")).toBe("\\");
    // Maiusc con un segno dipende dalla tastiera; con Ctrl o Alt è un comando, non uno strumento.
    expect(tastoStrumento("Shift+~")).toBeNull();
    expect(tastoStrumento("Cmd+K")).toBeNull();
    expect(tastoStrumento("Alt+V")).toBeNull();
    expect(tastoStrumento(null)).toBeNull();
    expect(tastoStrumento("")).toBeNull();
  });

  const CATALOGO = [
    { strumento: "selection", tasto: "V" },
    { strumento: "directSelection", tasto: "A" },
    { strumento: "pen", tasto: "P" },
    { strumento: "rectangle", tasto: "M" },
    { strumento: "ellipse", tasto: "L" },
    { strumento: "freeTransform", tasto: "E" },
    { strumento: "blobBrush", tasto: "Shift+B" },
    { strumento: "puppetWarp", tasto: null },
  ];
  const pronti = new Set(["selection", "directSelection", "pen", "rectangle", "ellipse", "blobBrush"]);

  it("ogni strumento pronto risponde al suo tasto, anche dove Fub ha uno strumento con la stessa lettera", () => {
    const scelto = (premuto: string) => strumentoDelTasto(CATALOGO, premuto, (id) => pronti.has(id));
    expect(scelto("v")).toBe("selection");
    expect(scelto("p")).toBe("pen");
    expect(scelto("m")).toBe("rectangle");
    expect(scelto("l")).toBe("ellipse");
    expect(scelto("Shift-b")).toBe("blobBrush");
  });

  it("uno strumento non pronto non prende il tasto, che resta a Fub; un tasto senza strumento è null", () => {
    const scelto = (premuto: string) => strumentoDelTasto(CATALOGO, premuto, (id) => pronti.has(id));
    expect(scelto("e")).toBeNull();
    expect(scelto("x")).toBeNull();
    // Maiusc+V non è V: la lettera nuda e quella con Maiusc sono due tasti.
    expect(scelto("Shift-v")).toBeNull();
  });

  it("due strumenti sullo stesso tasto: vince il primo del catalogo che è pronto", () => {
    const doppi = [
      { strumento: "a", tasto: "K" },
      { strumento: "b", tasto: "K" },
    ];
    expect(strumentoDelTasto(doppi, "k", () => true)).toBe("a");
    expect(strumentoDelTasto(doppi, "k", (id) => id === "b")).toBe("b");
  });
});
