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
// verificano a mano su ogni scena: è per questo che «ha un titolo» e «`prepare`
// è una funzione» sono asserzioni e non assunzioni.
//
// # Perché `import.meta.glob` e non `node:fs`
//
// Stessa ragione del presidio del §1.3: `tsconfig.json` dichiara `types` senza
// Node apposta, e un presidio non deve essere il primo a rinunciare alla riga
// che tiene. Le baseline si contano come Vite le vede, cioè come file.
import { describe, expect, it } from "vitest";

import { LIGHTS as lights, SCENE as scene, photoFilename as foto } from "./scene.mjs";
import { SAMPLES } from "./samples";
import sourceNode from "../src/ui/node.ts?raw";

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
const MINIMUM = 20;

describe("l'elenco delle scene", () => {
  it("non è vuoto, e non si svuota in silenzio", () => {
    expect(scene.length).toBeGreaterThanOrEqual(MINIMUM);
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
      expect(s.title, `${s.id} non ha title`).toBeTruthy();
      expect(typeof s.prepare, `${s.id} non dichiara come si prepara`).toBe("function");
    }
  });
});

describe("le baseline", () => {
  it("ci sono per ogni scena, in **entrambe** le lights", () => {
    const missing = scene.flatMap((s) =>
      lights.map((l) => foto(s, l)).filter((n) => !baseline.includes(n)),
    );
    expect(missing, "manca una foto: «npm run bench:update»").toEqual([]);
  });

  it("non ne avanza nessuna senza la sua scena", () => {
    const expected = new Set(scene.flatMap((s) => lights.map((l) => foto(s, l))));
    const orphans = baseline.filter((n) => !expected.has(n));
    expect(orphans, "una foto senza scena: è il ritratto di qualcosa che non c'è più").toEqual(
      [],
    );
  });

  it("sono esattamente due per scena e non una di più", () => {
    expect(baseline.length).toBe(scene.length * lights.length);
  });
});

// ---------------------------------------------------------------------------
// «Ogni componente in ogni stato» — dimostrato, non affermato.
// ---------------------------------------------------------------------------

/// I `case` dello `switch` di `render()`, che sono l'unica definizione
/// verificabile a macchina di «ogni componente»: `UiKind` è un'unione del
/// contratto, ma ciò che si **disegna** è ciò che quel corpo sa disegnare.
/// Si ritaglia il corpo della funzione perché in `ui/node.ts` di `switch` ce ne
/// sono quattro, e gli altri tre commutano su altro (l'aggiornamento in loco, i
/// figli, il fuoco): prendere tutti i `case` del file vorrebbe dire pretendere
/// dal catalogo dei componenti che non esistono.
function kindsDrawn(source: string): string[] {
  const start = source.indexOf("function draw(");
  expect(start, "`draw()` is no longer in `ui/node.ts`").toBeGreaterThan(-1);
  // La funzione finisce alla prima graffa in colonna zero dopo il suo inizio:
  // è la forma di questo file, e se cambia questo presidio si accorge subito
  // che sta leggendo un pezzo di qualcos'altro.
  const end = source.indexOf("\n}", start);
  const body = source.slice(start, end);
  return [...body.matchAll(/^\s*case "([a-z_]+)":/gm)].map((m) => m[1]!);
}

describe("the component catalog", () => {
  const drawn = kindsDrawn(sourceNode);
  const covered = new Set(SAMPLES.flatMap((c) => c.covers));

  it("really reads the body of `draw()`", () => {
    // Se il ritaglio sbaglia, l'elenco è corto o vuoto e tutto il resto passa a
    // vuoto: il presidio che non trova niente e quello che trova tutto giusto
    // danno lo stesso verde, e questa riga è la differenza.
    expect(drawn.length).toBeGreaterThan(25);
  });

  it("every drawn kind has a sample", () => {
    const uncovered = drawn.filter((s) => !covered.has(s as never));
    expect(uncovered, "kind without a sample in the catalog").toEqual([]);
  });

  it("does not promise kinds that nobody draws", () => {
    const invented = [...covered].filter((s) => !drawn.includes(s));
    expect(invented, "catalog covers a kind that `draw()` does not know").toEqual([]);
  });

  it("gives every sample at least one state, and a title", () => {
    for (const c of SAMPLES) {
      expect(c.title).toBeTruthy();
      expect(c.states.length, `"${c.title}" shows no state`).toBeGreaterThan(0);
      expect(c.covers.length, `"${c.title}" does not say what it covers`).toBeGreaterThan(0);
    }
  });

  it("does not let two samples cover the same kind", () => {
    const all = SAMPLES.flatMap((c) => c.covers);
    expect(new Set(all).size, "two samples contend for one kind").toBe(all.length);
  });
});
