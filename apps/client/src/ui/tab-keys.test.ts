// La regola delle frecce che tre barre di schede condividono: le linguette di
// un riquadro, le schede dell'ispettore e il nodo `tabs`. Ogni barra ha poi il
// proprio test DOM, perché l'indice corrente lo legge ognuna a modo suo.
import { describe, expect, it } from "vitest";
import { tabIndexForKey } from "./tab-keys";

describe("il tasto che sposta fra le linguette", () => {
  const cases: [string, number, string, number, number | null][] = [
    ["nessuna linguetta", 0, "ArrowRight", 0, null],
    ["nessuna linguetta, nemmeno agli estremi", 0, "End", 0, null],
    ["→ va alla successiva", 0, "ArrowRight", 3, 1],
    ["→ dall'ultima torna alla prima", 2, "ArrowRight", 3, 0],
    ["← va alla precedente", 2, "ArrowLeft", 3, 1],
    ["← dalla prima va all'ultima", 0, "ArrowLeft", 3, 2],
    ["Home va alla prima", 2, "Home", 3, 0],
    ["Fine va all'ultima", 0, "End", 3, 2],
    ["una linguetta sola resta dov'è", 0, "ArrowLeft", 1, 0],
    ["↑ non è di una barra orizzontale", 1, "ArrowUp", 3, null],
    ["↓ nemmeno", 1, "ArrowDown", 3, null],
    ["Invio attiva, non sposta", 1, "Enter", 3, null],
    ["una lettera non sposta", 1, "a", 3, null],
  ];

  it.each(cases)("%s", (_name, current, key, count, expected) => {
    expect(tabIndexForKey(current, key, count)).toBe(expected);
  });
});
