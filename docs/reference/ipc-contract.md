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
| componenti | leggere la mappa dei componenti di un vault e applicare una scelta |

Le operazioni offerte da provider passano da porte generiche. Una feature non
aggiunge una porta soltanto per evitare di usare il proprio registro.

## La griglia

La famiglia Grid usa porte strettamente tipate, con i record `Grid*` del
mirror: `list_grid_surfaces` elenca i binding, e una superficie con
`protocol_version` 2 si apre sui byte di un documento con `open_grid_bytes`,
`grid_bytes_window`, `apply_grid_bytes`, `grid_bytes_commands`,
`grid_bytes_command` e `close_grid_bytes`. La shell
negozia famiglia, versione e formato prima di aprire; un binding sconosciuto
o incompatibile non viene chiamato e la superficie dice che il foglio non si
apre. `query_index` non applica patch e non possiede lifecycle.

`open_grid_bytes` riceve `surface`, `doc`, `journal` e `base`: la shell non
trasporta i byte, ma il giornale canonico delle celle cambiate (il testo
della sessione documento) e la revisione dei byte da cui parte. L'host legge
il documento, controlla che il formato sia quello della superficie (`BadArgs`
altrimenti) e risponde `Conflict` se i byte non sono più quelli di `base`. La
sessione è un `GridBytesSession` (fogli, foglio attivo, fogli nascosti, avvisi
`GridNotice`, celle in conflitto e il libro `GridBook`: i dodici colori del
tema in `#RRGGBB`, i nomi definiti visibili, il modo di calcolo
`GridCalculation`, la struttura protetta e il carattere dello stile Normale,
nome e punti, che lo stile di una cella tace); la finestra è un `GridBytesWindow`, la cui
cella porta `GridValue`, il testo formattato, blocco, `stale`, `conflict`,
l'indice del suo stile e i segni (barra di dati, icona, commento,
collegamento). La finestra porta gli stili delle sue celle, ognuno una volta
(`GridCellStyle`: carattere, colori, bordi, allineamenti, rientro, a capo,
rotazione), le unioni e le tabelle che la toccano (`GridMerge`, `GridTable`
con le opzioni e il nome dello stile) e la vista del foglio (`GridSheetView`:
riquadri bloccati, griglia, intestazioni, zoom, da destra a sinistra, la
modalità `GridViewMode`, le formule mostrate, la protezione, griglia e
intestazioni in stampa). La finestra porta anche gli oggetti che la toccano,
nell'ordine in cui si disegnano (`GridObject`: tipo `GridObjectKind`, id,
cella dell'angolo, scarto e misura in pixel a zoom 100, testo alternativo):
un grafico o un grafico sparkline con il suo disegno in SVG, un'immagine con
i suoi byte (`GridMedia`: tipo, impronta `key` e base64), una forma con il
suo aspetto (`GridShape`), che disegna la shell; `missing` dice perché un
oggetto non porta ciò che mostra (`too_large`, `unsupported`). La richiesta
della finestra elenca in `known_media` le impronte che la shell ha già: di
quelle immagini la finestra porta la chiave senza i byte. Il
commit è un `GridCommit` il cui `edit` è il diff del testo del giornale, da
applicare al buffer della sessione documento.

La sessione porta anche il catalogo dei comandi che serve
(`GridCommandState`: id, acceso, perché è spento). `grid_bytes_commands`
riceve una `GridSelection` (foglio, intervalli A1, cella attiva) e ridà il
catalogo su quella selezione; `grid_bytes_command` riceve un
`GridCommandRequest` (la revisione e un `GridCommand` con i parametri come
testo di un oggetto JSON) e ridà un `GridCommandOutcome`: il commit del
giornale, che resta alla revisione se il comando non cambia la cartella, i
fogli, la selezione nuova, il risultato come testo JSON, la finestra di
dialogo chiesta, il catalogo aggiornato e il libro. Il risultato è sempre un
oggetto: un valore che non lo è sta sotto `value`, i messaggi del comando
sotto `messages`. I parametri della finestra chiesta portano anche ciò che la
finestra mostra all'apertura e che la shell non legge da sé (la regola di
convalida della cella attiva per `dataValidation`). Un comando che il provider non
serve, spento o con parametri che non tornano è `BadArgs`. Il provider delle
cartelle di Excel serve un sottoinsieme del catalogo di GridCraft, più
`edit.undo` ed `edit.redo` del documento
([ADR 0219](../decisions/0219-la-cartella-si-modifica-con-i-comandi-di-gridcraft.md),
in proposta); su una cartella che la riscrittura perderebbe i comandi che la
cambiano sono spenti, e darne uno è `PermissionDenied` con `xlsx.rewrite.loses`.

## Limiti e semantica Grid

Le coordinate sono `SheetId + RowId + ColumnId`; una sessione apre la
sorgente nell'host, e le letture sono finestre fino a 256×128 e 32.768
coordinate. Un commit accetta 16.384 patch e
4 MiB di preimmagini e nuovi input; la risposta, envelope compreso, è al
massimo 8 MiB. L'invalidazione restituisce le coordinate da rileggere fino a
32.768 elementi, poi `all`. Il diff del giornale usa offset in byte UTF-8.
Una finestra porta fino a 1.024 tabelle; il libro fino a 4.096 nomi; un nome
di tabella, di stile o definito è al massimo di 255 byte. Una finestra porta
fino a 1.024 oggetti; il disegno di un grafico è al massimo di 1 MiB, i byte
di un'immagine di 3 MiB in base64 (soltanto PNG, JPEG, GIF, BMP, WebP e SVG),
il testo di una forma di 64 KiB; la richiesta elenca fino a 256 impronte di
64 byte al più.

Il registro conserva ownership e disposer per ogni binding. L'unload ritira il
binding, distrugge le istanze e soltanto dopo rilascia il provider. Nessuna
battuta attraversa IPC: la shell consegna una sola richiesta al commit.
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

## Componenti

La pagina «Componenti» ha due porte dedicate, in `allow-shell` e quindi solo
per la finestra principale. Non passa da `query_index` o `invoke_command`
perché lo stato dei componenti, come `plugins.disabled`, non è
`program_writable`: un componente non deve poter spegnere gli altri. Le due
porte applicano la stessa regola della CLI e di MCP (`Host::components`,
`Host::apply_components`); con l'app aperta CLI e MCP arrivano dal canale di
controllo (`Call::Components`, `Call::ApplyComponents`).

- `components_map(vault)` risponde `ComponentsMap`: i `gruppi`
  (`ComponentGroup`: `id` e `nome`, nell'ordine scrivere, leggere, pensare,
  disegnare, ufficio, foto, altro, supporto, e solo quelli che in questa build
  hanno righe), le righe (`ComponentRow`: id, `nome`, `descrizione`, `gruppo`
  — l'id di un gruppo, `altro` se la riga non ne dice uno —, `tipo`
  `mode`/`engine`/`service`/`data`, `ui` — le cartelle del client che carica,
  come `editors/media` —, `richiede` già risolto in id, `usa`, `acceso`,
  `perche`, `richiesto_da`, `bundle`), lo `stato` (scelti, in attesa), il
  `profilo` attivo (`null` = personalizzato), i `profili` con `etichetta`,
  `piu_avanti` e `arriva_con`, e i `mancanti` delle chiavi `components.*`.
  **I testi arrivano già risolti** nella lingua del vault (`locale.language`,
  con quella del sistema come ripiego), dal catalogo
  `fub_features::componenti::catalog` (`component.<x>.name`,
  `component.<x>.description`, `component.group.<g>.name`,
  `profile.<p>.name`). Sul filo non esce mai una chiave: un nome che il
  catalogo non ha è l'id della riga (del gruppo, del profilo), una
  descrizione che non ha è vuota.
- `components_apply(vault, azione, apply)` riceve un'azione
  (`{ azione: "accendi" | "spegni" | "rispondi" | "profilo", … }`; spegni ha
  `anche_questi` e `orfani` `chiedi`/`togli`/`tieni`). Con `apply` assente o
  falso è una prova: dice che cosa cambierebbe e non scrive. Risponde
  `ComponentsApplied`, con il tag `risposta`:
  - `{ risposta: "esito", … }`: l'`effetto` (`accesi_anche` è «Attivati
    anche…», `spenti_anche`, `orfani`, `mancanti`), le `scritture`, le
    `chiavi` che cambiano, lo `stato` dopo, `applicato` e gli `avvisi`;
  - `{ risposta: "rifiuto", rifiuto: … }`: il **rifiuto tipato**
    (`sconosciuto`, `nucleo`, `richiesto` con `da`, `profilo_sconosciuto`,
    `profilo_piu_avanti` con `arriva_con`). Non è un errore: la shell lo dice
    con le sue parole.

Gli errori restano per ciò che non è una scelta: a vault chiuso tutte e due le
porte rispondono `not_found`.

**L'avviso del rimontaggio.** Spegnere o riaccendere la lavagna rimonta il
vault (`Host::remount`): l'esito ha una scrittura su `fub.lavagna`, e dal
ponte degli eventi escono `vault_closed` e poi `vault_opened` dello stesso
`root`. Il secondo lo emette `remount` sul bus del vault riaperto, solo verso
gli abbonati e non verso gli handler dei plugin, perché quello della
scansione esce prima che il ponte nuovo si abboni. Vale per ogni strada:
`components_apply` e il canale di controllo. Una scelta che non rimonta lo
dice con `setting_changed` su `plugins.disabled` o sulle chiavi
`components.*`.

Nei test e nel banco l'host finto non ha un risolutore: serve le risposte
dell'host vero registrate in `apps/client/src/__fixtures__/components-scenario.json`
(vault temporaneo con il profilo «Studio»), che
`UPDATE_MIRROR=1 cargo test -p fub-app --test ts_mirror_app` rigenera, e
rifiuta lanciando una scelta che lo scenario non ha. Lo scenario passa per
ogni gesto della pagina da «Studio» e da «Solo note» (profili, rifiuti
`nucleo` e `richiesto`, `anche_questi`, il profilo che diventa
personalizzato, il PDF che accende la penna, la lavagna che rimonta, la penna
orfana e le due risposte); ogni mappa ci sta una volta sola (`mappe`), e
`partenze` nomina gli stati da cui il finto può partire (`componentsStart` in
`createFakeHost`, `?componenti=solo-note` nel banco; di serie «Studio»). Per
ogni scelta applicata lo scenario porta gli `eventi` che l'host vero ha
mandato dopo la risposta (`setting_changed`, `vault_closed`, `vault_opened`,
con la radice `/vault`): il finto li manda nello stesso ordine, in un giro del
ciclo degli eventi successivo alla risposta e con la radice del suo vault.
`componentsFromOutside` applica una scelta come farebbero CLI o MCP (stato ed
eventi, senza `componentsApply`), `componentsFail` fa rispondere a
`componentsApply` un `PluginError`.

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
- `markdown.bold`, `markdown.italic`, `markdown.underline`,
  `markdown.strikethrough`, `markdown.superscript`, `markdown.subscript`,
  `markdown.highlight`, `markdown.code`, `markdown.math`, `markdown.comment`,
  `markdown.clear`;
- `markdown.color.<colore>` e `markdown.background.<colore>`, con i nove
  colori del contenuto (`gray`, `brown`, `orange`, `yellow`, `green`, `blue`,
  `purple`, `pink`, `red`) o `default`, che toglie il colore: scrivono
  `<span class="fub-color-…">` e `<mark class="fub-bg-…">`;
- `markdown.link`, `markdown.wikilink`, `markdown.image`, `markdown.footnote`,
  `markdown.footnote.delete`;
- `markdown.list.bullet`, `markdown.list.ordered`, `markdown.list.task`,
  `markdown.list.indent`, `markdown.list.dedent`;
- `markdown.quote`, `markdown.callout`, `markdown.details`, `markdown.columns`, `markdown.codeblock`,
  `markdown.mathblock`, `markdown.rule`, `markdown.toc`, `markdown.table`;
- `markdown.embed` (una nota incorporata `![[`) e `markdown.diagram` (un
  blocco `mermaid`), che riaprono il completamento delle note e dei modelli;
- `markdown.mention` e `markdown.date`, che scrivono `@` e aprono le proposte
  di persone e date;
- `markdown.linkcard`, che apre un paragrafo per un indirizzo web;
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
  chiuso e versionato (`"format": "fub-rich"`, `"version": 4`,
  `"opaque_schema": N`), con `format_id` `"docx"` e `source_kind` `"bytes"`.
  `revision` è quella dei byte del file, non del testo restituito;
- `write_document` riceve una proiezione in `source` e la `base` letta
  insieme a essa. L'host riparte dai byte del file a quella revisione, salva
  con il codec e scrive con il CAS della stessa revisione. Una proiezione che
  descrive il file com'è non scrive e restituisce la revisione corrente; senza
  un file, la proiezione crea un documento nuovo;
- `save_draft` conserva la proiezione come testo del buffer, come per ogni
  altro documento.

`read_document` e `write_document` girano fuori dal thread principale
dell'app, per ogni formato: aprire e salvare un `.docx` legge, proietta e
misura il pacchetto, e la finestra non si ferma ad aspettarli. L'ordine delle
scritture di un documento lo tiene la `DocumentSession` della shell, che le
accoda, e una lettura superata la scarta. Le bozze (`save_draft`,
`discard_draft`) restano sul thread principale, nell'ordine in cui arrivano.

La forma della proiezione (revisioni, commenti, pagina, oggetti, inchiostri e
disegni, blocchi chiusi, versioni e schema dei dati opachi) è in
[Proiezione dei documenti di videoscrittura](rich-projection.md).

## Cartelle di Excel

Una cartella di `fub-format-xlsx` (formato `xlsx`, per `.xlsx`, `.xlsm`,
`.xltx` e `.xltm`, con la feature `xlsx` di `fub-host`) passa dalle stesse
porte, e il suo testo è il **giornale** delle celle cambiate (ADR 0216):

- `read_document` restituisce `text` vuoto (il giornale vuoto), con
  `format_id` `"xlsx"`, `source_kind` `"bytes"`, `text_kind`
  `"grid_journal"` e la `revision` dei byte del file. Ogni altro documento ha
  `text_kind` `"source"`: il testo è il sorgente che `write_document` riceve;
- la griglia si apre sui byte con `open_grid_bytes`, sulla superficie
  `fub.grid.xlsx` della versione 2, e legge le finestre che mostra;
- `write_document` riceve il giornale nella forma canonica (`BadArgs` con
  `host.xlsx.journal` altrimenti) e lo **innesta** nei byte alla revisione
  `base`, con il CAS della stessa revisione: il resto del file resta byte
  per byte. Un giornale di comandi che cambia più dell'input di costanti si
  rifà sui byte, e la cartella si **riscrive** con il codec soltanto se la
  misura dice che non perde niente (`PermissionDenied` con
  `xlsx.rewrite.loses`, che nomina la perdita, altrimenti). Un giornale vuoto, o già tutto nei byte, non scrive niente; un
  giornale per un file che non c'è si rifiuta (`host.xlsx.missing`); una
  voce che i byte non possono ricevere si rifiuta con la sua specie
  (`PermissionDenied` per una cella bloccata, `Conflict` per un foglio che
  non c'è più, `BadArgs` per una formula in una voce di cella: una formula
  entra soltanto come comando), e il file resta com'era;
- `resource_write` deposita una cartella nuova (`expected` nullo) come ogni
  file, e rifiuta di coprirne una che c'è (`host.xlsx.readonly`): una
  cartella cambia soltanto dal giornale, con `write_document`.

Nella finestra:

- i valori sono quelli che il file ha salvato, comprese le celle versate
  dalle matrici: niente si ricalcola. `display` è il valore nel formato
  numerico della cella, e `input` ciò che la barra mostra e la cella riceve
  (`=…` per una formula). `apply_grid_bytes` con la prima formula da
  scrivere porta la sessione ai comandi: la formula entra come
  `range.setValues`, e il commit riscrive il giornale;
- `lock` è uno fra `array`, `spill`, `shared-formula`, `data-table`,
  `table-header`, `table-totals`, `merged`, `pivot`, `rich-value`,
  `protected` e `sheet-shape` (il foglio ha una forma che l'innesto non sa
  ancora riscrivere);
- `stale` segna una formula che legge, anche attraverso altre formule, una
  cella cambiata: tiene il valore del file, e il salvataggio chiede a Excel di
  ricalcolare all'apertura (`fullCalcOnLoad`);
- il testo automatico su una cella senza riempimento non ha `text_color`, e
  prende il colore della shell.

Gli avvisi della sessione sono `macros`, `external-links`, `incomplete` (la
lettura ha lasciato indietro qualcosa), `not-shown-slicers` e `uncomputed`
(formule senza valore salvato), ciascuno con il suo conteggio. Le unioni, le
note, la formattazione condizionale e gli oggetti (grafici, grafici
sparkline, immagini e forme) arrivano nella finestra, e non sono avvisi.

Gli errori arrivano tipizzati con chiave di catalogo `host.xlsx.*`: una
cartella cifrata (`encrypted`), un file oltre 256 MiB (`too_large`), un
contenuto che non è una cartella di Excel (`not_xlsx`, con `found`) e un
pacchetto che il codec rifiuta (`codec`). La forma della sessione e delle
finestre è di `crates/fub-format-xlsx/src/grid.rs`; la fixture
`apps/client/src/__fixtures__/xlsx-grid.json` la lega alla shell
(`crates/fub-format-xlsx/tests/ts_grid.rs`).

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
