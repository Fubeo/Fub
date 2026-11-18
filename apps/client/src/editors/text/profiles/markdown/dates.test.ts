import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isTaskLine, mentionDates, saidDay } from "./dates";

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
    // Già passato: anche quello che viene, con la regola del campo della data.
    expect(isos("4 mag")).toEqual(["2026-05-04", "2027-05-04"]);
    expect(isos("zzz")).toEqual([]);
  });
});

// La regola delle frasi intere (T10), la stessa del campo della data nelle
// proprietà: rispetto a venerdì 20 marzo 2026, settimana dal lunedì.
const FRIDAY = new Date(2026, 2, 20, 10, 0);
const said = (text: string, locale = "it", today = FRIDAY, firstDay = 1) => saidDay(text, today, firstDay, locale);

describe("saidDay", () => {
  it("capisce le parole del prototipo", () => {
    expect(said("venerdì")).toBe("2026-03-27");
    expect(said("fra due settimane")).toBe("2026-04-03");
    expect(said("fra tre settimane")).toBe("2026-04-10");
    expect(said("20 marzo")).toBe("2026-03-20");
    expect(said("3/4")).toBe("2026-04-03");
    expect(said("oggi")).toBe("2026-03-20");
    expect(said("Domani")).toBe("2026-03-21");
    expect(said("dopodomani")).toBe("2026-03-22");
    expect(said("prossimo martedì")).toBe("2026-03-24");
    expect(said("tra 3 giorni")).toBe("2026-03-23");
    expect(said("fra un mese")).toBe("2026-04-20");
    expect(said("fra un anno")).toBe("2027-03-20");
    expect(said("2 settimane fa")).toBe("2026-03-06");
    expect(said("1° maggio")).toBe("2026-05-01");
    expect(said("2026-11-04")).toBe("2026-11-04");
    expect(said("20.3.2026")).toBe("2026-03-20");
  });

  it("non capisce ciò che non è una data, e non indovina", () => {
    expect(said("")).toBeNull();
    expect(said("riunione")).toBeNull();
    expect(said("fra tante settimane")).toBeNull();
    expect(said("fra 1000 giorni")).toBeNull();
    expect(said("4 ma")).toBeNull();
    expect(said("2026-02-30")).toBeNull();
    expect(said("13/13")).toBeNull();
  });

  it("«31/2» non c'è: non scivola al 3 marzo", () => {
    expect(said("31/2")).toBeNull();
    expect(said("31/2/2027")).toBeNull();
    expect(said("30 febbraio")).toBeNull();
    // Il 29 febbraio senza anno è quello del primo anno che ce l'ha.
    expect(said("29/2")).toBe("2028-02-29");
  });

  it("un anno a due cifre è di questo secolo; senza anno, il giorno che viene", () => {
    expect(said("3/4/27")).toBe("2027-04-03");
    expect(said("20 marzo 27")).toBe("2027-03-20");
    expect(said("5/1/99")).toBe("2099-01-05");
    expect(said("1/3")).toBe("2027-03-01");
    expect(said("10 gennaio")).toBe("2027-01-10");
    expect(said("10 gennaio 2026")).toBe("2026-01-10");
  });

  it("«fra 0 giorni» è oggi; un mese più corto tiene l'ultimo giorno", () => {
    expect(said("fra 0 giorni")).toBe("2026-03-20");
    expect(said("in 0 days")).toBe("2026-03-20");
    expect(said("fra un mese", "it", new Date(2026, 0, 31))).toBe("2026-02-28");
    expect(said("fra un mese", "it", new Date(2028, 0, 31))).toBe("2028-02-29");
  });

  it("l'inglese, e l'ordine di giorno e mese della lingua", () => {
    expect(said("friday", "en")).toBe("2026-03-27");
    expect(said("next tuesday", "en")).toBe("2026-03-24");
    expect(said("in two weeks", "en")).toBe("2026-04-03");
    expect(said("in a month", "en")).toBe("2026-04-20");
    expect(said("three days ago", "en")).toBe("2026-03-17");
    expect(said("March 20", "en")).toBe("2026-03-20");
    expect(said("march 21st, 2027", "en")).toBe("2027-03-21");
    // «3/4»: il 4 marzo in inglese americano (già passato: quello del
    // 2027), il 3 aprile in italiano e in inglese britannico; un numero
    // oltre il 12 dice l'ordine da sé.
    expect(said("3/4", "en")).toBe("2027-03-04");
    expect(said("3/4", "en-US")).toBe("2027-03-04");
    expect(said("3/4", "en-GB")).toBe("2026-04-03");
    expect(said("20/3/2026", "en")).toBe("2026-03-20");
    // Le parole valgono in tutte e due le lingue, come per `@`.
    expect(said("venerdì", "en")).toBe("2026-03-27");
    expect(said("tomorrow", "it")).toBe("2026-03-21");
  });

  it("conta i giorni del calendario locale, a qualunque ora", () => {
    expect(said("oggi", "it", new Date(2026, 2, 20, 23, 59))).toBe("2026-03-20");
    expect(said("domani", "it", new Date(2026, 2, 20, 0, 1))).toBe("2026-03-21");
    // Il passaggio all'ora legale (29 marzo in Europa) non sposta il giorno.
    expect(said("fra 10 giorni", "it", new Date(2026, 2, 25, 0, 30))).toBe("2026-04-04");
  });

  it("«prossimo» segue il primo giorno della settimana, come in `@`", () => {
    expect(said("prossima domenica", "it", FRIDAY, 1)).toBe("2026-03-29");
    expect(said("prossima domenica", "it", FRIDAY, 7)).toBe("2026-03-22");
  });

  it("`@` propone anche la frase intera, dopo le parole a metà", () => {
    expect(mentionDates("fra due settimane", FRIDAY, 1).map((each) => each.iso)).toEqual(["2026-04-03"]);
    expect(mentionDates("3/4", FRIDAY, 1).map((each) => each.iso)).toEqual(["2026-04-03"]);
    // «10 gennaio»: quello di quest'anno, già passato, e quello che viene.
    expect(mentionDates("10 gennaio", FRIDAY, 1).map((each) => each.iso)).toEqual(["2026-01-10", "2027-01-10"]);
  });
});

describe("saidDay in un altro fuso", () => {
  // Node rilegge il fuso quando `TZ` cambia; ogni file gira nel suo processo.
  beforeAll(() => {
    vi.stubEnv("TZ", "Pacific/Kiritimati");
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("il giorno è quello locale, non quello in UTC", () => {
    // Le 0:30 del 21 marzo a UTC+14 sono ancora il 20 marzo in UTC.
    const early = new Date(2026, 2, 21, 0, 30);
    expect(early.getTimezoneOffset()).toBe(-840);
    expect(early.toISOString().slice(0, 10)).toBe("2026-03-20");
    expect(said("oggi", "it", early)).toBe("2026-03-21");
    expect(said("domani", "it", early)).toBe("2026-03-22");
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
