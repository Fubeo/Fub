# Il disegno completo

> **Domanda:** come lo spazio di lavoro Completo raggiunge ogni funzione del
> motore vettoriale, che cosa vuol dire parità, che cosa arriva tardi e chi
> possiede che cosa?
> **Fonti autorevoli:** `crates/fub-disegno/`, `crates/fub-motori/`,
> `crates/fub-host/src/drawing.rs`, `apps/client/vite.config.ts`,
> `crates/fub-disegno/disco.tsv`, `crates/fub-disegno/src/disco.rs`.
> **Decisioni:** [ADR 0250](../decisions/0250-il-disegno-completo-sul-motore.md),
> [ADR 0239](../decisions/0239-il-disegno-sul-motore-vettoriale.md),
> [ADR 0248](../decisions/0248-il-disegno-nella-nota-si-modifica-sul-posto.md).

Il disegno completo è lo spazio Completo dei disegni (`.svg`) quando passa
tutto dal motore: strumenti, comandi, effetti e pannelli, con l'interfaccia
di Fub. Si appoggia al giro di [Il disegno sul motore](disegno.md): il
motore calcola su una copia, il client scrive il file.

Il disegno completo arriva a pezzi. Ciò che non c'è ancora porta accanto
«(arriva con T…)», il task del piano che lo porta, e quel task toglie la
nota quando lo fonde. Un percorso di un file che non esiste ancora è scritto
in codice, senza link.

## Che cosa vuol dire parità

La parità è con il motore alla revisione fissa `cfb30d81` di
`vendor/vectorcraft/`. Il suo contratto è la mappa,
`crates/fub-disegno/mappa.tsv` (arriva con T2): una riga per ogni strumento,
comando, voce dell'interfaccia, effetto e pannello del motore, con la sua
`famiglia`, il suo `posto` in Fub e il suo stato.

| Stato | Vuol dire | Lo prova |
|---|---|---|
| fatto | si raggiunge dal suo posto (menu, colonna, ispettore, finestra, banda o tasto), fa sul disegno ciò che fa nel motore e si annulla con un passo | il suo caso in `crates/fub-disegno/tests/famiglie/`, provato dal motore e dal client ([il banco delle righe](#lindice-e-i-pezzi-pigri)) |
| fub | la serve una funzione di Fub (Salva, le schede, le Impostazioni, i recenti), scritta nella colonna `fub` | la funzione di Fub |
| escluso | non entra, con il suo perché nella riga | la guardia della mappa |
| da fare | non è ancora fatto | la guardia lo conta |

La guardia `.github/scripts/check-disegno-mappa.mjs` (arriva con T2)
confronta le righe con quelle estratte dal motore: una funzione nuova senza
riga, o una riga che sparisce, la fa cadere. Con `--finale` vuole anche che
nessuna riga resti da fare.

Un motore più nuovo arriva con l'aggiornamento dei motori: la mappa si
rigenera, e le sue righe nuove nascono da fare.

## Il percorso di un comando

Un comando del motore, per esempio «Sposta…» o «Ombra esterna…», passa da
questi pezzi:

1. **La voce.** Il menu ≡, Ctrl+/, la fila delle opzioni o una sezione
   dell'ispettore mostrano la voce dall'indice,
   `apps/client/src/editors/spatial/completo/indice.generated.json`,
   generato dal Rust: etichetta, posto, tasto e famiglia.
   Nel client non c'è un elenco scritto a mano.
2. **Il pezzo del client.** `completo/carica.ts` importa con
   `import()` il chunk `drawing-fam-<id>` della famiglia, se non c'è già. Un
   comando con parametri apre la sua finestra del kit, con l'anteprima
   (arriva con T6).
3. **L'IPC.** Il client chiama `drawing_command` con l'id
   `disegno.<id del motore>` (le forme in `crates/fub-abi/src/drawing.rs`,
   [le porte del disegno](../reference/drawing-ipc.md)). Con `preview` il
   comando gira su una copia e non entra nella cronologia (arriva con T4).
4. **La famiglia.** In `fub-disegno` il comando trova la sua famiglia
   (`crates/fub-disegno/src/famiglie/`, letta da `mappa.tsv`), che nasce
   al primo uso, poi il motore lo esegue sulla copia nella sessione di K5.
   Passa solo una riga «fatto» della mappa; una «da fare» è `Unserved`, e
   una `fub`, esclusa o dietro una feature del motore spenta è
   `unsupported`.
5. **La differenza.** Il motore confronta la copia prima e dopo
   (`crates/fub-disegno/src/differenza.rs`) e rende le operazioni di scena.
   Ciò che l'SVG non sa dire va nella ricetta in `<metadata>` (arriva con
   T27).
6. **Il file.** Il client applica le operazioni con `ctx.commit`, in un solo
   passo di annullamento, e la `DocumentSession` le porta al file come ogni
   altra modifica.

Un comando di sola lettura (un pannello che mostra dati) rende una lettura
invece delle operazioni (arriva con T4). Una famiglia che non trova memoria
nel `Budget` rifiuta il comando con `NoMemory` (arriva con T4), e il disegno
resta com'era. Un comando con argomenti che il motore non prende (`BadArgs`)
non tocca la copia né la revisione e non rende operazioni: la sessione resta
aperta, la frase del motore si annuncia, o nella finestra del comando si
mostra sotto i campi senza «Riprova», e la finestra resta aperta
([Quando il motore manca](disegno.md#quando-il-motore-manca)). Le finestre
che controllano da sé i valori (per esempio «Nuovo gruppo colori…») lo fanno
prima di mandare il comando.

## Il percorso di uno strumento del motore

Il ponte degli strumenti del motore, la fila delle opzioni, i tracciati,
i gesti a mano libera e il Contagocce stanno in
[Gli strumenti del motore nel Completo](disegno-strumenti.md).

## Il testo (T16)

La famiglia `testo` (`crates/fub-disegno/src/famiglie/testo.rs`) passa al
motore i comandi sul testo scelto; il formato è quello di
[scene-format-text](../reference/scene-format-text.md), senza campi nuovi.

- **All'apertura** (`crates/fub-disegno/src/apertura.rs`, `testi_in_area`) un
  `<text fub:wrap>` con le righe unite da `fub:join` diventa nel motore un
  testo in area: un solo stile, il testo con gli spazi e gli a capo che le
  unioni dicono, il riquadro largo `fub:wrap` (nelle unità del testo) e alto
  quanto le righe. Un testo con più stili o una scala non uniforme resta
  da punto, e i comandi che lo cambiano si rifiutano come prima.
- **La differenza** (`differenza_testo.rs`, `riscrittura`) riscrive intero un
  testo in area prima o dopo, o con un'interlinea nuova: rimuove il
  `<text>` e lo aggiunge con lo stesso id, gli attributi del file nel loro
  ordine (cambiati solo carattere, allineamento, `x`, `y`, `fub:wrap`) e le
  righe come le impagina il motore (`differenza_righe.rs`, `righe_scritte`:
  `x`, `dy`, `fub:join`). Lo stesso scrive lo strumento trascinato
  (`gesti/strumento.rs`). Un testo con più colori, stili per riga o caratteri
  fuori da XML si rifiuta.
- **`text.editRange`** si chiama con l'id di Fub (`element`) e il testo
  intero (`text`); Fub calcola il pezzo diverso in byte del testo del motore
  (`argomenti_della_copia`), e il motore lo sostituisce in un passo. Un
  testo bloccato o nascosto si rifiuta prima (`locked`, `hidden`).
- **Il doppio clic** con la Selezione su un testo scelto porta al campo
  «Testo» dell'ispettore (`motore/gesti.ts`, `doubleTap`), che scrive alla
  conferma: nessun IPC per tasto. Per un testo in area il campo
  (`tools/text.ts`, `areaWordsOf`) manda le parole a `text.editRange`
  (`Completo.parole`, dal percorso unico `eseguiPerId`), mai all'operazione
  `text`, che scriverebbe righe senza a capo; senza motore il campo non c'è.
- **All'apertura** (`apertura.rs`) un testo di punto perde gli spazi che
  l'importazione del motore aggiunge in fondo alle righe per i nodi di soli
  spazi fra i `tspan` (`spazi_fra_le_righe`), e un testo in area riprende le
  righe del file, col paragrafo di uno spazio indivisibile vuoto
  (`testi_in_area`, `RIGA_VUOTA`). Le righe in area si dispongono nella
  larghezza arrotondata come il file la scrive, così chi riapre ritrova gli
  stessi a capo.
- `type.createOutlines` trasforma il testo in tracciati; senza i caratteri
  si rifiuta (`unsupported`). `edit.findReplace` ha una finestra scritta da
  Fub (`FINESTRE_SCRITTE`, senza `ids`).

Restano da fare `text.areaOptions` (colonne e margini interni non hanno un
attributo nel formato) e il campo dell'interlinea nella sezione Carattere.

## I livelli

I livelli nel motore (l'id e il nome, la differenza, i comandi sui livelli,
la selezione per carattere e il livello corrente) stanno in
[I livelli del motore nel Completo](disegno-livelli.md).

## I campioni e i gruppi di colori

I campioni del motore diventano i campioni del file
([il formato](../reference/scene-format-resources.md#2-le-risorse)) in
`crates/fub-disegno/src/campioni.rs`, che legge il file nel documento del motore
e porta nel formato ciò che il comando ha cambiato. Un gruppo di colori è
l'attributo `fub:group` dei suoi campioni, uno dopo l'altro nella stessa
`defs`: nessun elemento nuovo, nessuna versione e nessuna migrazione, e un Fub
più vecchio vede i campioni senza gruppo. Un `fub:group` che non si legge come
gruppo (vuoto, col nome di un campione o di un motivo, sparso) lascia i campioni
senza gruppo e resta com'è nel file.

Nuovo gruppo colori, Modifica gruppo colori, Separa gruppo colori e Aggiungi ai
campioni di un tema scrivono o tolgono l'attributo; un comando che farebbe un
gruppo vuoto è un `BadArgs` col perché in italiano, e il file resta com'era.
Campioni predefiniti (`swatch.resetDefaults`) rimette i campioni di serie del
motore coi nomi in italiano (`campioni_predefiniti.rs`: nel motore non c'è una
strada per la lingua dell'app); un nome già nel disegno non torna, e con
`replace` chi usava un campione tolto tiene il suo colore. Ciò che il formato
non sa dire, le sfumature di serie e i colori non RGB scritti come `#rrggbb`,
va nelle `losses` dell'esito (`Unsupported`, `Approximated`), e il client lo
dice con «fatto» (`applicaEsito` in `completo/esegui.ts`). La finestra del
nuovo gruppo (`ui.newColorGroup`) non c'è ancora.

## Chi possiede che cosa

| Che cosa | Chi lo possiede | Perché |
|---|---|---|
| la mappa | `crates/fub-disegno/mappa.tsv` e la sua guardia (arriva con T2) | è il contratto della parità; una riga cambia stato solo con la sua prova |
| l'indice | `fub-disegno`, che lo genera nel client come un mirror | il client non nomina il motore e non ha un elenco scritto a mano |
| le famiglie | nel processo `crates/fub-disegno/src/famiglie/` (feature `completo`), nel client i chunk `drawing-fam-<id>` | sono le unità pigre; una famiglia non importa un'altra |
| il `Budget` | lo strato dei motori, `crates/fub-motori/src/memoria.rs` | libera le cache delle famiglie quando serve ([Lo strato dei motori](motori.md)) |
| le librerie dell'utente | il kernel, in `.fub/plugins/fub.draw/librerie/` del vault (arriva con T30) | il motore non tocca il disco; le librerie viaggiano con il vault |
| il disco | il kernel; il motore lo ha negato per tutto il processo ([il disco](#il-disco)) | ogni byte del motore passa da Fub |
| il file `.svg` e la cronologia | il client, come nella 0239 | il motore rende operazioni e non usa la sua cronologia |

## La mappa delle funzioni e la mappa degli id

In `fub-disegno` ci sono due mappe che non si toccano:

- `crates/fub-disegno/mappa.tsv` (arriva con T2) è un file di dati: le
  funzioni del motore, la loro famiglia e il loro posto in Fub. Cambia
  quando cambia il motore o quando una riga diventa fatta;
- `crates/fub-disegno/src/mappa.rs` è codice: lega ogni oggetto della copia
  del motore all'id del suo elemento nel file, per ogni disegno aperto (vedi
  [la copia e la differenza](disegno.md#la-copia-e-la-differenza)).

## L'indice e i pezzi pigri

**L'indice dei comandi** è
`apps/client/src/editors/spatial/completo/indice.generated.json`: una voce
per ogni riga fatta della mappa e per ogni riga `fub` con un posto vero.
Lo scrive il Rust (`crates/fub-disegno/src/catalogo.rs`, attraverso
`fub_motori::importa`), e `cargo test -p fub-disegno --test ts_indice` cade
se è stantio; `UPDATE_MIRROR=1` lo rigenera, con gli schemi delle finestre
in `completo/famiglie/<id>/schema.generated.json` (campi, `predefinito`,
`minimo`, `massimo`). Quando lo schema del motore descrive i parametri a
parole, i campi li scrive Fub dal codice del comando (`FINESTRE_SCRITTE`
in `catalogo.rs`: Sposta tracciato, Semplifica, Smussa, Espandi, Dividi in
trattini); la frase, il verbo di OK, le parole delle scelte e le unità sono
nei testi della famiglia (`descrizione:<id>`, `azione:<id>`,
`campo:<id>:<nome>` o `campo:<nome>`, `scelta:<campo>:<valore>`,
`unita:<campo>`). Una voce ha la fonte,
l'id, la chiamata (un comando, un effetto con `disegno.effect.apply`, uno
strumento o un'azione del client), le etichette italiana e inglese, il
posto (`scheda/gruppo`), la famiglia, il tasto, l'effetto (`cambia`,
`legge`, `mostra`) e se apre una finestra. Le etichette passano per
`crates/fub-disegno/glossario.tsv`, le parole del motore tradotte in quelle
del disegno di Fub; un'etichetta senza traduzione resta inglese e il test
la elenca. Il client legge l'indice con `completo/indice.ts`: un solo
`import()` per tutte le chiamate (ripetuto se non arriva), e le voci per
posto, per famiglia e per testo cercato.

**I pezzi pigri del client** stanno in `apps/client/src/editors/spatial/completo/`:

| Pezzo | Chunk | Quando arriva |
|---|---|---|
| `index.ts`, `carica.ts` | `drawing-completo` | entrando nel Completo col componente `fub.disegno-completo` acceso (`chrome/workspace.ts`, un `import()` per disegno) |
| `indice.ts` e il suo JSON | `drawing-indice` | quando il Completo si apre (`apri`) |
| `famiglie/<id>/` | `drawing-fam-<id>` | il nucleo quando il Completo si apre, ogni altra famiglia al primo uso |

`carica.ts` porta una famiglia così: importa il suo chunk, poi chiede al
motore `disegno.famiglia.prepara`, che la fa nascere nel processo. Due
richieste insieme fanno un giro solo; un giro vecchio (dopo «Riprova») non
scrive sopra il nuovo; il disegno chiuso butta gli esiti in volo. Gli errori
sono tre: `no-memory` (il `Budget` dice no), `motore` (il motore non
risponde o manca), `chunk` (il file non arriva); dall'errore si esce con
`riprova`. Una famiglia registra i suoi pezzi una volta sola.

**I confini** li controlla la build ([che cosa arriva tardi](#che-cosa-arriva-tardi)),
con i test delle regole in `apps/client/build/completo-chunks.test.mjs`; ogni
modulo sta nel suo chunk, e ogni chunk c'è. Lo scenario V1 del banco WebView
(`bench/webview/run.mjs`) guarda la stessa cosa nella WebView vera: chunk,
memoria e tempo all'avvio, nel Semplice, col Completo e con la penna. La
WebKitGTK dell'app non elenca fra le risorse i file del protocollo dell'app,
quindi lo scenario legge script e `modulepreload`: per questo ogni famiglia
precarica il suo chunk (`completoPreload`, `build.modulePreload` di
`vite.config.ts`), anche se non importa nient'altro.

**Il banco di prova delle righe**: ogni riga fatta ha un caso in
`crates/fub-disegno/tests/famiglie/<famiglia>.json`, con il disegno di
partenza e ciò che si aspetta (operazioni, lettura, errore o pixel).
`cargo test -p fub-disegno --test famiglie` li fa girare nel motore e
controlla che ogni riga fatta abbia il suo caso;
`apps/client/src/editors/spatial/completo/casi.test.ts` applica le
operazioni in un passo, confronta il testo con il `.svg` di `dopo` byte per
byte e annulla (`FUB_CASI_SCRIVI=1` riscrive i `dopo`). I casi di
`tests/casi-prova/` provano il banco stesso. Nel banco visivo il motore
finto risponde ai comandi del Completo con
`apps/client/bench/disegno-famiglie/<famiglia>.json`; un comando senza
risposta è `Unserved`, come una riga da fare.

## Che cosa arriva tardi

Nel client, la regola `NOT_AT_STARTUP` di `apps/client/vite.config.ts` fa
cadere `npm run build` se un chunk `drawing-*` o un modulo di
`editors/spatial/` entra nel grafo statico di una pagina. Le regole del
Completo stanno accanto, nel plugin `completo-confini`
(`apps/client/build/completo-chunks.mjs`): fuori da
`editors/spatial/completo/` si importa solo `completo/index.ts`, e solo con
`import()`; l'indice e le famiglie arrivano da lì, e una famiglia non ne
importa un'altra. All'avvio e nel Semplice non arriva niente del Completo;
passando al Completo arrivano la sua cornice, l'indice e il nucleo; ogni
altra famiglia al suo primo uso.

Nel processo il codice del Completo è compilato, e pigro è lo stato: il
motore nasce al primo disegno aperto (o con `warm_engine`), una famiglia al
suo primo uso o quando uno spazio di lavoro la prepara, e mai con il suo
componente spento. Lo stato di una famiglia sta in un `Pigro` dello strato
dei motori. Nata, si iscrive nel `Budget` come cache `disegno.<famiglia>`:
i suoi byte sono quelli delle tabelle del motore che possiede (la patch
0008, [Il disco](#il-disco)), e liberarla svuota quelle tabelle e la rimette
da nascere, così il comando dopo la rifà. Un comando che la tiene tiene il
suo stato fino alla fine, anche se il `Budget` la libera intanto. Le 26
famiglie stanno in `famiglie/<id>.rs`, uno per famiglia, con lo stato vuoto
finché il task della famiglia non lo riempie.

`disegno.famiglia.prepara` avvia la nascita come lavoro dello strato dei
motori (`Lavori::in_sottofondo`) e risponde subito con lo stato: `pronta`,
`in-corso` o il rifiuto `no_memory` se il `Budget`, già liberato quanto
poteva, resta sopra il tetto. Una seconda preparazione, o un comando della
stessa famiglia, si unisce al lavoro in corso. Un lavoro finito dopo che il
componente si è spento si butta: le famiglie contano i giri, come i motori.

Il componente spento nel vault: ogni `disegno.*` tranne i tre di K5
risponde `Unserved` (`host.drawing.complete_off`), `famiglia.prepara`
compreso, e `drawing_commands` elenca solo i tre di K5; nessuna famiglia
nasce. Spegnerlo libera le famiglie nate e le toglie dal `Budget`. In una
build senza la feature `drawing-complete` di `fub-host` gli stessi comandi
rispondono `Unserved` (`host.drawing.complete_missing`). «Chiudi tutto»
rende il motore e, con lui, le famiglie.

## Il disco

Il motore non legge e non scrive file: ogni byte gli arriva da Fub e torna
a Fub. Alla nascita del motore, `MotoreDisegno::crea` chiama
`disco::confina()` (`crates/fub-disegno/src/disco.rs`), una volta per
processo:

- spegne i caratteri del sistema (`set_system_fonts(false)`): nessuna
  scansione delle cartelle dei caratteri, nessun ripiego che legge il disco;
  i caratteri vengono dal vault (D12) e Fub li dà come byte;
- mette in vigore radici vuote (`AutomationRoots::deny_all()`, patch `0008`
  di `vendor/vectorcraft`): `check_read` e `check_write` rifiutano ogni
  percorso, in ogni thread del motore. Se nel processo erano già in vigore
  radici diverse, il motore non nasce, con un errore tipato.

Le radici non fermano `unconfined`, che il motore usa per le cartelle sue
(preferenze, recupero, librerie, modelli). Per questo
`crates/fub-disegno/disco.tsv` elenca ogni punto del motore che tocca il
disco (file, funzione, primitiva), con i comandi della mappa che ci
arrivano e come Fub ci arriva (`come`):

| `come` | Vuol dire |
|---|---|
| `byte` | Fub passa i byte al posto del percorso (con il task) |
| `kernel` | il kernel legge e scrive per il motore, nel vault (con il task) |
| `fub` | lo fa Fub, non il motore: salvataggio, recupero, modelli |
| `rifiutato` | le radici vuote lo fermano; mai dentro `unconfined` |
| `escluso` | Fub non lo offre, con il perché (D6, D9 o D12) |
| `spento` | sta dietro una feature che Fub non compila |
| `ambiente` | legge l'ambiente (thread, memoria, data), non un file |
| `nessuno` | nessun comando di Fub ci arriva, e la nota dice perché |

`node tools/disegno-disco/elenco.mjs` riscrive le prime tre colonne dal
codice; `--check` cade, nominandolo, per un sito senza riga, un id che non è
nella mappa o un valore non ammesso. Prima di `Azione::di`,
`Disegno::comando` rifiuta con un argomento non valido i comandi delle righe
`escluso` e `fub` e ogni argomento che porta un percorso, letto dallo schema
del comando. `cargo test -p fub-disegno --test disco` apre e cambia un
disegno del corpus con `HOME`, le `XDG_*` e la cartella corrente vuote, e
controlla che restino vuote.

La patch `0008` elenca anche le tabelle globali del motore che crescono con
l'uso (`vectorcraft_engine::tables`): per ognuna il peso e, quando si può,
lo svuotamento. `user_profiles` e `font_faces` non si svuotano senza
rompere i documenti aperti, e il loro peso entra lo stesso nei conti.
`cargo test -p fub-disegno --release --test famiglie_memoria -- --ignored
--nocapture` stampa una riga per tabella.

## Le preferenze del motore

Le preferenze del motore (`vectorcraft_engine::Prefs`: griglia, guide, passi,
preset delle famiglie) stanno nella sessione di ogni istanza. Fub le tiene
nell'impostazione di macchina `draw.motore` (`crates/fub-features/src/draw.rs`,
`{"v":1,"prefs":{…}}` con le sole chiavi cambiate), e l'host ne è il padrone
(`crates/fub-host/src/drawing.rs`):

- **alla nascita** di un'istanza, l'host legge `draw.motore` e la dà al motore
  (`preferenze::componi`, chiave per chiave: una chiave che non vale si salta
  con un avviso nel log);
- **dopo ogni comando**, fuori dal lucchetto dell'istanza, l'istanza dice quali
  preferenze il comando ha cambiato (`prefs.set`, `prefs.reset`, le opzioni di
  uno strumento, i preset di una famiglia: `Disegno::prendi_le_preferenze_cambiate`)
  e l'host le scrive sopra le chiavi che tiene. Una scrittura che non riesce
  rimette nell'istanza i valori di prima e torna con l'errore: il valore
  salvato resta quello di prima;
- **un valore più nuovo** (`v` più alta) vale per le chiavi che si capiscono
  ma non si riscrive; **uno rotto** vale come le preferenze di serie e non si
  sovrascrive. In tutti e due i casi `prefs.set` e `prefs.reset` si rifiutano
  con `conflict` (`host.drawing.prefs_newer`, `host.drawing.prefs_broken`)
  prima del motore, finché l'utente non azzera `draw.motore`;
  `gradient.presets.save` e `gradient.presets.delete` invece tornano con un
  rifiuto nell'esito (`unsupported`, il perché in `reading`), perché vengono
  dalla sessione del disegno aperto, che un errore fermerebbe; la sezione
  Sfumatura lo dice con la frase del caso;
- **le quattro cartelle** (`fontsFolder`, `pluginsFolder`, `recoveryFolder`,
  `templatesFolder`: `preferenze::CARTELLE`) non si leggono, non si scrivono e
  non si mostrano: `prefs.get` e `prefs.list` le tolgono, e un `prefs.set` che
  ne nomina una è `bad_args` da `disco::controlla`.

Impostazioni › Disegni le mostra nel riquadro «Motore del disegno»
(`apps/client/src/panels/settings-motore.ts`, il corpo pigro in
`settings-motore-corpo.ts`): apre nel motore un disegno vuoto suo, chiede
`prefs.list`, e ogni campo è un `prefs.set` su quel disegno; nessuna IPC nuova.
Le parole delle categorie, dei titoletti e delle etichette sono generate da
`crates/fub-host/tests/ts_preferenze_motore.rs` (il catalogo italiano del
motore passato per il glossario del disegno) in
`settings-motore.generated.json`, con la versione di `draw.motore`. Un disegno
già aperto prende le preferenze cambiate da un altro disegno solo quando si
riapre.

Le sfumature preimpostate della sezione Sfumatura stanno qui: le 55 del motore
sono sue, e quelle che l'utente salva sono la chiave `gradientPresets` delle
preferenze, quindi `draw.motore`, per tutti i disegni e fuori dal file SVG.
`gradient.presets.list`, `gradient.presets.save` e `gradient.presets.delete`
(famiglia `aspetto`) le leggono e le cambiano senza toccare il disegno né la
cronologia; `gradient.presets.apply` è un cambio del disegno come gli altri,
con un passo di Annulla. Il client
(`apps/client/src/editors/spatial/completo/sfumature-preimpostate.ts`)
controlla il nome prima del motore, che rifiuta come `bad_args` un nome vuoto,
già preso o di una preimpostata sua, e mostra i nomi del motore nella lingua
dell'interfaccia (`sfumature-nomi.ts`).

## Le due strade

Il componente «Disegno completo» (`fub.disegno-completo`, in «Disegnare»,
acceso di serie) richiede il «Motore del disegno» e si spegne con lui: un
vault che aveva spento soltanto il motore legge spento anche il Completo,
senza che il file cambi. Con il componente spento il Completo è quello
nativo, scritto in TypeScript, e il file si apre e si salva come prima. Con
il motore spento valgono gli strumenti semplici, come dice
[quando il motore manca](disegno.md#quando-il-motore-manca).

Un disegno incorporato in una nota resta quello della
[0248](../decisions/0248-il-disegno-nella-nota-si-modifica-sul-posto.md): la
superficie compatta sta nel Semplice e non carica niente del Completo; «A
tutta pagina» apre il Completo.

Per il giro di un gesto, la copia e i comandi IPC vedi
[Il disegno sul motore](disegno.md); per il motore pigro, il `Budget` e i
caratteri [Lo strato dei motori](motori.md).
