import { describe, expect, it } from "vitest";
import samples from "../__fixtures__/mirror-samples.json";
import {
  gridJournalEntry,
  gridJournalReverted,
  gridJournalText,
  parseGridJournal,
  popGridCommand,
  pushGridCommand,
  rebaseGridJournalText,
  recordGridJournal,
  type GridCommand,
  type GridJournal,
} from "./grid-journal";

const CASES = (
  samples as {
    GridJournalRebase: {
      current: string;
      saved: string;
      rebased: string;
      reverted: number;
    }[];
  }
).GridJournalRebase;

function one(before: string, after: string, row = "r0"): string {
  return gridJournalText({
    entries: [{ sheet: "s1", row, column: "c0", before, after }],
    commands: [],
  });
}

function command(id: string, params = "{}"): GridCommand {
  return { id, params, sheet: "s1", selection: "A1:B2", active: "A1" };
}

describe("giornale della griglia", () => {
  it("riporta un giornale sui byte salvati come GridJournal::rebase", () => {
    expect(CASES.length).toBeGreaterThan(0);
    for (const { current, saved, rebased, reverted } of CASES) {
      expect(rebaseGridJournalText(current, saved)).toBe(rebased);
      expect(gridJournalReverted(parseGridJournal(current), parseGridJournal(saved))).toBe(reverted);
    }
    expect(CASES.some((sample) => sample.reverted > 0)).toBe(true);
  });

  it("rilegge ogni testo della fixture e lo riscrive byte per byte", () => {
    for (const text of CASES.flatMap((sample) => [sample.current, sample.saved, sample.rebased])) {
      expect(gridJournalText(parseGridJournal(text))).toBe(text);
    }
  });

  it("ordina le chiavi come byte, non come numeri", () => {
    const journal: GridJournal = parseGridJournal(CASES[1].current);
    expect(journal.entries.map((entry) => entry.row)).toEqual(["r0", "r10", "r2"]);
    expect(gridJournalEntry(journal, { sheet: "s1", row: "r10", column: "c1" })?.after).toBe("x");
  });

  it("rifiuta un testo che non è nella forma canonica", () => {
    const canonical = one("1", "2");
    expect(parseGridJournal(canonical).entries).toHaveLength(1);
    const rejected = [
      " ",
      canonical.replace(`"version":1,`, "").replace("{", `{"version":1,`).replace(`"cells"`, ` "cells"`),
      `{"cells":[],"version":1}`,
      `{"version":1,"cells":[]}`,
      `{"version":2,"cells":[{"sheet":"s1","row":"r0","column":"c0","before":"1","after":"2"}]}`,
      one("1", "1"),
      `{"version":1,"cells":[{"sheet":"s1","row":"r2","column":"c0","before":"","after":"a"},{"sheet":"s1","row":"r10","column":"c0","before":"","after":"b"}]}`,
      `{"version":1,"cells":[{"sheet":"s1","row":"r0","column":"c0","before":"","after":"a"},{"sheet":"s1","row":"r0","column":"c0","before":"","after":"b"}]}`,
      `{"version":1,"cells":[{"sheet":"s 1","row":"r0","column":"c0","before":"","after":"a"}]}`,
      `{"version":1,"cells":[{"row":"r0","sheet":"s1","column":"c0","before":"","after":"a"}]}`,
      `{"version":1,"cells":[{"sheet":"s1","row":"r0","column":"c0","before":"","after":"\\ud800"}]}`,
      `{"version":1,"cells":[{"sheet":"s1","row":"r0","column":"c0","before":"","after":"\\u00e8"}]}`,
    ];
    for (const text of rejected) expect(() => parseGridJournal(text), text).toThrow(TypeError);
  });

  it("toglie le voci salvate e riporta sul disco una cella tornata indietro", () => {
    const saved = one("1", "2");
    expect(rebaseGridJournalText(saved, saved)).toBe("");
    expect(rebaseGridJournalText(one("1", "3"), saved)).toBe(one("2", "3"));
    expect(rebaseGridJournalText("", saved)).toBe(one("2", "1"));
  });

  it("registra una cella tenendo l'input del file, e la toglie se ci torna", () => {
    const key = { sheet: "s1", row: "r0", column: "c0" };
    const first = recordGridJournal(parseGridJournal(""), key, "1", "2");
    expect(gridJournalText(first)).toBe(one("1", "2"));
    const second = recordGridJournal(first, key, "2", "3");
    expect(gridJournalText(second)).toBe(one("1", "3"));
    expect(gridJournalText(recordGridJournal(second, key, "3", "1"))).toBe("");
    expect(() => recordGridJournal(first, { ...key, row: "r 0" }, "", "x")).toThrow(TypeError);
  });

  it("aggiunge e toglie comandi, con i parametri come testo intatto", () => {
    const first = pushGridCommand(parseGridJournal(""), command("home.bold"));
    const second = pushGridCommand(first, command("cell.set", '{"input":"=\\"è\\""}'));
    const text = gridJournalText(second);
    expect(text).toBe(
      '{"version":2,"commands":[{"id":"home.bold","params":"{}","sheet":"s1","selection":"A1:B2","active":"A1"},' +
        '{"id":"cell.set","params":"{\\"input\\":\\"=\\\\\\"è\\\\\\"\\"}","sheet":"s1","selection":"A1:B2","active":"A1"}]}',
    );
    expect(parseGridJournal(text)).toEqual(second);
    expect(gridJournalText(popGridCommand(second))).toBe(gridJournalText(first));
    expect(gridJournalText(popGridCommand(first))).toBe("");
  });

  it("rifiuta un comando non valido, e celle e comandi insieme", () => {
    const empty = parseGridJournal("");
    for (const wrong of [
      command(""),
      command("a", "[]"),
      command("a", "nope"),
      { ...command("a"), active: "A1:B2" },
      { ...command("a"), selection: "A 1" },
      command("a", `{"x":"${"a".repeat(64 * 1024)}"}`),
    ]) {
      expect(() => pushGridCommand(empty, wrong), JSON.stringify(wrong).slice(0, 80)).toThrow(TypeError);
    }
    const cells = parseGridJournal(one("1", "2"));
    expect(() => pushGridCommand(cells, command("home.bold"))).toThrow(TypeError);
    const commands = pushGridCommand(empty, command("home.bold"));
    expect(() => recordGridJournal(commands, { sheet: "s1", row: "r0", column: "c0" }, "1", "2")).toThrow(TypeError);
    for (const text of [
      `{"version":2,"commands":[]}`,
      `{"commands":[{"id":"a","params":"{}","sheet":"s1","selection":"A1","active":"A1"}],"version":2}`,
      `{"version":2,"commands":[{"id":"a","params":"{}","sheet":"s1","selection":"A1","active":"A1"}],"cells":[]}`,
      `{"version":2,"commands":[{"id":"a","params":"{}","sheet":"s1","selection":"A1","active":"A1","x":1}]}`,
    ]) {
      expect(() => parseGridJournal(text), text).toThrow(TypeError);
    }
  });
});
