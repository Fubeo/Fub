# 0123 — Lo slug di un titolo è un posto, non una parola

**Stato**: accolta **Data**: 2026-08-06 **Chiude**: il difetto *«due heading con
lo stesso testo danno lo stesso `id`: lo slug non si disambigua, e un link
interno atterra in silenzio sul primo»* di
[«I difetti da correggere»](../todo.md) **Commit**: *(questo commit)*

---

## La domanda

Una nota con due `## Note` produceva due elementi con lo **stesso** `id`.
`getElementById` restituisce il primo in ordine di documento;
`outline.iter() .find(…)` pure. Quindi un `[[Nota#Note]]` apriva sempre la prima
sezione, e la seconda non era nominabile da **nessuna** sintassi: non un errore,
una destinazione sbagliata, che è il modo peggiore di sbagliare perché non
lascia niente da leggere.

La domanda dietro è più corta della riparazione: **lo slug è una funzione del
testo di un titolo?** Finché la risposta era sì, la disambiguazione era
inesprimibile — e non per modo di dire: il banco di conformità dei provider
(`lo_slug_di_un_heading_e_quello_del_contratto`) asseriva
`h.slug == heading_slug(&h.text)` titolo per titolo, cioè **vietava** a chiunque
scrivesse un provider di disambiguare. Il presidio che teneva ferma la regola
teneva fermo anche il difetto.

La risposta è no. Uno slug è **un posto in un documento**, e la domanda «è già
preso?» non è una domanda sul testo: è una domanda sul documento, e la sua
risposta è **stato**.

## Le due decisioni

**Con che regola si disambigua.** Il primo che chiede una forma la ottiene
esattamente com'era (`heading_slug`), dal secondo in poi si numera in coda:
`note`, `note-1`, `note-2`. È la consuetudine di GitHub — quella che chi scrive
markdown ha già in mano — ma il criterio che l'ha scelta è un altro, ed è che
quella forma è **raggiungibile scrivendola**: `[[Nota#Note 1]]` passa da
`heading_slug` e dà `note-1`, quindi la seconda sezione omonima si nomina senza
imparare una sintassi nuova.

Il primo che tiene la forma pura non è cortesia verso GitHub: è la condizione
perché un documento **senza** omonimi abbia gli stessi id di ieri. Una
disambiguazione che spostasse anche un solo id di un documento senza duplicati
sarebbe una regressione silenziosa su ogni link già scritto dall'utente, ed è il
verso che il presidio guarda per primo.

Il numero è la prima forma **libera**, non un contatore per testo. Con un
contatore, un documento che contiene davvero un `## Note 1` accanto a due
`## Note` avrebbe prodotto due `note-1`: il difetto di partenza spostato di una
riga. Con la ricerca del libero, il terzo diventa `note-2` — e se `note-1` se
l'è già preso un omonimo, il titolo che si chiama davvero «Note 1» prende
`note-1-1` invece di rubarglielo. Non è bello; è **deterministico e unico**, che
sono le due cose che un indirizzo deve essere.

**Chi la possiede: il render o il modello.** Il modello, e il codice lo diceva
già: `render.rs` non costruisce nessuno slug — stampa `block.anchor()` e basta.
Chi lo costruisce è il **parser**, e chi lo legge è il canale dati
(`IndexQuery::Resolve`), l'embed (`section_of`), il pannello outline (che ci
tiene la chiave di riconciliazione dell'albero). Se la disambiguazione fosse
stata una proprietà della proiezione HTML, ognuno di quei tre avrebbe dovuto
rifarla; nel modello, la ricevono tutti senza saperlo.

Da qui la forma: `HeadingSlugs` nel contratto, uno per documento, e nel parser
**una** chiamata usata due volte — lo slug dell'outline e l'ancora del blocco
sono la stessa assegnazione, non due chiamate che si danno la stessa risposta
per fortuna. Chiamarlo due volte è il modo esatto in cui una disambiguazione si
trasforma nel difetto che voleva chiudere: `note` all'outline e `note-1` al
blocco, cioè un id nell'HTML che nessuna query sa più nominare. Il presidio lo
prova, e lo prova rosso.

## Chi genera e chi cerca sono la stessa cosa in due versi

È la forma della
[0121](0121-l-id-del-contenuto-vive-in-un-altro-spazio-di-nomi.md), applicata a
un'altra coppia. Là erano l'`id` che si scrive e il `#frammento` che lo cerca, e
la risposta era una funzione sola. Qui sono l'allocatore che assegna e la regola
che risolve, e la risposta è che vivono adiacenti nel contratto: `HeadingSlugs`
e `heading_matches`.

Perché contava: i posti che risolvevano un `#Sezione` erano **due, e diversi**.

- `CoreIndex::position_in` confrontava `heading_slug(query)` con `h.slug`;
- `section_of` (che serve `render_embed`) confrontava `resolution_key(query)`
  con `resolution_key(h.slug)` **oppure** con `resolution_key(h.text)`.

Trovavano lo stesso titolo finché il titolo era uno, quindi nessun test le
vedeva divergere: erano d'accordo per la ragione sbagliata — atterravano
entrambe sul primo di due omonimi. Sulla disambiguazione si sarebbero separate
subito, perché `resolution_key("Note 1")` è `note 1` e non `note-1`: il link
avrebbe aperto la seconda sezione e l'embed della stessa scritta ne avrebbe
mostrata un'altra, o nessuna.

`heading_matches` tiene tutt'e due le strade, perché rispondono a due modi di
scrivere: chi scrive `#Note 1` nomina lo **slug** (ed è così che si raggiunge un
omonimo), chi scrive `#Ciao, Mondo!` nomina il **titolo** com'è, punteggiatura
compresa. La prima vince sulla seconda perché è l'unica che sa distinguere gli
omonimi. E l'ancora che il resolver restituisce adesso è quella del titolo
trovato, non quella ricalcolata sulla domanda: chi la riceve ha diritto all'id
vero, quello che nell'HTML esiste davvero.

## Le premesse cadute

**Falsa, ed era l'ancoraggio del difetto: «`render.rs` · la funzione che
costruisce lo slug di un heading, e il ramo che rende un `Block::Heading`».** In
`render.rs` non c'è nessuna funzione che costruisca uno slug, e il ramo
dell'heading non lo tocca: `anchor_attr(block)` stampa `block.anchor()` per
**ogni** blocco allo stesso modo. Sembrava vera per una ragione onesta — il
sintomo si vede nell'HTML, e chi scrive l'HTML è il renderer — ma il renderer è
il testimone, non l'autore. Se la riparazione fosse andata dove il difetto la
mandava, sarebbe nata nel posto in cui il resolver è **obbligato** a rifarla.

**Falsa a metà: «un contatore di duplicati è stato, e lo stato è la cosa che
diverge: chiediti chi lo possiede e se può essercene uno solo».** Vera la
diagnosi, falso l'implicito che il pericolo fosse *tenere* lo stato. Ce n'è uno
solo — un `HeadingSlugs` per documento, in `Acc` — e il modo di sbagliare che
resta non è averne due: è **leggerne uno due volte**. È il red che si vede
peggio, perché il codice sbagliato è più corto di quello giusto.

**Vera, e più corta di come suonava: la 0121 aveva spostato il difetto, non
chiuso.** Il prefisso `fub-contenuto-` risolveva la collisione fra contenuto e
shell, che è un'altra coppia; questa è la collisione del contenuto **con sé
stesso**, e il prefisso la conserva identica.

## Quanti erano

Uno dichiarato (`render.rs`), tre che **costruiscono** uno slug e tre che lo
**risolvono**:

1. `fub-abi/src/model.rs` — `heading_slug`, la regola;
2. `fub-format-markdown/src/parse.rs` — lo slug dell'outline;
3. `fub-format-markdown/src/parse.rs` — l'ancora del `Block::Heading`, dalla
   stessa espressione ma chiamata a parte;
4. `fub-sdk/src/testing/conformita.rs` — il banco che la rendeva inesprimibile;
5. `fub-kernel/src/index/core.rs` — `position_in`, il resolver del canale dati;
6. `fub-kernel/src/workspace.rs` — `section_of`, il resolver dell'embed, con una
   regola **diversa** dalla precedente.

Lato shell zero: `frontend/src/ui/sanitize.ts` prefissa un nome, non lo genera,
e nessun modulo del frontend costruisce uno slug da un testo — l'outline gli
arriva già fatto dal kernel. Il fattore rispetto al dichiarato è 6×, e i due che
contavano — il quarto e il sesto — stavano **fuori** dalla frase del difetto.

## Chi se ne accorge se torna

Quattro presidi, ognuno provato rosso rimettendo il codice vecchio, uno per uno.

- **La regola, nel contratto** (`fub-abi`): due omonimi non condividono un id, e
  — il verso che protegge i link già scritti — un elenco senza omonimi dà
  esattamente `heading_slug` titolo per titolo. Rosso togliendo la ricerca del
  libero.
- **Il provider** (`fub-format-markdown`): gli `id` dell'HTML sono tre diversi,
  e l'ancora di ogni blocco È lo slug del suo posto nell'outline. Rosso due
  volte, e in due modi diversi: senza allocatore (`note`, `note-1`, `note`) e
  con l'allocatore chiamato **due volte** sullo stesso titolo (`note-1-1` nel
  blocco contro `note-1` nell'outline) — che è il difetto che la riparazione
  poteva generare.
- **L'accordo fra i due lati** (`fub-features`, e2e su un vault vero): `#Note`
  resta la prima sezione, `#Note 1` atterra sulla seconda, ogni ancora che il
  resolver restituisce esiste davvero nell'HTML reso, e l'embed ritaglia la
  stessa sezione che il link apre. Rosso cambiando **un solo** lato: col
  generatore vecchio, e — separatamente — con ognuno dei due resolver rimesso
  alla sua vecchia regola.
- **Il corpus**: `due heading omonimi` è una voce del corpus condiviso, quindi
  la conformità si misura su un documento che ce li ha. Senza, il banco sarebbe
  passato senza aver provato niente — è la trappola della
  [0054](0054-il-banco-del-lato-provider.md), e qui era a un passo: la funzione
  di conformità è stata riscritta e il corpus non aveva un solo caso che la
  esercitasse davvero.

Il banco confronta l'outline **intero** contro `heading_slugs`, non un titolo
alla volta. Non è una comodità: è ciò che rende la disambiguazione un'
**obbligazione** per ogni `FormatProvider` che verrà, invece del divieto che era
prima.

## Il limite, dichiarato

Resta il residuo che la [0122](0122-una-sorgente-non-degrada-si-rifiuta.md)
aveva già nominato dall'altro lato: l'ancora **esplicita** di un heading
(`## Titolo ^xyz`) finisce in `DocumentModel.anchors` ma non nell'albero, perché
`Block::Heading.anchor` porta lo slug. Sarebbe la via naturale con cui un utente
disambigua *a mano* due sezioni omonime, e oggi non ha effetto sull'`id` reso.
Si ripara nel modello — dove sta la disambiguazione da questo verbale in poi — e
non è stata toccata qui perché è una firma, non un difetto: `anchor` è uno solo
e i candidati sono due.
