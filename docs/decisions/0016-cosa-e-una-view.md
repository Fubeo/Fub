# 0016 — Cosa è una view

|  |  |
|---|---|
| **Decisa** | 2026-07-26 |
| **Origine** | `todo.md` §2.1–§2.8 (seduta 2, *ex* §1.2, §1.14, §1.15, §1.30–§1.33, §3.9) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/02-cosa-e-una-view.md) · [il protocollo](../architecture/ui-protocol.md)

---

Le firme dicevano insieme una cosa che nessuno aveva mai deciso: *una view è una
funzione pura, sincrona, senza stato, che disegna in sola lettura su una delle
tre superfici che esistono.* Non era una scelta sbagliata — era una scelta
**implicita**, e su quella forma non regge niente di interattivo né di
asincrono, cioè i capitoli 11, 12, 11.5 e 22 di FEATURES.

Otto voci su nove sono chiuse in questo giro. Resta aperta la
[§2.9](../roadmap/18-editor-e-tastiera.md#29-prestazioni-della-ui) (virtualizzazione,
P2): è la stessa superficie quando le liste diventano lunghe, non ha scadenza
col freeze, e non è una precondizione di niente.

## Cosa è una view, adesso

Un **esemplare** (`ViewInstance`: quale view, quale istanza, con quali
parametri) che disegna un **albero di nodi con una chiave** su una delle **dieci
superfici** del contratto, può **mutare sé stessa** in risposta a un'azione, può
dire **«non ancora»** e può chiedere di **essere ridisegnata** quando ha finito
qualcosa che il vault non vede.

Le decisioni prese, da NON ridiscutere senza motivo:

- **Un nodo è `{ key, kind }`**, e la chiave sta nel contratto (§2.8). Non è
  decorazione: senza, l'identità di un nodo è la sua posizione, e una lista che
  si riordina si porta dietro il focus e la selezione di qualcun altro. Il §2.1
  chiedeva un `Patch { path, node }`; il path si rompe al primo riordino —
  cioè esattamente nel caso che lo motivava, il pannello con 500 righe e una
  spunta — quindi il patch è **per chiave** e una chiave che non si trova non è
  un errore, è una view cambiata sotto.
- **Trentatré specie di nodo**, e la regola di fiducia invariata: `Html` e
  `WebView` restano riservate, ogni specie nuova è **sicura per costruzione**
  (nessun campo è interpretato come markup) e la validazione ora scende da
  `UiNode::children`, quindi un contenitore nuovo è coperto dal giorno in cui
  esiste. La versione di prima elencava a mano i due contenitori che c'erano:
  è la forma di presidio che si dimentica alla terza aggiunta, e c'è un test che
  lo prova sui due posti dove sarebbe più facile — la cella di una tabella e il
  `fallback` di un `Custom`.
- **Le due metà di un'azione hanno due proprietari** (§2.7). `ActionRef.payload`
  è del **provider** — lo scrive rendendo l'albero e gli torna intatto —,
  `UiAction.fields` è della **shell**, che ci mette lo stato dei campi in vigore.
  Nessuno dei due fonde l'oggetto dell'altro, quindi non serve una regola di
  collisione. È ciò che sostituisce la convenzione privata «i dati dentro l'id»
  (`open:a/Uno.md`, `tag:rust`, `reveal:10:15`) che le tre feature ufficiali
  stavano promuovendo a contratto de facto: l'id torna **opaco**.
- **`ViewPlacement` è diventato `ViewSurface`, con dieci casi** (§2.2). Una voce
  di menu o una scheda di impostazioni non è un *posto in un layout*: è una
  superficie a cui ci si attacca. I tre di prima restano in testa e nell'ordine
  — è lo stesso discriminante — e i sette nuovi comprendono l'**area
  principale**, che è la superficie che mancava di più: il grafo è uscito dal
  contratto con un comando bespoke e un renderer privato non perché sia
  speciale, ma perché non c'era un posto dove metterlo.
- **`on_action` prende `&mut self`, `render_view` resta `&self`** (§2.4). Non è
  un compromesso: è la stessa divisione che regge `index.query` e il §8.3 — N
  view che si ridisegnano non si aspettano a vicenda. Il costo è **zero**,
  perché il kernel estraeva già il provider per la durata dell'azione (era la
  disciplina che serve a prestargli l'host in scrittura), ed è questo che ha
  tolto ogni ragione alla terza strada, l'interior mutability dichiarata a
  contratto. A M5 la firma non si vede: nel WIT `self` non compare, e un
  componente WASM muta la propria memoria lineare senza chiedere permesso.
- **L'invito a ridisegnare è un evento, non una capacità** (§2.5). La regola è
  della [decisione 0013](0013-elenco-delle-capacita.md) — *una capacità è ciò di
  cui il chiamante ha bisogno della risposta per proseguire; ciò che si limita a
  informare è un evento* — e applicarla a `invalidate_view` dà
  `Event::ViewInvalidated { view, instance }`. Da evento guadagna l'origine, che
  una capacità si sarebbe dovuta far dichiarare da chi la chiama. `instance`
  assente = tutte le istanze. Il **freno** è di chi disegna e sta scritto
  accanto a lui: venti inviti in un giro sono un ridisegno, e la finestra è un
  microtask — «quando questo giro di eventi è finito».
- **«Non ancora» è un nodo, non una risposta** (§2.5). `Pending` e `Failed` sono
  specie di nodo perché il caso normale è **parziale**: la testata c'è, la
  tabella arriva. Un `render_view` che potesse rispondere «non ancora» avrebbe
  costretto ogni view a essere tutta pronta o tutta assente.
- **I parametri di una view sono i `ParamSpec` dei comandi** (§2.3), e la
  convalida è **letteralmente la stessa funzione** (`command::validate_params`,
  estratta da `CommandSpec::validate_args`). Due grammatiche di parametri
  sarebbero due convalide, due descrizioni per un umano e due modi di
  sbagliarle: chi apre una view da un comando e chi la apre a mano devono
  ricevere la stessa risposta sullo stesso argomento sbagliato. Il punto di
  applicazione è uno solo, il kernel, per la ragione di sempre: uno schema che a
  farlo rispettare è chi lo pubblica non è uno schema, è un commento.
- **Chi apre un'istanza è un comando** (`CommandEffect::OpenView`), non una
  capacità dell'`HostApi`: stessa regola della 0013, e in più il comando è il
  canale che la shell già esegue — con la palette, la scorciatoia e la
  descrizione per un umano, gratis.
- **`selected` è uno stato del nodo** (`ListItem`, `TreeItem`). Il commento
  dell'outline nominava già questa mancanza («un evidenziato vero vorrebbe una
  nozione di elemento corrente in `UiNode` — che è roba del §2.1»), e senza,
  chi ce l'ha se lo scrive nel titolo: cioè il §2.7 in un'altra forma.

## Il dogfooding, che è dove si è scoperto se regge

Le quattro feature ufficiali sono passate dal protocollo nuovo, e ognuna ha
esercitato una parte diversa:

- **Backlink** — il payload al posto della concatenazione, e la **chiave** su
  ogni riga (il `DocId` sorgente, non la posizione).
- **Outline** — è diventato un **albero vero**. Prima la gerarchia degli heading
  si vedeva rientrando il titolo con uno spazio EM, perché il protocollo aveva
  solo liste piatte: la struttura di un documento attraversava il confine come
  *spaziatura*. Ora attraversa come annidamento, e la sezione col cursore è
  `selected` invece di un sottotitolo che dice «cursore qui». Ha portato anche
  una regola che il rientro nascondeva: «figlio» è *di livello maggiore*, non
  *di livello esattamente uno in più* — una nota che comincia da un `h2` o salta
  un livello non deve perdere heading, e c'è il test.
- **Tag** — ha un **filtro**, cioè un campo di testo il cui contenuto sopravvive
  fra due render. Prima non era esprimibile in nessuna delle due metà: non
  c'erano nodi di input, e `on_action` prendeva `&self`. È il collaudo del §2.4
  e del §2.8 insieme — si digita, il provider filtra e risponde `Replace`, la
  shell **riconcilia** e il campo non perde il focus. Con l'albero ricostruito
  da zero, scrivere due lettere di fila sarebbe impossibile.
- **Statistiche** — è il primo cliente di una superficie **nuova**: sta nella
  barra di stato, che è ciò che il §2.2 nomina per «ciò che informa senza
  interrompere». Prima finiva «in basso», cioè in un riquadro largo quanto la
  finestra per due conteggi.

## La linea di base ritagliata

Il presidio dell'additività ha nominato **sette** rotture, ed è il suo mestiere:
sono deliberate, sono pre-freeze, e la baseline è stata ritagliata con la
ragione scritta dentro `crates/fub-abi/wit/frozen/0.1.0.wit` (più la riga nella tabella dei
ritagli del suo README).

| cosa | perché |
|---|---|
| `ui-node`: da `variant` a `record { key, kind }` | la chiave (§2.8) |
| `ui-list-item.action`, `ui-button.action`: da `action-id` a `action-ref` | il payload (§2.7) |
| `view-placement` → `view-surface` | dieci superfici, e il nome giusto (§2.2) |
| `view-spec.placement` → `surface` | idem |
| `render-view`, `on-action`: primo parametro da `string` a `view-instance` | le istanze (§2.3) |

Tutto il resto è **additivo** e passa il presidio senza toccare niente: le
venticinque specie di nodo nuove, i cinque campi nuovi di `view-spec`, il
`fields` di `ui-action`, il `patch` di `view-update`, il `view-invalidated` di
`event`/`event-kind`, l'`open-view` di `command-effect`.

## Cosa NON è stato fatto, e perché

- **Quattro superfici su dieci non sono ospitate da questa shell**: area
  principale, menu, menu contestuale e scheda di impostazioni. Il contratto le
  **nomina** — che è la parte che scade col freeze — ma ospitarle vuol dire
  rispettivamente il modello di layout (§1.2, che è la feature 3.3 e va decisa
  con `PaneId` e le sessioni multiple del §9.6), un menu applicativo, un menu
  contestuale estendibile e il pannello di impostazioni del §11.1. Nessuna delle
  quattro cade in silenzio: una view che le chiede riceve un avviso che la
  nomina e dice cosa manca. La superficie vera dove dirlo è il §20.4.
- **`UiKind::Custom` disegna il fallback e basta.** Il ramo «la shell che
  conosce `ns` disegna il suo widget» non è una svista: non ha ancora un
  cliente, e un registro con zero clienti è un meccanismo senza mestiere — la
  stessa diagnosi con cui la [decisione 0013](0013-elenco-delle-capacita.md) ha
  tenuto fuori `notify`. Arriverà col primo, cioè il giorno che il grafo
  smetterà di essere un pannello nativo e diventerà un provider sull'area
  principale.
- **`Event::ViewInvalidated` non ha ancora un emettitore vero.** Il canale c'è
  ed è provato end-to-end (un provider lo emette, il bus lo consegna con la sua
  origine, la shell coalizza), ma il caso che lo motiva — un job che finisce — è
  il §9.1, e un job oggi non vede il vault. È P0 lo stesso perché a scadere col
  freeze è la **forma**, non il cliente.
- **Cestino e cronologia non sono ancora `ViewProvider`.** Era la metà aperta
  del §1.2, ed era bloccata da questa seduta: adesso non lo è più — i nodi di
  input e il «sto caricando» ci sono — ma migrarli è dogfooding di un'altra
  seduta, non parte di questa. Il blocco è **tolto**, e sta scritto lì.
- **Il riconciliatore non ha un test sul DOM.** La sua *decisione* — quale
  elemento vecchio serve a quale nodo nuovo — è una funzione pura e ha nove
  test, perché è lì che si sbaglia in un modo che non si vede (una riga che
  riceve il contenuto di un'altra). Ciò che tocca il DOM davvero vuole un
  ambiente DOM nei test, che questa shell non ha: è il §17.2, e aggiungere una
  dipendenza per farlo qui sarebbe stata una decisione di un'altra seduta presa
  di straforo.

## Verifica

`cargo test --workspace`: **456 verdi** (erano 446), fra cui la conformità
abi↔WIT, l'additività col ritaglio dichiarato, i mirror TS↔Rust rigenerati e i
due test nuovi dell'invito a ridisegnare. `npx tsc` pulito, **152 test vitest**
(erano 143: nove li porta l'accoppiamento dei figli), `vite build` ok.

Il round-trip albero↔arena ora ha una fixture che contiene **ogni** specie di
nodo: il `match` esaustivo garantisce che una specie nuova non si possa
dimenticare, non che i suoi campi siano mappati sul campo giusto — e con
trentatré specie, un `label` copiato al posto di un `title` è l'errore che si fa
davvero.

**Non verificato visivamente nell'app Tauri.** Vale più che per la
[decisione 0015](0015-la-forma-della-shell.md): lì era un riordino a
comportamento invariato, qui il percorso di disegno delle view dichiarate è
stato riscritto, e la classe di difetti che i test di questa shell non vedono è
esattamente quella che un riconciliatore introduce.
