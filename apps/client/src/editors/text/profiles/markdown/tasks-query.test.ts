import { describe, expect, it } from "vitest";
import type { QueryExpr, QueryPredicate } from "../../../../host/contract";
import { parseSearch } from "../../../../rules/search-syntax";
import {
  dueIsNear,
  localDay,
  shiftDay,
  taskDue,
  taskMatches,
  tasksOf,
  translateTasksQuery,
  type TaskFilter,
} from "./tasks-query";

const TODAY = "2026-11-14";

/// La ricerca tradotta, letta dalla barra come la legge il recinto.
function parsed(search: string): QueryExpr {
  const result = parseSearch(search, true);
  if ("fault" in result) throw new Error(`la barra non legge «${search}»: ${result.fault.kind}`);
  return result.ok;
}

/// Le foglie di una ricerca a una clausola.
function leaves(search: string): QueryPredicate[] {
  const expr = parsed(search);
  expect(expr.any).toHaveLength(1);
  return expr.any[0]!.all.map((literal) => literal.predicate);
}

describe("le righe del plugin Tasks nella ricerca", () => {
  it("not done chiede i compiti da fare", () => {
    const query = translateTasksQuery("not done", TODAY);
    expect(query.search).toBe("task:todo");
    expect(query.filter.status).toBe("open");
    expect(query.skipped).toEqual([]);
    expect(leaves(query.search)).toEqual([{ kind: "task", status: "open" }]);
  });

  it("done chiede i compiti fatti", () => {
    const query = translateTasksQuery("done", TODAY);
    expect(query.search).toBe("task:done");
    expect(query.filter.status).toBe("done");
    expect(leaves(query.search)).toEqual([{ kind: "task", status: "done" }]);
  });

  it("due before è una scadenza prima del giorno, escluso", () => {
    const query = translateTasksQuery("not done\ndue before 2026-11-20", TODAY);
    expect(query.search).toBe("task:todo due:<2026-11-20");
    expect(query.filter.due).toEqual([{ op: "before", day: "2026-11-20" }]);
    expect(leaves(query.search)[1]).toEqual({ kind: "task_due", min: null, max: { date: "2026-11-20", inclusive: false } });
  });

  it("due after è una scadenza dopo il giorno, escluso", () => {
    const query = translateTasksQuery("due after 2026-11-20\nnot done", TODAY);
    expect(query.search).toBe("due:>2026-11-20 task:todo");
    expect(leaves(query.search)[0]).toEqual({ kind: "task_due", min: { date: "2026-11-20", inclusive: false }, max: null });
  });

  it("due on, e due da solo, sono quel giorno", () => {
    for (const line of ["due on 2026-11-20", "due 2026-11-20", "DUE ON 2026-11-20"]) {
      const query = translateTasksQuery(`not done\n${line}`, TODAY);
      expect(query.search).toBe("task:todo due:2026-11-20");
      expect(query.filter.due).toEqual([{ op: "on", day: "2026-11-20" }]);
      expect(leaves(query.search)[1]).toEqual({
        kind: "task_due",
        min: { date: "2026-11-20", inclusive: true },
        max: { date: "2026-11-20", inclusive: true },
      });
    }
  });

  it("today, tomorrow e yesterday sono i giorni di chi guarda", () => {
    expect(translateTasksQuery("due before today", TODAY).filter.due).toEqual([{ op: "before", day: TODAY }]);
    expect(translateTasksQuery("due on tomorrow", TODAY).filter.due).toEqual([{ op: "on", day: "2026-11-15" }]);
    expect(translateTasksQuery("due after yesterday", TODAY).filter.due).toEqual([{ op: "after", day: "2026-11-13" }]);
    // Il cambio di mese e d'anno.
    expect(translateTasksQuery("due on tomorrow", "2026-12-31").filter.due).toEqual([{ op: "on", day: "2027-01-01" }]);
  });

  it("path includes è il percorso che contiene il testo", () => {
    const query = translateTasksQuery("not done\npath includes Progetti", TODAY);
    expect(query.search).toBe("task:todo path:Progetti");
    expect(leaves(query.search)[1]).toEqual({ kind: "path", glob: "**Progetti**" });
    const spaced = translateTasksQuery("not done\npath includes Mostra di primavera", TODAY);
    expect(spaced.search).toBe('task:todo path:"Mostra di primavera"');
    expect(leaves(spaced.search)[1]).toEqual({ kind: "path", glob: "**Mostra di primavera**" });
  });

  it("tag includes è il tag, col # o senza", () => {
    for (const line of ["tag includes #casa", "tag includes casa", "tags include #casa"]) {
      const query = translateTasksQuery(`not done\n${line}`, TODAY);
      expect(query.search).toBe("task:todo tag:casa");
      expect(query.filter.tags).toEqual(["casa"]);
      expect(leaves(query.search)[1]).toEqual({ kind: "tag", name: "casa", descendants: true });
    }
  });

  it("una riga sconosciuta si mostra e si salta, senza rompere le altre", () => {
    const query = translateTasksQuery("not done\nsort by due\n\n# un commento\ndue before someday\npath includes a", TODAY);
    expect(query.search).toBe("task:todo path:a");
    expect(query.skipped).toEqual([
      { line: 2, text: "sort by due" },
      { line: 5, text: "due before someday" },
    ]);
    expect(leaves(query.search)).toHaveLength(2);
  });

  it("senza una riga sullo stato chiede le note che hanno compiti, fatti o da fare", () => {
    const query = translateTasksQuery("path includes Progetti", TODAY);
    expect(query.search).toBe("(task:todo OR task:done) path:Progetti");
    expect(query.filter.status).toBeNull();
    const expr = parsed(query.search);
    expect(expr.any.map((clause) => clause.all.map((literal) => literal.predicate.kind))).toEqual([
      ["task", "path"],
      ["task", "path"],
    ]);
  });

  it("un recinto vuoto o di soli commenti non salta niente", () => {
    expect(translateTasksQuery("", TODAY)).toEqual({ search: "(task:todo OR task:done)", filter: { status: null, due: [], tags: [] }, skipped: [] });
    expect(translateTasksQuery("# solo un commento\n  \n", TODAY).skipped).toEqual([]);
  });
});

describe("la scadenza di una riga", () => {
  it("è la parola dopo l'ultimo 📅", () => {
    expect(taskDue("Chiedere il preventivo 📅 2026-11-18")).toEqual({ from: 23, to: 36, day: "2026-11-18" });
    const text = "Rimandato 📅 2026-11-01 poi 📅 2026-11-20 🔁 every week";
    const due = taskDue(text)!;
    expect(due.day).toBe("2026-11-20");
    expect(text.slice(due.from, due.to)).toBe("📅 2026-11-20");
  });

  it("senza 📅 non c'è", () => {
    expect(taskDue("Un compito senza data")).toBeNull();
  });

  it("una data che non esiste resta una scadenza senza giorno", () => {
    expect(taskDue("Refuso 📅 2026-02-30")?.day).toBeNull();
    expect(taskDue("Parola 📅 domani")?.day).toBeNull();
    expect(taskDue("Bisestile 📅 2028-02-29")?.day).toBe("2028-02-29");
  });

  it("è vicina se è passata o entro sette giorni", () => {
    expect(dueIsNear("2026-11-10", TODAY)).toBe(true);
    expect(dueIsNear(TODAY, TODAY)).toBe(true);
    expect(dueIsNear("2026-11-20", TODAY)).toBe(true);
    expect(dueIsNear("2026-11-21", TODAY)).toBe(false);
  });

  it("il giorno di oggi è quello del fuso della macchina", () => {
    expect(localDay(new Date(2026, 10, 14, 23, 59))).toBe("2026-11-14");
    expect(localDay(new Date(2026, 10, 15, 0, 0))).toBe("2026-11-15");
    expect(shiftDay("2026-03-28", 2)).toBe("2026-03-30");
  });
});

describe("i compiti di una nota", () => {
  const source = [
    "# Mostra",
    "",
    "- [ ] Chiedere il preventivo per le cornici 📅 2026-11-13 #lavoro",
    "- [x] Scegliere la sala",
    "  - [/] Più giù, in corso 📅 2026-12-01",
    "> - [ ] Dentro una citazione",
    "",
    "```",
    "- [ ] non è un compito",
    "```",
    "",
    "Perché è già così: - [ ] neanche questo",
  ].join("\n");

  it("li dice la grammatica, col posto del simbolo in code unit e in byte", () => {
    const tasks = tasksOf(source);
    expect(tasks.map((task) => [task.symbol, task.text])).toEqual([
      [" ", "Chiedere il preventivo per le cornici 📅 2026-11-13 #lavoro"],
      ["x", "Scegliere la sala"],
      ["/", "Più giù, in corso 📅 2026-12-01"],
      [" ", "Dentro una citazione"],
    ]);
    for (const task of tasks) expect(source.charAt(task.at - 1) + source.charAt(task.at)).toBe(`[${task.symbol}`);
    // Dopo l'emoji (2 code unit, 4 byte) e la «ù» (1 code unit, 2 byte) i due posti divergono.
    const encoder = new TextEncoder();
    for (const task of tasks) expect(task.byte).toBe(encoder.encode(source.slice(0, task.at)).length);
    expect(tasks[2]!.byte).toBeGreaterThan(tasks[2]!.at);
    expect(tasks[0]!.due?.day).toBe("2026-11-13");
  });

  it("tiene i ritorni a capo di Windows fuori dal testo", () => {
    const tasks = tasksOf("- [ ] Uno 📅 2026-11-20\r\n- [ ] Due\r\n");
    expect(tasks.map((task) => task.text)).toEqual(["Uno 📅 2026-11-20", "Due"]);
    expect(tasks[0]!.due?.day).toBe("2026-11-20");
  });

  it("li filtra per stato, scadenza e tag del compito", () => {
    const [cornici, sala, corso] = tasksOf(source);
    const filter = (more: Partial<TaskFilter>): TaskFilter => ({ status: null, due: [], tags: [], ...more });
    expect(taskMatches(cornici!, filter({ status: "open" }))).toBe(true);
    expect(taskMatches(sala!, filter({ status: "open" }))).toBe(false);
    expect(taskMatches(sala!, filter({ status: "done" }))).toBe(true);
    // Uno stato personalizzato non è «fatto».
    expect(taskMatches(corso!, filter({ status: "open" }))).toBe(true);
    expect(taskMatches(cornici!, filter({ status: "both" }))).toBe(false);
    expect(taskMatches(cornici!, filter({ due: [{ op: "before", day: "2026-11-14" }] }))).toBe(true);
    expect(taskMatches(corso!, filter({ due: [{ op: "before", day: "2026-11-14" }] }))).toBe(false);
    expect(taskMatches(corso!, filter({ due: [{ op: "after", day: "2026-11-30" }] }))).toBe(true);
    expect(taskMatches(cornici!, filter({ due: [{ op: "on", day: "2026-11-13" }] }))).toBe(true);
    // Senza data, una condizione sulla scadenza non passa; un compito fatto neppure.
    expect(taskMatches(sala!, filter({ due: [{ op: "after", day: "2000-01-01" }] }))).toBe(false);
    expect(taskMatches(cornici!, filter({ tags: ["Lavoro"] }))).toBe(true);
    expect(taskMatches(corso!, filter({ tags: ["lavoro"] }))).toBe(false);
    expect(taskMatches(tasksOf("- [ ] Sotto #lavoro/mostra")[0]!, filter({ tags: ["lavoro"] }))).toBe(true);
    expect(taskMatches(tasksOf("- [ ] Simile #lavoratori")[0]!, filter({ tags: ["lavoro"] }))).toBe(false);
  });
});
