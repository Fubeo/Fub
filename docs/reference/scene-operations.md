# Operazioni sulla scena

> **Ambito:** le operazioni che modificano un disegno di FubDraw, versione 1:
> forma, esiti, validazione, limiti, `TextOperation`, undo e concorrenza nella
> sessione live.
> **Fonti autorevoli:** `apps/client/src/editors/spatial/scene/` (`ops.ts`,
> `engine.ts`, `diff.ts`), la pila di undo in
> `apps/client/src/editors/spatial/tools/history.ts` e i vettori scritti a
> mano in `apps/client/src/__fixtures__/scene-ops/`.

La superficie spaziale cambia un disegno soltanto con operazioni. Le usano tre
consumatori: l'undo di ogni superficie, la `TextOperation` che la superficie
consegna alla `DocumentSession` e la sessione live, con i commit dal tablet e
l'eco dal PC. Gli elementi sono quelli del
[formato della scena](scene-format.md); il perché sta
nell'[ADR 0203](../decisions/0203-superfici-spaziali.md). I `§` dei commenti
del motore sono le sezioni di questa pagina; quelli del formato si citano come
«formato della scena, §N».

## 1. Dove vive

- **Applicazione:** il motore è TypeScript, in
  `apps/client/src/editors/spatial/scene/`. Lo usa la superficie della shell,
  e lo stesso codice servirà al client che scrive dal tablet.
- **Rust:** `fub-scene` non applica operazioni. Legge i testi dei vettori di
  prova (§9) e verifica che si analizzino senza errori.
- **Un motore in Rust** nascerà solo con un consumatore Rust delle operazioni.

## 2. Forma

Le operazioni sono oggetti JSON con il campo `op`. La versione del protocollo
sta nell'involucro del messaggio live, non nella singola operazione.

### Elemento (`Elem`)

```json
{
  "tag": "path",
  "attrs": { "id": "o7k2m9x4q", "fub:tool": "pen", "fill": "#0072b2", "fub:brush": "pf1 size=4 …", "fub:ink": "1 s100 cxypt …" },
  "children": [],
  "text": null
}
```

- **`attrs`:** i valori sono sempre stringhe; gli attributi con un namespace
  si scrivono con il prefisso (`fub:ink`, `xlink:href`).
- **`children`:** per `g`, `a` e `text`, per la `defs` della radice, le
  [risorse](scene-format-resources.md) e il loro contenuto; `title` e `desc`
  sono figli ammessi di qualunque elemento.
- **`text`:** solo per `tspan`, `textPath`, `title` e `desc`.
- **`runs`:** al posto di `text`, per un `tspan` che è una riga di un `text`,
  o per il suo `textPath`: il testo della riga e i suoi pezzi, nella forma
  dell'operazione `text` ([testo](scene-format-text.md), §7). Tutti e due
  insieme sono `invalid-elem`.

### Posizione (`Pos`)

`{ "last": true }` mette l'elemento in cima all'ordine visivo, il caso normale;
gli altri valori sono `{ "first": true }` e `{ "after": "<id del fratello>" }`.
La radice, come genitore, si scrive `"#root"`, che non è un id valido. Sotto la
radice `first` vuol dire subito dopo `title`, `desc`, le `defs` e la carta che
stanno in testa, mai prima, e per una `defs` subito dopo `title` e `desc`,
quindi prima della carta; in un livello o in un gruppo, subito dopo i loro
`title` e `desc`.

### Bersaglio (`target`)

Un bersaglio è un id. Per un elemento senza id è
`{ "path": [i0, i1, …], "tag": "…" }`, cioè gli indici dei figli elemento a
partire dalla radice. Il percorso vale solo se l'elemento in quella posizione
non ha id e ha quel tag; altrimenti l'operazione è rifiutata con
`missing-target`.

- Un elemento **modificabile** senza id riceve un id con `ident`, nello stesso
  `batch` dell'operazione che lo modifica.
- Un id si cambia con un `batch` di due `ident` sullo stesso percorso: il
  primo toglie l'id, il secondo dà quello nuovo. L'annulla rimette l'id di
  prima com'era scritto.
- Un elemento **estraneo** senza id si indirizza con il percorso, solo per
  `remove` e `move`.
- Commenti, istruzioni di elaborazione e testo non si indirizzano: restano
  dove sono.

### Le operazioni

| `op` | Campi | Effetto | Inversa |
|---|---|---|---|
| `add` | `parent`, `pos`, `elem` oppure `raw` | inserisce l'elemento | `remove` con lo stesso `id`, o col percorso |
| `remove` | `target` | elimina l'elemento con i suoi figli | `add` con l'elemento tolto e il suo posto |
| `set` | `id`, oppure `#root`; `attrs` (una stringa, oppure `null` per togliere) | cambia attributi | `set` con i valori precedenti |
| `text` | `id`, `lines` (una riga è una stringa, o la lista del suo testo e dei suoi [pezzi](scene-format-text.md)), `joins` facoltativo | sostituisce le righe di un `text` | `text` con le righe precedenti, pezzi compresi, e i `joins` di prima se l'operazione ne aveva o una riga aveva un `fub:join` |
| `move` | `target`, `parent`, `pos` | sposta l'elemento: ordine o livello | `move` alla posizione precedente |
| `ident` | `path`, `tag`, `id` (oppure `null` per togliere) | dà un id a un elemento modificabile che non ne ha, o gli toglie quello che ha | `ident` con l'id di prima, o con `id: null` |
| `page` | `viewBox` (`"x y w h"`) | cambia insieme `viewBox`, `width` e `height` della radice e la geometria della carta | `page` con i valori precedenti |
| `meta` | `title`, `desc` (una stringa, oppure `null` per togliere) | crea, cambia o toglie titolo e descrizione della radice | `meta` con i valori precedenti |
| `adopt` | `undo` facoltativo | «Modifica»: aggiunge `xmlns:fub` e `fub:version="1"` alla radice di un documento estraneo | `adopt` con `undo: true`, che li toglie |
| `batch` | `ops`, `label` facoltativo | applica tutte le operazioni oppure nessuna | `batch` con le inverse in ordine inverso |

L'inversa si calcola **quando l'operazione si applica**, leggendo lo stato che
sta per cambiare. Per questo è sempre esatta rispetto alla scena su cui è stata
calcolata.

Tre inverse hanno una forma che scrive soltanto il motore e che la rete non
accetta:

- **`remove`:** l'inversa è `add` con `slot`, `gap` e `raw`. `raw` è
  l'elemento tolto così come era scritto, anche estraneo; `gap` sono gli spazi
  che lo precedevano; `slot` è il punto: il genitore, l'elemento che lo
  precedeva, i commenti o le istruzioni in mezzo e gli spazi rimasti davanti.
- **`move`:** l'inversa è `move` con `slot` e `gap`, e riporta l'elemento al
  punto esatto da cui è partito.
- **`page`:** l'inversa porta `previous`, i valori di prima di `viewBox`,
  `width`, `height` e della carta, compresi quelli assenti.

Altri dettagli:

- **`add` con `raw`:** al posto di `elem`, `raw` porta il testo XML di uno o
  più elementi fratelli, così come vanno scritti: è la forma con cui si
  incolla, e gli elementi restano identici byte per byte, anche quelli che il
  formato non ammette.
  - Il testo è una sequenza di elementi ben formati nei namespace che il
    genitore dichiara (ognuno può dichiararne di suoi), separati soltanto da
    spazi, senza niente prima del primo o dopo l'ultimo.
  - Un elemento che, letto in quel posto, il formato ammette passa dagli
    stessi controlli di `elem` (§4): valori nei limiti di §5, id nella forma
    degli id nuovi, niente carta, livelli solo sotto la radice, titolo e
    descrizione della radice solo con `meta`, tratti che si leggono. Il `d`
    di ogni tratto si riscrive col contorno ricalcolato, al suo posto o, se
    manca, in fondo al tag d'apertura; il resto resta com'è scritto.
  - Un elemento estraneo resta com'è: la forma degli id nuovi non si chiede,
    e il limite del valore di un attributo non vale, perché conta solo
    quello dell'operazione.
  - Ogni `id` della sequenza è nuovo, cioè assente dal documento e diverso
    dagli altri; altrimenti `duplicate-id`.
  - I ritorni a capo diventano quelli del documento. Uno `script` o un
    attributo `on…` restano inerti come in ogni elemento estraneo (S005).
  - `raw` ed `elem` insieme, o nessuno dei due, sono `invalid-elem`.
  - L'inversa è `remove` per un elemento solo e, per una sequenza, un
    `batch` di `remove` dall'ultimo elemento al primo, ognuno con l'id o, se
    manca, col percorso. Un `add` ripetuto, in cui ogni elemento ha un id già
    presente e scritto uguale, è un doppione (§8).
- **`adopt`:** se il prefisso `fub` è già legato a un altro namespace, si usa
  il primo `fubN` libero. L'inversa toglie `fub:version`, e la dichiarazione
  del prefisso solo se nient'altro la usa.
- **`meta`:** una stringa vuota scrive `<title/>` o `<desc/>`, come ogni
  elemento senza testo; `null` toglie l'elemento.
- **`move`:** un livello sta solo sotto la radice; `title` e `desc` non
  entrano né escono dalla radice. Un elemento che spostandosi cambierebbe
  ruolo o namespace è rifiutato con `invalid-elem`.
- **Id toccati:** un `set` su un gruppo o un livello riporta anche gli id dei
  discendenti, perché cambia come si vedono.
- **Risorse:** un riferimento a una risorsa resta vero. In un `batch` la
  risorsa viene prima di chi la usa, togliere una risorsa usata è `in-use`, e
  le risorse di FubDraw che un'operazione lascia senza riferimenti se ne
  vanno con lei: [risorse](scene-format-resources.md), §9.
- **`joins` di `text`:** il `fub:join` di ogni riga di un [testo in
  area](scene-format-text.md#4-il-testo-in-area), una voce per riga, una
  stringa o `null` per nessuno; con `joins` ogni riga prende il suo, senza le
  righe che restano tengono il loro e quelle nuove cominciano un paragrafo.
  Una voce in più o in meno, una voce che non è una stringa o `null`, o un
  carattere che XML non ammette sono `invalid-elem`.
- **`text` su un testo su tracciato:** `lines` ha una riga sola, che diventa
  il contenuto del `textPath`, coi pezzi; il `textPath` tiene i suoi
  attributi, scritti nell'ordine canonico. Più righe, nessuna, o `joins` sono
  `invalid-elem` ([testo](scene-format-text.md#5-il-testo-su-tracciato)).
- **`add` di un testo su tracciato:** il `textPath` non ha id e porta `text`
  o `runs`, senza figli; fuori da un `text` è `invalid-elem`. Il tracciato
  che segue è un `path` in una `defs` della radice, con l'id di una risorsa,
  `r` e otto caratteri, mentre un `path` fra gli oggetti ha l'id di un
  oggetto, `o` e otto caratteri: l'uno al posto dell'altro è `invalid-elem`,
  con `elem` come con `raw`. In un `batch` il tracciato viene prima del testo,
  e un testo che segue un tracciato che non c'è è `invalid-elem`.
- **Il tracciato di un testo** è una risorsa come le altre: toglierlo, o
  togliergli l'id con `ident`, mentre un testo lo segue è `in-use`; un `set`
  del suo `d` sposta il testo, uno che lo renderebbe estraneo, come un
  `transform` o un `d` fuori grammatica, è `invalid-elem`. Togliere il testo
  raccoglie il tracciato `private` e la `fub-defs` rimasta vuota: in avanti è
  un `batch` col `remove` del testo, poi del tracciato e della `fub-defs`, e
  l'inversa li rimette.
- **`set` sulla radice:** con `id` uguale a `#root` cambia soltanto l'unità e
  le guide del documento, `fub:units` e `fub:guides`, coi valori nella loro
  grammatica ([unità e guide](scene-format-rulers.md)). Ogni altro attributo
  è rifiutato con `invalid-elem`, perché il resto della radice cambia con
  `page` e `adopt`. L'inversa è un `set` su `#root` coi valori di prima;
  nessun id è toccato.

## 3. Esiti e precondizioni

`apply(scena, op)` restituisce uno di due esiti:

- `applied`, con l'inversa, gli id toccati e le modifiche di testo (§6);
- `rejected`, con uno dei motivi sotto e un dettaglio leggibile. La scena
  resta invariata.

| Motivo | Quando |
|---|---|
| `missing-target` | il bersaglio non esiste |
| `missing-parent` | il genitore non esiste o non è un livello o un gruppo modificabile |
| `missing-anchor` | l'`after` non esiste, non è figlio del genitore, o è l'elemento stesso |
| `duplicate-id` | `add` con un id già presente e un elemento diverso (§8), o di una risorsa con un id a cui il documento rimanda già |
| `in-use` | `remove` di una risorsa, o di una `defs` che ne contiene, a cui rimanda qualcosa fuori da ciò che si toglie; `ident` che toglie l'id a una risorsa usata |
| `invalid-elem` | tag, attributo o valore fuori dal formato, oppure `fub:ink` non conforme |
| `locked` | il bersaglio o il genitore stanno in un elemento bloccato (`fub:locked="true"`), oppure il bersaglio è la carta, che cambia solo con `page` |
| `foreign` | `set`, `text` o `add` dentro un nodo estraneo |
| `cycle` | `move` dentro un discendente dell'elemento stesso |
| `limit` | operazione oltre i limiti (§5) |
| `read-only` | documento in sola lettura: versione futura, `DOCTYPE`, oltre i limiti di modifica |

In un `batch`, se un'operazione è rifiutata si rifiuta tutto il batch, con
l'indice dell'operazione che ha fallito.

Un elemento bloccato non sta dentro sé stesso: si cambia, si sposta e si
toglie, ed è con un `set` che si sblocca. È bloccato solo ciò che contiene: un
livello, un gruppo o un collegamento bloccati tengono fermi i loro figli, e una
forma bloccata si cambia ancora con le operazioni. Che non si prenda sul foglio
lo decide la superficie, come per le guide bloccate.

## 4. Validazione

- Ogni operazione passa dalla stessa validazione, che venga dall'utente,
  dall'undo o dalla rete: tag e attributi ammessi, numeri finiti, colori,
  grammatica di `transform`, regole di `href`, grammatica e limiti di
  `fub:ink`, chiavi di `fub:brush`, grammatica di `fub:units` e
  `fub:guides`, formato degli id che `add` crea. `ident`
  accetta ogni id che il formato ammette, non vuoto e che nessun altro
  elemento porti; un `set` non cambia `id`.
- L'inchiostro si conserva grezzo, e il contorno `d` ne è solo una
  conseguenza. Un tratto ricevuto dalla rete non porta il contorno: se `d` è
  presente si scarta, e chi possiede il documento lo ricalcola da `fub:ink` e
  `fub:brush`.
- Il contorno si ricalcola in ogni `add` di un tratto e in ogni `set` che
  tocca `fub:ink`, `fub:brush`, `fub:tool` o `d`. Con canali d'inchiostro
  sconosciuti (S010) il contorno non si calcola: un `add` tiene il `d`
  ricevuto, un `set` è rifiutato con `invalid-elem`.
- I valori nuovi si scrivono come arrivano, senza normalizzarli: li giudica la
  classificazione del formato della scena (§4), sull'elemento già scritto.

## 5. Limiti

| Limite | Valore |
|---|---|
| Operazioni in un `batch`, compresi i `batch` annidati | 10 000 |
| JSON di un'operazione | 8 MiB: un'immagine incorporata di 5 MiB occupa circa 6,7 MiB in base64 |
| Valore di un attributo | 512 KiB; per l'`href` di un'immagine 7 MiB |
| Annidamento di gruppi | 32 livelli |

Il limite delle operazioni di un `batch` vale per ciò che arriva al motore.
L'inversa che il motore stesso calcola non lo conta: quella di un `add` con
una sequenza lunga toglie gli elementi uno per uno, e un annulla deve
riuscire anche così.

## 6. Dall'operazione alla `TextOperation`

La `DocumentSession` accetta solo `SurfaceEdit { text, operation }` e verifica
che `operation` trasformi il buffer corrente in `text`. Per questo la scena
tiene, per ogni elemento:

- lo **span** `[from, to)` nel testo corrente, con offset UTF-16 sul testo
  normalizzato a LF, gli stessi di `TextEngine`;
- lo span del solo **tag di apertura** per `g` e `a`;
- il **rientro** della sua riga.

### Regole

- **`add`:** si inserisce `"\n" + rientro + forma canonica` alla fine dello
  span del fratello `after`; con `first` subito dopo il tag di apertura del
  genitore, con `last` prima della riga del tag di chiusura. Un genitore vuoto
  scritto come `<g …/>` si riscrive per intero, in forma aperta, con il figlio
  dentro. Con `raw` si inserisce `raw` al posto della forma canonica, con le
  righe interne come sono e soltanto il `d` dei tratti riscritto.
- **`remove`:** si cancella lo span dell'elemento. Se l'elemento comincia una
  riga, si cancellano anche il ritorno a capo e il rientro che lo precedono,
  così non resta una riga vuota.
- **`set` su `g` o `a`:** si sostituisce solo il tag di apertura, perché i
  figli non cambiano. Un `g` o un `a` autochiuso si riscrive per intero.
- **`ident`, `adopt` e `set` su `#root`:** si riscrive solo il tag
  dell'elemento o della radice, copiando così come sono gli attributi che non
  cambiano.
- **`page`:** si riscrivono il tag della radice e la riga della carta.
- **`meta`:** si sostituiscono, si inseriscono o si cancellano le righe di
  `title` e `desc`, all'inizio della radice.
- **`set` su un altro elemento e `text`:** si sostituisce lo span con la nuova
  forma canonica dell'elemento.
- **Righe nuove di `text`:** una riga nuova copia gli attributi del `tspan`
  precedente tranne `id`, `dy` e `fub:join`. Il `dy` è quello dell'ultimo `tspan` dopo il
  primo che lo scrive; se non c'è, è 1,25 volte il corpo con cui si vede
  l'ultima riga: il primo `font-size` che si incontra salendo dal suo `tspan`
  al `text` e ai contenitori, 16 se nessuno lo scrive. I pezzi della riga
  prima non si copiano.
- **`move`:** una cancellazione e un inserimento, calcolati sul testo di
  partenza, ordinati e non sovrapposti. Le righe interne dell'elemento
  spostato prendono il rientro della nuova profondità, ma solo se cominciano
  tutte con il rientro vecchio; altrimenti, e con `xml:space`, restano come
  sono. Il testo di `tspan`, `textPath`, `title` e `desc` non si tocca.
- **`batch`:** le operazioni si applicano in sequenza a scena e testo. La
  `TextOperation` viene da un diff per righe fra i due testi a LF, che dà a
  ogni blocco la forma delle regole sopra; si verifica applicandola, e se non
  torna si ripiega su `operationFromText(prima, dopo)` di
  `apps/client/src/editors/core/text-operation.ts`, una sola patch
  prefisso/suffisso. Lo stesso diff dà la `TextOperation` di ogni operazione.
  Oltre 512 righe di differenza il mezzo resta una patch sola.

### Invarianti verificate dai test

1. `tryApplyOperation(prima, operation)` restituisce esattamente `dopo`.
2. Analizzare `dopo` produce una scena strutturalmente uguale a quella in
   memoria.
3. Ogni byte fuori dalle modifiche resta identico.
4. Dopo l'applicazione gli span degli elementi successivi si spostano del
   delta; quelli del frammento inserito si ricavano analizzando il frammento
   stesso.

La superficie consegna `{ text, operation, origin }` con `origin` uguale a
`input`, `undo` o `redo`, la stessa forma di `EditorChange` di `TextEngine`.
Gli offset di `operation` sono sul testo a LF. `text` è il testo grezzo con le
stesse modifiche riportate sui suoi offset: i terminatori non toccati restano
identici, anche se misti, e le righe nuove usano il terminatore prevalente. La
`DocumentSession` normalizza entrambi i lati per validare e conserva `text`
così com'è.

## 7. Undo e redo

- **Pila:** ogni superficie ha la propria, e ricorda gli ultimi 1000 passi.
  Una voce è un gesto: il suo nome, per gli annunci, e il suo undo, cioè
  l'inversa e l'operazione in avanti che il redo ripete.
- **Un gesto, una voce:** un tratto è un `add`; un trascinamento diventa un
  solo `set` di `transform` alla fine del gesto. Gli stati intermedi non si
  registrano.
- **Fusione:** due voci consecutive con lo stesso nome, fatte di `set` sulle
  stesse chiavi degli stessi elementi, o di due `batch` di quei `set` nello
  stesso ordine, a meno di 500 ms l'una dall'altra e senza altri cambiamenti
  in mezzo, diventano una voce sola: resta la prima inversa e l'ultima
  operazione in avanti, e l'undo resta esatto. Così una serie di piccoli
  spostamenti, o tre colori provati di fila, si annullano in un passo. Dopo
  un annulla o un ripeti la voce in cima non si fonde più, e nemmeno una
  voce che ha tolto delle risorse.
- **Selezione:** dopo annulla o ripeti, la selezione sono gli oggetti che il
  passo ha toccato e che ci sono ancora; dopo un salto, quelli dell'ultimo
  passo del salto.
- **Salti:** la pila si percorre anche a salti, fino a un passo qualsiasi: i
  passi in mezzo si annullano, o si ripetono, in fila, e la superficie emette
  una `TextOperation` sola per tutto il salto, con l'origine `undo` o `redo`.
  Il salto si ferma al primo passo che non si annulla, o non si ripete, che
  si scarta come sotto; quelli prima restano fatti.
- **Undo esatto:** se l'undo arriva sulla scena lasciata dall'operazione,
  rimette i nodi di prima e il file torna identico byte per byte, anche dove
  l'inversa riscriverebbe in forma canonica (un `<g/>` riaperto, per esempio).
  Altrimenti si applica l'inversa.
- **Undo impossibile:** se l'inversa è rifiutata, perché il bersaglio è
  cambiato altrove, la voce si scarta e la superficie annuncia, col nome del
  gesto, che non si può annullare perché il disegno è cambiato nel
  frattempo. Le altre voci restano, perché toccano altri oggetti e valgono
  ancora.
- **Cambiamenti remoti:** quelli che arrivano da un'altra superficie o dalla
  sessione live non entrano nella pila locale
  ([ADR 0190](../decisions/0190-sessioni-documento-e-undo.md)).
- **`realigned`:** l'esito arriva come `syncDoc` con il testo autorevole. La
  scena si ricostruisce dal testo, che resta l'unica verità; le voci restano
  e, se il loro bersaglio non c'è più, falliscono come sopra.

## 8. Concorrenza nella sessione live

- **Ordine:** il PC applica le operazioni nell'ordine di arrivo e numera ogni
  operazione applicata con un contatore di sessione, `seq`.
- **`add`:** due aggiunte commutano, perché hanno id unici; con `pos: last`
  l'ordine visivo segue l'ordine di arrivo.
- **`set`:** sullo stesso attributo vince l'ultimo arrivato al PC.
- **`remove`:** vince sui `set` successivi, che sono rifiutati con
  `missing-target`.
- **Commit già applicati:** alla ripresa il PC dichiara l'ultimo commit
  applicato, `lastC`, e il client rispedisce solo quelli successivi. Come rete
  di sicurezza, un `add` con un id già presente ed elemento canonicamente
  identico si applica senza modifiche ed è segnato `duplicate`.
- **Eco:** il PC rimanda ai client le operazioni applicate con gli elementi in
  forma canonica, compreso il `d` calcolato, e con le risorse che hanno
  tolto. Il client sostituisce per id la propria versione ottimistica.
- **Rifiuto:** su un `nack` il client annulla l'effetto ottimistico con
  l'inversa. Su uno `snapshot` riapplica sopra le proprie operazioni ancora in
  attesa.

## 9. Vettori di prova

Ogni vettore è un file JSON in `apps/client/src/__fixtures__/scene-ops/`,
con il numero e il nome della tabella sotto (`01-add-first-stroke.json`). I
vettori sono oracoli scritti a mano e rivisti: generarli con il motore che
devono verificare renderebbe il test circolare.

```json
{ "name": "add-first-stroke", "input": "<svg …>…</svg>", "ops": [ { "op": "add", "parent": "l3f8a0c2d", "pos": { "last": true }, "elem": { "tag": "path", "attrs": { } } } ], "expect": { "outcome": "applied", "text": "<svg …>…</svg>" } }
```

| # | Nome | Verifica |
|---|---|---|
| 1 | `add-first-stroke` | primo tratto in un livello vuoto |
| 2 | `add-last-in-layer` | aggiunta in cima all'ordine visivo |
| 3 | `add-after-anchor` | inserimento dopo un fratello |
| 4 | `add-to-self-closing-group` | genitore `<g/>` riscritto in forma aperta |
| 5 | `remove-middle` | nessuna riga vuota residua |
| 6 | `remove-last-line` | rimozione dell'ultimo figlio |
| 7 | `remove-with-foreign-neighbors` | i byte estranei vicini restano identici |
| 8 | `set-transform` | solo `transform` cambia, l'inchiostro resta |
| 9 | `set-null-removes-attr` | `null` toglie l'attributo |
| 10 | `set-on-foreign` | rifiuto `foreign` |
| 11 | `text-lines-emoji` | offset UTF-16 con coppie surrogate |
| 12 | `move-z-order` | ordine nello stesso genitore |
| 13 | `move-to-other-layer` | cambio di livello |
| 14 | `move-into-descendant` | rifiuto `cycle` |
| 15 | `batch-group` | raggruppamento: `add` del gruppo e `move` dei figli |
| 16 | `batch-partial-failure` | rifiuto con l'indice dell'operazione fallita |
| 17 | `duplicate-id-identical` | `applied` senza modifiche |
| 18 | `duplicate-id-different` | rifiuto `duplicate-id` |
| 19 | `locked-layer` | rifiuto `locked` |
| 20 | `crlf-input` | operazione calcolata sul testo a LF; `text` consegnato con i CRLF originali |
| 21 | `bom-input` | BOM conservato |
| 22 | `paper-is-locked` | la carta non si modifica |
| 23 | `unknown-fub-attr-preserved` | attributo `fub:*` sconosciuto conservato dopo un `set` |
| 24 | `inkscape-attr-preserved` | attributo `inkscape:*` conservato |
| 25 | `network-stroke-d-recomputed` | `d` arrivato dalla rete scartato e ricalcolato |
| 26 | `mixed-eol` | file con CRLF e LF misti: i terminatori non toccati restano identici |
| 27 | `page-grow` | `page` allarga insieme `viewBox` e carta |
| 28 | `meta-title` | `meta` crea il `<title>` mancante |
| 29 | `adopt-foreign` | «Modifica» su un SVG estraneo |
| 30 | `ident-then-set` | `ident` e `set` nello stesso `batch` su un elemento senza id |
| 31 | `remove-foreign-by-path` | `remove` di un elemento estraneo senza id, indirizzato con il percorso |
| 32 | `set-self-closing-group` | `set` su un `<g/>` autochiuso, riscritto per intero |
| 33 | `first-under-root` | `first` sotto la radice va dopo titolo e carta |
| 34 | `text-inherited-size` | interlinea di una riga nuova dal corpo ereditato |
| 35 | `root-units-guides` | `set` su `#root` scrive unità e guide nell'ordine della radice; la geometria resta |
| 36 | `root-guides-remove` | `null` toglie le guide, l'unità resta |
| 37 | `root-guides-invalid` | guide fuori grammatica: rifiuto `invalid-elem` |
| 38 | `root-units-other-prefix` | l'unità col prefisso che il documento lega al namespace di FubDraw |
| 39 | `root-other-attr` | sulla radice un attributo che cambia con `page`: rifiuto `invalid-elem` |
| 40 | `locked-group` | un oggetto dentro un gruppo bloccato non cambia: rifiuto `locked` |
| 41 | `locked-group-add` | dentro un gruppo bloccato non si aggiunge niente: rifiuto `locked` |
| 42 | `locked-object-unlock` | una forma bloccata si cambia ancora: un `set` la sblocca |
| 43 | `add-raw-foreign` | `add` con `raw` scrive l'elemento estraneo così com'è, e l'inversa lo toglie col percorso |
| 44 | `add-raw-sequence` | un `raw` con un elemento del formato e uno estraneo; l'inversa è un `batch` che li toglie dall'ultimo al primo |
| 45 | `add-raw-duplicate-id` | un `raw` con dentro un id già presente: rifiuto `duplicate-id` |
| 46 | `text-runs` | una riga coi pezzi, sulla stessa riga del file e con gli attributi in ordine canonico |
| 47 | `text-runs-canonical` | i pezzi in forma canonica; l'inversa riporta i pezzi di prima |
| 48 | `text-runs-foreign-piece` | un pezzo con un attributo della riga: rifiuto `invalid-elem` |
| 49 | `add-text-runs` | `add` di un testo coi pezzi e la tipografia nuova, come lo scrive un duplicato |
| 50 | `add-defs-first` | la `fub-defs` va dopo il titolo e prima della carta |
| 51 | `add-gradient-use` | un `batch` aggiunge una sfumatura e la dà a un rettangolo, col ripiego |
| 52 | `remove-resource-in-use` | togliere una sfumatura usata: rifiuto `in-use` |
| 53 | `collect-private` | un `set` che toglie l'ultimo riferimento toglie la sfumatura privata e la `fub-defs` vuota; l'inversa le rimette |
| 54 | `collect-keeps-unowned` | una sfumatura senza `fub:role` resta |
| 55 | `collect-cascade` | togliere l'oggetto toglie il motivo privato e la sfumatura privata del suo contenuto |
| 56 | `add-resource-dangling` | una risorsa con un id a cui un elemento estraneo rimanda già: rifiuto `duplicate-id` |
| 57 | `set-missing-resource` | un `fill` verso una risorsa che non c'è: rifiuto `invalid-elem` |
| 58 | `add-raw-resources` | un `raw` con una sfumatura e un motivo che la usa, nella stessa `defs` |
| 59 | `filter-closed-list` | un filtro con `feTurbulence`: rifiuto `invalid-elem` |
| 60 | `text-path-runs` | `text` su un testo su tracciato sostituisce il contenuto del `textPath` coi pezzi e ne tiene gli attributi; l'inversa rimette la riga di prima |
| 61 | `text-joins` | `text` con `joins` su un testo in area: ogni riga ha il suo `fub:join`, la prima nessuno; l'inversa rimette righe e `joins` di prima |
| 62 | `text-path-one-line` | un testo su tracciato ha una riga sola: `text` con due righe, rifiuto `invalid-elem` |
| 63 | `add-text-path` | un `batch` aggiunge la `defs` col tracciato e il testo che lo segue con `xlink:href` e i pezzi; l'inversa toglie l'uno e l'altro |
| 64 | `remove-text-collects-path` | togliere un testo su tracciato toglie il suo tracciato privato e la `fub-defs` rimasta vuota; l'inversa li rimette |

Oltre ai campi dell'esempio, ogni vettore ha `description`. `expect` può avere
`reason` e `index` per un rifiuto; `duplicate`, `inverse` ed `edits`, cioè le
modifiche di testo dove §6 ne fissa la forma; `inverseText`, il testo che
l'inversa dà su un motore aperto dal testo di dopo, quando non è quello di
partenza.

Un test Rust, `crates/fub-scene/tests/ops_vectors.rs`, legge gli stessi file e
verifica che ogni testo si analizzi senza perdere un byte, senza errori S003 o
S004 e senza ragioni di sola lettura. Così il motore TypeScript e il lettore
Rust restano d'accordo sul formato che le operazioni scrivono.
