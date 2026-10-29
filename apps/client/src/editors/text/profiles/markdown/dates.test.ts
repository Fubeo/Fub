import { describe, expect, it } from "vitest";
import { isTaskLine, mentionDates } from "./dates";

// Le date di `@` (K6) rispetto a giovedì 29 ottobre 2026, in italiano e in
// inglese, con la settimana che comincia di lunedì o di domenica.
const THURSDAY = new Date(2026, 9, 29);
const isos = (query: string, firstDay = 1) => mentionDates(query, THURSDAY, firstDay).map((each) => each.iso);

describe("mentionDates", () => {
  it("senza niente scritto propone oggi e domani", () => {
    expect(mentionDates("", THURSDAY, 1, "it")).toEqual([
      { iso: "2026-10-29", said: "oggi" },
      { iso: "2026-10-30", said: "domani" },
    ]);
    expect(mentionDates("", THURSDAY, 1, "en").map((each) => each.said)).toEqual(["today", "tomorrow"]);
  });

  it("capisce le parole relative, anche a metà, nelle due lingue", () => {
    expect(isos("oggi")).toEqual(["2026-10-29"]);
    expect(isos("tomorrow")).toEqual(["2026-10-30"]);
    expect(isos("ieri")).toEqual(["2026-10-28"]);
    expect(isos("dopodomani")).toEqual(["2026-10-31"]);
    expect(isos("dom")).toEqual(["2026-10-30", "2026-11-01"]);
  });

  it("un giorno della settimana è il prossimo con quel nome, mai oggi", () => {
    expect(isos("venerdì")).toEqual(["2026-10-30"]);
    expect(isos("venerdi")).toEqual(["2026-10-30"]);
    expect(isos("friday")).toEqual(["2026-10-30"]);
    expect(isos("giovedì")).toEqual(["2026-11-05"]);
    expect(isos("thu")).toEqual(["2026-11-05"]);
  });

  it("«prossimo» è quel giorno nella settimana dopo, secondo il primo giorno", () => {
    expect(isos("prossimo venerdì")).toEqual(["2026-11-06"]);
    expect(isos("next friday", 7)).toEqual(["2026-11-06"]);
    expect(isos("next sunday", 1)).toEqual(["2026-11-08"]);
    expect(isos("next sunday", 7)).toEqual(["2026-11-01"]);
    expect(isos("prossima domenica", 6)).toEqual(["2026-11-01"]);
  });

  it("legge giorno e mese nei due ordini, con l'anno o in quello di oggi", () => {
    expect(isos("4 novembre")).toEqual(["2026-11-04"]);
    expect(isos("4 Nov")).toEqual(["2026-11-04"]);
    expect(isos("november 4")).toEqual(["2026-11-04"]);
    expect(isos("nov 4 2027")).toEqual(["2027-11-04"]);
    expect(isos("4 novembre 2027")).toEqual(["2027-11-04"]);
    expect(isos("2026-11-04")).toEqual(["2026-11-04"]);
  });

  it("non inventa giorni che non ci sono né mesi ambigui", () => {
    expect(isos("31 novembre")).toEqual([]);
    expect(isos("2026-02-30")).toEqual([]);
    expect(isos("4 ma")).toEqual([]);
    expect(isos("4 mag")).toEqual(["2026-05-04"]);
    expect(isos("zzz")).toEqual([]);
  });
});

describe("isTaskLine", () => {
  it("riconosce i compiti, anche numerati o citati", () => {
    expect(isTaskLine("- [ ] chiamare")).toBe(true);
    expect(isTaskLine("  1. [x] fatto")).toBe(true);
    expect(isTaskLine("> - [ ] citato")).toBe(true);
    expect(isTaskLine("- non un compito")).toBe(false);
  });
});
