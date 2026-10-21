# Contratto IPC

> **Ambito:** confine JSON fra shell TypeScript e `fub-app`.
> **Fonti autorevoli:** `apps/client/src/host/contract.ts`,
> `apps/client/src/host/ipc.ts`, `crates/fub-app/src/lib.rs`.

## Principio

L'IPC adatta il contratto dell'host alla webview. Non è un secondo dominio e non
contiene policy.

Il frontend usa un'interfaccia host; l'implementazione reale chiama Tauri e i
test usano un fake.

## Famiglie di porte

| Famiglia | Esempi di responsabilità |
|---|---|
| lifecycle | aprire, elencare, selezionare e chiudere vault |
| documenti | leggere, scrivere, rinominare, cestinare e ripristinare |
| bozze | leggere, aggiornare e rimuovere |
| query | interrogare provider di indice |
| comandi | elencare, pianificare, eseguire e annullare |
| view | elencare, rendere, inviare azioni e stato |
| job | elencare, osservare e cancellare |
| impostazioni | schema, valori e scrittura |
| tema | manifest e artefatti della skin |
| eventi | ascolto del canale tipizzato |
| sessione live | avviare, interrogare e fermare la sessione di un disegno, rispondere allo scrittore |

Le operazioni offerte da provider passano da porte generiche. Una feature non
aggiunge una porta soltanto per evitare di usare il proprio registro.

## Valutazione del foglio pilota

La shell usa `IndexQuery::Custom` con namespace `fub.sheet` soltanto per la
valutazione read-only della vertical slice, non per il protocollo Grid a
finestre. Il payload privato è `{kind: "evaluate", version: 1, source: string}`:
versioni, specie o campi sconosciuti sono `BadArgs`. La risposta è
`IndexResult::Custom` con la forma `SheetEvaluation` del mirror TypeScript. Ogni
dipendenza elenca in `depends_on` le celle nominate una per una e, in
`depends_on_ranges`, gli intervalli come rettangoli per angoli; il secondo campo
manca quando la formula non nomina intervalli.

`query_index` non applica patch e non possiede lifecycle: resta una porta di
sola lettura. La famiglia Grid usa invece le porte strettamente tipate
`list_grid_surfaces`, `open_grid`, `grid_window`, `apply_grid`, `reload_grid` e
`close_grid`, con i record `Grid*` del mirror. La shell negozia famiglia e
versione prima di `open_grid`; un binding sconosciuto o incompatibile non viene
chiamato e attiva il fallback registrato.

Il provider verifica il limite sorgente di 16 MiB e misura la risposta JSON,
compreso l'envelope, entro 8 MiB prima di materializzare il valore JSON.
Disabilitare il bundle ritira la route di valutazione: la query restituisce
`Unserved` e la shell usa il fallback agli input grezzi. Le finestre, patch,
invalidazioni e il diff UTF-8 seguono i limiti del contratto ABI/WIT e non
trasportano DOM, CodeMirror, callback JavaScript o una battuta.
Il payload non è il percorso Grid pubblico a finestre.

Le fonti sono `crates/fub-format-sheet/src/index.rs` e il mirror TypeScript in
`apps/client/src/host/contract.ts`. La fixture
`apps/client/src/__fixtures__/sheet-query.json` è generata e verificata dal test
Rust [`crates/fub-host/tests/sheet_query.rs`](../../crates/fub-host/tests/sheet_query.rs);
non è un percorso di esecuzione del fake host e nessun interprete formule vive
nel fake host.

## Limiti e semantica Grid

Le coordinate sono `SheetId + RowId + ColumnId`; una sessione apre o ricarica
la sorgente completa (massimo 16 MiB), mentre le letture successive sono
finestre fino a 256×128 e 32.768 coordinate. Un commit accetta 16.384 patch e
4 MiB di preimmagini e nuovi input; la risposta, envelope compreso, è al
massimo 8 MiB. L'invalidazione restituisce coordinate modificate e dipendenti
fino a 32.768 elementi, poi `all`. Il diff conseguente usa offset in byte UTF-8.

Il registro conserva ownership e disposer per ogni binding. L'unload ritira il
binding, distrugge le istanze e soltanto dopo rilascia il provider. Nessuna
battuta attraversa IPC: la shell pubblica una sola operazione al commit.
Provider nativo e proxy WASM devono osservare la stessa famiglia/versione,
limiti, fallback ed errori.


## Sessione live

Un tablet scrive su un disegno aperto in una finestra. Il protocollo e la
composizione nell'app sono in [Sessione live](live-session.md); qui c'è il
confine con la shell.

| Comando | Cosa fa |
|---|---|
| `live_start` | avvia la sessione di un documento e apre il suo canale di eventi |
| `live_pairing` | il QR in corso, o con `renew` uno nuovo |
| `live_send` | manda allo scrittore `ack`, `nack`, `ops` o `snapshot` |
| `live_status` | stato, scrittore, commit in attesa e contatori |
| `live_stop` | chiude con un motivo e restituisce i commit senza risposta |

`live_start` riceve il documento, lo snapshot iniziale e, se la shell lo
sceglie, un indirizzo. Restituisce la sessione, il primo QR e gli indirizzi
privati delle interfacce attive, quello della rotta predefinita per primo.
Senza indirizzo la sessione ascolta su quello della rotta predefinita.

Gli eventi arrivano su un `Channel` di Tauri che la shell passa a
`live_start`: ogni messaggio è un gruppo di eventi, nell'ordine della
sessione, e dopo `ended` il canale si chiude. Il canale non è autorevole:
i commit senza risposta tornano da `live_status` e da `live_stop`.

I tipi usano i nomi in camelCase e il tipo in `t`; i contatori del protocollo
sono `u64` e viaggiano come stringhe. La shell li ha in `contract.ts` con il
prefisso `Live`, e il fake host simula la sessione con `liveEmit`.

I comandi li serve solo l'app: in un browser `api.liveSupported()` è falso e
la shell non offre la sessione. Il fake host li serve se riceve una rete con
`live`. Il lato del PC è in [Disegni](../product/drawing-live.md).

| Errore | Quando |
|---|---|
| `not_found` | sessione sconosciuta o di un'altra finestra, risposta a un commit che non è in attesa, indirizzo non disponibile |
| `already_exists` | il documento ha già una sessione, QR nuovo con lo scrittore collegato |
| `cancelled` | messaggio o QR nuovo dopo la fine della sessione |
| `conflict` | un `seq` che torna indietro |
| `bad_args` | documento o snapshot iniziale non validi, messaggio oltre i limiti, snapshot oltre 20 MiB |
| `unserved` | nessuna interfaccia attiva ha un indirizzo IPv4 privato |
| `io` | interfacce di rete illeggibili, porta occupata |
| `internal` | certificato, generatore casuale o QR non disponibili |

## Tipi principali

La shell riceve forme per:

- `VaultInfo` e `OpenVaults`;
- documenti, revisioni e report di edit;
- query e risultati paginati;
- specifiche ed esiti dei comandi;
- view, `UiNode` e azioni;
- plugin, fiducia, permessi e registrazioni;
- job e progresso;
- impostazioni;
- eventi;
- errori tipizzati.

Gli enum senza payload sono generati. Le union con payload mantengono un
discriminante stabile.

## `u64`

JSON usa numeri IEEE-754. Un `u64` che rappresenta identità, hash o revisione
attraversa il confine come stringa.

```text
Rust u64 -> stringa JSON -> TypeScript string
```

Non convertire quella stringa in `number` per comodità. Confrontala come
identità o usa una conversione controllata quando il dominio la consente.

Timestamp in millisecondi possono restare `number` perché il loro intervallo
utile è sotto il limite esatto e la shell li usa con `Date`.

## Errori

La forma conserva:

```text
kind + message
```

La shell decide il comportamento da `kind`. `message` è presentabile e può
essere localizzato, ma non viene analizzato con sottostringhe.

`message` sul filo è sempre una stringa. Dentro l'host un errore può restare
una chiave del catalogo, perché chi lo riceve in Rust lo riconosce da quella.
I comandi e le view escono già localizzati. Un comando IPC che porta alla shell
l'errore di una chiamata dell'host lo passa da `Host::localized_error`
(`for_the_shell` in `fub-app`): una chiave non risolta sul filo è un oggetto,
non una frase. Un errore nuovo destinato all'utente usa una chiave del
catalogo invece di un letterale. Il guard `check-error-literals.mjs` conta i
letterali per crate e ne impedisce la crescita.

Un errore Rust non attraversa il confine come debug string o stack trace.

## Eventi

Gli eventi IPC sono fatti già accaduti. Contengono almeno:

- specie;
- origine;
- soggetto;
- batch, quando presente;
- payload tipizzato;
- severità per gli avvisi.

Una coda può compattare progresso o notifiche ripetute. Il risultato autorevole
di un'operazione resta nella sua risposta.

## View

Il protocollo di view usa:

- id della view;
- contesto e interessi;
- stato per istanza;
- `UiNode`;
- azioni con payload opaco;
- update completo o incrementale quando il contratto lo prevede.

La shell non interpreta il payload di un'azione. Lo rimanda al provider
proprietario.

## Barra di formattazione e azioni dell'editor

Un comando con `CommandSurface::Toolbar` (`"toolbar"` in JSON) si offre come
pulsante nella barra di formattazione del riquadro, nell'ordine in cui il
provider dichiara i comandi. Se il suo id è un'azione dell'editor che la
superficie montata conosce, la shell la esegue sulla superficie senza
invocare il comando: nessuna IPC per pulsante. Un'azione che la superficie non
conosce non si disegna; un comando che non è un'azione diventa un pulsante col
suo titolo, invocato come dalla palette. Soltanto il core registra id senza
namespace, quindi soltanto il core dichiara pulsanti che scrivono nel testo.

Invocato dalla palette o da una scorciatoia, il comando restituisce
`CommandEffect::Custom` con `ns` `fub.editor.action`
(`fub_abi::ui::EDITOR_ACTION_NS`) e payload `{ "action": "<id>" }`. La shell
esegue l'azione nel riquadro col fuoco, o avvisa che lì non si può. È un
intento privilegiato: vedi [permessi e sicurezza](permissions-and-security.md).

Gli id delle azioni sono un vocabolario stabile fra plugin e shell; cambiarne
uno spegne il pulsante di chi lo nomina. La superficie Markdown conosce:

- `text.undo`, `text.redo`;
- `markdown.paragraph`, `markdown.heading.1` … `markdown.heading.6`;
- `markdown.bold`, `markdown.italic`, `markdown.strikethrough`,
  `markdown.highlight`, `markdown.code`, `markdown.math`, `markdown.comment`,
  `markdown.clear`;
- `markdown.link`, `markdown.wikilink`, `markdown.image`, `markdown.footnote`,
  `markdown.footnote.delete`;
- `markdown.list.bullet`, `markdown.list.ordered`, `markdown.list.task`,
  `markdown.list.indent`, `markdown.list.dedent`;
- `markdown.quote`, `markdown.callout`, `markdown.codeblock`,
  `markdown.mathblock`, `markdown.rule`, `markdown.table`;
- `markdown.property.add`, `markdown.property.up`, `markdown.property.down`;
- `markdown.table.row.before`, `.row.after`, `.row.up`, `.row.down`,
  `.row.delete`, `.column.before`, `.column.after`, `.column.left`,
  `.column.right`, `.column.delete`, `.sort.ascending`, `.sort.descending`
  (tutti col prefisso `markdown.table`).

La superficie ricca dei documenti di videoscrittura conosce un sottoinsieme
degli stessi id, con lo stesso significato: `text.undo`, `text.redo`,
`markdown.paragraph`, `markdown.heading.1` … `.6`, `markdown.bold`,
`markdown.italic`, `markdown.strikethrough`, `markdown.highlight`,
`markdown.clear`, `markdown.list.bullet`, `markdown.list.ordered`,
`markdown.list.indent`, `markdown.list.dedent`, `markdown.quote` e
`markdown.table.row.before`, `.row.after`, `.row.up`, `.row.down`,
`.row.delete`. Il prefisso è storico: l'id nomina il gesto, non il formato.

Icona, gruppo e menu a tendina di ogni azione sono della shell
(`panels/format-bar.ts`), come le icone della rail: il contratto porta soltanto
l'id, il titolo e la descrizione del comando.

## Documenti di videoscrittura

Un documento di un formato di `fub-format-rich` (`docx`, `odt`, `rtf` e
`doc`, quest'ultimo per `.doc` e `.dot`, con la feature `rich` di `fub-host`)
passa dalle stesse porte dei documenti, senza una porta in più:

- `read_document` restituisce in `text` la **proiezione** del file: JSON
  chiuso e versionato (`"format": "fub-rich"`, `"version": 2`,
  `"opaque_schema": N`), con `format_id` `"docx"` e `source_kind` `"bytes"`.
  `revision` è quella dei byte del file, non del testo restituito;
- `write_document` riceve una proiezione in `source` e la `base` letta
  insieme a essa. L'host riparte dai byte del file a quella revisione, salva
  con il codec e scrive con il CAS della stessa revisione. Una proiezione che
  descrive il file com'è non scrive e restituisce la revisione corrente; senza
  un file, la proiezione crea un documento nuovo;
- `save_draft` conserva la proiezione come testo del buffer, come per ogni
  altro documento.

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

`page` è la pagina di una sezione in punti, `{"w", "h", "top", "bottom",
"left", "right", "cols"}`, con `w` e `h` già nel verso della pagina e `cols`
assente quando è una. La porta il paragrafo che chiude la sezione, dopo
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

Un documento che il codec o la proiezione non riportano identico si apre con
`"readonly"` nella proiezione (`revisions`, `track_changes`, `protected`,
`projection`, `codec`, `import`) e ogni scrittura viene rifiutata con il suo
motivo. `import` è il motivo di ogni documento `rtf` e `doc`, e di un `odt`
che il codec OpenDocument non sa rappresentare: lo legge un importatore che non
riporta il file intero. Un file nuovo `rtf` o `doc` non si crea
(`host.rich.no_writer`); un `odt` sì.
`opaque_schema`, subito dopo `version`, è lo schema dei dati opachi (`k` e
`sect`, JSON del modello del motore in base64), che si incrementa quando
cambia la loro forma serializzata: lo schema 2 aggiunge all'1 il campo
facoltativo `eastAsianLayout` delle proprietà del carattere, e il codec legge
ogni schema fino al suo. La versione 1, quella delle bozze di
prima, ha le stesse chiavi senza `opaque_schema` e i dati dello schema 0. La
shell legge le due versioni, ciascuna con il suo elenco chiuso di chiavi, e
ricopia versione e schema come li ha ricevuti. Il codec rifiuta una versione
futura (`host.rich.version`) e uno schema che non legge, scritto da un Fub
più nuovo (`host.rich.opaque_schema`); un dato opaco che, decodificato e
riscritto, perderebbe un campo è una proiezione malformata.

Gli errori del codec arrivano tipizzati con chiave di catalogo `host.rich.*`.
La forma della proiezione è di `crates/fub-format-rich/src/projection.rs`; la
fixture `apps/client/src/__fixtures__/rich-projection.json` la lega alla
shell nei due versi (`crates/fub-format-rich/tests/ts_projection.rs`).

## Cartelle di Excel

Una cartella di `fub-format-xlsx` (formato `xlsx`, per `.xlsx`, `.xlsm`,
`.xltx` e `.xltm`, con la feature `xlsx` di `fub-host`) passa dalle stesse
porte, in **sola lettura**:

- `read_document` restituisce in `text` la **proiezione** della cartella, con
  `format_id` `"xlsx"`, `source_kind` `"bytes"` e la `revision` dei byte del
  file;
- `write_document` si rifiuta sempre con `PermissionDenied`
  (`host.xlsx.readonly`), anche per un file che non c'è, e il file resta
  com'è.

La proiezione è JSON chiuso, `{"version": 1, "active", "notices", "sheets"}`:

- `active` è l'indice del foglio attivo nel file;
- ogni foglio è `{"name", "hidden", "row_count", "column_count",
  "row_height", "column_width", "rows", "columns", "cells"}`. Gli assi
  arrivano fino all'ultima cella mostrata; `row_height` e `column_width` sono
  le dimensioni del foglio in pixel, e `rows` e `columns` elencano soltanto
  le linee con una dimensione loro o nascoste, `{"index", "size", "hidden"}`
  con l'indice da 0;
- ogni cella è `{"row", "col", "formula", "value", "style", "derived"}`, con
  le coordinate da 0. `formula` è il testo della barra (`=…`, o `{=…}` per una
  matrice legacy); `value` è `{"kind": "number" | "text" | "boolean" |
  "error", "text"}`, con `text` già nel formato numerico della cella; `style`
  è `{"bold", "italic", "text_color", "fill_color", "horizontal": "start" |
  "center" | "end"}`, con i colori in `#RRGGBB`. Il testo automatico su una
  cella senza riempimento non ha `text_color`, e prende il colore della
  shell;
- `derived: true` segna un valore che il file non ha e che Fub ha calcolato:
  le celle versate dalle matrici, i cui valori in cache il lettore scarta, e
  le formule salvate senza valore. Ogni altro valore è quello del file;
- `notices` è l'elenco ordinato degli avvisi, `{"kind", "detail"}`:
  `macros` (le macro non si eseguono), `external_links` (i collegamenti ad
  altre cartelle non si aggiornano), `incomplete` (con `detail` l'avviso della
  lettura di GridCraft, in inglese), `not_shown` (con `detail` una fra
  `merges`, `charts`, `images`, `shapes`, `comments`, `conditional_formats`,
  `sparklines`), `recalculated` (ci sono celle `derived`) e `truncated` (con
  `detail` il foglio dove le celle si fermano: la proiezione non supera
  16 MiB).

Gli errori arrivano tipizzati con chiave di catalogo `host.xlsx.*`: una
cartella cifrata (`encrypted`), un file oltre 256 MiB (`too_large`), un
contenuto che non è una cartella di Excel (`not_xlsx`, con `found`) e un
pacchetto che il codec rifiuta (`codec`). La forma della proiezione è di
`crates/fub-format-xlsx/src/projection.rs`; la fixture
`apps/client/src/__fixtures__/xlsx-projection.json` la lega alla shell
(`crates/fub-format-xlsx/tests/ts_projection.rs`).

## Percorsi

Il frontend invia path relativi o root di vault secondo la porta. Le regole di
canonicalizzazione e recinzione vivono nel core.

Non accettare un path assoluto in una porta generica per evitare la verifica del
vault.

## Import Tauri

Sono consentiti soltanto:

- `apps/client/src/host/ipc.ts`;
- `apps/client/src/host/dialog.ts`.

Ogni altro modulo importa l'interfaccia host.

## Compatibilità

Un cambio IPC richiede:

1. tipo Rust serializzabile;
2. fixture;
3. mirror TypeScript;
4. test di conformità;
5. aggiornamento del fake host;
6. test del flusso nella shell;
7. strategia per campi assenti se deve leggere una forma precedente.

## Porte da evitare

- un comando per ogni query;
- payload `unknown` quando il dominio è chiuso;
- stringhe che codificano errori;
- callback o oggetti DOM;
- path di filesystem non recintati;
- duplicazione di regole già in `fub-abi`;
- accesso diretto a `invoke` da un pannello.
