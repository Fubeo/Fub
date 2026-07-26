# 2. Cosa è una view

Una **seduta** della [roadmap infrastrutturale](../todo.md): le firme dicono insieme che una view è una funzione pura, sincrona, senza stato.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

La seduta più grande del piano, e la più urgente: sette voci su nove sono
**firme del contratto**. Cosa scade davvero col freeze di M4 va detto con la
tabella della [decisione 0002](../decisions/0002-additivita-del-contratto.md) in mano, o si prende la scadenza sbagliata: un caso in
coda a un `variant` e un campo in fondo a un `record` restano **additivi** anche
dopo, e §2.1, §2.2, §2.6 e §2.7 sono di quella specie — la 0002 cita
letteralmente «una superficie in più in `view-placement` (§2.2)» fra le aggiunte
che il presidio deve far passare. A scadere sono le due che toccano una funzione
che c'è già: la **§2.3** (`render_view` con un parametro in più) e la **§2.5**
(`render_view` che può rispondere «non ancora»); accanto, la **§2.4**, invisibile
al WIT — dove `self` non compare — e rottura di ogni implementatore Rust.
Le altre stanno qui per la seconda ragione, che non è più debole: sono **lo
stesso record**, e ciò che il freeze pubblica resta pubblicato per sempre in
`wit/frozen/` — un campo aggiunto dopo è una forma in più da servire in eterno,
non un campo che sostituisce quello di prima. Il quinto
giro le aveva già raggruppate così («§2.4, §2.5, §2.6 e §2.7 con §2.1, §2.2
e §2.3»), e la ragione è che oggi le firme dicono insieme una cosa che nessuno
ha mai deciso: *una view è una funzione pura, sincrona, senza stato, che disegna
in sola lettura su una delle tre superfici che esistono.* Su quella forma non
regge niente di interattivo né di asincrono — cioè i capitoli 11, 12, 11.5 e 22.

Deciderle separate non funziona: `ViewSpec` è **lo stesso record** che le
superfici (2.2), le istanze (2.3) e i metadati (2.6) devono toccare, e i nodi di
input (2.1) sono inutilizzabili senza la chiave (2.8), senza il payload (2.7) e
senza uno stato dove metterli (2.4).

### 2.1 `UiNode` — senza input, metà di FEATURES non è dichiarativa

*ex §1.2 · contratto · **P0** — leva alta: sposta dal «cablato» al «registrato» i capitoli 4-22*

- [ ] **Nodi di input**: `TextInput`, `TextArea`, `Number`, `Checkbox`,
      `Select`, `Radio`, `Slider`, `DatePicker`, `Form { fields, submit }`. Con
      essi `UiAction` deve portare **valori** (oggi `payload` è JSON libero: va
      formalizzato lo stato del form).
- [ ] **Nodi strutturali**: `Table { columns, rows }`, `Tree`, `Tabs`,
      `Section/Collapsible`, `Badge`, `Icon`, `Progress`, `Separator`,
      `EmptyState`, `KeyValue`. Sono ciò che serve a database, task, dashboard,
      health check, diagnostica.
- [ ] **`UiNode::Custom { ns, payload, fallback }`**: la shell che conosce `ns`
      disegna il widget suo (grafo, canvas, chart), chi non lo conosce disegna
      il `fallback` dichiarativo. È il modo di far entrare le superfici
      privilegiate nel protocollo invece di tenerle fuori come oggi.
- [ ] **Feedback dell'host**: `ViewUpdate::Patch { path, node }` per non
      ridisegnare tutto — un pannello task con 500 righe non può fare `Replace`
      a ogni spunta. Un `ViewUpdate::Notify` e un `ViewUpdate::Confirm` **non**
      vanno più cercati qui: la conferma è esclusa dalla [decisione 0010](../decisions/0010-comando-descritto-a-una-macchina.md) (questo host non
      può fermarsi a chiedere), e la [decisione 0013](../decisions/0013-elenco-delle-capacita.md) ha chiuso la questione con una
      regola generale — *una capacità è ciò di cui il chiamante ha bisogno della
      risposta per proseguire; ciò che si limita a informare è un evento* —
      mandando `notify` e `progress` fra le varianti di `Event`, dove sono
      additive e dove l'origine ce l'hanno già. Il che lascia aperto **dove
      atterrano**, non se esistono: è il centro notifiche del §10.3.
- [ ] **Regola di fiducia invariata**: `Html`/`WebView` restano riservati; i
      nodi nuovi devono essere tutti sicuri per costruzione (nessuna stringa
      interpretata come markup) e `validate_untrusted` va esteso ai figli nuovi
      con il suo test.

*Sblocca:* 28 (impostazioni), 8.2 (editor proprietà), 11.2-11.3 (viste e
editing database), 10.3 (viste task), 11.5 (dashboard/widget), 19.3 (form),
16.1 (prompt dei template), 24.2 (health/repair wizard).

### 2.2 Le superfici della UI sono tre, e chiuse

*ex §1.14 · contratto · **P0** — leva alta: senza, metà di FEATURES per volume non ha dove atterrare*

- [ ] **`ViewPlacement` deve smettere di essere un enum a tre casi**:
      `LeftSidebar`, `RightSidebar`, `Bottom` (`abi/traits.rs:416-420`) sono tutto
      ciò che un provider può occupare. Il capitolo 20.1 chiede alla lettera
      *ribbon*, *status bar*, *settings tab*, *menu* e *context menu* di
      plugin: cinque superfici che oggi non hanno nome nel contratto, quindi
      cinque cose che una feature ufficiale può cablare nella shell e un plugin
      no.
- [ ] **L'area principale non esiste nel contratto**: l'editor è cablato in
      `main.ts` e nessun provider può prendersi quello spazio. È lì che vivono
      database (11), canvas e slide (12), grafo (7.3), viste task (10.3),
      dashboard (11.5), calendario (10.4) — cioè i capitoli più grossi di
      FEATURES. La prova che il buco è reale è già in repo: il grafo è uscito
      con un comando bespoke (`graph_data`, `app/lib.rs:698`) e un renderer
      privato (`graph.ts`). Non perché il grafo sia speciale — perché **non
      c'era un posto dove metterlo**. Con tre placement, ogni capitolo grande
      ripete quella scappatoia.
- [ ] **Superficie ≠ disegno**: allargare `ViewPlacement` (o sostituirlo con un
      `ViewSurface` che nomini area principale, modale, status bar, ribbon,
      menu contestuale, scheda di impostazioni) è ciò che dà l'**ancoraggio**;
      cosa ci si disegni dentro è il `UiNode::Custom` del §2.1. Le due voci
      vanno decise insieme, o si ottiene metà del varco.
- [ ] **Perché è P0, dato che allargare è additivo.** Un caso in coda a
      `view-placement` è fra le aggiunte che la [decisione 0002](../decisions/0002-additivita-del-contratto.md) certifica come lecite
      anche dopo il freeze: la scadenza dura non è questa voce. È P0 perché
      **sostituire** `ViewPlacement` con un `ViewSurface` non è un caso in coda,
      e perché è lo stesso record della §2.3 e della §2.6 — deciderla dopo di
      loro significa riscriverlo due volte, e deciderla dopo il primo provider
      di terzi significa portarsi dietro tre placement per sempre.

*Sblocca:* 20.1 per intero, 11 (database), 12 (canvas, diagrammi,
presentazioni), 7.3 (il grafo smette di essere privilegiato), 10.3-10.4, 11.5,
28 (le impostazioni come scheda, non come finestra dell'app).

### 2.3 Le view non si istanziano

*ex §1.15 · contratto · **P0** — l'altra metà del contesto di sessione (decisione 0007)*

- [ ] **`ViewSpec` con parametri e identità d'istanza**: `views()` restituisce
      un elenco **statico** e `view_owner` risolve per id esatto
      (`workspace.rs:1566`). Non c'è modo di dire "questa view, con questo
      parametro". Servono a 11.2 (viste multiple per database), 8.3 (viste
      salvate, smart folder), 9.2 (query embed, query salvate, parametriche),
      11.5 (una dashboard per progetto), 12 (un canvas per file), 10.3 (task
      per tag / per cartella / per data: la stessa view, filtri diversi).
- [ ] **È l'altra metà della [decisione 0007](../decisions/0007-contesto-di-sessione.md)**: quello risolve *quale documento* guarda una
      view, questo *quale istanza* è. Due split con due pannelli backlink hanno
      bisogno di entrambe le risposte, e oggi non ne hanno nessuna.
- [ ] Firma da decidere ora: `render_view(view, instance, host)` +
      `open_view(spec, params)` come esito di comando ([decisione 0009](../decisions/0009-registro-dei-comandi.md)). Dopo il freeze è
      una migrazione di **ogni** `ViewProvider` scritto nel frattempo — ed è
      questa, con la §2.5, la voce della seduta che scade davvero: un parametro
      in più su `render-view` cambia una funzione che esiste
      (`wit/fubmd/abi.wit:1061`), cioè l'unica riga della tabella della
      [decisione 0002](../decisions/0002-additivita-del-contratto.md) che non ha una colonna «additivo».

### 2.4 Un `ViewProvider` non può avere stato: la firma glielo vieta

*ex §1.30 · contratto · **P0** — leva alta, con la 2.5: insieme dicono che una view è una funzione pura*

- [ ] **`render_view` *e* `on_action` prendono `&self`**
      (`abi/traits.rs:457-467`). Non è una svista del percorso di lettura: **un
      provider di view non può mutare sé stesso nemmeno in risposta a un
      click**. Filtro corrente, tab attiva, pagina, ordinamento, selezione,
      sezioni aperte, esito di un calcolo: niente ha dove stare, se non dietro
      interior mutability — cioè un `Mutex` che ogni autore di provider si
      inventa per conto suo, con la sua idea di cosa succede se il lock è preso
      durante un render.
- [ ] **È distinto dal §11.2**, che chiede *dove* vive lo stato di vista
      (settings, sessione, layout): questo dice che la **firma** lo esclude a
      monte. Il contenitore che il contratto offre non è più lo `storage_*`
      volatile e a chiave→valore — la [decisione 0013](../decisions/0013-elenco-delle-capacita.md) l'ha **tolto** — ma i `data_*`
      (`abi/traits.rs:281-288`), che sono persistenti e su path, quindi un
      namespace per-view lo sanno esprimere. Resta intatta l'obiezione che conta,
      e non è una proprietà del contenitore: `data_write` prende `&mut self` e
      **`render_view` riceve un `&dyn HostApi`**, non `&mut` — dal percorso di
      lettura non si scrive, qualunque sia il contenitore.
- [ ] Con tre pannelli in sola lettura non si nota; con i nodi di input del
      §2.1 è il caso normale. Le tre strade, da scegliere ora perché `&self` è
      la firma che il freeze congela: **`&mut self` su `on_action`** — che non
      costa il prestito condiviso del render, perché `render_view` può restare
      `&self` (il percorso di lettura del §8.3 resta parallelizzabile) ma
      richiede al kernel di estrarre il provider come già fa in `view_action`
      (`workspace.rs:1538-1554`); **uno stato di vista esplicito** passato dall'host
      a ogni chiamata e restituito modificato, che è la forma più amica del
      component model di M5; oppure **interior mutability dichiarata come
      contratto**, con la sua regola di rientranza scritta accanto a quella
      degli eventi. La terza è ciò che succede da sé se non si sceglie.

### 2.5 Una view non può chiedere di essere ridisegnata, né dire "sto caricando"

*ex §1.31 · contratto · **P0** — leva alta, con la 2.4*

- [ ] **Il protocollo di view è pull-only e sincrono.** `ViewSpec.refresh` è una
      maschera sugli eventi *del kernel* e `ViewUpdate` esiste solo come
      risposta a `on_action`: un provider che finisce un job (§9.1), riceve
      dati dalla rete o completa un calcolo **non ha modo di dire
      «ridisegnami»**. L'unica strada è emettere un `Event::Custom` e
      dichiararsi interessato a `EventKind::Custom` — cioè svegliare ogni
      handler e ogni view del sistema (§10.1).
- [ ] **E non esiste uno stato intermedio**: `render_view` deve rispondere
      subito con un albero, quindi una view che dipende da lavoro lungo non è
      esprimibile — né "in caricamento", né "fallito, riprova", né parziale.
      Con il §9.1 che manda il lavoro lungo nei job, la coppia
      job→view è **il** percorso normale di 11 (database), 12 (canvas), 22
      (AI), 18 (stato del sync), 11.5 (dashboard), 24.1 (progresso), e oggi non
      esiste.
- [ ] Serve la terna, decisa insieme: un `HostApi::invalidate_view(view)` (o un
      `ViewUpdate` emesso fuori da `on_action`), una variante di stato nel
      protocollo (`UiNode::Pending`/`Error`, o `render_view` che può
      rispondere "non ancora"), e la regola di coalescing — venti inviti a
      ridisegnare in un giro sono un ridisegno.

*Sblocca:* 22 per intero, 11, 12, 11.5, 18.1 (stato sync visibile), 24.1
(indexing progress, task manager), 14.2 (il clipper che mostra cosa sta
scaricando).

### 2.6 `ViewSpec` non dice come si presenta

*ex §1.32 · contratto · **P0** — additiva, ma sullo stesso record di 2.2 e 2.3*

- [ ] **Id, titolo, placement, `refresh`, `follows`** (`abi/traits.rs:423-455`) e nient'altro:
      niente icona, ordine o priorità, stato di default (aperta/chiusa),
      dimensione preferita, possibilità di essere nascosta e richiamata a
      comando. Con tre pannelli decide la shell per conoscenza privata; con i
      venti di 20.1 e le sidebar personalizzabili, collassabili e a gruppi di
      3.3, la shell non ha su cosa decidere.
- [ ] È additivo — un campo oggi, una minor domani — ma è **lo stesso record**
      che §2.2 (superfici) e §2.3 (istanze) devono toccare, e quei due lo
      riscrivono: va deciso nella stessa seduta o si aggiunge due volte.

### 2.7 `UiAction.payload` esiste e non lo usa nessuno

*ex §1.33 · contratto · **P0** — il canale c'è già ed è inerte*

- [ ] **La shell non popola mai il payload**: il parametro sulla cucitura c'è
      già (`api.ts:369`, `payload?: unknown`), ma l'unico chiamante — `mountView`
      — invoca `api.viewAction(view, action)` senza (`main.ts:1380-1386`), e le
      tre feature ufficiali codificano i dati **dentro l'id dell'azione** —
      `open:a/Uno.md` (`features/src/backlinks.rs:116`), `tag:rust`
      (`features/src/tags.rs:101`), `reveal:10:15`
      (`features/src/outline.rs:172`). Funziona, ed è una convenzione privata che
      sta diventando contratto de facto: il prossimo provider farà string-concat
      anche lui, perché è ciò che vede fare.
- [ ] **Il §2.1 dà per scontato che le azioni portino valori** (lo stato di un
      form). Il canale c'è già ed è inerte: o si formalizza adesso — chi mette
      cosa nel payload, come si serializza lo stato di un form, chi lo valida —
      o i nodi di input nasceranno sopra una convenzione che nessuno ha scritto.
- [ ] Va con il §16.1: il parsing degli `ActionId` è già nell'elenco di ciò che
      «ogni provider riscriverebbe», e la ragione per cui lo riscrive è questa.

### 2.8 Il view host ridisegna tutto, e i nodi non hanno una chiave

*ex §3.9 · shell · **P0** — la **chiave** è contratto (P0); il riconciliatore è shell (P1)*

- [ ] **`mountView` fa `target.innerHTML = ""` e ricostruisce**
      (`main.ts:1381`), e `renderUiNode` crea elementi nuovi a ogni giro
      (`ui.ts`). Oggi si nota poco: le view sono liste in sola lettura. Con gli
      input del §2.1 è fatale — un campo di testo perde focus e contenuto a
      **ogni** `IndexUpdated`, cioè a ogni salvataggio.
- [ ] **La chiave è contratto, quindi è P0**: il §2.1 nomina
      `ViewUpdate::Patch { path, node }`, ma un patch indirizzato per *path* si
      rompe al primo riordino di lista — ed è esattamente il caso che il §2.1
      cita, il pannello task con 500 righe. Serve una chiave stabile sui nodi
      (`UiNode.key`), che è ciò su cui un riconciliatore può lavorare.
- [ ] **Lato shell**: un riconciliatore che aggiorna invece di ricostruire, e
      la conservazione dello stato di vista (focus, scroll, selezione, sezioni
      aperte) attraverso il ridisegno. Senza, il §2.1 consegna nodi di input
      che nella pratica non si possono usare.

### 2.9 Prestazioni della UI

*ex §3.6 · shell · **P2** — la stessa superficie, quando le liste diventano lunghe*

- [ ] **Virtualizzazione** di file tree, risultati di ricerca, liste lunghe e
      tabelle: senza, "vault enormi" (24.1) è una promessa che la UI rompe prima
      del kernel.
- [ ] **Rendering incrementale dell'anteprima** e lazy loading di immagini/embed.
