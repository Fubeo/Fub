# 18. L'editor e la tastiera, e ciò che resta della shell

Una **seduta** della [roadmap infrastrutturale](../todo.md): ciò che resta della shell e non appartiene a nessuna delle sedute sopra.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Questa seduta è definita **per esclusione** — ciò che resta della shell e non
appartiene a nessuna delle sedute sopra — e con le sedute 1, 2, 3 e 4 chiuse
quella definizione si è messa a lavorare: le loro decisioni sono prese, ma
quattro code sono rimaste, **tutte di strato shell**, e sono finite qui invece di
restare a fare da appendice a un capitolo concluso (§1.2, §2.9, §3.3, §4.4, in
fondo). I numeri non cambiano — un `§X.Y` è citato nei commit e nei commenti, e
si ritira, non si rinomina — quindi una voce trasferita porta con sé il proprio,
e la [corrispondenza](numerazione.md) dice dove è andata a finire.

Ne esce l'ordine in cui quelle quattro si sbloccano a vicenda, che era la cosa
che nessuna delle quattro sedute poteva vedere da sola:

**il modello di layout (~~§1.2~~) → il grafo nell'area principale (§3.3)**, e di
lato la tastiera (~~§18.2~~) che deve arbitrare fra i comandi del kernel e quelli
della shell prima che §4.4 le chieda un secondo livello di decorazioni. La
~~§2.9~~ non era in coda a nessuno — si pagava quando le liste diventano lunghe —
ed è chiusa con la
[0114](../decisions/0114-una-finestra-non-si-omette.md): «non essere in coda a
nessuno» si è rivelata la sua proprietà migliore, perché è ciò che le ha
permesso di essere presa per ultima senza che nel frattempo qualcun altro
decidesse al posto suo.

Di quell'ordine, **l'anello della tastiera si è sciolto senza essere servito a
niente**. La §18.2 è chiusa
([0090](../decisions/0090-una-sequenza-e-una-modalita-che-scade.md)) e la §4.4 è
ancora aperta, ma non stava aspettando *lei*: l'arbitrato fra i due registri era
già arrivato con la [0077](../decisions/0077-una-scorciatoia-e-una-chiave.md), e
ciò che restava — l'accordo in sequenza — non tocca le decorazioni da nessun
lato. È il secondo dei tre anelli che si scioglie invece di sbloccarsi, dopo il
~~§1.2~~, e per la stessa ragione: un ordine fra voci di sedute diverse indovina
la **dipendenza** meglio di quanto indovini *quale pezzo* della voce la porta.

Di quell'ordine è caduto anche il pezzo che riguardava l'editor, e in un modo che
nessuna delle quattro sedute poteva vedere: il secondo livello di decorazioni non
aspettava la tastiera **né** un canale, perché il canale è stato deciso
inesistente ([0018](../decisions/0018-chi-vede-il-modello-parsato.md)). La
~~§18.1~~ è chiusa con la
[0089](../decisions/0089-da-cosa-e-partita-una-scrittura.md), che ne ha eseguita
una casella e riformulata l'altra.

Il primo anello è **caduto**: il ~~§1.2~~ è chiuso con la
[0078](../decisions/0078-i-riquadri-sono-un-fatto-della-shell.md), e l'ordine ha
fatto il suo lavoro — la §3.3 non aspetta più niente. La cosa che quell'ordine
non poteva prevedere è che il nodo costasse **zero firma**: i riquadri erano già
nel contratto dalla [0007](../decisions/0007-contesto-di-sessione.md), e ciò che
mancava era un corpo alla shell.

Le due voci native della seduta sono **chiuse tutte e due**, e ciò che resta in
questo file sono solo code di sedute concluse altrove — cioè la definizione per
esclusione con cui la seduta era nata, arrivata fino in fondo. La ~~18.2~~
dipendeva dal registro comandi
([decisione 0009](../decisions/0009-registro-dei-comandi.md)) e dai settings
(11.1), ed è stata chiusa in due tempi. Con la
[0077](../decisions/0077-una-scorciatoia-e-una-chiave.md): la tastiera è
configurabile perché una scorciatoia è una chiave di impostazione che il kernel
fabbrica per ogni comando, e i comandi **della shell** — toggle dei pannelli,
cambio modalità, grafo, palette — non sono più bottoni: sono comandi con la
stessa forma, che si eseguono di qua invece che attraverso l'IPC. E con la
[0090](../decisions/0090-una-sequenza-e-una-modalita-che-scade.md), che ha preso
l'accordo **in sequenza** — «un secondo problema», diceva la voce, e lo era — e
ha trovato che il blocco che lo teneva fermo non esisteva: la sintassi degli
accordi non è mai stata nel contratto, quindi `Mod-k d` costa **zero firma**. Il
resto della voce, invece, era vero fino in fondo: una sequenza ha uno stato, un
timeout, un annullamento e una regola sul prefisso, e valeva la pena eseguirle
tutte e quattro insieme.

Con loro il residuo dichiarato della
[decisione 0004](../decisions/0004-il-grafo-e-i-link-non-wiki.md): l'arco adesso è
vero, **il clic no** — la shell non naviga né i link markdown né i wikilink, e
in anteprima un `.internal-path` porta già il suo `data-path` che nessuno
raccoglie.

### ~~18.1 Editor~~

*ex §3.7 · shell · **P1** — **chiusa** con la [0089](../decisions/0089-da-cosa-e-partita-una-scrittura.md)*

- [x] **Ponte inverso code unit → byte** (`offsets.ts`): fatto con la [decisione 0007](../decisions/0007-contesto-di-sessione.md)
      (`charToByteIndex`, testato su accenti ed emoji in andata e ritorno), che
      ne aveva bisogno per far attraversare il confine alla selezione. Le due
      direzioni stanno in un punto solo.
- [x] ~~**Due livelli di decorazione dichiarati**: sintassi dal tree Lezer
      (già fatto), semantica dagli `Span` del modello (embed risolti, callout,
      math) — con la regola di chi vince dove.~~ **Riformulata e passata alla
      [§4.4](#44-due-parser-per-la-stessa-sintassi)** con la
      [0089](../decisions/0089-da-cosa-e-partita-una-scrittura.md). La casella
      nominava un canale — il modello parsato fino alla webview — che la
      [0018](../decisions/0018-chi-vede-il-modello-parsato.md) ha deciso che
      **non ci sarà**, e non per rimandarlo: la live preview decora un *buffer*,
      che può essere sporco, mentre il modello è quello del *file*. Ciò che
      resta di vero — il confine dichiarato, e la sintassi scritta una volta
      sola da cui il lato TS genera le proprie decorazioni — è già una casella
      della §4.4, scritta dal lato giusto. Eseguirla di qua avrebbe voluto dire
      anticipare quel canale con un cliente solo, che è ciò che la §4.4 chiama
      indovinare.
- [x] ~~**Invariante del buffer sporco** irrobustita (oggi custodita da un flag TS)
      e conflitto buffer↔disco esplicito: è lavoro M3 già dichiarato.~~
      **Fatto** con la
      [0089](../decisions/0089-da-cosa-e-partita-una-scrittura.md):
      `write_document` prende una `base: Option<Revision>` e rende la revisione
      **prodotta**, quindi il salvataggio dell'editor è una scrittura *guardata*
      e non più una sovrascrittura. Le due cose che questa riga non prevedeva e
      che sono costate di più. La prima: **il ritorno paga quanto la base**.
      Senza, la guardia varrebbe alla prima battuta e basta — il secondo
      salvataggio nominerebbe la base d'apertura e fallirebbe contro sé stesso —
      e per giunta è ciò che riempie il `DraftInfo::base` che la
      [0088](../decisions/0088-cio-che-non-e-ancora-successo.md) aveva dovuto
      lasciare `null` un verbale fa. La seconda: **non era additiva**, in
      nessuna delle due metà, e il ripiego di affiancare una firma nuova è stato
      scartato perché lascerebbe per sempre due modi di scrivere un documento,
      di cui uno cieco: si è ritagliata la linea di base, che prima del freeze è
      l'uscita onesta. Di là dal confine il conflitto **non ha un dialogo**: il
      buffer sporco resta e aspetta, come una bozza recuperata, e le due vie
      d'uscita sono comandi della shell senza scorciatoia.
      Ci è arrivato anche il **residuo del ~~§9.7~~**
      ([decisione 0030](../decisions/0030-il-rilevamento-si-puo-chiedere.md)):
      `write_document` non porta una `base`, quindi il salvataggio dell'editor
      **copre** una scrittura altrui che il watcher non ha visto, e nessuna delle
      due metà del sistema se ne accorge. La guardia giusta esiste da un pezzo —
      la revisione nella firma e `Conflict` invece della sovrascrittura silenziosa
      ([0008](../decisions/0008-modifica-chirurgica.md)) — ma vale per
      `apply_edit`, cioè per i *provider*. Quel che la 0030 ha aggiunto è che
      adesso il rischio è **misurabile** da qui: con `VaultStatus.watching` a
      `false` la copertura è nulla, e si sa.
- [x] ~~**La history di undo attraversa le note, e questo è un bug da chiudere
      subito.**~~ **Chiuso** con la
      [0045](../decisions/0045-l-undo-ha-due-pile.md), che è arrivata prima del
      previsto: la voce diceva «non aspetta la decisione sui due livelli di
      undo», e la decisione è venuta con la seduta 13 invece che dopo. Delle due
      riparazioni che la voce proponeva ne funziona **una sola** — marcare il
      `dispatch` come non annullabile lascia in pila le modifiche *dell'altra
      nota*, ancora applicabili a questa — e CodeMirror non ha uno «svuota la
      history»: `setDoc` ricostruisce lo stato. Il presidio è
      `frontend/src/editor/editor.test.ts`, verificato rosso sul codice di prima.

### ~~18.2 Comandi e tastiera~~

*ex §3.2 · shell · **P1** — **chiusa** con la [0077](../decisions/0077-una-scorciatoia-e-una-chiave.md) e la [0090](../decisions/0090-una-sequenza-e-una-modalita-che-scade.md), che ne ha eseguita una casella e trasferita l'altra*

- [x] ~~**Registro comandi nel frontend** alimentato da `list_commands` +
      command palette fuzzy + hotkey configurabili + conflitti segnalati.~~
      Fatto con la [0077](../decisions/0077-una-scorciatoia-e-una-chiave.md):
      una scorciatoia è una **chiave di impostazione** `keys.<id>` che il kernel
      fabbrica quando un `CommandProvider` si registra — col suggerimento
      dichiarato come default, così il valore efficace *è* la scorciatoia — e i
      comandi **della shell** sono comandi come gli altri, con la stessa forma e
      un `run()` locale al posto dell'IPC. Il filtro è a sottosequenza, col rango
      di prima come spareggio; i conflitti si **dicono** all'apertura, nominando
      i comandi, invece di essere rifiutati alla scrittura.
- [x] ~~**L'accordo in sequenza** (`g` poi `d`) — una sequenza ha uno stato («sto
      aspettando il secondo tasto»), un timeout, un modo di annullarla e la
      domanda di cosa fare se il primo tasto è già una scorciatoia da solo.
      Niente di tutto ciò si esprime nella sintassi che la `CommandSpec` dichiara
      oggi.~~ **Fatto** con la
      [0090](../decisions/0090-una-sequenza-e-una-modalita-che-scade.md), e le
      quattro cose che la riga elencava ci sono tutte e quattro — perché
      implementarne tre su quattro voleva dire una tastiera che ogni tanto non
      risponde. Ma l'ultima frase era **falsa**, e scoprirlo per primo ha
      cambiato la forma di tutto il resto: `CommandSpec.keybinding` è un
      `Option<String>` dalla [0009](../decisions/0009-registro-dei-comandi.md), e
      il contratto non dichiara una *sintassi* — dice per iscritto che «chi
      assegna davvero i tasti è la shell». `"Mod-k d"` ci sta dentro, quindi
      **zero firma e zero Rust**. La voce aveva confuso il *tipo* con la
      *sintassi*, che non è mai stata nel contratto ma in quaranta righe di
      TypeScript.

      L'esempio era ineseguibile, e non per un dettaglio: `g` poi `d` è un gesto
      vim, e vim ha una modalità normale. Sotto questa tastiera c'è un editor, e
      `g` è testo di qualcuno. Si è preso il modello **VS Code** — il primo tasto
      porta un modificatore — e la cosa che non era ovvia prima di scriverla è
      che la regola ha **due metà che si tengono**: il secondo tasto può essere
      nudo *proprio perché il primo non lo era*. `Mod-k` apre una modalità che
      dura due secondi, che si vede nella barra di stato e che ha una porta
      d'uscita, e dentro quella finestra la `d` non appartiene a nessuno.

      Il punto che questa riga non prevedeva e che è costato di più: il conflitto
      di **prefisso** non è un conflitto che `conflitti` sappia vedere. `Mod-k` e
      `Mod-k d` non sono lo stesso accordo, e però il secondo non si preme mai —
      cioè è il modo esatto in cui una sequenza resterebbe *accettata e non
      onorata*, che era il criterio con cui questa casella si giudicava. Vince il
      corto, e la cosa si **dice all'avvio** perché si decide guardando il
      registro fermo. Con lei è venuto fuori un difetto vecchio: un accordo
      scritto male era **escluso** dal conteggio dei conflitti invece che
      segnalato, e da quando una scorciatoia è una stringa che l'utente scrive a
      mano è un silenzio che non si può tenere.
- [x] ~~**La scorciatoia di un comando di shell non si riconfigura**: la chiave la
      fabbrica il kernel registrando un provider, e un comando che vive nella
      webview un provider non ce l'ha (il pannello le mostra di sola lettura). La
      via d'uscita non è un secondo registro di qua — è la shell che diventa un
      componente come gli altri, cioè la domanda della §16.3.~~
      **Trasferita alla
      [§16.3](16-crate-sdk-banchi-di-prova.md#163-un-crate-per-bundle-di-feature)**
      con la [0090](../decisions/0090-una-sequenza-e-una-modalita-che-scade.md),
      e non per abitudine: prima si è misurata una terza strada che la casella
      non aveva guardato — un `CommandProvider` **di prossimità**, registrato
      dall'host per conto della shell al solo scopo di far nascere le chiavi
      `keys.shell.*`. Gli id passerebbero davvero, e si rompe in cinque punti,
      quattro dei quali sono lavoro e il quinto una **contraddizione**: i
      provider si registrano per vault e le chiavi `keys.*` sono di scope
      `Vault`, ma `shell.vault.open` è il comando che esiste *prima* di ogni
      vault. La sua chiave nascerebbe solo dopo che un vault è aperto — quando
      serve meno — e vivrebbe dentro il vault che serve ad aprire. I cinque punti
      stanno nel verbale, così che chi eseguirà la §16.3 non debba rimisurarli.

---

## Le code delle sedute chiuse

Quattro voci arrivate da sedute la cui **decisione** è presa e il cui verbale è
in [decisions/](../decisions/README.md). Stanno qui perché è qui che verranno
eseguite: sono tutte shell, e la seduta che le ospitava non ha più niente da
decidere per loro.

### ~~1.2 Smontare il monolite~~

*ex §3.1 · shell · **P1** — dalla [seduta 1](01-forma-della-shell.md) ([decisione 0015](../decisions/0015-la-forma-della-shell.md)); **chiusa** con la [0078](../decisions/0078-i-riquadri-sono-un-fatto-della-shell.md), che era l'ultima casella*

- [x] **Un modulo per dominio** (`explorer`, `search`, `trash`, `history`,
      `graph`) con un piccolo store condiviso e un router di eventi kernel:
      `handleKernelEvent` conosceva privatamente ogni pannello, e ora chi ha
      interesse dichiara l'evento che lo riguarda. `main.ts` è passato da 1622 a
      137 righe (decisione 0015).
- [x] **Un solo modo di montare un pannello**: l'**interfaccia** in
      `ui/panel-host.ts` — un pannello dichiara chi è, dove sta, cosa lo fa
      invecchiare (`refresh`, `followsDoc`) e quando è visibile; l'host decide
      quando chiamarlo. Explorer, ricerca, cestino, cronologia e grafo passano da
      lì insieme alle view dichiarate, di cui `ui/views.ts` è ora solo
      l'adattatore `ViewSpec`→`Panel`. La mappa è la regola 5 di
      [architecture/shell.md](../architecture/shell.md).
- [x] **Il protocollo di disegno** che la seduta 2 le bloccava, chiuso con la
      [decisione 0016](../decisions/0016-cosa-e-una-view.md).
- [x] ~~**Migrare cestino e cronologia a `ViewProvider`**~~ — **fatto** con la
      [0075](../decisions/0075-una-view-non-chiede-con-una-finestra.md), e ha
      trovato due cose che questa riga non prevedeva. La prima: le due domande
      del cestino non volevano un `ViewUpdate::Confirm` nel contratto, si
      **disegnano** — la domanda in corso sta nello stato di vista dell'esemplare
      e l'albero la mostra al posto dell'elenco. La seconda: alla cronologia non
      mancava un canale. È una view della feature *versioning*, cioè dello stesso
      plugin che le versioni le scrive, quindi le rilegge dal proprio spazio dati
      — e le due letture che il §16.6 voleva migrare a `IndexQuery` non sono
      migrate, sono **sparite** insieme al loro unico chiamante. Con loro se ne
      sono andate cinque porte IPC in tutto, e il debito dichiarato del §16.6 è
      sceso da cinque a due.
- [x] ~~**Modello di layout**: tab, split, pane, workspace salvabili (3.3, 4.1).~~
      **Fatto** con la
      [0078](../decisions/0078-i-riquadri-sono-un-fatto-della-shell.md), e la
      riga che diceva «la sua metà kernel va decisa insieme a `PaneId`» si è
      rivelata falsa nel modo migliore: **non c'era niente da decidere**.
      `ViewContext` porta un `pane` dalla
      [0007](../decisions/0007-contesto-di-sessione.md) e lo stato di vista è già
      per esemplare ([0037](../decisions/0037-lo-stato-di-vista.md)), quindi N
      riquadri ci stavano già — la pluralità è un fatto della **shell**, e il
      kernel una mappa di riquadri non la vuole, perché la domanda a cui risponde
      («cosa sta guardando l'utente adesso») è una sola per definizione. Costo a
      ridosso del freeze di M4: zero firma.

      Le altre due cose che la voce teneva insieme si sono separate. «Il layout»
      erano **due** oggetti — com'era aperta la finestra (nessun nome: stato di
      vista, file della macchina) e un workspace **salvato con un nome** (creato
      apposta: nel vault) — e distinguerli chiude anche la metà rimasta del
      [§11.2](11-impostazioni-e-i-tre-stati.md#112-tre-stati-diversi-zero-contenitori).
      E tab e split si sono disegnati **insieme**: un riquadro tiene N documenti
      con uno attivo, e fare prima il solo split — che è ciò che sblocca la §3.3 —
      avrebbe voluto dire buttare quel modello il giorno delle tab.

      Il punto che la voce non nominava e che è costato di più: **una nota aperta
      due volte è un buffer**. Due riquadri con due testi propri sarebbero due
      note, e il salvataggio più recente coprirebbe l'altro senza dirlo.

### ~~2.9 Prestazioni della UI~~

*ex §3.6 · shell · **P2** — dalla [seduta 2](02-cosa-e-una-view.md) ([decisione 0016](../decisions/0016-cosa-e-una-view.md)); **chiusa** con la [0114](../decisions/0114-una-finestra-non-si-omette.md), che lascia due caselle*

- [x] **Virtualizzazione** di file tree, risultati di ricerca, liste lunghe e
      tabelle — con la precisazione che la misura ha imposto: quel che si è
      fatto **non è virtualizzazione**, ed è la metà che sta *prima* del layout.
      Virtualizzare vuol dire disegnare ciò che si vede, e *cosa si vede* è una
      domanda di layout, che in `happy-dom` non esiste (**buco dichiarato n. 5**
      della [0112](../decisions/0112-un-e2e-contro-un-host-finto-prova-il-cablaggio.md)):
      qui si decide **quanto attraversa il ponte e quanti elementi nascono**,
      cioè esattamente ciò che la voce nominava — «le manda tutte attraverso
      l'IPC prima ancora che qualcuno provi a disegnarle». La finestra che
      `Page` già esprimeva adesso qualcuno la chiede, e non per gentilezza: è il
      **primo argomento e non ha default**, quindi chiedere tutto è un caso da
      nominare (`SENZA_FINESTRA`) e non un'omissione.
      **Casella residua**: la finestra scorrevole vera, e con lei il gesto
      «mostra le altre» — oggi la riga che dice quante ne sono rimaste fuori non
      è attivabile, perché dirlo senza saperlo fare è più onesto che non dirlo.
- [x] **Lazy loading di immagini/embed**, che la voce teneva insieme al
      rendering incrementale e che la misura ha separato. Le immagini si sono
      potute fare senza layout, perché la shell non calcola cosa si vede ma può
      **dichiarare che non vuole deciderlo lei** (`loading="lazy"`), e la regola
      sta nel punto unico in cui dell'HTML entra nella webview (§3.6) invece che
      nell'anteprima. Gli embed no — caricarli quando si vedono è ancora
      layout — ma misurando è saltato fuori di peggio: la profondità
      dell'idratazione era limitata, la **larghezza** no, e la stessa pagina si
      chiedeva al kernel una volta per segnaposto.
      **Casella residua**: il **rendering incrementale**, e con due ragioni
      misurate invece di una. La precondizione della
      [decisione 0018](../decisions/0018-chi-vede-il-modello-parsato.md) — una
      chiave di `RenderOptions` che faccia scrivere nell'HTML da quale byte
      viene un elemento — è lavoro di `fub-abi` e del provider markdown, non di
      strato shell; e soprattutto **il suo primo cliente non esiste**:
      `updatePreview` gira quando cambia il documento del riquadro e quando si
      entra in Lettura, mai a ogni battuta, perché `PaneMode` è un enum di
      modalità esclusive e ciò che si rende è il sorgente **salvato**. Rendere
      incrementalmente vuol dire non rifare la parte che non è cambiata; se si
      rifà quando è cambiato il *documento*, sono cambiate tutte.
- [x] **Il numero che dice se è ora**, e il rimando al §17.1 è **scaduto**: la
      [0113](../decisions/0113-il-banco-conta-le-operazioni.md) ha chiuso quella
      voce decidendo l'opposto di ciò che questa si aspettava — un banco conta
      **operazioni**, non millisecondi, perché su una macchina condivisa il
      tempo non è un segnale, e qui il tempo di un fotogramma in `happy-dom` non
      esiste proprio. `ridisegno.test.ts` conta elementi nel DOM e domande al
      ponte, e la forma che dice di più non è una soglia ma un'**uguaglianza**:
      due vault che differiscono per quattromila note disegnano lo stesso
      albero.

### ~~3.3 La UI di un plugin non ha modo di entrare nella shell~~

*ex §3.12 · shell · **P1** — dalla [seduta 3](03-chi-disegna-cio-che-il-core-non-conosce.md) ([decisione 0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md)); **chiusa** con la [0079](../decisions/0079-il-grafo-esce-dall-overlay.md), che lascia una casella*

- [x] **La decisione fra le tre opzioni**: la terza — *solo prima parte, e tutto
      il resto dichiarativo* — con la precisazione che questa voce chiedeva: il
      protocollo dichiarativo **arriva ai blocchi custom** e non solo alle view,
      quindi il blocco di un plugin arriva a schermo senza una riga nel bundle
      della shell. Il registro di web component è scartato, l'iframe sandboxato
      va a M5.
- [x] **`UiKind::Custom` ha il suo primo cliente** — il diagramma — e ha portato
      con sé la scoperta che il ramo «la shell che conosce `ns` disegna il suo
      widget» **ancora non serve**.
- [x] ~~**Il grafo è ancora un pannello nativo**~~ — **fatto** con la
      [0079](../decisions/0079-il-grafo-esce-dall-overlay.md), e quel ramo che
      «ancora non serviva» è il posto in cui è passato. Il grafo è un
      `ViewProvider` (`fub-features/src/graph.rs`) che dichiara
      `ViewSurface::Main` — la **prima** view di questo repo a dichiararla, dopo
      che per tre sedute quella variante è stata nominata dal contratto e mai
      ospitata da nessuno — e manda nodi e archi dentro un
      `UiKind::Custom { ns: "fub:graph" }`; la shell ha imparato il ramo che
      `ui/node.ts` aspettava per nome, e i `ns` che sa disegnare stanno in un
      registro suo (`ui/custom.ts`) invece che in un `if`.

      Le due cose che questa riga non prevedeva e che sono costate di più. La
      prima: **una tab è diventata una cosa discriminata**. `PaneState.docs:
      string[]` era un elenco di path, e un path è l'identità di un documento
      ([0043](../decisions/0043-il-path-e-la-chiave.md)) — infilarci dentro
      `"view:graph"` sarebbe costato una riga e l'avremmo pagata in ogni lettore.
      La seconda: **il contratto non si è toccato**, per la terza voce di fila.
      «Cosa pubblica un riquadro che mostra il grafo» sembrava chiedere un campo
      nuovo, e la risposta era `doc: null` — uno stato che `ViewContext`
      esprimeva già, e che significa esattamente ciò che serviva.
- [x] ~~**Il conto del 21.1 resta da saldare**~~ — **ridotto al suo limite
      dichiarato**, che è la cosa più onesta che questa casella potesse
      diventare. La promessa era che ogni modulo Suite (FubCanvas, FubDB,
      FubCharts, FubMaps, FubForms, 21.2) possa avere un renderer proprio, e ora
      la strada è **percorsa** e non solo aperta: un modulo dichiara la sua view
      su `main`, manda il suo dato in un `Custom` con `ns` suo, e chi disegna
      registra una riga in `ui/custom.ts`. L'[asterisco di
      onestà](../architecture/ui-protocol.md) resta e ha cambiato misura: prima
      la graph view era privilegiata nei **dati** *e* nei **pixel**, adesso solo
      nei pixel — cioè in quel `ns` che sta nel bundle della shell, e che un
      plugin di terzi potrà spedire da sé solo quando la `WebView` avrà asset
      story e CSP (M5). Non è questa voce a poterlo togliere, ed è giusto che
      resti scritto dov'era.
- [ ] **La casella che resta: aprire in un riquadro una view che non sia il
      grafo.** Ci si arriva con `shell.graph`, che è il comando di *quel*
      componente e apre *quella* view. Va bene per il primo cliente e non per il
      secondo: quando una view principale sarà due, servirà un gesto generico —
      «apri una view nel riquadro col fuoco», con l'elenco che
      `viewPrincipali()` già restituisce. Non lo si è fatto adesso perché un
      gesto disegnato su zero clienti è un gesto indovinato, e i comandi si
      registrano al montaggio mentre le view si scoprono per vault: le due cose
      vanno decise insieme, e la seconda oggi non ha nessuno che la chieda.

### 4.4 Due parser per la stessa sintassi

*ex §3.8 · shell · **P1** — dalla [seduta 4](04-chi-vede-il-modello-parsato.md) ([decisione 0018](../decisions/0018-chi-vede-il-modello-parsato.md)); il blocco è tolto, resta il moltiplicatore*

- [x] **Il blocco è tolto, e non nel modo che questa voce si aspettava.** Il
      secondo livello della §18.1 (semantica dagli `Span` del modello) chiedeva un
      canale; la 0018 ha risposto che il canale c'è per chi sta di qua dal confine
      (`HostApi::read_model`) e che verso il webview **non ci sarà**: il modello è
      quello del **file**, la live preview decora un **buffer** che può essere
      sporco, e un modello spedito di là sarebbe vero solo quando serve meno.
- [ ] **Il confine, dichiarato**: il **buffer** è di Lezer, il **file** è del
      modello. Le due grammatiche restano — il tree Lezer è già in code unit e non
      costa IPC — ma restano perché sono su **due oggetti diversi**, non perché
      nessuno abbia deciso. Le voci di lista, oggi, sono parsate una seconda volta
      anche in `editor-commands.ts`, ed è lo stesso confine visto da un gesto
      invece che da una decorazione.
- [ ] **Togliere il moltiplicatore, non il canale.** Le estensioni del capitolo
      5.2 sono ~50 (callout, footnote, definition list, embed, apici/pedici, tabs,
      timeline, stepper, math…) e ognuna andrebbe scritta due volte, in due
      linguaggi, con due nozioni di offset. La strada decisa: la sintassi si
      dichiara **una volta sola** — `SyntaxRuleSpec` porta già il trigger come dato
      (`Inline { open, close }`, `Fence { info }`) e `HostApi::format_of` dice
      quali sintassi sono accese per quel documento — e il lato TS *genera* le sue
      decorazioni da quella dichiarazione invece di riscriverne la grammatica a
      mano. Serve un canale che porti alla shell le spec registrate, e la parte di
      `livepreview.ts` che oggi è un elenco di regex diventa un interprete di
      trigger.
- [ ] **Finché le due grammatiche restano due, la loro divergenza non è rossa da
      nessuna parte.** È la parte di questa voce che si paga **adesso** e non
      quando la si chiude, ed è la ragione per cui la
      [seduta 23](23-cosa-costano-le-decisioni-chiuse.md) l'ha incontrata
      guardando i prezzi: il difetto che ne esce non è un crash — è che *ciò che
      si vede mentre si scrive* e *ciò che viene reso e indicizzato* dicono due
      cose diverse sullo stesso testo, sul caso che nessuno prova, e in un
      editor quel caso lo trova l'utente tutti i giorni. Il presidio non aspetta
      la dichiarazione condivisa e non costa quanto lei: un **corpus** di
      frammenti su cui le due passate devono concordare — stessi confini, stessa
      specie — e che diventa rosso quando una delle due cambia idea da sola. È
      la mossa della [0060](../decisions/0060-il-modello-dice-il-vero-sui-byte.md)
      applicata all'altro asse: là il corpus teneva onesto il round-trip fra il
      modello e i byte, qui tiene onesti due parser sullo stesso testo. E ha la
      proprietà che rende un presidio utile prima della cura: quando la
      dichiarazione condivisa arriverà, il corpus è già lo strumento con cui si
      prova che il generato fa ciò che le regex facevano.
- [ ] **Il secondo livello della ~~§18.1~~ è arrivato qui**, ed è la stessa cosa
      vista dall'editor: «le decorazioni semantiche vengono dal modello» diventa
      scrivibile solo quando la dichiarazione è condivisa, e a buffer pulito. Con
      la [0089](../decisions/0089-da-cosa-e-partita-una-scrittura.md) non è più
      una nota di coordinamento fra due voci: la §18.1 è chiusa, e la sua casella
      è **questa**. Chi la esegue non deve andare a cercare cosa chiedeva di là —
      chiedeva un canale che le tre righe qui sopra dichiarano già inesistente.
