// **Un estratto con le porzioni evidenziate**, come nodi DOM.
//
// Nasce come funzione privata del pannello della ricerca e diventa un modulo
// quando la ricerca dentro la nota aperta (§21.4) è diventata la seconda
// superficie che mostra estratti. Non è una comodità: le due invarianti qui
// sotto sono il genere di cosa che, riscritta una seconda volta, si riscrive
// per il 95% — e il 5% che manca è un buco di sicurezza o una parola tagliata a
// metà su un accento.
//
// Due invarianti in una funzione sola:
//
// - il testo del provider entra **solo** come `textContent`/nodo di testo, mai
//   come HTML: un provider non può iniettare markup (vedi `DocumentMatch`);
// - gli offset arrivano in **byte UTF-8** (è la valuta degli `Span` in tutto il
//   modello) mentre le stringhe JS sono UTF-16: si taglia sui byte e si
//   decodifica, invece di fingere che gli indici coincidano — con l'italiano
//   accentato non coinciderebbero quasi mai.
import type { Span } from "../host/contract";

export function evidenziato(snippet: string, highlights: Span[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  const bytes = new TextEncoder().encode(snippet);
  const decoder = new TextDecoder();
  let pos = 0;
  for (const h of highlights) {
    // Un intervallo che torna indietro, che esce dall'estratto o che è vuoto si
    // scarta invece di far saltare il disegno: gli offset li manda un provider,
    // e la shell non è il posto in cui un provider sbagliato fa danno.
    if (h.start < pos || h.end > bytes.length || h.start >= h.end) continue;
    frag.append(decoder.decode(bytes.subarray(pos, h.start)));
    const mark = document.createElement("mark");
    mark.textContent = decoder.decode(bytes.subarray(h.start, h.end));
    frag.append(mark);
    pos = h.end;
  }
  frag.append(decoder.decode(bytes.subarray(pos)));
  return frag;
}
