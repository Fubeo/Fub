// **Il presidio della pelle** (§31.4): il file montato è quello che i pezzi
// compongono, e i pezzi sono quelli che l'ordine elenca.
//
// # Perché «byte per byte» e non «contiene»
//
// Perché è l'unica forma che rende i pezzi la **sorgente** e `pelle.css` un
// derivato. Senza, sarebbero diciannove file che si somigliano: qualcuno
// ritoccherebbe una regola nel file montato — con ragione, magari, perché è là
// che il browser lo ha portato — e da quel momento i pezzi racconterebbero una
// pelle che non esiste, finché la prima rigenerazione non se la riprende. È lo
// stesso schema della ricetta (`ricetta.test.ts`) e la stessa ragione della
// [0020](../../../docs/decisions/0020-le-regole-in-un-posto-solo.md).
//
// Il confronto si fa anche qui, e non solo in `tema/genera.mjs --verifica`,
// perché questo gira dentro `npm test`.
//
// # E perché i due versi dell'elenco
//
// `assembla` da sola vede un pezzo elencato che manca. Non vede il contrario —
// un pezzo scritto e mai elencato — se non glielo si dà da montare, ed è il
// difetto peggiore dei due: nessun errore, la pelle esce più corta, e ciò che
// mancava lo scopre chi guarda una superficie che non si è vestita. Qui i pezzi
// arrivano dal **disco** (il glob), non dall'ordine, così le due liste sono
// davvero due.
import { describe, expect, it } from "vitest";

import { ORDINE, assembla } from "./serie/pelle/ordine";
import pelle from "./serie/pelle.css?raw";

/// I pezzi come stanno sulla cartella: chiave = nome del file senza estensione.
const SU_DISCO: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob("./serie/pelle/*.css", { query: "?raw", import: "default", eager: true }),
  ).map(([percorso, testo]) => [
    percorso.replace(/^.*\/(.+)\.css$/, "$1"),
    testo as string,
  ]),
);

describe("la pelle è quella che i suoi pezzi compongono", () => {
  it("byte per byte", () => {
    expect(
      assembla(SU_DISCO),
      "pelle.css non è quello che i suoi pezzi producono: «npm run tema:genera». " +
        "Una regola scritta a mano nel file montato sparisce alla prima " +
        "rigenerazione, e fino ad allora dice il falso sul pezzo che avrebbe " +
        "dovuto contenerla.",
    ).toBe(pelle);
  });

  it("ogni pezzo sulla cartella ha un posto nell'ordine", () => {
    expect(Object.keys(SU_DISCO).sort()).toEqual([...ORDINE].sort());
  });

  it("e nessun pezzo è vuoto", () => {
    // Un pezzo svuotato è un pezzo che si può cancellare: se resta, la prossima
    // persona lo legge come «qui non c'è ancora niente» invece che come «qui
    // non c'è più niente», e ci scrive dentro cose di un altro componente.
    for (const [nome, testo] of Object.entries(SU_DISCO)) {
      expect(testo.replace(/\/\*[\s\S]*?\*\//g, "").trim(), `${nome}.css è vuoto`).not.toBe("");
    }
  });

  it("il filetto dice da quale pezzo viene ciò che segue", () => {
    // È l'unico verso in cui il derivato serve a chi scrive: i presidi, il
    // browser e le tracce puntano dentro `pelle.css`, e da lì si deve poter
    // risalire al pezzo da toccare.
    for (const pezzo of ORDINE) {
      expect(pelle, `manca il filetto di ${pezzo}.css`).toContain(`/* ── pelle/${pezzo}.css `);
    }
  });
});
