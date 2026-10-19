// Quanto si sposta la scelta in un elenco filtrato: le frecce e, come in molti
// selettori, Ctrl-N e Ctrl-P. Solo Ctrl, anche su macOS: lì Cmd-N resta «nuova
// nota», e Ctrl-N/Ctrl-P sono già «riga sotto/sopra» nei campi di testo.
export function listStep(event: KeyboardEvent): 1 | -1 | 0 {
  if (event.key === "ArrowDown") return 1;
  if (event.key === "ArrowUp") return -1;
  if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return 0;
  const key = event.key.toLowerCase();
  return key === "n" ? 1 : key === "p" ? -1 : 0;
}
