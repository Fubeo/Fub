// La regola del promemoria vista dalla Live (T36): il tratto che la
// pastiglia sostituisce, la scrittura del `⏰` e il promemoria detto a parole.
// La regola stessa (dove sta l'ultimo `⏰`, che cosa si legge) ha la sua
// gemella provata contro il contratto in `rules/rules-mirror.test.ts`.
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { markdownGrammar } from "./grammar";
import { computeDecorations } from "./livepreview";
import {
  reminderLabel,
  reminderPassed,
  reminderSource,
  reminderTaskAt,
  saidReminder,
  writeReminder,
} from "./task-reminder";

// Mercoledì 18 novembre 2026, alle dieci.
const NOW = new Date(2026, 10, 18, 10, 0);

function stateOf(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdown({ base: markdownGrammar })] });
}

function written(doc: string, when: { date: string; time: string } | null, line = 1): string {
  const state = stateOf(doc);
  const task = reminderTaskAt(state, state.doc.line(line).from);
  if (!task) throw new Error("la riga non è un compito");
  const spec = writeReminder(state, task, when);
  return spec ? state.update(spec).state.doc.toString() : doc;
}

describe("il promemoria detto a parole", () => {
  it("un giorno e un'ora, con le parole delle date", () => {
    expect(saidReminder("venerdì 9", NOW)).toEqual({ date: "2026-11-20", time: "09:00" });
    expect(saidReminder("domani alle 18:30", NOW)).toEqual({ date: "2026-11-19", time: "18:30" });
    expect(saidReminder("domani 18.30", NOW)).toEqual({ date: "2026-11-19", time: "18:30" });
    expect(saidReminder("friday at 7", NOW, 1, "en")).toEqual({ date: "2026-11-20", time: "07:00" });
    expect(saidReminder("2026-12-01 08:15", NOW)).toEqual({ date: "2026-12-01", time: "08:15" });
  });

  it("senza ora suona alle nove; senza giorno è oggi", () => {
    expect(saidReminder("domani", NOW)).toEqual({ date: "2026-11-19", time: "09:00" });
    expect(saidReminder("alle 17", NOW)).toEqual({ date: "2026-11-18", time: "17:00" });
    expect(saidReminder("17:45", NOW)).toEqual({ date: "2026-11-18", time: "17:45" });
  });

  it("ciò che non è un giorno o un'ora non si indovina", () => {
    expect(saidReminder("", NOW)).toBeNull();
    expect(saidReminder("venerdì 25", NOW)).toBeNull();
    expect(saidReminder("venerdì 9:75", NOW)).toBeNull();
    expect(saidReminder("quando capita", NOW)).toBeNull();
  });
});

describe("la pastiglia dice l'ora, e il giorno se non è oggi", () => {
  it("oggi l'ora sola; un altro giorno il giorno breve; un altro anno anche l'anno", () => {
    expect(reminderLabel({ date: "2026-11-18", time: "15:30" }, NOW, "it")).toBe("15:30");
    expect(reminderLabel({ date: "2026-11-13", time: "09:00" }, NOW, "it")).toBe("ven 13 nov, 09:00");
    expect(reminderLabel({ date: "2027-01-04", time: "09:00" }, NOW, "it")).toMatch(/^lun 4 gen 2027, 09:00$/);
  });

  it("è passato quando la sua ora è arrivata", () => {
    expect(reminderPassed({ date: "2026-11-18", time: "10:00" }, NOW)).toBe(true);
    expect(reminderPassed({ date: "2026-11-18", time: "10:01" }, NOW)).toBe(false);
    expect(reminderPassed({ date: "2026-11-13", time: "09:00" }, NOW)).toBe(true);
  });
});

describe("la Live: la pastiglia al posto del testo, il testo col cursore dentro", () => {
  const doc = "Titolo\n\n- [ ] Chiama Anna ⏰ 2026-11-13 09:00\n";
  const at = doc.indexOf("⏰");

  it("fuori dal cursore il tratto del `⏰` è la pastiglia, con lo stato e l'ora", () => {
    const decorations = computeDecorations(stateOf(doc), new Set([1]));
    const pill = decorations.filter((d) => d.kind === "task-reminder");
    expect(pill).toEqual([{ from: at, to: doc.indexOf("\n", at), kind: "task-reminder", data: "open 2026-11-13 09:00" }]);
  });

  it("col cursore sulla riga il testo resta, segnato", () => {
    const decorations = computeDecorations(stateOf(doc), new Set([3]));
    expect(decorations.some((d) => d.kind === "task-reminder")).toBe(false);
    expect(decorations.filter((d) => d.kind === "task-reminder-source").map((d) => doc.slice(d.from, d.to)))
      .toEqual(["⏰ 2026-11-13 09:00"]);
  });

  it("un compito fatto ha la pastiglia grigia; un promemoria che non si legge resta testo, segnato", () => {
    const done = "- [x] Chiama ⏰ 2026-11-13\n";
    expect(computeDecorations(stateOf(done), new Set()).find((d) => d.kind === "task-reminder")?.data)
      .toBe("done 2026-11-13 09:00");
    const bad = "- [ ] Chiama ⏰ 2026-02-30 09:00\n";
    const decorations = computeDecorations(stateOf(bad), new Set());
    expect(decorations.some((d) => d.kind === "task-reminder")).toBe(false);
    expect(decorations.find((d) => d.kind === "task-reminder-source")?.data).toBe("bad ");
  });

  it("fuori da un compito il `⏰` è testo", () => {
    const decorations = computeDecorations(stateOf("- Chiama ⏰ 2026-11-13 09:00\n\nChiama ⏰ 2026-11-13\n"), new Set());
    expect(decorations.some((d) => d.kind === "task-reminder" || d.kind === "task-reminder-source")).toBe(false);
  });

  it("la scadenza e il promemoria hanno ognuno la sua pastiglia", () => {
    const both = "- [ ] Chiama 📅 2026-11-20 ⏰ 2026-11-19 18:00\n";
    const kinds = computeDecorations(stateOf(both), new Set()).map((d) => d.kind);
    expect(kinds).toContain("task-due");
    expect(kinds).toContain("task-reminder");
  });
});

describe("la scrittura del promemoria", () => {
  it("in fondo al testo del compito, nella forma che l'indice legge", () => {
    expect(reminderSource({ date: "2026-11-20", time: "09:00" })).toBe("⏰ 2026-11-20 09:00");
    expect(written("- [ ] Chiama Anna  \n", { date: "2026-11-20", time: "09:00" }))
      .toBe("- [ ] Chiama Anna ⏰ 2026-11-20 09:00\n");
    expect(written("- [ ] Chiama 📅 2026-11-21\n", { date: "2026-11-20", time: "09:00" }))
      .toBe("- [ ] Chiama 📅 2026-11-21 ⏰ 2026-11-20 09:00\n");
  });

  it("al posto di quello che c'è, anche senza ora o illeggibile", () => {
    expect(written("- [ ] Chiama ⏰ 2026-11-13 09:00 subito\n", { date: "2026-11-20", time: "18:30" }))
      .toBe("- [ ] Chiama ⏰ 2026-11-20 18:30 subito\n");
    expect(written("- [ ] Chiama ⏰ 2026-11-13\n", { date: "2026-11-20", time: "18:30" }))
      .toBe("- [ ] Chiama ⏰ 2026-11-20 18:30\n");
    expect(written("- [ ] Chiama ⏰ 2026-02-30\n", { date: "2026-11-20", time: "18:30" }))
      .toBe("- [ ] Chiama ⏰ 2026-11-20 18:30\n");
  });

  it("toglierlo toglie anche lo spazio prima; senza promemoria non scrive", () => {
    expect(written("- [ ] Chiama ⏰ 2026-11-13 09:00\n", null)).toBe("- [ ] Chiama\n");
    expect(written("- [ ] Chiama\n", null)).toBe("- [ ] Chiama\n");
  });

  it("il compito si riconosce anche in una citazione e in una sottovoce", () => {
    expect(written("> - [ ] Chiama\n", { date: "2026-11-20", time: "09:00" })).toBe("> - [ ] Chiama ⏰ 2026-11-20 09:00\n");
    expect(written("- voce\n  - [ ] Chiama\n", { date: "2026-11-20", time: "09:00" }, 2))
      .toBe("- voce\n  - [ ] Chiama ⏰ 2026-11-20 09:00\n");
    expect(reminderTaskAt(stateOf("Chiama\n"), 0)).toBeNull();
  });
});
