// La prova comune delle tabelle: gli stessi gesti su ogni adattatore danno la
// stessa tabella, la stessa cella attiva e la stessa selezione, dove il
// formato ha la capacità. I casi sono dati; ogni adattatore li esegue nei suoi
// test con un `ConformanceDriver` che sa premere i tasti sulla sua tabella.
//
// Gli adattatori sono di due modi (`keys.ts`): «foglio» (la tabella delle
// note, la cornice, il foglio) e «documento» (le tabelle del docx, dove il
// cursore resta nel testo della cella). Un caso vale in tutti e due, se non
// dice altrimenti (`modes`); dove il gesto non ha senso lo dice col perché
// (`absent`), e la prova lì controlla che non cambi niente.
//
// Nel modo documento il cursore parte alla fine del testo della prima cella,
// e una freccia senza Maiusc che la tabella lascia al testo il driver la
// porta alla fine del testo della cella accanto, come farebbe il browser.
// Il foglio non ha un bordo: i casi che contano sul bordo della tabella
// (`bounded`) lì confrontano soltanto la cella attiva e le celle. Il foglio
// esegue alcuni gesti coi comandi del suo catalogo: lì il caso controlla il
// comando chiesto (`delegated`) invece delle celle.
//
// Qui non si importa il banco di prova: `playCase` ridà ciò che si è visto, e
// il confronto lo fa il test con `expectedOf`.

import type { TableCaps } from "./adapter";
import type { Cell, Range } from "./navigation";

export type ConformanceMode = "sheet" | "document";

export type ConformanceStep =
  /// Un tasto, dove sta il fuoco adesso (la tabella o la cella aperta).
  | { readonly key: string; readonly shift?: boolean; readonly mod?: boolean; readonly code?: string }
  /// Un comando del catalogo, per id.
  | { readonly command: string }
  /// Un gesto degli appunti, con gli appunti finti della prova.
  | { readonly clipboard: "cut" | "copy" | "paste" };

export interface ConformanceCase {
  readonly name: string;
  readonly rows: readonly (readonly string[])[];
  /// I modi in cui il caso vale (di solito tutti e due).
  readonly modes?: readonly ConformanceMode[];
  /// I modi in cui il gesto manca apposta, col perché: lì la prova non lo
  /// salta, controlla che il gesto non cambi niente (`caseAbsence`).
  readonly absent?: Partial<Record<ConformanceMode, string>>;
  /// Le capacità che il caso chiede: senza, l'adattatore lo salta.
  readonly needs?: readonly (keyof Omit<TableCaps, "headerRows">)[];
  /// Il risultato conta sul bordo della tabella: dove non c'è (il foglio) si
  /// confrontano soltanto la cella attiva e le celle, se non dipendono dal
  /// bordo (`cells` resta, `range` no).
  readonly bounded?: boolean;
  /// Il comando del catalogo dei fogli che lo stesso gesto chiede al foglio.
  readonly delegated?: string;
  readonly steps: readonly ConformanceStep[];
  readonly cells?: readonly (readonly string[])[];
  readonly active?: Cell;
  readonly range?: Range;
  /// Le celle segnate dal taglio, o `null` se non ce n'è segno.
  readonly cut?: Range | null;
  /// Quanti intervalli sono scelti.
  readonly ranges?: number;
}

/// Gli appunti finti di una prova: ciò che taglia o copia scrive, l'incolla
/// lo legge.
export interface ConformanceClipboard {
  text: string;
  html: string;
}

/// Ciò che un adattatore offre alla prova.
export interface ConformanceDriver {
  key(name: string, init: { readonly shiftKey: boolean; readonly ctrlKey: boolean; readonly code?: string }): void;
  command(id: string): void;
  /// Manda l'evento degli appunti dove sta il fuoco.
  clipboard?(kind: "cut" | "copy" | "paste", store: ConformanceClipboard): void;
  /// Lascia finire ciò che l'adattatore fa dopo (una promessa, un giro).
  settle?(): Promise<void>;
  cells(): string[][];
  active(): Cell;
  range(): Range;
  cut?(): Range | null;
  ranges?(): number;
  /// I comandi del catalogo che l'adattatore ha chiesto, in ordine.
  asked?(): readonly string[];
}

/// Un adattatore come lo vede la prova.
export interface ConformanceTarget {
  readonly mode: ConformanceMode;
  readonly caps: TableCaps;
  /// La tabella ha un bordo (una nota, un documento); il foglio no.
  readonly bounded: boolean;
  /// L'adattatore esegue i gesti delegati col suo catalogo.
  readonly delegates: boolean;
}

export interface ConformanceResult {
  readonly cells: string[][];
  readonly active: Cell;
  readonly range: Range;
  readonly cut?: Range | null;
  readonly ranges?: number;
  readonly asked?: readonly string[];
}

/// Se l'adattatore `target` può eseguire il caso.
export function caseApplies(test: ConformanceCase, target: TableCaps | ConformanceTarget): boolean {
  const full: ConformanceTarget = "mode" in target ? target : { mode: "sheet", caps: target, bounded: true, delegates: false };
  if (!(test.modes ?? ALL_MODES).includes(full.mode) || test.absent?.[full.mode]) return false;
  if (full.delegates && test.delegated) return true;
  return (test.needs ?? []).every((need) => full.caps[need]);
}

const ALL_MODES: readonly ConformanceMode[] = ["sheet", "document"];

/// Perché il gesto del caso manca apposta in `target`: il modo lo dice
/// (`absent`), o manca una capacità che il caso chiede. `null` se il caso
/// vale, o se è una variante di un altro modo (`modes`).
export function caseAbsence(test: ConformanceCase, target: ConformanceTarget): string | null {
  if (!(test.modes ?? ALL_MODES).includes(target.mode)) return null;
  const reason = test.absent?.[target.mode];
  if (reason) return reason;
  if (target.delegates && test.delegated) return null;
  const missing = (test.needs ?? []).filter((need) => !target.caps[need]);
  return missing.length > 0 ? `il formato non ha la capacità ${missing.join(", ")}` : null;
}

/// Ciò che il test si aspetta da `target`: i campi che lì non contano mancano.
export function expectedOf(test: ConformanceCase, target: ConformanceTarget): Partial<ConformanceResult> {
  if (target.delegates && test.delegated) return { asked: [test.delegated] };
  const loose = test.bounded && !target.bounded;
  return {
    ...(test.cells ? { cells: test.cells.map((row) => [...row]) } : {}),
    ...(test.active ? { active: test.active } : {}),
    ...(test.range && !loose ? { range: test.range } : {}),
    ...(test.cut !== undefined ? { cut: test.cut } : {}),
    ...(test.ranges !== undefined && !loose ? { ranges: test.ranges } : {}),
  };
}

/// Ciò che si è visto, ridotto ai campi che il test si aspetta.
export function seenOf(seen: ConformanceResult, expected: Partial<ConformanceResult>): Partial<ConformanceResult> {
  return Object.fromEntries(Object.keys(expected).map((name) => [name, seen[name as keyof ConformanceResult]]));
}

export async function playCase(test: ConformanceCase, driver: ConformanceDriver): Promise<ConformanceResult> {
  const store: ConformanceClipboard = { text: "", html: "" };
  for (const step of test.steps) {
    if ("command" in step) driver.command(step.command);
    else if ("clipboard" in step) {
      if (!driver.clipboard) throw new Error(`l'adattatore non sa ${step.clipboard}`);
      driver.clipboard(step.clipboard, store);
    } else {
      driver.key(step.key, { shiftKey: step.shift ?? false, ctrlKey: step.mod ?? false, ...(step.code ? { code: step.code } : {}) });
    }
    await driver.settle?.();
  }
  return {
    cells: driver.cells(),
    active: driver.active(),
    range: driver.range(),
    ...(driver.cut ? { cut: driver.cut() } : {}),
    ...(driver.ranges ? { ranges: driver.ranges() } : {}),
    ...(driver.asked ? { asked: [...driver.asked()] } : {}),
  };
}

const ROWS = [["Nome", "Voto"], ["Ada", "10"], ["Bea", "9"]] as const;
/// Una tabella di tre colonne, per le righe intere.
const WIDE = [["Nome", "Voto", "Nota"], ["Ada", "10", "bene"], ["Bea", "9", "ok"]] as const;
/// Una tabella coi buchi, per il bordo dei dati.
const HOLES = [["Nome", "Voto"], ["Ada", ""], ["", "9"], ["Cleo", "7"]] as const;

/// Nel documento Ctrl con una freccia è del testo.
const WORD_JUMP = "nel testo Ctrl con una freccia salta di parola: nel documento non va al bordo dei dati";
/// Nel documento non c'è una cella aperta.
const IN_TEXT = "il cursore è già nel testo della cella: non c'è una cella da aprire, riscrivere o annullare";

export const TABLE_CONFORMANCE: readonly ConformanceCase[] = [
  {
    name: "le frecce muovono la cella attiva, Maiusc allarga",
    rows: ROWS,
    steps: [{ key: "ArrowDown" }, { key: "ArrowRight", shift: true }, { key: "ArrowDown", shift: true }],
    range: { r0: 1, c0: 0, r1: 2, c1: 1 },
  },
  {
    name: "Ctrl con una freccia va al bordo",
    absent: { document: WORD_JUMP },
    rows: ROWS,
    steps: [{ key: "ArrowDown", mod: true }, { key: "ArrowRight", mod: true }],
    active: { row: 2, column: 1 },
  },
  {
    name: "Ctrl con una freccia si ferma al bordo dei dati",
    absent: { document: WORD_JUMP },
    rows: HOLES,
    steps: [{ key: "ArrowDown", mod: true }],
    active: { row: 1, column: 0 },
  },
  {
    name: "Ctrl con una freccia da una cella in fondo ai dati salta alla prima piena",
    absent: { document: WORD_JUMP },
    rows: HOLES,
    steps: [{ key: "ArrowDown", mod: true }, { key: "ArrowDown", mod: true }],
    active: { row: 3, column: 0 },
  },
  {
    name: "un carattere riscrive la cella, Invio conferma e scende",
    absent: { document: IN_TEXT },
    rows: ROWS,
    steps: [{ key: "ArrowDown" }, { key: "Z" }, { key: "Enter" }],
    cells: [["Nome", "Voto"], ["Z", "10"], ["Bea", "9"]],
    active: { row: 2, column: 0 },
  },
  {
    name: "Esc annulla la cella aperta",
    absent: { document: IN_TEXT },
    rows: ROWS,
    steps: [{ key: "ArrowDown" }, { key: "F2" }, { key: "Escape" }],
    cells: [["Nome", "Voto"], ["Ada", "10"], ["Bea", "9"]],
    active: { row: 1, column: 0 },
  },
  {
    name: "Tab conferma la cella e va avanti lungo la riga",
    absent: { document: IN_TEXT },
    rows: ROWS,
    steps: [{ key: "ArrowDown" }, { key: "Q" }, { key: "Tab" }],
    cells: [["Nome", "Voto"], ["Q", "10"], ["Bea", "9"]],
    active: { row: 1, column: 1 },
  },
  {
    name: "Tab dall'ultima cella aggiunge una riga",
    // Nel documento Ctrl+Fine va alla fine del documento: c'è la variante
    // «documento: Tab dall'ultima cella aggiunge una riga».
    modes: ["sheet"],
    needs: ["insertRows"],
    bounded: true,
    rows: ROWS,
    steps: [{ key: "End", mod: true }, { key: "Tab" }],
    cells: [["Nome", "Voto"], ["Ada", "10"], ["Bea", "9"], ["", ""]],
    active: { row: 3, column: 0 },
  },
  {
    name: "Canc svuota la selezione",
    rows: ROWS,
    steps: [{ key: "ArrowDown" }, { key: "ArrowRight", shift: true }, { key: "Delete" }],
    cells: [["Nome", "Voto"], ["", ""], ["Bea", "9"]],
  },
  {
    // Nel documento Maiusc+Spazio senza celle scelte scrive uno spazio.
    name: "Maiusc+Spazio sceglie la riga",
    bounded: true,
    rows: WIDE,
    steps: [{ key: "ArrowDown" }, { key: "ArrowRight", shift: true }, { key: " ", shift: true, code: "Space" }],
    active: { row: 1, column: 0 },
    range: { r0: 1, c0: 0, r1: 1, c1: 2 },
  },
  {
    name: "Ctrl+Spazio sceglie la colonna",
    bounded: true,
    rows: ROWS,
    steps: [{ key: "ArrowRight" }, { key: " ", mod: true, code: "Space" }],
    range: { r0: 0, c0: 1, r1: 2, c1: 1 },
  },
  {
    name: "Ctrl+Maiusc+Spazio sceglie la tabella",
    bounded: true,
    rows: ROWS,
    steps: [{ key: " ", shift: true, mod: true, code: "Space" }],
    range: { r0: 0, c0: 0, r1: 2, c1: 1 },
  },
  {
    name: "con più celle scelte Invio gira dentro la selezione",
    rows: ROWS,
    steps: [{ key: "ArrowDown" }, { key: "ArrowDown", shift: true }, { key: "Enter" }],
    cells: [["Nome", "Voto"], ["Ada", "10"], ["Bea", "9"]],
    active: { row: 2, column: 0 },
    range: { r0: 1, c0: 0, r1: 2, c1: 0 },
  },
  {
    name: "con più celle scelte Tab gira dentro la selezione",
    rows: ROWS,
    steps: [{ key: "ArrowDown" }, { key: "ArrowRight", shift: true }, { key: "Tab" }],
    active: { row: 1, column: 1 },
    range: { r0: 1, c0: 0, r1: 1, c1: 1 },
  },
  {
    name: "il taglio segna le celle e non le svuota",
    rows: ROWS,
    steps: [{ key: "ArrowDown" }, { key: "ArrowRight", shift: true }, { clipboard: "cut" }],
    cells: [["Nome", "Voto"], ["Ada", "10"], ["Bea", "9"]],
    cut: { r0: 1, c0: 0, r1: 1, c1: 1 },
  },
  {
    name: "Esc toglie il segno del taglio",
    rows: ROWS,
    steps: [{ key: "ArrowDown" }, { key: "ArrowRight", shift: true }, { clipboard: "cut" }, { key: "Escape" }],
    cells: [["Nome", "Voto"], ["Ada", "10"], ["Bea", "9"]],
    cut: null,
  },
  {
    name: "l'incolla dopo il taglio sposta le celle in un passo",
    rows: ROWS,
    steps: [{ key: "ArrowDown" }, { key: "ArrowRight", shift: true }, { clipboard: "cut" }, { key: "ArrowDown" }, { clipboard: "paste" }],
    cells: [["Nome", "Voto"], ["", ""], ["Ada", "10"]],
    active: { row: 2, column: 0 },
    cut: null,
  },
  {
    name: "Ctrl+D riempie in giù dalla prima riga scelta",
    delegated: "edit.fillDown",
    rows: ROWS,
    steps: [{ key: "ArrowDown" }, { key: "ArrowDown", shift: true }, { key: "d", mod: true, code: "KeyD" }],
    cells: [["Nome", "Voto"], ["Ada", "10"], ["Ada", "9"]],
  },
  {
    name: "Ctrl+R riempie a destra dalla prima colonna scelta",
    delegated: "edit.fillRight",
    rows: ROWS,
    steps: [{ key: "ArrowDown" }, { key: "ArrowRight", shift: true }, { key: "r", mod: true, code: "KeyR" }],
    cells: [["Nome", "Voto"], ["Ada", "Ada"], ["Bea", "9"]],
  },
  {
    name: "Ctrl+«+» su una riga intera inserisce una riga prima",
    needs: ["insertRows"],
    delegated: "home.insertRows",
    rows: ROWS,
    steps: [{ key: "ArrowDown" }, { key: "ArrowRight", shift: true }, { key: " ", shift: true, code: "Space" }, { key: "+", mod: true, shift: true, code: "Equal" }],
    cells: [["Nome", "Voto"], ["", ""], ["Ada", "10"], ["Bea", "9"]],
    active: { row: 1, column: 0 },
  },
  {
    name: "Ctrl+«−» su una riga intera la toglie",
    needs: ["deleteRows"],
    delegated: "home.deleteRows",
    rows: ROWS,
    steps: [{ key: "ArrowDown" }, { key: "ArrowRight", shift: true }, { key: " ", shift: true, code: "Space" }, { key: "-", mod: true, code: "Minus" }],
    cells: [["Nome", "Voto"], ["Bea", "9"]],
  },
  {
    name: "Ctrl+«+» su una colonna intera inserisce una colonna",
    needs: ["insertColumns"],
    delegated: "home.insertColumns",
    rows: ROWS,
    steps: [{ key: "ArrowRight" }, { key: " ", mod: true, code: "Space" }, { key: "+", mod: true, shift: true, code: "Equal" }],
    cells: [["Nome", "", "Voto"], ["Ada", "", "10"], ["Bea", "", "9"]],
  },
  {
    name: "Maiusc+F8 aggiunge un intervallo, e Canc li svuota tutti",
    rows: ROWS,
    steps: [{ key: "ArrowDown" }, { key: "F8", shift: true }, { key: "ArrowDown" }, { key: "ArrowRight" }, { key: "Delete" }],
    cells: [["Nome", "Voto"], ["", "10"], ["Bea", ""]],
    ranges: 2,
  },
  {
    name: "una riga sotto, e la selezione ci va",
    needs: ["insertRows"],
    rows: ROWS,
    steps: [{ key: "ArrowDown" }, { command: "markdown.table.row.after" }],
    cells: [["Nome", "Voto"], ["Ada", "10"], ["", ""], ["Bea", "9"]],
    active: { row: 2, column: 0 },
  },
  {
    name: "la riga d'intestazione non si sposta né si ordina",
    needs: ["moveRows", "sort"],
    rows: ROWS,
    steps: [{ command: "markdown.table.row.down" }, { key: "ArrowRight" }, { command: "markdown.table.sort.ascending" }],
    cells: [["Nome", "Voto"], ["Bea", "9"], ["Ada", "10"]],
  },
  {
    name: "una colonna spostata a sinistra porta con sé la selezione",
    needs: ["moveColumns"],
    rows: ROWS,
    steps: [{ key: "ArrowRight" }, { command: "markdown.table.column.left" }],
    cells: [["Voto", "Nome"], ["10", "Ada"], ["9", "Bea"]],
    active: { row: 0, column: 0 },
  },
  // ── Le varianti del modo «documento»: le frecce restano del testo finché
  // non escono dalla cella, e Ctrl+Z annulla un gesto in un passo.
  {
    name: "documento: Tab va alla cella dopo",
    modes: ["document"],
    rows: ROWS,
    steps: [{ key: "Tab" }],
    cells: [["Nome", "Voto"], ["Ada", "10"], ["Bea", "9"]],
    active: { row: 0, column: 1 },
  },
  {
    name: "documento: Tab dall'ultima cella aggiunge una riga",
    modes: ["document"],
    rows: ROWS,
    steps: [{ key: "Tab" }, { key: "Tab" }, { key: "Tab" }, { key: "Tab" }, { key: "Tab" }, { key: "Tab" }],
    cells: [["Nome", "Voto"], ["Ada", "10"], ["Bea", "9"], ["", ""]],
    active: { row: 3, column: 0 },
  },
  {
    name: "documento: Maiusc con una freccia che esce dalla cella sceglie le celle",
    modes: ["document"],
    rows: ROWS,
    steps: [{ key: "ArrowRight", shift: true }, { key: "ArrowDown", shift: true }],
    range: { r0: 0, c0: 0, r1: 1, c1: 1 },
  },
  {
    name: "documento: Canc svuota le celle scelte",
    modes: ["document"],
    rows: ROWS,
    steps: [{ key: "ArrowDown", shift: true }, { key: "Delete" }],
    cells: [["", "Voto"], ["", "10"], ["Bea", "9"]],
  },
  {
    name: "documento: Ctrl+Z annulla in un passo una riga inserita",
    modes: ["document"],
    rows: ROWS,
    steps: [
      { key: "ArrowDown" }, { key: "ArrowRight", shift: true }, { key: " ", shift: true, code: "Space" },
      { key: "+", mod: true, shift: true, code: "Equal" }, { key: "z", mod: true, code: "KeyZ" },
    ],
    cells: [["Nome", "Voto"], ["Ada", "10"], ["Bea", "9"]],
  },
  {
    name: "documento: Ctrl+Z annulla in un passo un riempimento",
    modes: ["document"],
    rows: ROWS,
    steps: [{ key: "ArrowDown" }, { key: "ArrowDown", shift: true }, { key: "d", mod: true, code: "KeyD" }, { key: "z", mod: true, code: "KeyZ" }],
    cells: [["Nome", "Voto"], ["Ada", "10"], ["Bea", "9"]],
  },
  {
    name: "documento: Ctrl+Z annulla in un passo un taglio incollato",
    modes: ["document"],
    rows: ROWS,
    steps: [
      { key: "ArrowDown" }, { key: "ArrowRight", shift: true }, { clipboard: "cut" },
      { key: "ArrowDown" }, { clipboard: "paste" }, { key: "z", mod: true, code: "KeyZ" },
    ],
    cells: [["Nome", "Voto"], ["Ada", "10"], ["Bea", "9"]],
  },
];
