// Il nome di una scheda di testo della lavagna: la sua prima riga non vuota,
// senza i segni del Markdown. Una regola sola per tutti i punti che lo
// mostrano: la testata del menu, l'avviso del Lazo e l'etichetta della penna
// («Ora fa parte di», «Si attacca a»), il titolo grande da lontano
// (`lod.ts`) e il nome nell'ispettore.
//
// Funzioni pure, senza DOM e senza l'albero Lezer: il nome è una riga, e
// `rules/syntax.ts` non copre enfasi, titoli e link. Le parole restano come
// sono: `snake_case`, `2*3*4` e un `*` da solo non si toccano. La pagina di
// riferimento è `docs/reference/canvas-view.md` («Da lontano»).

import { ALPHANUMERIC } from "../../rules/mirrored";

/// Una lettera o una cifra: quello che fa parte di una parola, come nella shell.
const WORD = ALPHANUMERIC.source;

/// Un segno di blocco davanti a una riga, uno alla volta: titolo, citazione,
/// elenco puntato o numerato, casella. Ogni alternativa consuma almeno un
/// carattere; `#tag`, `-5` e `1.5` non sono segni, perché non sono seguiti da
/// uno spazio.
const BLOCK_MARK = /^(?:#{1,6}(?=\s|$)|>|[-*+](?=\s|$)|\d{1,9}[.)](?=\s|$)|\[[ xX]\](?=\s|$))\s*/;
/// Un titolo: `#` seguito da uno spazio o dalla fine della riga.
const HEADING = /^#{1,6}(?=\s|$)/;
/// Un tratto orizzontale (`---`, `* * *`, `___`): non ha un nome.
const THEMATIC_BREAK = /^([-*_])(?:\s*\1){2,}$/;

/// Il codice fra backtick: il suo contenuto resta com'è, e i segni dentro non si tolgono.
const CODE = /(?<!\\)`([^`\n]+)`/g;
/// Il segnaposto di un codice mentre gli altri segni si tolgono: due caratteri
/// d'uso privato (U+E000 e U+E001), che nel testo di una scheda non compaiono.
/// Si costruiscono dal codice, perché il sorgente resti leggibile.
const SLOT_OPEN = String.fromCharCode(0xe000);
const SLOT_CLOSE = String.fromCharCode(0xe001);
const CODE_SLOT = new RegExp(`${SLOT_OPEN}(\\d+)${SLOT_CLOSE}`, "g");
/// Un'immagine o un link: `![alt](x)` e `[testo](x)` dicono il loro testo.
const LINK = /!?\[([^\]\n]*)\]\([^)\n]*\)/g;
/// Un wikilink o un embed: `[[nota|alias]]` dice l'alias, `[[nota]]` la nota.
const WIKILINK = /!?\[\[([^\]|\n]*)(?:\|([^\]\n]*))?\]\]/g;
/// Un escape: `\*` dice `*`, `\\` dice `\`.
const ESCAPE = /\\([!-\/:-@\[-\x60{-~])/g;

// L'enfasi conta solo se il segno non è attaccato a una parola o a un altro
// segno: `2*3*4`, `2**3**4`, `snake_case`, `a__b__c` restano com'erano. Il
// contenuto non inizia né finisce con uno spazio. Il grassetto viene prima
// del corsivo, così `**` non diventa due `*`.
const EMPHASIS = [
  new RegExp(String.raw`(?<!${WORD}|[*\\])\*\*(?=\S)(.+?)(?<=\S)\*\*(?!${WORD}|\*)`, "gu"),
  new RegExp(String.raw`(?<!${WORD}|_)__(?=\S)(.+?)(?<=\S)__(?!${WORD}|_)`, "gu"),
  new RegExp(String.raw`(?<!${WORD}|[*\\])\*(?=[^\s*])([^*]+?)(?<=[^\s*\\])\*(?!${WORD}|\*)`, "gu"),
  new RegExp(String.raw`(?<!${WORD}|_)_(?=[^\s_])([^_]+?)(?<=[^\s_])_(?!${WORD}|_)`, "gu"),
  new RegExp(String.raw`(?<!${WORD}|~)~~(?=\S)(.+?)(?<=\S)~~(?!${WORD}|~)`, "gu"),
  new RegExp(String.raw`(?<!${WORD}|=)==(?=\S)(.+?)(?<=\S)==(?!${WORD}|=)`, "gu"),
];

/// Il nome di un testo: la prima riga che, senza i segni, non è vuota. `""`
/// se il testo non ha niente da dire.
export function textCardName(text: string): string {
  for (const raw of text.split("\n")) {
    const name = plainLine(raw);
    if (name !== "") return name;
  }
  return "";
}

/// Una riga senza i segni di blocco davanti e senza quelli in linea.
function plainLine(raw: string): string {
  const line = raw.trim();
  if (THEMATIC_BREAK.test(line)) return "";
  // Un titolo può chiudersi con i suoi cancelletti: `## Idee ##` dice «Idee».
  const unclosed = HEADING.test(line) ? line.replace(/\s+#+$/, "") : line;
  return plainInline(stripBlockMarks(unclosed)).trim();
}

/// Toglie i segni di blocco uno dopo l'altro: `> - [ ] x` dice `x`.
function stripBlockMarks(line: string): string {
  let rest = line;
  let next = rest.replace(BLOCK_MARK, "");
  while (next !== rest) {
    rest = next;
    next = rest.replace(BLOCK_MARK, "");
  }
  return rest;
}

/// Il testo di una riga come lo legge chi la guarda, senza i suoi segni in linea.
function plainInline(text: string): string {
  // Il codice per primo: dentro i suoi backtick niente si toglie. Ogni codice
  // resta al suo posto come un segnaposto, e torna alla fine.
  const codes: string[] = [];
  let out = text.replace(CODE, (_match, code: string) => {
    codes.push(code);
    return `${SLOT_OPEN}${codes.length - 1}${SLOT_CLOSE}`;
  });
  out = out.replace(LINK, "$1");
  out = out.replace(WIKILINK, (_match, target: string, alias: string | undefined) => (alias?.trim() ? alias : target));
  for (const rule of EMPHASIS) out = out.replace(rule, "$1");
  out = out.replace(ESCAPE, "$1");
  return out.replace(CODE_SLOT, (_match, index: string) => codes[Number(index)] ?? "");
}
