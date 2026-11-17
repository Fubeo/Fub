// Dove si taglia il nome di una linguetta stretta.
//
// Una linguetta che non ha spazio taglia il nome alla fine, con l'ellissi: di
// solito l'inizio è ciò che distingue una nota dall'altra. Non quando due nomi
// della stessa striscia cominciano uguali — le note del diario
// («2026-08-18», «2026-08-19»), due omonime con la cartella in coda
// («Prima idea · Archivio») —: tagliati alla fine si leggono uguali. Allora il
// nome si divide in una testa, che si accorcia con l'ellissi, e una coda che
// resta a vista: la parte che lo distingue.
//
// Qui si decide solo dove; la misura la fa il CSS (`.tab-name-head`,
// `.tab-name-tail`), e un nome che ci sta si legge intero comunque. Il nome
// intero resta nel nome accessibile e nel suggerimento.

/// Sotto questo prefisso comune due nomi non si confondono: l'inizio diverso
/// si vede già dopo poche lettere.
const SHARED_MIN = 4;
/// Una coda più corta di così non dice niente da sola («9»): si allarga
/// all'indietro fino a questa misura.
const TAIL_MIN = 5;
/// Dove un nome si spezza bene: dopo uno spazio, un trattino, un punto.
const BOUNDARY = /[\s\-_.·/]/u;

/// Di quante lettere al più la coda si allarga per cominciare con una parola.
const REACH = 6;

/// L'inizio della parola che contiene `at`.
function wordStart(name: string, at: number): number {
  let start = at;
  while (start > 0 && !BOUNDARY.test(name[start - 1]!)) start--;
  return start;
}

function sharedPrefix(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let at = 0;
  while (at < limit && a[at] === b[at]) at++;
  return at;
}

/// Per ogni nome, l'indice da cui comincia la coda che resta a vista, o `null`
/// se il nome si taglia alla fine come sempre.
export function distinctiveTails(names: readonly string[]): (number | null)[] {
  return names.map((name, index) => {
    let shared = 0;
    names.forEach((other, position) => {
      if (position !== index && other !== name) shared = Math.max(shared, sharedPrefix(name, other));
    });
    if (shared < SHARED_MIN || shared >= name.length) return null;
    // La coda comincia all'inizio della parola in cui i nomi si separano, o
    // proprio lì se lì comincia una parola («Nota · Sorgente»).
    let start = shared;
    if (!BOUNDARY.test(name[start]!)) start = wordStart(name, start);
    // Troppo corta, la coda si allarga all'indietro, e se c'è vicino un
    // inizio di parola parte da lì: «08-19», «idea · /».
    if (name.length - start < TAIL_MIN) {
      start = Math.max(0, name.length - TAIL_MIN);
      const word = wordStart(name, start);
      if (start - word <= REACH) start = word;
    }
    // Una testa che non ha niente da accorciare non serve.
    return start > 0 ? start : null;
  });
}
