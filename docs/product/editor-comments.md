# I commenti nel testo

> **Per chi:** chi scrive nelle note e chi lavora sul loro editor.
> **Risultato:** sapere come si scrive, si discute, si risolve, si cancella e
> si copia un commento in Scrittura, in Lettura e in Sorgente.

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

## Il segno e la discussione

- Accanto al passo, nel margine destro del foglio, un segno dice chi ha
  cominciato (le iniziali in un pallino colorato) e quanti messaggi ha la
  discussione. Due segni vicini non si coprono: il secondo scende. Quando il
  margine non ha posto (a 700 px, sul telefono, con la pagina larga) il segno
  sta nel testo, subito dopo il passo, più piccolo della riga. Lo stesso in
  Lettura. Un commento su un punto non ha segno: sta nel pannello.
- Un clic sul segno (o Invio quando ha il fuoco) apre la discussione: la
  citazione del passo, i messaggi con chi e quando («ieri 17:40», il giorno del mese,
  l'anno se è un altro), il campo per rispondere (Ctrl Invio, ⌘ Invio su macOS, invia),
  poi «Risolvi» ed «Elimina». Un messaggio senza autore si legge «Senza
  nome», col pallino grigio. Esc chiude, e il fuoco torna dove stava.
- Se la nota cambia mentre la discussione è aperta, la discussione segue il
  suo passo; se il commento non c'è più (cancellato, o cambiato sul disco),
  si chiude e un avviso lo dice.

## Scrivere un commento

- Si seleziona del testo e si preme Ctrl Alt M (⌘ ⌥ M su macOS); lo stesso
  gesto è l'azione dell'editor `markdown.comment.add`, per la barra di
  formato e i menu. Si apre il primo
  messaggio, con la citazione e, in fondo, ciò che finirà nel file
  (`{==…==}{>>…<<}`). Senza selezione il commento va sul punto del cursore.
- Una selezione su più blocchi diventa un commento sul primo blocco, e il
  primo messaggio lo dice. Nel codice e nelle formule un commento non sta: va
  su un punto, subito dopo il blocco, e il primo messaggio lo dice.
- La firma viene da Impostazioni › Profilo (`profile.name`, di questa
  macchina). Al primo commento, se manca, il primo messaggio la chiede, con
  l'avviso che il nome finisce nel file. Ogni vault sceglie come firmare
  (`comments.author`): il nome, le iniziali o nessuna firma; senza firma il
  messaggio ha solo la data.
- In una nota in sola lettura i commenti si leggono: la discussione non ha il
  campo né i pulsanti, e Ctrl Alt M lo dice con un avviso.

## Risolvi, Elimina e i risolti

- **Risolvi** toglie i segni (il passo resta testo della nota) e archivia la
  discussione in fondo alla nota, in commenti `%%` che la Scrittura e la
  Lettura non mostrano: il formato è in
  [Convenzioni delle note](../reference/note-conventions.md#larchivio-dei-risolti).
  In Scrittura l'archivio torna a vista quando il cursore ci entra; in
  Sorgente si vede sempre.
- **Elimina** toglie tutto: segni e messaggi.
- Ogni gesto (scrivere, rispondere, risolvere, eliminare, svuotare) è un passo
  d'annullamento solo. Dopo Risolvi, Elimina e Svuota un avviso offre
  «Annulla»; se nel frattempo la nota è cambiata, «Annulla» rimette ciò che
  il gesto ha tolto senza toccare il resto.
- Risolvere dopo un cambio esterno lavora sul testo di adesso: la
  discussione che si risolve è quella che la nota ha in quel momento.

## Il pannello «Commenti»

Nell'ispettore, accanto agli altri pannelli della nota. Elenca prima i
commenti aperti, in ordine di testo, con la citazione, chi e quando, il primo
messaggio e il numero delle risposte; poi «Risolti», le discussioni
dell'archivio, con la citazione e il numero dei messaggi. Un clic (o Invio)
su un aperto porta al passo e apre la discussione. «Svuota i risolti»
toglie l'archivio, ed è un passo d'annullamento. Il pannello legge il testo
della nota che si sta scrivendo, senza passare dal kernel, e si aggiorna poco
dopo l'ultima battuta.

## Scrivere e cancellare

- Il cursore salta ogni segno nascosto come un pezzo solo: `{==` è un pezzo,
  `==}` con i messaggi che lo seguono un altro. Backspace e Canc accanto a un
  segno lo saltano e cancellano la lettera che si vede; Ctrl Backspace e Ctrl
  Canc (Alt su macOS) la parola che si vede.
- Scrivere dentro il passo è scrivere nel testo della nota: il commento resta
  attaccato al passo che cresce.
- Una selezione che prende un segno nascosto senza prendere tutto il commento
  cancella soltanto il testo che si vede: i segni e i messaggi restano. Ciò che
  si scrive al posto della selezione entra al primo carattere visibile tolto.
  Vale per ogni cursore quando ce ne sono più d'uno, per il trascinamento (il
  testo trascinato arriva senza i segni che ha tagliato) e per i comandi di Vim
  (`x`, `dw`, `diw`).
- Un gesto di formato (Ctrl B e gli altri) su una selezione che taglia un
  commento si allarga al commento intero: da «Il» alla fine di «passo», Ctrl B
  dà `**Il {==passo==}{>>…<<}**`. Una selezione tutta dentro il passo formatta
  il testo commentato, dentro i segni.
- Cancellare tutto il testo di un passo toglie anche il commento, nello stesso
  passo d'annullamento, e un avviso lo dice: «Commento tolto insieme al testo
  commentato», con «Annulla». Se nel frattempo il testo non è cambiato,
  «Annulla» rimette testo e commento; altrimenti rimette i messaggi dove stava
  il passo, come commento su un punto, perché la discussione non vada persa.
  Ctrl Z fa lo stesso dell'annullamento.
- Una nota aperta in una scheda della lavagna ha la stessa superficie, e le
  stesse regole.
- Le modifiche che non vengono dalla tastiera (un'altra superficie sulla stessa
  nota, il file cambiato sul disco) restano come sono.

## Copiare, tagliare e incollare

- Il testo semplice di una copia è il Markdown della selezione. Un commento che
  sta tutto nella selezione si copia intero; uno preso a metà perde i segni e i
  messaggi che cadono nella selezione, così copiare il passo evidenziato dà il
  passo e basta. Vale per Ctrl C e Ctrl X, per Copia e Taglia del tasto destro
  e per «Copia come Markdown, HTML o testo», in Scrittura e in Lettura; in
  Sorgente si copia ciò che è scritto, segni compresi. Anche il numero di
  parole della selezione nel menu conta il testo che si legge.
- Tagliare tutto il testo di un passo lo sposta col suo commento, come in Word:
  gli appunti di Fub portano il commento intero (il Markdown coi segni e i
  messaggi), il testo semplice resta il passo senza segni. L'avviso dice «Il
  commento è andato col testo tagliato: incollalo per rimetterlo», con
  «Annulla». Incollando in Fub, con Ctrl V o con Incolla del tasto destro, il
  commento torna attaccato al testo nel posto nuovo; «Incolla come testo»
  incolla il passo e basta, e nel codice entra sempre il testo semplice. Un
  taglio di una parte del passo, o la sola copia, restano come sopra. Taglia
  e Incolla del tasto destro passano dagli appunti del sistema, che non hanno
  il tipo di Fub: Fub ricorda l'ultimo taglio, e lo dimentica quando la
  finestra perde il focus o si nasconde e quando gli appunti hanno un altro
  testo, così un commento non si attacca mai a un testo copiato da un'altra
  app.
- Un taglio mostra un avviso solo, quello del taglio; Canc e Backspace quello
  del commento tolto.
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
la cancellazione e l'avviso stanno in `comments/mask.ts`, la copia e il taglio
che porta il commento in `comments/copy.ts` (l'incolla in `paste.ts`, i gesti
del menu in `surface.ts`), la Sorgente in `comments/source.ts`, la Lettura in
`render-inline.ts`, l'allargamento dei gesti di formato in `format-toggle.ts`;
`comments/threads.ts` legge dall'albero i commenti di un tratto per chi lavora
fuori dalla resa.
Il segno, la discussione e il pannello stanno in `comments/`: `model.ts`
(leggere le discussioni, la firma, dove va un commento nuovo), `resolve.ts`
(Risolvi, Elimina, l'archivio), `margin.ts` (il margine, il segno nel testo,
l'archivio nascosto), `thread.ts` (il riquadro della discussione e del primo
messaggio), `discussions.ts` (i gesti, l'annullamento, gli avvisi),
`inspector.ts` (il pannello) e `author.ts` (la firma dalle impostazioni);
`surface.ts` li monta. Le impostazioni `profile.name` e `comments.author` sono
in `crates/fub-host/src/settings/specs.rs`. Il numero di parole della nota (la banda, il pannello delle statistiche,
`fub-cli wordcount`) lo conta il kernel in `crates/fub-features/src/stats.rs`,
sul sorgente senza i segni e i messaggi dei commenti; allo stesso modo la riga
«Selezione» del pannello, sul testo selezionato che la shell gli passa com'è
scritto. I colori sono della
pelle (`theme/scrittoio/skin/rich.css`, componente `note-comments` dell'anatomia; il segno,
la discussione e il pannello in `theme/scrittoio/skin/document-meta.css`, componenti
`document-comment-margin`, `document-comment-discussion` e
`document-comments-panel`).

## Limiti

- Con modifiche non ancora salvate la riga «Selezione» del pannello delle
  statistiche toglie solo i commenti che il file salvato ha già: un commento
  appena scritto si conta coi suoi segni fino al salvataggio.
- In Lettura un commento su un punto non ha segno: si apre dal pannello.
- Una riga che ha la forma dell'archivio dentro un blocco di codice si legge
  come archivio nel pannello.
- In Vim `l` e `h` attraversano un segno nascosto un carattere alla volta (una
  coda lunga chiede decine di battute), come gli indirizzi nascosti dei link.
