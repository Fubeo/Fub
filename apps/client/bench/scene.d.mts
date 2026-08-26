// **La forma delle scene, dal lato dei tipi.**
//
// `scene.mjs` gira in Node — lo legge il fotografo, che sta fuori dal browser e
// fuori da Vite — e `tsconfig.json` tiene i `.mjs` di questa cartella fuori dal
// controllo dei tipi apposta: è la riga di confine scritto lì. Ma il presidio
// (`scene.test.ts`) è un `.ts`, e da questo lato del confine la forma va
// dichiarata, o `SCENE` arriva come `any` e un presidio scritto su `any` non
// presidia niente.
//
// Il rischio di una dichiarazione senza compilatore che la tenga è che menta.
// Qui non può mentire a lungo: `scene.test.ts` verifica **a mano**, su ogni
// scena, che ci sia un id, un titolo e un `prepare` che sia una funzione. Se
// questo file e quello vero divergono, è quel test a diventare rosso.

/// Le due luci in cui ogni scena si fotografa.
export type Light = "dark" | "light";

/// Una scena: cosa si guarda, come ci si arriva, e su quale delle due pagine
/// del banco (la shell vera, oppure il catalogo).
export interface Scene {
  /// L'id, che è anche il nome del file della foto.
  id: string;
  /// Cosa si sta guardando, per chi legge il foglio di contatto.
  title: string;
  /// La query string con cui si apre la pagina (vault vuoto, quale catalogo).
  query?: string;
  /// `"catalog"` per le scene che non sono schermate ma cataloghi.
  page?: string;
  /// I gesti che portano la pagina davanti all'obiettivo. Riceve la pagina di
  /// Playwright, che da questo lato del confine non ha un tipo — i tipi di
  /// Playwright sono di Node, e Node qui non c'è.
  prepare: (page: unknown) => Promise<void>;
}

export declare const SCENE: readonly Scene[];
export declare const LIGHTS: readonly Light[];
export declare function photoFilename(scene: Scene, light: Light): string;
export declare function sceneUrl(base: string, scene: Scene, light: Light): string;
