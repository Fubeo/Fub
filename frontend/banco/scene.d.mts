// **La forma delle scene, dal lato dei tipi.**
//
// `scene.mjs` gira in Node — lo legge il fotografo, che sta fuori dal browser e
// fuori da Vite — e `tsconfig.json` tiene i `.mjs` di questa cartella fuori dal
// controllo dei tipi apposta: è la riga di confine scritta lì. Ma il presidio
// (`scene.test.ts`) è un `.ts`, e da questo lato del confine la forma va
// dichiarata, o `SCENE` arriva come `any` e un presidio scritto su `any` non
// presidia niente.
//
// Il rischio di una dichiarazione senza compilatore che la tenga è che menta.
// Qui non può mentire a lungo: `scene.test.ts` verifica **a mano**, su ogni
// scena, che ci sia un id, un titolo e un `prepara` che sia una funzione. Se
// questo file e quello vero divergono, è quel test a diventare rosso.

/// Le due luci in cui ogni scena si fotografa.
export type Luce = "dark" | "light";

/// Una scena: cosa si guarda, come ci si arriva, e su quale delle due pagine
/// del banco (la shell vera, oppure il catalogo).
export interface Scena {
  /// L'id, che è anche il nome del file della foto.
  id: string;
  /// Cosa si sta guardando, per chi legge il foglio di contatto.
  titolo: string;
  /// La query string con cui si apre la pagina (vault vuoto, quale catalogo).
  query?: string;
  /// `"catalogo"` per le scene che non sono schermate ma cataloghi.
  pagina?: string;
  /// I gesti che portano la pagina davanti all'obiettivo. Riceve la pagina di
  /// Playwright, che da questo lato del confine non ha un tipo — i tipi di
  /// Playwright sono di Node, e Node qui non c'è.
  prepara: (page: unknown) => Promise<void>;
}

export declare const SCENE: readonly Scena[];
export declare const LUCI: readonly Luce[];
export declare function nomeFoto(scena: Scena, luce: Luce): string;
export declare function indirizzo(base: string, scena: Scena, luce: Luce): string;
