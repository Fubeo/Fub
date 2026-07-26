// Il presidio del §1.3: **nessun modulo della shell importa `@tauri-apps`
// fuori dalla cucitura**.
//
// Non è una regola di stile. `api.ts` era già l'unica porta verso il backend —
// tranne una riga in `main.ts`, che importava il plugin dei dialoghi per le
// conferme e il file picker. Una riga sola, e la shell smetteva di essere
// portabile: il PWA (26.3), il mobile (26.2) e gli e2e della shell (§17.2, che
// girano contro un host finto) si rompono tutti sullo stesso punto, e si
// rompono *dopo*, quando la si è dimenticata.
//
// La regola si presidia leggendo i sorgenti perché è l'unico modo che non
// dipende da chi la ricorda: un `import` nuovo in un file nuovo è rosso il
// giorno che lo si scrive. È la versione UI della "dieta dell'IPC" del §16.6.
//
// I sorgenti si leggono con `import.meta.glob` di Vite e non con `node:fs`
// apposta: `tsconfig.json` dichiara `types` senza Node, e tenerlo così è ciò
// che impedisce a un modulo della shell di usare per sbaglio un'API che nella
// webview non esiste. Un presidio della portabilità non deve essere il primo a
// rinunciarci.
import { describe, expect, it } from "vitest";

/// Tutti i `.ts` sotto `src/`, contenuto compreso. Le chiavi sono path relativi
/// a questo file (`../panels/document.ts`).
const sorgenti = import.meta.glob("../**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/// I due soli moduli autorizzati: l'IPC del backend e le superfici di sistema.
const CUCITURA = ["host/ipc.ts", "host/dialog.ts"];

/// Un riferimento a `@tauri-apps` in un `import`/`export … from` o in un
/// `import(...)` dinamico. Cerca la stringa del modulo, non la riga: un
/// `import type` su più righe conta esattamente come uno normale — la regola
/// vale anche per i tipi, o basta un `import type` per aggirarla e il presidio
/// diventa una formalità.
const RIFERIMENTO = /["'`]@tauri-apps\/[^"'`]*["'`]/;

/// Le chiavi del glob sono relative a QUESTO file, che sta in `src/host/`:
/// `../panels/document.ts` per gli altri, e `./ipc.ts` per i vicini di
/// cartella. Si riportano entrambe a `src/`.
function relativoASrc(chiave: string): string {
  if (chiave.startsWith("../")) return chiave.slice(3);
  if (chiave.startsWith("./")) return `host/${chiave.slice(2)}`;
  return chiave;
}

describe("la cucitura con l'host", () => {
  it("è l'unica a importare @tauri-apps", () => {
    const colpevoli = Object.entries(sorgenti)
      .map(([chiave, testo]) => ({ file: relativoASrc(chiave), testo }))
      .filter(({ file }) => !CUCITURA.includes(file))
      .filter(({ testo }) => RIFERIMENTO.test(testo))
      .map(({ file }) => file);

    expect(colpevoli, `moduli che importano @tauri-apps fuori da ${CUCITURA.join(", ")}`).toEqual(
      [],
    );
  });

  it("legge davvero i sorgenti, e la lista delle eccezioni punta a file veri", () => {
    // Due modi in cui un presidio muore senza che nessuno se ne accorga: un
    // glob che non trova più nulla (passa sempre) e un elenco di eccezioni che
    // nomina file rinominati (passa sempre).
    const file = Object.keys(sorgenti).map(relativoASrc);
    expect(file.length).toBeGreaterThan(10);
    for (const eccezione of CUCITURA) expect(file).toContain(eccezione);
  });

  it("riconosce un'importazione Tauri quando c'è", () => {
    // La prova che il filtro non è sempre vuoto per una svista nella regexp:
    // la cucitura, che l'importazione ce l'ha per davvero, deve essere colta.
    const cucitura = Object.entries(sorgenti).filter(([k]) =>
      CUCITURA.includes(relativoASrc(k)),
    );
    // Senza questa riga il `for` che segue passerebbe a vuoto se il glob
    // smettesse di trovarli — che è come questo stesso test è già nato rotto.
    expect(cucitura).toHaveLength(CUCITURA.length);
    for (const [chiave, testo] of cucitura) {
      expect(RIFERIMENTO.test(testo), relativoASrc(chiave)).toBe(true);
    }
  });
});
