// Il gergo del codice che non arriva a chi scrive.
//
// Ogni voce è una parola che nel codice è giusta e nell'interfaccia no, con la
// parola da usare al suo posto. È il glossario e insieme il guard:
// `gergo.test.ts` cerca queste parole nei testi italiani del catalogo, così una
// frase nuova che le riporta dentro non passa.
//
// Si guarda il testo che si legge: i segnaposto (`{view}`) sono nomi di
// argomenti, non parole, e restano fuori dal confronto.

export interface Gergo {
  /// Come si riconosce, a parola intera e senza badare alle maiuscole.
  readonly parola: RegExp;
  /// Che cosa si scrive invece.
  readonly invece: string;
}

export const GERGO: readonly Gergo[] = [
  { parola: /\bwatcher\b/i, invece: "«le modifiche fatte fuori da Fub»" },
  { parola: /\bsnapshot\b/i, invece: "«copia completa»" },
  { parola: /\bkernel\b/i, invece: "«il vault», o niente: chi scrive non vede il nucleo" },
  { parola: /\bshell\b/i, invece: "«la finestra»" },
  { parola: /\bbuffer\b/i, invece: "«il testo che è in Fub»" },
  { parola: /\bdrain\w*/i, invece: "«mettere in salvo le modifiche»" },
  { parola: /\bview\b/i, invece: "«vista»" },
  { parola: /\brender\w*/i, invece: "«disegnare», «resa»" },
  { parola: /\bscocca\b/i, invece: "«cornice»" },
  { parola: /\boklch\b/i, invece: "«tinta»" },
  { parola: /\bpayload\b/i, invece: "«contenuto»" },
  // Una revisione si dice per quello che è, non col suo numero interno.
  { parola: /\br\d+\b/, invece: "«versione», con la data" },
  // Un campo vuoto si spiega a parole, non con un'uguaglianza.
  { parola: /\bvuoto\s*=/i, invece: "«Come il sistema», «tutto il vault»: il valore che vale" },
];

/// Le parole di gergo in un testo, nell'ordine del glossario.
export function gergoIn(text: string): Gergo[] {
  const read = text.replace(/\{[^}]*\}/g, " ");
  return GERGO.filter((voce) => voce.parola.test(read));
}
