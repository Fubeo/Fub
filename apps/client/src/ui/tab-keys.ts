// **La linguetta che un tasto raggiunge** in una barra di schede orizzontale.
//
// Era la stessa funzione in tre barre: le linguette di un riquadro
// (`panels/document.ts`), le schede dell'ispettore (`ui/views.ts`) e il nodo
// `tabs` che un provider disegna (`ui/node.ts`). È la regola del tab widget:
// ← e → si spostano e il giro si chiude, Home e Fine vanno agli estremi. Qui
// c'è solo l'indice; focus, click e attivazione restano a chi disegna la barra,
// che sa anche da dove viene l'indice corrente.
//
// Le schede delle impostazioni non passano da qui: stanno in colonna e
// rispondono anche a ↑ e ↓.

/// L'indice che `key` raggiunge partendo da `current` su `count` linguette, o
/// `null` se il tasto non sposta niente o non c'è niente da raggiungere.
export function tabIndexForKey(current: number, key: string, count: number): number | null {
  if (count < 1) return null;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
