# I tipi di nota nell'editor

> **Per chi:** chi scrive note di un tipo (Libro, Progetto, Riunione) e chi
> lavora su «Nuova nota», sulla testata o sul cassetto delle note.
> **Risultato:** sapere che cosa chiede «Nuova nota», che cosa mostra la
> testata di una nota con un tipo, dove scrive «In evidenza» e dove sta nel
> codice.

Un tipo è una nota della cartella dei tipi (`Tipi/` di partenza): il suo
frontmatter dice icona, proprietà, quali stanno in evidenza e in che cartella
nascono le note; il corpo è il modello. Una nota dice il suo tipo con
`tipo: "[[Tipi/Libro]]"`. La forma del file, la creazione da un tipo e i casi
che non vanno lisci li dicono le
[convenzioni delle note](../reference/note-conventions.md); qui sta ciò che si
vede nell'editor.

## «Nuova nota» chiede il tipo

Se il vault ha dei tipi, «Nuova nota» (il comando, Ctrl+N, e la voce «Nota»
del menu [«Nuovo»](editor-menus.md#il-menu-nuovo) che il «+» del cassetto apre)
apre sotto il «+» il menu «Nuova nota di tipo»: in cima «Nota», la nota
semplice, già scelta; sotto un tassello per tipo, con la sua icona, il nome e
le proprietà che porta (quelle in evidenza, o le prime tre; senza proprietà la
cartella dove nasce). Il piede ricorda dove stanno i tipi.

- Invio a menu appena aperto crea la nota semplice, come senza tipi; frecce e
  Invio scelgono un tipo; Esc o un clic fuori non creano niente.
- Un tipo nasce col suo modello e le sue proprietà vuote, nella cartella del
  tipo; senza una cartella sua, in quella della nota aperta o nello spazio
  attivo. Il nome è quello di una nota senza titolo che non c'è ancora: una
  nota nuova non sovrascrive mai un file.
- Un tipo che non si legge si vede nel menu, spento, e dice perché.
- Senza tipi, o se l'elenco non si legge, la domanda non c'è: nasce la nota
  semplice. Una nota che non nasce non apre niente, lascia il disco com'era e
  l'avviso dice perché.

## La testata di una nota con un tipo

Quando `tipo` nomina un tipo che si legge, la testata mette in evidenza `tipo`
e poi le proprietà in evidenza del tipo, nel suo ordine; le altre stanno dietro
«Altre N proprietà». Se la nota non ha un'icona sua mostra quella del tipo, un
poco più tenue; toccarla sceglie un'icona per la nota sola. La testata segue il
tipo quando il file del tipo cambia, anche mentre è aperto in un'altra
linguetta.

Quando il tipo non va, la testata lo dice sotto il titolo, senza toccare la
nota:

- **non c'è** (rinominato, spostato o mai scritto): «Scegli il tipo»;
- **più tipi con quel nome**: «Scegli il tipo»;
- **non si legge** (frontmatter rotto): «Apri il tipo» e «Scegli il tipo».

«Scegli il tipo» apre l'elenco dei tipi e scrive nel testo della nota, in un
solo passo d'annullamento, il link nuovo e le proprietà del tipo che mancano,
vuote; non toglie niente. In sola lettura l'avviso resta e il pulsante no.

## «In evidenza» scrive nel tipo

In una nota con un tipo, «Metti in evidenza» e «Togli dall'evidenza» del menu
di una proprietà cambiano `featured` nel file del tipo, non la nota: vale per
tutte le note di quel tipo. L'avviso lo dice («è in evidenza nelle note di tipo
Libro») e offre «Annulla», che riporta il tipo com'era. Un tipo cambiato
altrove nel frattempo, o che non si scrive, resta com'era e l'avviso dice
perché. `tipo` sta sempre in evidenza e il suo menu non lo offre.

## La sezione «Tipi» del cassetto

Fra le appuntate e «Tutte le note» il cassetto elenca i tipi del vault, con
l'icona, il nome e quante note lo nominano (lo zero non si scrive). Un clic, o
Invio, apre la nota del tipo. Senza tipi, o mentre il filtro delle note è
attivo, la sezione non c'è. Si rilegge quando cambiano le note o la cartella
dei tipi nelle impostazioni.

## La pagina del tipo

In fondo alla nota del tipo, dopo l'ultima riga, la pagina del tipo elenca le
note di quel tipo, per nome, con i valori delle sue proprietà in evidenza
(«Frank Herbert · letto»); il titolo dice quante sono («Note di tipo Libro ·
2»). Un clic apre la nota. Oltre le 50 righe una riga dice quante ne restano;
senza note dice che «Nuova nota» le crea. Valgono tutte le forme di `tipo`
che valgono per la testata; un tipo che non si legge non ha la pagina.

La pagina non è testo: non si scrive nel file, quindi nemmeno nel modello delle
note nuove, e copiare o esportare il tipo non la porta. La disegna il
componente delle proprietà: spento, la pagina non c'è. Si rilegge quando cambia
l'indice, mai per battuta; la nota la mostra o la toglie quando cambia la
cartella dei tipi o la nota viene rinominata dentro o fuori.

## Limiti

- Rinominare o spostare un tipo non aggiorna i `tipo` delle note: i link del
  frontmatter non sono nel grafo dei link. La testata dice che il tipo non c'è
  e «Scegli il tipo» lo rimette.
- La pagina del tipo è un elenco, non una Base: niente colonne, filtri o
  ordini scelti da chi la guarda.

## Dove sta nel codice

- «Nuova nota» e il menu: `apps/client/src/state/new-note.ts`,
  `apps/client/src/ui/note-type-menu.ts`; i dati dei tipi:
  `apps/client/src/state/note-types.ts`, sopra i comandi `note.type.list`,
  `note.type.get` e `note.from_type` (`crates/fub-features/src/properties/`).
- La testata: `markdown/page/note-type.ts` (stato del tipo, avviso, «Scegli il
  tipo»), `page/featured.ts` (l'evidenza del tipo), `page/header.ts`;
  «In evidenza» nel tipo e «Annulla» in `markdown/surface.ts`.
- Il cassetto: `apps/client/src/panels/explorer-types.ts`.
- La pagina del tipo: la vista `note_type_page` in
  `crates/fub-features/src/properties/type_page.rs`, sopra
  `note_types::notes_of_type` (la stessa risoluzione dei conti di
  `typed_notes`, ordinando solo le righe mostrate); il posto in
  fondo alla nota è `markdown/type-page.ts`, acceso da `markdown/surface.ts`.
- Stile: `skin/document.css` (`.cm-fub-page-type-*`), `skin/drawers.css`
  (`.note-type-menu*`). Scene del banco `tipi-*` e `mobile-tipi-*`; prove in
  `src/note-types.e2e.test.ts`, `src/state/new-note.test.ts` e
  `page/note-type.dom.test.ts`, `markdown/type-page.dom.test.ts`; scene
  `tipi-07-pagina` e `tipi-08-pagina-stretta`.
