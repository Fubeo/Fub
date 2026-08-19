// **Il presidio del banco** (§31.1): l'elenco delle scene è chiuso, e i due
// cataloghi che dicono «ogni componente» lo dimostrano invece di affermarlo.
//
// # Le due direzioni, e perché servono tutte e due
//
// Una scena senza baseline e una baseline senza scena sono due difetti diversi,
// e nessuno dei due si vede guardando l'altro. Senza la prima verifica, una
// scena nuova che nessuno ha fotografato passa per verde — il fotografo la
// salta e non se ne lamenta nessuno. Senza la seconda, una scena cancellata
// lascia in repo la foto di qualcosa che non esiste più, e quella foto invecchia
// diventando il ritratto di un'interfaccia che non c'è: la prossima persona che
// la guarda cerca di capire cosa è cambiato in una schermata che è stata
// rimossa.
//
// Che l'elenco si possa svuotare in silenzio è la lezione della
// [0109](../../docs/decisions/0109-un-conteggio-che-non-si-sa-non-e-un-nome-solo.md):
// un elenco vuoto e un elenco che passa danno lo stesso verde. Qui c'è un
// pavimento, e sta scritto.
//
// # Le scene arrivano da un `.mjs`, e i tipi da un `.d.mts`
//
// `scene.mjs` è di Node, e `tsconfig.json` i `.mjs` del banco li tiene fuori
// apposta. Da questo lato del confine la forma la dichiara `scene.d.mts` — che
// nessun compilatore confronta con l'originale, e che i test qui sotto
// verificano a mano su ogni scena: è per questo che «ha un titolo» e «`prepara`
// è una funzione» sono asserzioni e non assunzioni.
//
// # Perché `import.meta.glob` e non `node:fs`
//
// Stessa ragione del presidio del §1.3: `tsconfig.json` dichiara `types` senza
// Node apposta, e un presidio non deve essere il primo a rinunciare alla riga
// che tiene. Le baseline si contano come Vite le vede, cioè come file.
import { describe, expect, it } from "vitest";

import { LUCI as luci, SCENE as scene, nomeFoto as foto } from "./scene.mjs";
import { CAMPIONI } from "./campioni";
import sorgenteNode from "../src/ui/node.ts?raw";

/// Le baseline in repo, per nome. Il valore non interessa (sono PNG): interessa
/// **quali** ci sono, e questa è la sola domanda che si possa fare a un `glob`
/// senza leggere mezzo megabyte di immagini.
const baseline = Object.keys(
  import.meta.glob("./baseline/*.png", { eager: true, query: "?url", import: "default" }),
).map((p) => p.slice(p.lastIndexOf("/") + 1));

/// Il pavimento dell'elenco. Non è il numero di scene di oggi trasformato in
/// legge — è il numero sotto cui l'elenco ha smesso di coprire la shell: le
/// diciassette schermate più i tre cataloghi erano già il minimo per dire «ogni
/// superficie ha una foto». Alzarlo è una riga, e va fatta apposta.
const MINIMO = 20;

describe("l'elenco delle scene", () => {
  it("non è vuoto, e non si svuota in silenzio", () => {
    expect(scene.length).toBeGreaterThanOrEqual(MINIMO);
  });

  it("ha un id per scena, e nessuno ripetuto", () => {
    const ids = scene.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("scrive gli id come nomi di file: minuscoli, senza spazi", () => {
    for (const s of scene) {
      expect(s.id, `«${s.id}» non è un id`).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it("dice per ogni scena cosa si sta guardando e come ci si arriva", () => {
    for (const s of scene) {
      expect(s.titolo, `${s.id} non ha titolo`).toBeTruthy();
      expect(typeof s.prepara, `${s.id} non dichiara come si prepara`).toBe("function");
    }
  });
});

describe("le baseline", () => {
  it("ci sono per ogni scena, in **entrambe** le luci", () => {
    const mancanti = scene.flatMap((s) =>
      luci.map((l) => foto(s, l)).filter((n) => !baseline.includes(n)),
    );
    expect(mancanti, "manca una foto: «npm run banco:aggiorna»").toEqual([]);
  });

  it("non ne avanza nessuna senza la sua scena", () => {
    const attese = new Set(scene.flatMap((s) => luci.map((l) => foto(s, l))));
    const orfane = baseline.filter((n) => !attese.has(n));
    expect(orfane, "una foto senza scena: è il ritratto di qualcosa che non c'è più").toEqual(
      [],
    );
  });

  it("sono esattamente due per scena e non una di più", () => {
    expect(baseline.length).toBe(scene.length * luci.length);
  });
});

// ---------------------------------------------------------------------------
// «Ogni componente in ogni stato» — dimostrato, non affermato.
// ---------------------------------------------------------------------------

/// I `case` dello `switch` di `disegna()`, che sono l'unica definizione
/// verificabile a macchina di «ogni componente»: `UiKind` è un'unione del
/// contratto, ma ciò che si **disegna** è ciò che quel corpo sa disegnare.
/// Si ritaglia il corpo della funzione perché in `ui/node.ts` di `switch` ce ne
/// sono quattro, e gli altri tre commutano su altro (l'aggiornamento in loco, i
/// figli, il fuoco): prendere tutti i `case` del file vorrebbe dire pretendere
/// dal catalogo dei componenti che non esistono.
function specieDisegnate(sorgente: string): string[] {
  const inizio = sorgente.indexOf("function disegna(");
  expect(inizio, "`disegna()` non sta più in `ui/node.ts`").toBeGreaterThan(-1);
  // La funzione finisce alla prima graffa in colonna zero dopo il suo inizio:
  // è la forma di questo file, e se cambia questo presidio si accorge subito
  // che sta leggendo un pezzo di qualcos'altro.
  const fine = sorgente.indexOf("\n}", inizio);
  const corpo = sorgente.slice(inizio, fine);
  return [...corpo.matchAll(/^\s*case "([a-z_]+)":/gm)].map((m) => m[1]!);
}

describe("il catalogo dei componenti", () => {
  const disegnate = specieDisegnate(sorgenteNode);
  const coperte = new Set(CAMPIONI.flatMap((c) => c.copre));

  it("legge davvero il corpo di `disegna()`", () => {
    // Se il ritaglio sbaglia, l'elenco è corto o vuoto e tutto il resto passa a
    // vuoto: il presidio che non trova niente e quello che trova tutto giusto
    // danno lo stesso verde, e questa riga è la differenza.
    expect(disegnate.length).toBeGreaterThan(25);
  });

  it("copre ogni specie che la shell sa disegnare", () => {
    const scoperte = disegnate.filter((s) => !coperte.has(s as never));
    expect(scoperte, "specie senza campione nel catalogo").toEqual([]);
  });

  it("non promette specie che nessuno disegna", () => {
    const inventate = [...coperte].filter((s) => !disegnate.includes(s));
    expect(inventate, "il catalogo copre una specie che `disegna()` non conosce").toEqual([]);
  });

  it("dà a ogni campione almeno uno stato, e un titolo", () => {
    for (const c of CAMPIONI) {
      expect(c.titolo).toBeTruthy();
      expect(c.stati.length, `«${c.titolo}» non mostra nessuno stato`).toBeGreaterThan(0);
      expect(c.copre.length, `«${c.titolo}» non dice cosa copre`).toBeGreaterThan(0);
    }
  });

  it("non fa coprire la stessa specie a due campioni", () => {
    const tutte = CAMPIONI.flatMap((c) => c.copre);
    expect(new Set(tutte).size, "due campioni si contendono una specie").toBe(tutte.length);
  });
});
