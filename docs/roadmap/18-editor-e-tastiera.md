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

**il modello di layout (§1.2) → il grafo nell'area principale (§3.3)**, e di
lato la tastiera (§18.2) che deve arbitrare fra i comandi del kernel e quelli
della shell prima che §4.4 le chieda un secondo livello di decorazioni. La
§2.9 non è in coda a nessuno: si paga quando le liste diventano lunghe.

Le due voci native della seduta. La 18.2 dipende dal registro comandi
([decisione 0009](../decisions/0009-registro-dei-comandi.md)), che è fatto: oggi la
shell **onora** i `keybinding` dichiarati dai comandi e ignora quelli senza
modificatori; ciò che manca è la tastiera **configurabile dall'utente**, che vive
nei settings (11.1), e i comandi **della shell** (toggle dei pannelli, cambio
modalità), che non possono registrarsi nel kernel e finché non c'è un registro di
qua restano bottoni.

Con loro il residuo dichiarato della
[decisione 0004](../decisions/0004-il-grafo-e-i-link-non-wiki.md): l'arco adesso è
vero, **il clic no** — la shell non naviga né i link markdown né i wikilink, e
in anteprima un `.internal-path` porta già il suo `data-path` che nessuno
raccoglie.

### 18.1 Editor

*ex §3.7 · shell · **P1** — il ponte inverso è fatto (decisione 0007); il secondo livello aspetta il capitolo 4*

- [x] **Ponte inverso code unit → byte** (`offsets.ts`): fatto con la [decisione 0007](../decisions/0007-contesto-di-sessione.md)
      (`charToByteIndex`, testato su accenti ed emoji in andata e ritorno), che
      ne aveva bisogno per far attraversare il confine alla selezione. Le due
      direzioni stanno in un punto solo.
- [ ] **Due livelli di decorazione dichiarati**: sintassi dal tree Lezer
      (già fatto), semantica dagli `Span` del modello (embed risolti, callout,
      math) — con la regola di chi vince dove.
- [ ] **Invariante del buffer sporco** irrobustita (oggi custodita da un flag TS)
      e conflitto buffer↔disco esplicito: è lavoro M3 già dichiarato. Ci è
      arrivato anche il **residuo del ~~§9.7~~**
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

### 18.2 Comandi e tastiera

*ex §3.2 · shell · **P1** — il registro c'è (decisione 0009); manca il lato shell*

- [ ] **Registro comandi nel frontend** alimentato da `list_commands` +
      command palette fuzzy + hotkey configurabili (con chord) + conflitti
      segnalati. È la superficie con cui l'utente raggiunge tutto il resto.

---

## Le code delle sedute chiuse

Quattro voci arrivate da sedute la cui **decisione** è presa e il cui verbale è
in [decisions/](../decisions/README.md). Stanno qui perché è qui che verranno
eseguite: sono tutte shell, e la seduta che le ospitava non ha più niente da
decidere per loro.

### 1.2 Smontare il monolite

*ex §3.1 · shell · **P1** — dalla [seduta 1](01-forma-della-shell.md) ([decisione 0015](../decisions/0015-la-forma-della-shell.md)); tre punti su quattro sono fatti*

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
- [ ] **Migrare cestino e cronologia a `ViewProvider`** (dogfooding già
      pianificato): la cronologia è il caso "view con stato per-documento,
      input e azioni che scrivono". Era bloccata dalla seduta 2 e **non lo è
      più** — la 0016 le dà i nodi di input, lo stato su `on_action`, il «sto
      caricando» e il riconciliatore che rende usabile un campo di testo. Migrarla
      prima avrebbe dato una view che sa mostrare la lista e non sa offrire il
      bottone «Ripristina» se non come `list_item` cliccabile, cioè il protocollo
      collaudato su un caso ammorbidito per farlo passare. Ora il caso non è più
      ammorbidito, e resta solo da farlo. **È l'unica delle quattro code che non
      aspetta nient'altro**, ed è il motivo per cui vale la pena che stia in cima.
- [ ] **Modello di layout**: tab, split, pane, workspace salvabili (3.3, 4.1).
      Oggi c'è un editor solo e un documento solo: tutto il capitolo 3.3 è
      bloccato da questa mancanza, non dalla UI. **Non è un refactor, è una
      feature**, e la sua metà kernel va decisa insieme a `PaneId` — le sessioni
      multiple, che le stavano davanti, sono **fatte**
      ([decisione 0029](../decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md):
      l'host tiene una mappa di vault aperti, ogni comando IPC accetta un `vault`
      opzionale, e ci sono `list_vaults`, `set_current_vault` e `close_vault`, che
      oggi non chiama nessuno) —
      la metà shell si esegue qui, e sblocca la §3.3 qui sotto. Ciò che è già
      pronto: il contesto di sessione pubblicato porta l'identità del pannello,
      quindi il giorno che i pannelli saranno due nessuno dovrà inventarsi da dove
      viene la risposta.

### 2.9 Prestazioni della UI

*ex §3.6 · shell · **P2** — dalla [seduta 2](02-cosa-e-una-view.md) ([decisione 0016](../decisions/0016-cosa-e-una-view.md)); si paga quando le liste diventano lunghe*

- [ ] **Virtualizzazione** di file tree, risultati di ricerca, liste lunghe e
      tabelle: senza, "vault enormi" (24.1) è una promessa che la UI rompe prima
      del kernel. Il nodo `Table` della
      [decisione 0016](../decisions/0016-cosa-e-una-view.md) ha reso il caso più
      concreto, non più urgente: una tabella dichiarata con diecimila righe le
      manda tutte attraverso l'IPC prima ancora che qualcuno provi a disegnarle, e
      la finestra che serve è quella che `Page` già esprime nelle query — il pezzo
      che manca è chi la chiede.
- [ ] **Rendering incrementale dell'anteprima** e lazy loading di immagini/embed.
      Il rendering incrementale ha una precondizione che la
      [decisione 0018](../decisions/0018-chi-vede-il-modello-parsato.md) ha
      nominato e **non** costruito: sapere da quale byte del sorgente viene un
      elemento reso. La forma decisa è una chiave di `RenderOptions` che fa
      scrivere le coordinate nell'HTML — non un secondo canale che porta il
      modello — e si costruisce quando questa voce diventa il suo primo cliente.
- [ ] **Il numero che dice se è ora**: le soglie su vault sintetici da 10k/100k
      note stanno nel [§17.1](17-presidi-che-restano.md#171-corpus-fuzzing-prestazioni),
      e sono il presidio che dice *quando* questa voce ha smesso di essere P2. Le
      due si leggono insieme: là si misura, qui si fa.

### 3.3 La UI di un plugin non ha modo di entrare nella shell

*ex §3.12 · shell · **P1** — dalla [seduta 3](03-chi-disegna-cio-che-il-core-non-conosce.md) ([decisione 0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md)); la decisione è presa, resta il grafo*

- [x] **La decisione fra le tre opzioni**: la terza — *solo prima parte, e tutto
      il resto dichiarativo* — con la precisazione che questa voce chiedeva: il
      protocollo dichiarativo **arriva ai blocchi custom** e non solo alle view,
      quindi il blocco di un plugin arriva a schermo senza una riga nel bundle
      della shell. Il registro di web component è scartato, l'iframe sandboxato
      va a M5.
- [x] **`UiKind::Custom` ha il suo primo cliente** — il diagramma — e ha portato
      con sé la scoperta che il ramo «la shell che conosce `ns` disegna il suo
      widget» **ancora non serve**.
- [ ] **Il grafo è ancora un pannello nativo** (`panels/graph.ts`), ed è ciò che
      resta di questa voce. Non è bloccato dal contratto: l'area principale c'è
      dalla [decisione 0016](../decisions/0016-cosa-e-una-view.md) e *come*
      disegnarci qualcosa che il core non conosce c'è dalla
      [0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md).
      **Aspetta il modello di layout della §1.2 qui sopra**, ed è la ragione per
      cui le due voci ora stanno nello stesso file: finché l'area principale è un
      pannello solo, spostarci il grafo vuol dire togliere di mezzo l'editor.
- [ ] **Il conto del 21.1 resta da saldare**: ogni modulo Suite è «installabile
      separatamente» e «disattivabile», e FubCanvas, FubDB, FubCharts, FubMaps e
      FubForms (21.2) hanno bisogno di un renderer proprio. Con la strada
      dichiarativa aperta la promessa è vera per la maggior parte di ciò che
      disegnano; per i canvas ad alte prestazioni resta vera solo a M5, ed è il
      limite che l'[asterisco di onestà](../architecture/ui-protocol.md) dichiara
      già per la graph view.

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
- [ ] **Va con il secondo livello della [§18.1](#181-editor)**, che è la stessa
      cosa vista dall'editor: «le decorazioni semantiche vengono dal modello»
      diventa scrivibile solo quando la dichiarazione è condivisa, e a buffer
      pulito.
