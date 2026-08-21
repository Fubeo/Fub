# Protocollo di UI dichiarativa (`UiNode`)

Un plugin o una feature ufficiale descrive la propria interfaccia utente. Usa un albero `UiNode`. L'albero `UiNode` è serializzabile e neutro rispetto al framework. Il frontend del core (il motore di base) lo disegna. Usa i propri componenti nativi. Questo produce temi coerenti. Evita JS nei plugin. Offre la stessa strada per le feature native e i plugin di terzi.

*   Definizione: `crates/fub-abi/src/ui.rs`.
*   Renderer e riconciliatore: `frontend/src/ui/node.ts`.
*   Cos'è una view, e perché: [decisione 0016](../decisions/0016-cosa-e-una-view.md).

Torna a [../PIANO.md](../PIANO.md) · vedi [traits.md](traits.md).

## Un nodo è una chiave e una specie

`UiNode` è il record `{ key, kind }`. La **chiave** rappresenta l'identità del nodo durante due ridisegni. La chiave è stabile e unica **fra i fratelli**. Funziona come identificatore (es. l'id di un documento). Sostituisce l'uso dell'indice nella lista. Il riconciliatore lavora su questa chiave. Questo fissa l'identità del nodo. Altrimenti, l'identità dipende dalla posizione. In assenza di chiave, riordinare una lista sposta il focus e la selezione. I nodi omettono la chiave in mancanza di liste riordinabili.

## Ogni etichetta è un `Text`, non una `String`

Secondo la [decisione 0040](../decisions/0040-chi-localizza.md), **ogni campo letto da una persona** è un [`Text`](../../crates/fub-abi/src/text.rs). Questi campi includono `content`, `title`, `label`, `subtitle`, `placeholder`, `submit_label` e `message`. Un `Text` assume due forme:
*   `Literal`: Un dato grezzo (es. un nome di tag, un path).
*   `Message`: Una chiave di catalogo fornita dall'autore. Include i relativi argomenti.

Il **kernel** (il motore logico centrale) risolve il testo. Questo avviene sulla via d'uscita dal contratto.

L'albero arriva alla webview della shell (l'interfaccia utente). Qui ogni `Text` diventa un `Literal`. Un `Literal` sul filo di comunicazione è una stringa semplice. L'autore di un provider (chi fornisce i dati della vista) nota una cosa sola: i builder accettano `impl Into<Text>`. Di conseguenza, `UiNode::text("ciao")` continua a funzionare.

I seguenti campi rimangono identificatori grezzi: `Icon.name` (un id del repertorio della shell), `Custom.ns`, `Html.html`, `WebView.url`, i `field` e i `value` dei nodi di input, e il `value` di una `UiOption`. Usare traduzioni distruggerebbe la loro identità.

## Le specie di nodo

**Struttura di base**

| Specie | Campi | Reso dal frontend come |
|---|---|---|
| `Stack` | `dir: Axis`, `gap: u8`, `children` | `div` flex (row/column) |
| `Text` | `content` | `div.ui-text` |
| `Heading` | `level: u8`, `content` | `h1..h6` |
| `List` | `items` | `div.ui-list` |
| `ListItem` | `title`, `subtitle`, `action: Option<ActionRef>`, `selected` | riga cliccabile |
| `Button` | `label`, `intent: Intent`, `action: ActionRef` | `button.intent-*` |
| `Html` | `html` | `div.ui-html` (frammento già renderizzato) — **solo codice fidato** |
| `WebView` | `url`, `height: u32` | `iframe` sandboxed (`allow-scripts`) — **solo codice fidato** |

**Nodi strutturali**

| Specie | Campi | Reso come |
|---|---|---|
| `Section` | `title`, `collapsed`, `children` | `details`/`summary` (la chiusura appartiene alla shell) |
| `Table` | `columns: Vec<TableColumn>`, `rows` | `table` (le righe sono nodi con chiave) |
| `Row` | `cells`, `action` | `tr` cliccabile |
| `Tree` | `roots` | `div.ui-tree` |
| `TreeItem` | `label`, `expanded`, `action`, `selected`, `children` | voce annidata |
| `Tabs` | `active: u32`, `tabs` | linguette e corpo (il cambio scheda lascia inalterato il provider) |
| `Tab` | `label`, `action`, `children` | il corpo di una scheda |
| `Badge` | `label`, `intent` | `span.ui-badge` |
| `Icon` | `name` | icona del repertorio della shell; restituisce il vuoto per nomi ignoti |
| `Progress` | `value: Option<f32>`, `label` | `progress` (l'assenza indica stato indeterminato) |
| `Separator` | — | `hr` |
| `EmptyState` | `title`, `detail`, `action` | stato di vuoto, con l'azione successiva |
| `KeyValue` | `entries` | `dl` |

**Nodi di input.**
Ogni nodo possiede tre campi:
*   `field`: La chiave per il ritorno del valore in `UiAction::fields`.
*   `value`: Il valore attuale desiderato dal provider. Questo mantiene il protocollo privo di stato sul lato shell.
*   `action`: Un'azione opzionale. Scatta all'assestamento del valore.

Nodi supportati:
*   `TextInput`, `TextArea`, `Number`, `Checkbox`, `Select`, `Radio`, `Slider`.
*   `DatePicker`: Rappresenta una data civile ISO-8601. È una stringa. Usa il tempo civile del locale ([decisione 0039](../decisions/0039-il-locale-e-il-caso.md)).
*   `Form { children, submit_label, submit }`: L'invio trasmette **tutti** i campi contenuti.

**Il varco, e i due stati**

| Specie | A cosa serve |
|---|---|
| `Custom { ns, payload, fallback }` | la shell disegna il widget se conosce `ns`; applica il `fallback` dichiarativo altrimenti |
| `Pending { label }` | stato di attesa: qualcuno sta preparando il dato |
| `Failed { message, retry }` | errore operativo, con invito a riprovare |

I tipi `Pending` e `Failed` sono **nodi** diretti, sostituendo le risposte piatte in `render_view`. Risolvono le parzialità. Esempio: la testata esiste, ma la tabella è in arrivo.

Tipi di supporto: `Axis { Row, Column }`, `Intent { Neutral, Primary, Danger }`. I plugin scelgono **intenti semantici**. Il core fornisce i colori finali tramite il tema. Altri tipi: `Align`, `ActionId(String)`, `ActionRef { action, payload }`, `UiValue { Text | Number | Bool | Choices }`, `FieldValue { field, value }`, `UiOption`, `KeyValueEntry`, `TableColumn`.

## Chi mette cosa in un'azione

Un'azione possiede **due metà**. Ognuna ha un proprietario esclusivo. Le due parti restano indipendenti:
*   Il **provider** assegna al nodo un `ActionRef`. Contiene l'id e il `payload`. Il payload permette di riconoscere l'oggetto del clic. Questo dato torna intatto al provider.
*   La **shell** compila `UiAction::fields` con lo stato attuale dei campi. Prende i campi dal `Form` contenitore, oppure dall'intera view all'esterno di un form. Un campo dichiarato due volte appare una volta sola, trattenendo l'ultimo valore.

Il tipo `ActionId` è un identificatore **opaco**. Funge solo da riferimento. In passato, la convenzione privata concatenava i dati dentro l'id (es. `open:a/Uno.md`, `tag:rust`). Questa abitudine rischiava di diventare un contratto de facto.

## Ciclo azione → aggiornamento

1. Il frontend monta l'albero tramite `mountTree(container, node, onAction)`. Disegna l'albero la prima volta. Riconcilia i nodi dalle volte successive.
2. Un click o la modifica di un campo innesca un evento. Invia al `ViewProvider` i dati `UiAction { action, payload, fields }`. Trasmette anche l'istanza emittente.
3. Il provider riceve `&mut self` e conserva la memoria dello stato locale. Risponde con `ViewUpdate`:
   *   `Replace { root }`: Rimpiazza l'albero della view. La shell riconcilia l'albero preservando le istanze attive.
   *   `Patch { key, node }`: Sostituisce **esclusivamente il nodo** associato a quella chiave. Una chiave mancante segnala un cambiamento sottostante della view, risultando valida.
   *   `None`: Nessun cambiamento.
   *   `Navigate { doc_id }`: Chiede al core di aprire un documento.
   *   `Reveal { doc_id, span }`: Apre il documento (se necessario) e centra la vista sull'intervallo. Lo `span` usa i byte UTF-8. Il frontend mappa l'offset sull'editor con `frontend/src/rules/offsets.ts`.
   *   `RunSearch { query }`: Esegue una ricerca e mostra i risultati.
   *   `Custom { ns, payload }`: Intento specifico per l'estensione. La shell ignora la richiesta se non riconosce `ns`.

I comandi `render_view`, `view_action` e `set_active_context` alimentano questo giro. Il montaggio risiede in `frontend/src/ui/views.ts`. Vari flussi lo esercitano: i backlink (usano `open` col `DocId` nel payload producendo `Navigate`), l'outline (usa `reveal` con lo span producendo `Reveal`), il pannello tag (usa `search` col tag producendo `RunSearch`, usando il campo `filter` per collaudare lo stato) e le statistiche.

## Le istanze: quale esemplare sta disegnando

Le funzioni `render_view` e `on_action` ricevono una `ViewInstance { view, instance, params }`. La funzione `views()` produce un elenco **statico** di specie. Un esemplare specifica la view esatta accompagnata da un parametro. Esempi: le viste multiple di un database, le viste salvate, le query embed parametriche, i task suddivisi per tag, per cartella o per data.

I `params` si dichiarano in `ViewSpec::params`, con gli **stessi `ParamSpec` dei
comandi**, e la convalida è la stessa funzione (`command::validate_params`). Chi
apre una view da un comando e chi la apre a mano ricevono la stessa risposta
sullo stesso argomento sbagliato. Il punto di applicazione è uno: il kernel.

Un comando avvia un'istanza tramite `CommandEffect::OpenView { view, params }`. La shell monta automaticamente l'**esemplare unico** di ogni view dichiarata. Prende il nome dalla sua specie e omette i parametri.

## Le superfici: dove una view si ancora

L'enumerazione `ViewSurface` nomina dieci superfici: `LeftSidebar`, `RightSidebar`, `Bottom`, `Main`, `Modal`, `StatusBar`, `Ribbon`, `Menu`, `ContextMenu` e `SettingsTab`. Indica il punto di ancoraggio preciso. Si distingue da un modello di layout sullo spazio diviso.

Questa shell ne ospita **otto**:
*   Le sei principali.
*   La scheda di impostazioni. Ha un pannello dedicato dal §11.1 ([decisione 0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md)).
*   L'area principale ([decisione 0079](../decisions/0079-il-grafo-esce-dall-overlay.md)).

Le due che restano (menu e menu contestuale) richiedono il modello di layout completo (feature 3.3). Prevedono un menu applicativo e un menu contestuale estendibile. Una view riceve **un avviso esplicito** quando le richiede, evitando sparizioni silenziose.

La scheda di impostazioni impone un limite dichiarato. Le view associate si montano **tutte nella stessa area**. Condividono lo spazio sotto il form generato dallo schema. Dedicare una scheda sua a ciascuna view esigerebbe il modello di layout globale.

La `ViewSpec` include la presentazione:
*   `icon`.
*   `order`: Ordine crescente. L'ordine di registrazione risolve i pari merito.
*   `open_by_default`.
*   `preferred_size`: Applicata alla prima apertura.
*   `closable`.

## Quando una view invecchia: due maschere e un invito

La `ViewSpec` dichiara due maschere: `refresh: EventMask` e `follows: ContextMask`.
*   `refresh`: Copre gli eventi del **vault** (la cartella utente). L'arrivo di un evento esige un nuovo `render_view`.
*   `follows`: Copre le parti del **contesto di sessione** (documento, selezione, modalità).

Le due maschere restano separate. Un cursore in movimento appartiene al contesto della finestra, slegato dagli eventi del vault. Far transitare il cursore sull'event bus imporrebbe la consegna di ogni battuta a tutti gli handler.

La proprietà `refresh` accetta la maschera per intero, escludendo l'uso di semplici liste di specie ([decisione 0033](../decisions/0033-la-grana-di-un-abbonamento.md)). Comprende specie, prefissi di topic dei custom e il **soggetto**. La shell applica questa regola coerentemente col kernel. Usa `maskWants` in `frontend/src/rules/mirrored.ts`, gemella di `fub_abi::rules::events::mask_wants`. La fixture generata connette le due implementazioni. Un semplice filtro per specie forzava ridisegni eccessivi da parte della shell, tradendo le intenzioni del contratto visivo. I pannelli **nativi** dichiarano una maschera e non una lista tramite `refreshOn(...)` in `ui/panel-host.ts` per ottenere la stessa garanzia.

La shell pubblica il contesto tramite `set_active_context`. Riceve dal kernel **gli id delle view da ridisegnare**. Il kernel esegue questo conteggio grazie a `follows`. Senza questo blocco logico, il sistema imporrebbe il ridisegno globale a ogni input. Richiederebbe una `query_index` per ogni singola battuta.

L'**invito** rappresenta la terza strada. Un provider emette `Event::ViewInvalidated { view, instance }` al termine di un lavoro lungo. Sfrutta un evento al posto della capacità `invalidate_view`. Questo asseconda la [decisione 0013](../decisions/0013-elenco-delle-capacita.md). Una capacità implica l'attesa di una risposta bloccante. Una notifica usa un evento. L'omissione di `instance` invalida tutte le istanze. Il componente di rendering gestisce il **freno** applicativo. Ricevere venti inviti in un giro produce un ridisegno. Questo processo rispetta un microtask.

Dichiarazioni delle sette view ufficiali:
*   **Backlink**: dichiarano solo `Document`. I backlink di una nota rimangono costanti ovunque nella nota.
*   **Outline**: dichiara `Document + Selection`. Segnala la sezione della selezione primaria.
*   **Statistiche**: dichiarano tutto. Seguono la selezione. Aggiornano la veste grafica durante la lettura.
*   **Cronologia**: dichiara `Document`. Raffigura la storia della nota corrente.
*   **Pannello tag**: maschera vuota. La distribuzione dei tag del vault resta globale.
*   **Cestino**: maschera vuota. Il contenuto appartiene al contesto globale.
*   **Grafo**: maschera vuota (nessun contesto, nessun evento). Ridisegnarlo innesca la simulazione in corso. Riavviarla compromette la visualizzazione dell'utente.

## La regola dell'escape hatch — e il confine di fiducia

I nodi `Html` e `WebView` fungono da scappatoie protette. Richiedono un **uso parsimonioso**:
*   **`Html`**: Ospita un frammento già renderizzato dal core (es. l'anteprima HTML di un backlink). Veicola output originato dal core. Esclude rigorosamente il codice sorgente del plugin. Passa sempre attraverso il punto unico di sanitizzazione (`ui/sanitize.ts`, §3.6). I due presidi gestiscono autorizzazioni separate affrontando due domande diverse. Il kernel definisce l'emittente autorizzato. Il sanitizer filtra il markup ammesso nella webview. Il codice fidato conserva le naturali vulnerabilità.
*   **`WebView`**: Rappresenta un iframe isolato (`sandbox="allow-scripts"`). Ospita in via esclusiva il codice arbitrario del plugin. L'uso interviene quando la resa dichiarativa si dimostra inadeguata. Serve unicamente a ospitare canvas o DOM proprietari.

**Confine di fiducia.** I nodi `Html` e `WebView` iniettano contenuto attivo nella webview principale. Quest'ultima comunica con l'IPC Tauri usando pieni privilegi. Un plugin isolato via sandbox userebbe l'interfaccia utente per scavalcare i blocchi. Inietterebbe tag `<script>` nel core aggirando la memoria isolata. Si applicano le seguenti restrizioni:
*   Le due varianti restano **riservate al codice fidato** (core e feature ufficiali).
*   L'host blocca gli alberi provenienti da provider **privi di fiducia**. Usa `UiNode::validate_untrusted()` (in `fub-abi`, coperto da test). L'errore `PermissionDenied` interviene alla comparsa di `Html` o `WebView`. Il punto di controllo è **uno**: `Workspace::render_view` e `Workspace::view_action`. I provider registrano qui il proprio grado di fiducia tramite `register_view_provider(id, Trust, provider)`. Questo esame abbraccia anche gli alberi restituiti in `ViewUpdate::Replace`. Ciò blocca gli aggiramenti tramite i clic manuali. Attualmente tutti i provider godono di fiducia. La validazione agisce a protezione di scenari futuri (verifica in `crates/fub-kernel/tests/view_trust.rs`).
*   La `WebView` riaprirà le porte ai plugin in futuro. Richiede prima una **asset story** (asset del plugin serviti localmente dall'host) e una **CSP** dedicata. La pianificazione indica l'obiettivo a M5.

## L'HTML entra da un punto solo

Ogni frammento HTML transita esclusivamente da `frontend/src/ui/sanitize.ts` (§3.6). Raccoglie il passaggio di `UiNode::Html`, dell'anteprima del documento e del contenuto degli embed. L'architettura passata sparpagliava i flussi su tre punti disgiunti.

Il sanitizer produce un `DocumentFragment` intenzionalmente. Evita la generazione di stringhe dirette. Assegnare una stringa ripulita a `innerHTML` innesca la doppia parsatura. Questa classe di difetti causa le vulnerabilità più fatali per i sanitizer. La **politica** ammette specifici tag, attributi e URL. Impiega funzioni pure sottoposte a test rigorosi. L'attraversamento del DOM manca attualmente di copertura. Il framework `happy-dom` offre un ambiente idoneo. Esegue correntemente il presidio di accessibilità e l'e2e della shell ([decisione 0112](../decisions/0112-un-e2e-contro-un-host-finto-prova-il-cablaggio.md)). Lo sviluppo dei test sul DOM attende solo la sua implementazione pratica.

Si applicano due regole asimmetriche:
*   Un **link** aziona la navigazione. Accetta URL esterni `https://`. L'utente conferma deliberatamente l'apertura. L'elemento adotta `rel="noopener noreferrer"`.
*   Una **risorsa** (attributo `src`) esegue il caricamento automatico. Invia avvisi impliciti di apertura della nota al server. Il sistema blocca i collegamenti remoti per impostazione predefinita (5.3, 23.2).

La policy CSP residente in `tauri.conf.json` fornisce l'ultima barriera. Il sanitizer delimita l'ingresso nel DOM. La policy CSP circoscrive le azioni degli elementi iniettati.

## Transclusion (embed): placeholder + composizione

La funzione `FormatProvider::render_html` resta **pura per-documento**. Opera senza l'accesso a `HostApi` e ignora i documenti esterni. Il provider trascura la risoluzione diretta degli embed (es. `![[Page#Heading]]`). Genera un segnaposto intermedio:

```html
<div class="embed" data-embed-page="Page" data-embed-heading="Heading">…</div>
<div class="embed" data-embed-page="Page" data-embed-block="abc123">…</div>
```

La composizione finale avviene all'esterno:
1. Il **kernel** attiva `Workspace::render_embed(page, heading?, block?)`. Localizza la pagina sfruttando il grafo. Genera l'intero documento, la singola sezione associata all'heading (ritagliata sugli `Span` dell'outline), o l'esatto blocco identificato dall'ancora (ritagliato tramite `DocumentModel::anchors`). Fornendo tutt'e due, il sistema privilegia **il blocco**. Le ancore di blocco appaiono univocamente. Gli heading identificano l'intero intervallo contenitore.
2. Il **frontend** idrata i segnaposti (tramite il comando IPC `render_embed`). Innesta l'HTML in modo ricorsivo. Preserva la lista dei documenti attivi. Questo interrompe la creazione di **cicli** distruttivi (es. `![[A]]` all'interno di A). Arresta l'analisi al limite massimo di profondità, fissato a 5.

Questo modello conserva la purezza del provider. Assegna al kernel l'esclusiva sul vault e sulle sue topologie. Il frontend gestisce il contenuto emulando il processo di navigazione dei wikilink.

Prendiamo la **graph view** ad alte prestazioni come caso d'uso. Poggia su un modello force-directed su Canvas. Rispetta la [decisione 0079](../decisions/0079-il-grafo-esce-dall-overlay.md) senza essere più una promessa. Evita completamente `UiNode`, utilizzando il resto del protocollo. Il `ViewProvider` del grafo (in `fub-features/src/graph.rs`) seleziona `ViewSurface::Main`. Estrae i nodi e gli archi inviando due domande al canale dati (`IndexQuery::Documents` e `IndexQuery::Neighbors`). Genera l'output tramite `UiKind::Custom { ns: "fub:graph", payload }`. Il frontend intercetta questo namespace. Sovrappone il proprio canvas (`frontend/src/panels/graph.ts`, formalizzato in `ui/custom.ts`). Il click sui nodi produce azioni di view ordinarie. L'aggiornamento impiega `ViewUpdate::Navigate`, replicando la logica del backlink.

**Considerazioni aggiornate sul dogfooding.** Inizialmente la graph view godeva di un privilegio in due sensi. Manteneva i propri **dati** esclusivi e i propri **pixel**. Il primo vantaggio è decaduto. Il canale pubblico offre l'accesso globale ai dati. Qualsiasi vista a grafo esegue liberamente le stesse due query. Il secondo privilegio permane: **un namespace `ns` noto alla shell**. L'estensione di terzi emette il nodo `Custom` visualizzando un semplice `fallback`. Questo durerà fino al supporto formale della `WebView` via asset story e CSP (traguardo M5). Il principio "l'adeguatezza per le feature ufficiali garantisce l'adeguatezza per i plugin" qualifica rigorosamente le interfacce **dichiarative**. Il varco `Custom` spezza il modello dichiarativo. Fornisce un degrado documentato, impedendo la creazione di vie di fuga isolate.

## Dogfooding: le sette view ufficiali

Queste sette view esplorano il cammino dei plugin di terzi. Mantengono il protocollo intenzionalmente essenziale. Ciascuna stressa un comparto distinto:
*   **Backlink** (`backlinks.rs`): Impiega il payload. Abbandona la concatenazione negli id. Pone la **chiave** univoca su ogni riga (il `DocId` originario).
*   **Outline** (`outline.rs`): Applica un `Tree` vero. In passato il formato aggiungeva uno spazio EM al titolo per creare la gerarchia. La struttura usava la formattazione spaziale per varcare il confine. Il sistema adotta l'aumento di livello logico per indicare la relazione di figlio, escludendo il passo matematico di uno in più.
*   **Tag** (`tags.rs`): Testa la funzionalità del **filtro**. Assicura la sopravvivenza del campo di testo durante due render successivi. Collauda simultaneamente lo stato su `on_action` e il meccanismo riconciliatore.
*   **Grafo** (`graph.rs`): Utilizza l'**area principale** e il varco `Custom`. Dichiara per prima la `ViewSurface::Main`. Invia i formati ignoti alla shell. Rappresenta l'integrazione complessa. Misura il confine tra dichiarazione astratta e disegno concreto.
*   **Statistiche** (`stats.rs`): Agisce come primo cliente della barra di stato.
*   **Cestino** (`trash.rs`): Svolge due domande dirette all'utente: confermare lo svuotamento o gestire il ripristino sul path occupato. Sostituisce le modali del contratto di sistema. Stampa la domanda al posto dell'elenco. Salva la richiesta nello stato di vista ([decisione 0075](../decisions/0075-una-view-non-chiede-con-una-finestra.md)).
*   **Cronologia** (`versioning.rs`): Scrive ciò che visualizza. Legge le elaborazioni dal suo spazio dati isolato. Usa un comando del registro (`version.restore`) per produrre un risultato.

**Limiti della garanzia:** La [decisione 0104](../decisions/0104-la-superficie-di-scrittura-si-presta.md) promuove una validazione **misurata**. Queste sette view impegnano quattro delle dieci superfici messe a disposizione da `ViewSurface`. Le altre sei mancano di coperture in dogfooding. Il principio di adeguatezza copre esclusivamente i perimetri convalidati attivamente. Assicura quattro superfici su dieci. La suite `fub-features/tests/conformita.rs` (funzione `il_dogfooding_dichiara_fin_dove_arriva`) traccia questo aspetto. Richiede l'assegnazione di una feature implementata o l'inclusione di una giustificazione documentata.

L'altra metà di dove finisce sta nel metro di
[plugin-boundary.md](plugin-boundary.md#cosa-non-può-essere-solo-un-guest-e-il-metro-per-deciderlo):
la sua **quarta voce** — *se la superficie esiste* — nomina chi non passa non
perché costi troppo, ma perché una porta non c'è. Il caso che trova è la
**superficie di scrittura**: non vietata e non attrezzata.

## Evoluzione prevista

*   **Completato ([decisione 0016](../decisions/0016-cosa-e-una-view.md)):** Comprende i nodi di input, le superfici, le istanze, lo stato in `on_action` e lo stato di attesa. Include i metadati di `ViewSpec`, il payload delle azioni e la chiave per il riconciliatore. Rispetta il vincolo della permanenza dello stato locale durante gli update interattivi. La chiave dimora saldamente **sul nodo**. L'istruzione `mountTree` riconcilia i dati attivi evitando cancellazioni arbitrarie. Esclude l'invio distruttivo dei valori dal provider sul campo in fase di focus.
*   **Completato ([decisione 0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md)):** Il protocollo abbraccia i **blocchi custom** estendendosi oltre le view. L'operazione `render_preview` fornisce un oggetto `RenderedDocument { html, parts }`. L'HTML espone un riferimento `data-ui-slot="N"`. La shell innesta il componente sfruttando `mountTree`. I componenti dei plugin finiscono a schermo **senza richiedere una riga aggiuntiva nel bundle host**. La via maestra per il widget rimarrà l'iframe sanificato (fissato per M5).
*   **Obiettivo aperto:** L'ottimizzazione e la virtualizzazione delle liste lunghe. L'analisi condotta nel ~~[§2.9](../roadmap/18-editor-e-tastiera.md#29-prestazioni-della-ui)~~ affronta solo la frazione antecedente al layout ([decisione 0114](../decisions/0114-una-finestra-non-si-omette.md)). Controlla i pesi e la conta degli elementi. Esclude la visualizzazione condizionata su schermo. Questa parte finale attende un collegamento efficace col layout visivo.
*   **Obiettivo aperto:** L'impiego maturo del ramo `Custom` supportato dal namespace noto alla shell. L'arrivo del primo diagramma (`ns: "fub:diagram"`) comprova l'assenza attuale di necessità primarie. La dichiarazione del `fallback` svolge un'azione risolutiva sufficiente. L'esigenza scaturirà insieme al futuro motore di disegno.
*   Ogni nuovo costrutto `UiNode` garantisce la compatibilità con il linguaggio WIT (elenco e tabella in [traits.md](traits.md)).

<!-- 9 [conta: famiglie-paginate] -->
