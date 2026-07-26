// Un messaggio all'utente che non richiede una risposta: l'esito di un comando,
// un errore che non blocca.
//
// È poco più di un toast, e sta in un modulo suo per una ragione che oggi non
// si vede: il §20.2 e il §20.4 chiedono una **destinazione** per ciò che va
// storto (oggi molti errori finiscono in `console.error`, cioè da nessuna
// parte, perché in un'app impacchettata la console non si apre). Quando quella
// destinazione ci sarà, la si costruisce qui — e i chiamanti sono già tutti
// passati di qua.
export function notify(message: string): void {
  document.getElementById("toast")?.remove();
  const toast = document.createElement("div");
  toast.id = "toast";
  // Testo semplice: ciò che arriva da un provider non diventa mai markup
  // (stessa regola di `SearchHit.snippet` e `UiNode` non fidato).
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 4000);
}
