# Proiezione dei documenti di videoscrittura

> **Ambito:** il JSON che `read_document` e `write_document` scambiano per un
> documento di `fub-format-rich` (`"format": "fub-rich"`, versione 4): i
> campi di tratti, oggetti e paragrafi, commenti, pagina, inchiostri e
> disegni, blocchi chiusi, versioni e schema dei dati opachi. Le porte sono
> nel [contratto IPC](ipc-contract.md#documenti-di-videoscrittura).
> **Fonti autorevoli:** `crates/fub-format-rich/src/projection.rs` e
> `apps/client/src/editors/rich/projection.ts`, con le fixture
> `apps/client/src/__fixtures__/rich-projection.json` e `rich-closed.json`.

## Campi

Un tratto, un oggetto e un paragrafo (per il suo segno di fine) portano
`ins` e `del` quando sono una revisione tracciata: `{"by", "at", "mv"}`,
autore, data e nome dello spostamento, ciascuno assente se vuoto. Due
revisioni con gli stessi campi sono la stessa; togliere `ins` o `del` la
accetta o la rifiuta.

I commenti sono l'elenco `comments`, fra `styles` e `blocks`: `{"id", "k",
"by", "at", "parent", "done", "text"}`, con `parent` l'id del commento a cui
risponde e `done` risolto. Di un commento con `k` cambia soltanto `done`; uno
senza `k` è nuovo, e `text` ne è il testo semplice, un paragrafo per riga.
L'intervallo è segnato da due oggetti `marker` con `"comment": {"id", "end"}`:
uno nuovo non ha `k`. Un segno senza il suo commento si toglie; due commenti
con lo stesso id, o una risposta senza il suo, sono una proiezione malformata.
Il codec ODT rifiuta un elenco non vuoto.

`"track": true`, fra `readonly` e `lang`, dice che il documento registra le
modifiche (assente quando non lo fa): la shell scrive ciò che cambia come
revisioni `ins` e `del`, e il codec salva l'impostazione con il documento. Il
codec ODT rifiuta `track`.

`roles`, fra `styles` e `page`, è l'aspetto del carattere che lo stile di
ogni ruolo darà a un paragrafo: `{"h", "quote", "list", "align"}`, con `h` un
aspetto per livello di titolo (senza i livelli vuoti in fondo) e ciascun
campo assente se vuoto. `align` è l'allineamento che lo stile di ogni ruolo
dà: `{"body", "h", "quote", "list"}`, con `h` un valore o `null` per livello,
e a sinistra ciò che manca. Anche una voce di `styles` può portare il suo
`align`. Sono suggerimenti di resa, come `f`: la shell li ricopia in un
paragrafo che cambia ruolo o stile (l'allineamento soltanto se seguiva lo
stile di prima), e il ritorno al documento li ignora.

`page` è la pagina di una sezione in punti, `{"w", "h", "top", "bottom",
"left", "right", "cols", "start"}`, con `w` e `h` già nel verso della pagina,
`cols` assente quando è una e `start`, dove comincia la sezione
(`continuous`, `even_page`, `odd_page`, `next_column`), assente quando
comincia a pagina nuova (`next_page`). La porta il paragrafo che chiude la sezione, dopo
`sect`, e la testa della proiezione per l'ultima, fra `styles` e `comments`.
Il codec la rilegge al ventesimo di punto e rifiuta lati fuori da 7,2–1584,
margini negativi o che lasciano meno di 36 punti al testo, `cols` fuori da
1–12 e una pagina su un paragrafo senza `sect`; cambiare `cols` rende uguali
le colonne. Il codec ODT rifiuta `page`.

`header` e `footer`, dopo `page`, sono l'intestazione e il piè di pagina
della stessa sezione (quelli delle pagine senza uno proprio): `{"lines":
[[…]], "locked"}`, una riga per paragrafo, ogni pezzo una stringa o
`{"field": "page" | "pages"}`. Assenti, la sezione mostra quelli della
sezione prima. Uno `locked` non si cambia; una riga che va a capo, un elenco
di righe vuoto o un `locked` cambiato sono una proiezione malformata. Il
codec ODT li rifiuta.

Un oggetto nuovo (`"t": "atom"` senza `k`) di specie `field` con `"toc": N`,
dopo `end`, è un sommario dei titoli fino al livello N (1–9): il codec Word
lo scrive come campo `TOC` da ricalcolare all'apertura, e rifiuta un `toc`
fuori da 1–9 o su un'altra specie; il codec ODT lo rifiuta.

Dalla versione 4 un oggetto può essere un inchiostro (`"kind": "ink"`) o un
disegno (`"kind": "drawing"`), e porta, dopo `comment`, tre campi
facoltativi:

- `ink`, i tratti: `{"strokes": [{"color", "width", "hl", "xy", "p",
  "pen"}]}`, con `color` in `#rrggbb`, `width` in punti, `hl` vero per
  l'evidenziatore, `xy` le coordinate in punti dall'angolo in alto a
  sinistra dell'oggetto, una dopo l'altra, `p` la pressione di ogni punto da
  0 a 1, assente senza penna, e `pen` la penna di Fub (`fountain`,
  `calligraphy`…), assente per quella di serie. Un inchiostro tenuto lo
  porta da vedere quando il file ha InkML che si legge; uno nuovo ne è il
  contenuto, con il PNG di ripiego in `data`, e il codec Word lo scrive come
  InkML in `w14:contentPart`. La penna diventa le proprietà del pennello che
  Word conosce (la Calligrafia una punta rettangolare, il Pennarello
  `ignorePressure`) più `fubPen`, che Word ignora e Fub rilegge;
- `svg`, il disegno di FubDraw: un disegno nuovo lo porta con il PNG di
  ripiego in `data`, e il codec Word lo scrive come `asvg:svgBlip` accanto
  all'immagine;
- `float`, dove sta un oggetto fuori dal testo: `{"wrap", "x", "y"}`, con
  `wrap` `square`, `front` o `behind` («Stretto», «Attraverso» e «Sopra e
  sotto» di Word arrivano come `square`) e `x`, `y` in punti dal margine
  sinistro della colonna e dall'inizio del paragrafo dell'ancora. Assente,
  l'oggetto è in linea. Lo portano un oggetto tenuto e uno nuovo di specie
  `image`, `ink` o `drawing`.

Per cambiare un inchiostro tenuto la shell lo rimanda nuovo, senza `k`. Un
`ink` su un'altra specie, un `svg` fuori da `drawing` o un `float` su un
oggetto nuovo che sta nel testo sono una proiezione malformata. Il codec ODT
scrive un disegno nuovo in linea come `draw:frame` con l'SVG e il PNG, e lo
rilegge come immagine; rifiuta un inchiostro, che la shell gli manda come
disegno, e un disegno nuovo con `float`.

Una nota tenuta (`"kind": "note"` con `k`) porta, da leggere, il testo della
sua parte in `note` (un paragrafo per riga) e `"end": true` se è di chiusura:
la superficie la numera e la mostra al passaggio. Il ritorno al documento li
ignora, perché vale la nota tenuta nel `k`; su un'altra specie tenuta sono una
proiezione malformata.

Un blocco del corpo (paragrafo o tabella, non i blocchi dentro una cella)
che il codec non riscriverebbe senza perdite porta `"locked": true`, subito
dopo `role` nel paragrafo e dopo `t` nella tabella: il salvataggio lo lascia
i byte del file. Toglierlo, cambiarlo o togliergli il segno viene rifiutato
(`host.rich.locked.block`, con il numero del blocco da 1); spostarlo intero
si può. `"body_only": true`, fra `readonly` e `track`, dice che il codec non
riscriverebbe senza perdite qualcosa fuori dal corpo, o che un blocco è
chiuso: si salvano soltanto i blocchi del corpo, per innesto, e un
salvataggio che tocca altro (pagina, intestazioni, commenti, note) o che
l'innesto non sa trattare viene rifiutato (`host.rich.locked.outside`).
Entrambi sono assenti quando sono falsi.

Un documento che il codec o la proiezione non riportano identico si apre con
`"readonly"` nella proiezione (`revisions`, `track_changes`, `protected`,
`projection`, `codec`, `import`) e ogni scrittura viene rifiutata con il suo
motivo. `import` è il motivo di ogni documento `rtf` e `doc`, e di un `odt`
che il codec OpenDocument non sa rappresentare: lo legge un importatore che non
riporta il file intero. Un file nuovo `rtf` o `doc` non si crea
(`host.rich.no_writer`); un `odt` sì.

`missing`, subito dopo `readonly`, dice dove sta ciò che manca quando il
motivo ha un posto: `[{"what", "block"}]`, con `block` l'indice del blocco
del corpo, assente se non sta in un blocco. Per `revisions` le voci sono
`format` (una revisione di formato, nel suo blocco) e una per specie di parte
con revisioni (`header`, `footer`, `note`, `comment`, `text_box`); per
`projection` i blocchi che non tornano identici (`changed`). `outside` è
qualcosa fuori dal corpo senza un posto da dire. L'elenco ha al più 50 voci,
è assente quando è vuoto e il ritorno lo ignora. Il codec ODT non lo scrive.
`opaque_schema`, subito dopo `version`, è lo schema dei dati opachi (`k` e
`sect`, JSON del modello del motore in base64), che si incrementa quando
cambia la loro forma serializzata: lo schema 2 aggiunge all'1 il campo
facoltativo `eastAsianLayout` delle proprietà del carattere, il 3 altri campi
facoltativi (`langEa` del carattere, `z` di un oggetto mobile, `outlineFill`
e `size` di forme e filigrane) e il riempimento trasparente o sfumato di una
forma come oggetto con `type`, accanto al colore `[r, g, b]`. Il codec legge
gli schemi che elenca, ciascuno con la sua regola: lo 0, l'1, il 2 e il 3,
perché ciascuno ha la forma del successivo senza i suoi campi facoltativi. La
versione 3 ha le chiavi della 4, senza inchiostri e disegni; la 2 quelle
della 3 senza `locked` e `body_only`; la 1, quella
delle bozze di prima, quelle della 2 senza `opaque_schema`, e i dati dello
schema 0. La shell legge le quattro versioni, ciascuna con il suo elenco chiuso di
chiavi, e ricopia versione e schema come li ha ricevuti. Il codec legge
formato, versione e schema prima del resto, e rifiuta una versione futura
(`host.rich.version`) e uno schema che non legge, scritto da un Fub più nuovo
(`host.rich.opaque_schema`), anche quando portano campi che non conosce; un
dato opaco che, decodificato e riscritto, perderebbe un campo è una
proiezione malformata, anche quando il campo sconosciuto vale `null`, `[]` o
`{}`.

Gli errori del codec arrivano tipizzati con chiave di catalogo `host.rich.*`.
La forma della proiezione è di `crates/fub-format-rich/src/projection.rs`; la
fixture `apps/client/src/__fixtures__/rich-projection.json` la lega alla
shell nei due versi, e `rich-closed.json` ne porta i blocchi chiusi
(`crates/fub-format-rich/tests/ts_projection.rs`).
