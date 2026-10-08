// Le etichette nelle forme (formato della scena, etichette): il testo scritto
// dentro un rettangolo, un rombo o un'ellisse, come nei diagrammi. È un
// `text` con `fub:inside`, che porta l'id della forma; forma ed etichetta
// sono figlie dirette dello stesso gruppo, e l'etichetta va a capo nella
// larghezza della forma col testo in area (`fub:wrap`).
//
// - **Ciò che è scritto è ciò che si vede.** La `transform` dell'etichetta la
//   mette già al centro della forma: un altro programma vede il testo dove
//   FubDraw lo mostra. `fub:inside` serve a FubDraw per rimetterla al centro,
//   e per rifarle la larghezza, quando la forma si sposta, si ruota o cambia
//   misura.
// - **La lettura vuole un id e basta:** un valore vuoto o di più parole non
//   si usa, e resta nel file com'è. Se la forma non c'è, non è una sorella
//   dell'etichetta in un gruppo o non è chiusa, l'etichetta è un testo
//   qualunque.
//
// È `labels.rs` di `fub-scene`, regola per regola: i casi scritti a mano in
// `apps/client/src/__fixtures__/scene-labels/cases.json` valgono per tutte e
// due.

/// Gli spazi intorno all'id: quelli di SVG.
const SPACES = /[ \t\n\r\f]+/;

/// La forma di `fub:inside`: l'id, una parola fra spazi; `null` fuori dalla
/// grammatica.
export function readInside(value: string): string | null {
  const words = value.split(SPACES).filter((word) => word !== "");
  return words.length === 1 ? words[0]! : null;
}
