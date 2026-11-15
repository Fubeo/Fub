# I commenti nel testo

> **Per chi:** chi scrive nelle note e chi lavora sul loro editor.
> **Risultato:** sapere come si vede, si scrive, si cancella e si copia un
> commento in Scrittura, in Lettura e in Sorgente.

## Che cosa sono

Un commento è un passo del testo con una discussione attaccata, scritto nel
file con CriticMarkup: `{==passo==}{>>@Anna 2026-11-08 17:40: va riscritto<<}`.
Il passo è testo della nota; i messaggi no. Un messaggio da solo,
`{>>…<<}`, commenta un punto. Più messaggi in fila sono la discussione dello
stesso commento. La grammatica (dove un segno conta, l'intestazione con autore
e data, le celle, il codice e le formule) è quella di
[Convenzioni delle note](../reference/note-conventions.md); i commenti si
leggono con la sintassi `fub:comments` accesa, la stessa dei commenti
`%%…%%`.

## Come si vede

- **Scrittura**: i segni e i messaggi non si vedono. Il passo ha un fondo
  giallo leggero con una riga sotto, più pieno quando il cursore ci sta dentro;
  un commento su un punto non lascia niente. Con «Mostra la sintassi» per
  elemento o per riga (`editor.live-reveal`) i segni tornano a vista, più
  chiari, e i messaggi hanno il colore basso dei commenti `%%…%%`.
- **Lettura**: il passo ha lo stesso fondo (`<mark class="comment-range">`), i
  segni e i messaggi non ci sono. Un messaggio non entra nell'ancora di un
  titolo, nella ricerca dei tag o dei link della nota.
- **Sorgente**: si vede tutto, e ogni commento, dal primo segno all'ultimo
  messaggio, ha un colore suo.

La discussione a margine, le risposte e «Risolvi» non stanno qui: sono del
pannello dei commenti.

## Scrivere e cancellare

- Il cursore salta ogni segno nascosto come un pezzo solo: `{==` è un pezzo,
  `==}` con i messaggi che lo seguono un altro.
- Scrivere dentro il passo è scrivere nel testo della nota: il commento resta
  attaccato al passo che cresce.
- Una selezione che prende un segno nascosto senza prendere tutto il commento
  cancella soltanto il testo che si vede: i segni e i messaggi restano.
- Cancellare tutto il testo di un passo toglie anche il commento, nello stesso
  passo d'annullamento, e un avviso lo dice: «Commento tolto insieme al testo
  commentato», con «Annulla». Se nel frattempo il testo non è cambiato,
  «Annulla» rimette testo e commento; altrimenti rimette i messaggi dove stava
  il passo, come commento su un punto, perché la discussione non vada persa.
  Ctrl Z fa lo stesso dell'annullamento.
- Le modifiche che non vengono dalla tastiera (un'altra superficie sulla stessa
  nota, il file cambiato sul disco) restano come sono.

## Copiare e incollare

- Il testo semplice di una copia è il Markdown della selezione. Un commento che
  sta tutto nella selezione si copia intero; uno preso a metà perde i segni e i
  messaggi che cadono nella selezione, così copiare il passo evidenziato dà il
  passo e basta.
- L'HTML che va verso altre app è quello della Lettura: niente segni, niente
  messaggi, niente fondo.
- Incollare in Fub un testo copiato da Fub con dei commenti lo tiene com'è: un
  messaggio `{>>…<<}` basta perché gli appunti si leggano come Markdown.

## Dove sta

La grammatica della shell è `comments/syntax.ts`
(`apps/client/src/editors/text/profiles/markdown/`), gemella di
`crates/fub-format-markdown/src/parse/comments.rs`: il corpus
(`corpus.test.ts`, famiglia `comment` della fixture
`apps/client/src/__fixtures__/corpus-syntax.json`) tiene le due letture
d'accordo, byte per byte. Le decorazioni nascono nella resa incrementale della
Scrittura (`livepreview.ts`, che chiede `comments/mask.ts` come disegnarle);
la cancellazione e l'avviso stanno in `comments/mask.ts`, la copia in
`comments/copy.ts`, la Sorgente in `comments/source.ts`, la Lettura in
`render-inline.ts`. I colori sono della pelle (`skin/editors.css`, componente
`note-comments` dell'anatomia).

## Limiti

- Il conteggio delle parole della barra di stato conta ancora i messaggi e i
  segni: lo calcola il kernel sul sorgente.
