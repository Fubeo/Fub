# 18. L'editor e la tastiera, e ciò che resta della shell

Una **seduta** della [roadmap infrastrutturale](../todo.md). Raccoglie i componenti della shell (il frontend) esclusi dalle sedute precedenti. **Tutte le voci sono chiuse.**

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Questa seduta raccoglie i residui della shell. Le sedute 1, 2, 3 e 4 sono chiuse. Le loro decisioni sono definitive. Le quattro code di strato shell sono trasferite qui. Le sezioni corrispondenti sono §1.2, §2.9, §3.3, §4.4. Ora sono chiuse tutte e quattro. I numeri identificativi restano invariati. Un identificatore `§X.Y` rimane costante nei commit e nei commenti. Ogni voce trasferita conserva il proprio numero. La [corrispondenza](numerazione.md) indica la nuova posizione.

L'ordine di sblocco tra le quattro code è il seguente:
- **il modello di layout (~~§1.2~~) → il grafo nell'area principale (§3.3)**.
- La tastiera (~~§18.2~~) si trova a lato. Gestisce l'arbitrato tra i comandi del kernel (il core backend) e della shell.
- La ~~§4.4~~ richiede alla tastiera un secondo livello di decorazioni.
- La ~~§2.9~~ è indipendente. Il suo costo aumenta con le liste lunghe.

La ~~§2.9~~ è chiusa con la [0114](../decisions/0114-una-finestra-non-si-omette.md). La sua indipendenza si è rivelata la sua proprietà migliore. Questa caratteristica ha permesso di affrontarla per ultima. Nel frattempo nessun altro ha preso decisioni al suo posto.

**L'anello della tastiera si è sciolto.** Risulta superfluo. La §18.2 è chiusa ([0090](../decisions/0090-una-sequenza-e-una-modalita-che-scade.md)). La ~~§4.4~~ si è chiusa dopo la §18.2. Ha evitato di aspettarla. L'arbitrato fra i due registri è arrivato con la [0077](../decisions/0077-una-scorciatoia-e-una-chiave.md). Il residuo è l'accordo in sequenza. Questo accordo lascia inalterate le decorazioni. È il secondo dei tre anelli a sciogliersi. Il primo è stato il ~~§1.2~~. La ragione è identica: l'ordine tra voci di sedute diverse individua la **dipendenza**. Sbaglia invece il pezzo esatto della voce responsabile.

Il pezzo sull'editor è caduto. Nessuna delle quattro sedute lo aveva previsto. Il secondo livello di decorazioni era indipendente dalla tastiera e dal canale. Il canale risulta inesistente ([0018](../decisions/0018-chi-vede-il-modello-parsato.md)). La ~~§18.1~~ è chiusa con la [0089](../decisions/0089-da-cosa-e-partita-una-scrittura.md). Questa decisione ha eseguito una casella. Ha riformulato l'altra.

Il primo anello è **caduto**. Il ~~§1.2~~ è chiuso con la [0078](../decisions/0078-i-riquadri-sono-un-fatto-della-shell.md). L'ordine è efficace. La §3.3 è sbloccata. Il nodo costa **zero firma** (nessuna modifica alle API). L'ordine non poteva prevederlo. I riquadri erano presenti nel contratto dalla [0007](../decisions/0007-contesto-di-sessione.md). La shell necessitava solo di un corpo.

Le due voci native della seduta sono **chiuse tutte e due**. Questo file contiene solo code di sedute concluse altrove. Rappresenta il risultato finale della sua definizione originaria.
La ~~18.2~~ dipendeva dal registro comandi ([decisione 0009](../decisions/0009-registro-dei-comandi.md)) e dai settings (11.1). È chiusa in due tempi:
- **[0077](../decisions/0077-una-scorciatoia-e-una-chiave.md)**: La tastiera è configurabile. Una scorciatoia è una chiave di impostazione prodotta dal kernel per ogni comando. I comandi **della shell** (toggle dei pannelli, cambio modalità, grafo, palette) assumono la stessa forma. Si eseguono localmente. Sostituiscono i bottoni e bypassano l'IPC (Inter-Process Communication).
- **[0090](../decisions/0090-una-sequenza-e-una-modalita-che-scade.md)**: Affronta l'accordo **in sequenza**. Rappresentava un secondo problema reale. Il blocco inibitore era assente. Il contratto omette la sintassi degli accordi. Il comando `Mod-k d` costa **zero firma**. Il resto della voce è esatto. Una sequenza richiede uno stato, un timeout, un annullamento e una regola sul prefisso. L'esecuzione congiunta di tutte e quattro queste caratteristiche garantisce affidabilità.

Questo sblocca il residuo della [decisione 0004](../decisions/0004-il-grafo-e-i-link-non-wiki.md). L'arco è reale. Il clic richiede implementazione. La shell omette la navigazione dei link markdown e dei wikilink. In anteprima un elemento `.internal-path` possiede un `data-path`. Il ricevitore ignora questo dato.

### ~~18.1 Editor~~

*ex §3.7 · shell · **P1** — **chiusa** con la [0089](../decisions/0089-da-cosa-e-partita-una-scrittura.md)*

- [x] **Ponte inverso code unit → byte** (`offsets.ts`): Completato con la [decisione 0007](../decisions/0007-contesto-di-sessione.md). Sfrutta `charToByteIndex`. È testato su accenti ed emoji in andata e ritorno. Permette alla selezione di attraversare il confine. Le due direzioni risiedono in un solo punto.
- [x] ~~**Due livelli di decorazione dichiarati**~~: **Riformulata e passata alla [§4.4](#44-due-parser-per-la-stessa-sintassi)** con la [0089](../decisions/0089-da-cosa-e-partita-una-scrittura.md). 
  - La casella nominava un canale dal modello parsato alla webview (il componente browser). 
  - La [0018](../decisions/0018-chi-vede-il-modello-parsato.md) ha scartato questo canale. 
  - La live preview decora un *buffer* potenzialmente sporco. 
  - Il modello rappresenta il *file* salvato. 
  - Il confine dichiarato e la sintassi scritta una sola volta passano alla §4.4 sul lato corretto. 
  - L'esecuzione qui avrebbe anticipato un canale per un solo cliente. La §4.4 definisce questo processo come un'ipotesi.
- [x] ~~**Invariante del buffer sporco e conflitto buffer↔disco esplicito**~~: **Fatto** con la [0089](../decisions/0089-da-cosa-e-partita-una-scrittura.md). 
  - `write_document` riceve una `base: Option<Revision>`. Restituisce la revisione **prodotta**. 
  - Il salvataggio dell'editor diventa una scrittura *guardata*, rimpiazzando la sovrascrittura. 
  - Due aspetti inattesi hanno aumentato i costi. 
  - **Il ritorno paga quanto la base**: la guardia serve per i salvataggi successivi. Senza di essa, il secondo salvataggio riutilizzerebbe la base iniziale e fallirebbe contro sé stesso. Questo risultato riempie il `DraftInfo::base` lasciato `null` dalla [0088](../decisions/0088-cio-che-non-e-ancora-successo.md). 
  - **Assenza di additività**: l'aggiunta di una firma nuova avrebbe creato due metodi di scrittura di cui uno cieco. Il team ha ritagliato la linea di base. Rappresenta la soluzione onesta prima del freeze. 
  - Il conflitto omette un dialogo dal lato frontend. Il buffer sporco rimane in attesa come una bozza recuperata. Le due vie d'uscita sono comandi della shell privi di scorciatoia. 
  - Integra il **residuo del ~~§9.7~~** ([decisione 0030](../decisions/0030-il-rilevamento-si-puo-chiedere.md)). Prima, `write_document` ometteva la `base`. Il salvataggio dell'editor copriva modifiche esterne ignorate dal watcher (il processo di monitoraggio file). La guardia appropriata risiede nella revisione della firma e nel `Conflict`, che sostituiscono la sovrascrittura silenziosa ([0008](../decisions/0008-modifica-chirurgica.md)). Questa guardia è limitata ad `apply_edit` per i *provider* (fornitori). La 0030 rende il rischio **misurabile**. Un `VaultStatus.watching` a `false` indica esplicitamente copertura nulla.
- [x] ~~**La history di undo attraversa le note, e questo è un bug da chiudere subito**~~: **Chiuso** con la [0045](../decisions/0045-l-undo-ha-due-pile.md). 
  - La decisione sui due livelli di undo ha anticipato i tempi. È arrivata con la seduta 13. 
  - Delle due riparazioni proposte, **una sola** è funzionante. 
  - Marcare il `dispatch` come non annullabile conserva le modifiche *dell'altra nota* nella pila, rendendole applicabili a questa. 
  - CodeMirror (l'editor di testo) manca di un comando per svuotare la history. `setDoc` ricostruisce lo stato. 
  - Il presidio `frontend/src/editor/editor.test.ts` fallisce correttamente sul codice precedente.

### ~~18.2 Comandi e tastiera~~

*ex §3.2 · shell · **P1** — **chiusa** con la [0077](../decisions/0077-una-scorciatoia-e-una-chiave.md) e la [0090](../decisions/0090-una-sequenza-e-una-modalita-che-scade.md). Ha eseguito una casella. Ha trasferito l'altra.*

- [x] ~~**Registro comandi nel frontend** alimentato da `list_commands`, con palette fuzzy, hotkey configurabili e conflitti segnalati.~~ Fatto con la [0077](../decisions/0077-una-scorciatoia-e-una-chiave.md).
  - Una scorciatoia è una **chiave di impostazione** `keys.<id>`.
  - Il kernel la fabbrica alla registrazione di un `CommandProvider`.
  - Il suggerimento funge da default. Il valore efficace diventa la scorciatoia.
  - I comandi **della shell** presentano la medesima forma. Utilizzano un `run()` locale al posto dell'IPC.
  - Il filtro opera a sottosequenza. Il rango precedente serve da spareggio.
  - I conflitti si segnalano all'apertura nominando i comandi, rimpiazzando il rifiuto alla scrittura.
- [x] ~~**L'accordo in sequenza** (`g` poi `d`): una sequenza ha uno stato («sto aspettando il secondo tasto»), un timeout, un modo di annullarla e la domanda di cosa fare se il primo tasto è già una scorciatoia da solo. Niente di tutto ciò si esprime nella sintassi che la `CommandSpec` dichiara oggi.~~ **Fatto** con la [0090](../decisions/0090-una-sequenza-e-una-modalita-che-scade.md).
  - L'implementazione include tutte e quattro le funzionalità necessarie: stato della sequenza, timeout, annullamento, e regola sul prefisso. L'implementazione di tre funzionalità su quattro produrrebbe una tastiera difettosa.
  - L'ultima affermazione si è rivelata falsa. Questa scoperta ha trasformato la struttura. 
  - `CommandSpec.keybinding` è un `Option<String>` dalla [0009](../decisions/0009-registro-dei-comandi.md). 
  - Il contratto affida l'assegnazione dei tasti alla shell. Omette una sintassi fissa. `"Mod-k d"` è pienamente supportato, con costo pari a **zero firma** e **zero Rust**. 
  - La voce confondeva il *tipo* con la *sintassi*. La sintassi risiedeva in quaranta righe di TypeScript.
  - L'esempio iniziale (`g` poi `d`) risultava ineseguibile. Vim (editor modale) adotta una modalità normale. Il sistema include un editor di testo, rendendo `g` un input testuale. 
  - Il modello prescelto è **VS Code**. Il primo tasto richiede un modificatore. 
  - La regola si compone di **due metà interdipendenti**. Il secondo tasto è libero dal modificatore grazie all'impiego di questo nel primo. 
  - `Mod-k` avvia una modalità transitoria di due secondi visibile nella barra di stato. Include una porta d'uscita. Il tasto `d` risulta libero all'interno di questa finestra.
  - Il conflitto di **prefisso** è costato di più: non è un conflitto che `conflitti` sappia vedere.
  - `Mod-k` e `Mod-k d` costituiscono due accordi distinti. L'accordo lungo rimane inaccessibile. Rappresenta un accordo accettato ma inonorato. 
  - L'accordo più corto ha la precedenza. Il sistema lo comunica all'avvio analizzando il registro statico. 
  - Questo processo ha evidenziato un difetto pregresso: un accordo errato risultava escluso dal conteggio dei conflitti. Le scorciatoie manuali richiedono una segnalazione esplicita.
- [x] ~~**La scorciatoia di un comando di shell non si riconfigura**~~: **Trasferita alla [§16.3](16-crate-sdk-banchi-di-prova.md#163-un-crate-per-bundle-di-feature)** con la [0090](../decisions/0090-una-sequenza-e-una-modalita-che-scade.md).
  - **Fatta** lì, dalla [0116](../decisions/0116-lo-scope-di-una-chiave-segue-la-vita-di-chi-la-dichiara.md).
  - I cinque punti originali erano corretti. La loro conclusione si è dimostrata errata. 
  - Il sistema necessitava esclusivamente della chiave dal `CommandProvider`. 
  - Il quinto punto stabilisce la regola mancante: lo scope di una chiave segue il ciclo di vita del suo creatore. Le chiavi `keys.shell.*` appartengono alla macchina.
  - Il trasferimento deriva dall'analisi di una terza via. Un `CommandProvider` **di prossimità** registrato dall'host per conto della shell genera le chiavi `keys.shell.*`. 
  - Gli ID si trasmettono correttamente. Il sistema fallisce in cinque punti. 
  - I primi quattro richiedono lavoro aggiuntivo. 
  - Il quinto rivela una contraddizione: i provider si registrano per vault (directory di lavoro). Le chiavi `keys.*` hanno scope `Vault`. Il comando `shell.vault.open` deve operare *prima* di ogni vault. 
  - La sua chiave si genererebbe a vault aperto, perdendo la sua utilità. Vivrebbe all'interno del vault che intende aprire. 
  - I cinque punti sono documentati nel verbale per la §16.3.

---

## Le code delle sedute chiuse

Questa sezione include quattro voci ereditate da sedute precedenti. Le loro decisioni sono definitive. I verbali risiedono in [decisions/](../decisions/README.md). L'esecuzione avviene qui. Riguardano interamente la shell. Le sedute di origine hanno esaurito i loro compiti.

### ~~1.2 Smontare il monolite~~

*ex §3.1 · shell · **P1** — dalla [seduta 1](01-forma-della-shell.md) ([decisione 0015](../decisions/0015-la-forma-della-shell.md)); **chiusa** con la [0078](../decisions/0078-i-riquadri-sono-un-fatto-della-shell.md). Rappresentava l'ultima casella.*

- [x] **Un modulo per dominio** (`explorer`, `search`, `trash`, `history`, `graph`): Fornito di un piccolo store condiviso e un router di eventi kernel. `handleKernelEvent` manteneva connessioni dirette a ogni pannello. Ora i componenti dichiarano esplicitamente gli eventi di interesse. `main.ts` passa da 1622 a 137 righe ([decisione 0015](../decisions/0015-la-forma-della-shell.md)).
- [x] **Un solo modo di montare un pannello**: Definito dall'**interfaccia** in `ui/panel-host.ts`. Un pannello dichiara identità, posizione, trigger di aggiornamento (`refresh`, `followsDoc`) e visibilità. L'host controlla l'esecuzione. Explorer, ricerca, cestino, cronologia e grafo utilizzano questo canale insieme alle view (viste) dichiarate. `ui/views.ts` funge da adattatore `ViewSpec`→`Panel`. La regola 5 in [architecture/shell.md](../architecture/shell.md) definisce la mappa.
- [x] **Il protocollo di disegno**: Bloccato in precedenza dalla seduta 2. Ora è chiuso con la [decisione 0016](../decisions/0016-cosa-e-una-view.md).
- [x] ~~**Migrare cestino e cronologia a `ViewProvider`**~~: **Fatto** con la [0075](../decisions/0075-una-view-non-chiede-con-una-finestra.md). 
  - Ha rivelato due requisiti inattesi. 
  - La prima: le due richieste del cestino si **disegnano** direttamente. Omettono l'uso di `ViewUpdate::Confirm` nel contratto. La domanda in corso risiede nello stato di vista dell'esemplare. L'albero la mostra al posto dell'elenco. 
  - La seconda: la cronologia possedeva già un canale. Rappresenta una view della feature *versioning*. Il plugin corrispondente rilegge i dati dal proprio spazio. 
  - Le due letture previste per il §16.6 tramite `IndexQuery` risultano assenti. Sono sparite insieme al loro unico chiamante. 
  - Il sistema elimina cinque porte IPC totali. Il debito del §16.6 si riduce da cinque a due.
- [x] ~~**Modello di layout**: tab, split, pane, workspace salvabili (3.3, 4.1)~~: **Fatto** con la [0078](../decisions/0078-i-riquadri-sono-un-fatto-della-shell.md). 
  - L'affermazione sulla decisione congiunta kernel/`PaneId` risulta errata in positivo: il lavoro era assente. 
  - `ViewContext` include un `pane` dalla [0007](../decisions/0007-contesto-di-sessione.md). Lo stato di vista opera per esemplare ([0037](../decisions/0037-lo-stato-di-vista.md)). 
  - Il sistema supporta già N riquadri. La pluralità appartiene alla **shell**. 
  - Il kernel rifiuta mappe di riquadri. Risponde a una sola domanda utente per definizione. Costo al freeze della release M4: zero firma.
  - Le altre due caratteristiche si sono divise. 
  - «Il layout» comprende **due** oggetti separati. Il primo traccia l'apertura della finestra tramite stato di vista nel file della macchina. Il secondo rappresenta un workspace **salvato con un nome** all'interno del vault. 
  - Questa distinzione risolve la metà residua del [§11.2](11-impostazioni-e-i-tre-stati.md#112-tre-stati-diversi-zero-contenitori). 
  - Tab e split godono di progettazione **congiunta**. Un riquadro contiene N documenti. Solo uno è attivo. 
  - Realizzare prima lo split (necessario per la §3.3) avrebbe reso il modello obsoleto al lancio delle tab.
  - Il problema non documentato con il costo maggiore: **una nota aperta due volte condivide il buffer**. Due riquadri con testi indipendenti creerebbero due note. Il salvataggio recente sovrascriverebbe l'altro di nascosto.

### ~~2.9 Prestazioni della UI~~

*ex §3.6 · shell · **P2** — dalla [seduta 2](02-cosa-e-una-view.md) ([decisione 0016](../decisions/0016-cosa-e-una-view.md)); **chiusa** con la [0114](../decisions/0114-una-finestra-non-si-omette.md). Lascia due caselle.*

- [x] **Virtualizzazione**: Riguarda file tree, risultati di ricerca, liste lunghe e tabelle. 
  - La misurazione precisa un dettaglio: il risultato **non è virtualizzazione**. Consiste nella metà precedente al layout. 
  - Virtualizzare richiede il disegno della porzione visibile. 
  - La visibilità dipende dal layout. Questo concetto manca in `happy-dom` (**buco dichiarato n. 5** della [0112](../decisions/0112-un-e2e-contro-un-host-finto-prova-il-cablaggio.md)). 
  - Il sistema decide **il traffico sul ponte e la generazione degli elementi**. Risolve il problema originale della trasmissione massiva via IPC precedente al disegno. 
  - L'entità `Page` supporta la finestra dati. Questa finestra rappresenta il **primo argomento ed richiede un valore esplicito**. 
  - L'estrazione totale impiega il flag esplicito `SENZA_FINESTRA` per evitare omissioni.
  - **Casella residua**: La vera finestra scorrevole e il gesto «mostra le altre». Attualmente il contatore dei restanti elementi risulta inattivo. La sua disattivazione garantisce onestà tecnica.
- [x] **Lazy loading di immagini/embed**: Originariamente accorpato al rendering incrementale. La misurazione li ha separati. 
  - Le immagini funzionano senza layout. La shell **delega la decisione** al browser tramite `loading="lazy"`. 
  - La regola risiede nell'unico punto di ingresso HTML della webview (§3.6). Rimpiazza l'impiego nell'anteprima. 
  - Gli embed richiedono ancora il layout per il caricamento visivo. 
  - L'analisi ha svelato un problema peggiore: la profondità dell'idratazione aveva un limite, la **larghezza** no. L'applicazione richiedeva la stessa pagina al kernel una volta per ogni segnaposto.
  - **Casella residua**: Il **rendering incrementale**, giustificato da due ragioni misurate invece di una. 
  - La precondizione della [decisione 0018](../decisions/0018-chi-vede-il-modello-parsato.md) richiede una chiave `RenderOptions`. Questa chiave inietta le origini dei byte nell'HTML. È compito di `fub-abi` e del provider markdown. Esclude il coinvolgimento dello strato shell. 
  - **Il primo cliente è assente**: `updatePreview` si attiva solo al cambio del documento nel riquadro e all'ingresso in modalità Lettura. Evita l'esecuzione ad ogni battuta. 
  - `PaneMode` è un enum (enumerazione) di modalità esclusive. Il sistema rende esclusivamente il sorgente **salvato**. 
  - Il rendering incrementale richiede di conservare la parte immutata. I cambiamenti a livello di intero *documento* invalidano tutte le parti.
- [x] **Il numero che dice se è ora**: Il rimando al §17.1 risulta **scaduto**. 
  - La [0113](../decisions/0113-il-banco-conta-le-operazioni.md) ha chiuso la voce con una decisione opposta. 
  - Un banco misura le **operazioni**, ignorando i millisecondi. Il tempo su una macchina condivisa perde validità come segnale. Il tempo di un fotogramma in `happy-dom` risulta completamente assente. 
  - `ridisegno.test.ts` conta gli elementi nel DOM (Document Object Model) e le interrogazioni al ponte. 
  - La metrica più indicativa assume la forma di un'**uguaglianza**: due vault con una differenza di quattromila note disegnano lo stesso albero.

### ~~3.3 La UI di un plugin non ha modo di entrare nella shell~~

*ex §3.12 · shell · **P1** — dalla [seduta 3](03-chi-disegna-cio-che-il-core-non-conosce.md) ([decisione 0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md)); **chiusa** con la [0079](../decisions/0079-il-grafo-esce-dall-overlay.md). Lascia una casella.*

- [x] **La decisione fra le tre opzioni**: Vince la terza. Prevede l'utilizzo esclusivo della prima parte con un approccio dichiarativo per il resto. 
  - Il protocollo dichiarativo si estende ai blocchi custom, superando il limite delle view. 
  - Il blocco di un plugin raggiunge lo schermo ignorando il bundle della shell. 
  - Il registro di web component subisce lo scarto. L'iframe sandboxato passa alla release M5.
- [x] **`UiKind::Custom` ha il suo primo cliente**: Il diagramma. Ha svelato l'inutilità temporanea del ramo dove la shell disegna il widget conoscendo `ns`.
- [x] ~~**Il grafo è ancora un pannello nativo**~~: **Fatto** con la [0079](../decisions/0079-il-grafo-esce-dall-overlay.md). 
  - Il ramo temporaneamente inutile diventa la via di passaggio. 
  - Il grafo opera come `ViewProvider` (`fub-features/src/graph.rs`). 
  - Dichiara `ViewSurface::Main`. È la **prima** view del repo a utilizzare questa variante, nominata nel contratto per tre sedute e rimasta inospitata. 
  - Invia nodi e archi dentro un `UiKind::Custom { ns: "fub:graph" }`. 
  - La shell ha integrato il ramo atteso per nome da `ui/node.ts`. I `ns` supportati risiedono in un registro dedicato (`ui/custom.ts`), sostituendo un costrutto `if`.
  - Due aspetti inattesi hanno aumentato i costi. 
  - La prima: **una tab è diventata un'entità discriminata**. `PaneState.docs: string[]` costituiva un elenco di path. Un path rappresenta l'identità di un documento ([0043](../decisions/0043-il-path-e-la-chiave.md)). L'inserimento di `"view:graph"` avrebbe introdotto un costo su ogni lettore. 
  - La seconda: **il contratto resta invariato**, per la terza voce consecutiva. 
  - La natura dei dati pubblicati da un riquadro grafico richiedeva apparentemente un nuovo campo. La risposta è `doc: null`. Questo stato apparteneva già a `ViewContext` e soddisfa pienamente il requisito.
- [x] ~~**Il conto del 21.1 resta da saldare**~~: **Ridotto al suo limite dichiarato**. Rappresenta l'esito più onesto per questa casella. 
  - La promessa garantiva un renderer (motore di rendering) dedicato per ogni modulo Suite (FubCanvas, FubDB, FubCharts, FubMaps, FubForms, 21.2). 
  - Il percorso risulta ora pienamente **attivo**. 
  - Un modulo dichiara la propria view su `main`. Invia i dati in un `Custom` con un proprio `ns`. L'entità responsabile del disegno registra una riga in `ui/custom.ts`. 
  - L'[asterisco di onestà](../architecture/ui-protocol.md) permane con misura ridotta. 
  - In precedenza, la graph view manteneva privilegi nei **dati** e nei **pixel**. Ora conserva privilegi solo nei pixel (il `ns` incluso nel bundle della shell). 
  - Un plugin di terze parti gestirà l'invio autonomo solo dopo l'implementazione in `WebView` di asset story e CSP (Content Security Policy) (M5). 
  - Questa voce rispetta il limite. La nota resta nella posizione originaria.
- [ ] **La casella che resta**: **Aprire in un riquadro una view diversa dal grafo.** 
  - Il comando `shell.graph` apre la view specifica di quel componente. 
  - Questa soluzione soddisfa il primo cliente. Diventa insufficiente per il secondo. 
  - Il passaggio a due view principali richiederà un gesto generico. L'azione aprirà una view nel riquadro col fuoco, mostrando l'elenco fornito da `viewPrincipali()`. 
  - L'implementazione attuale esclude questo gesto basato su zero clienti per evitare ipotesi errate. 
  - I comandi richiedono registrazione al montaggio. Le view si scoprono a livello di vault. Le due operazioni necessitano di decisione congiunta. Attualmente la seconda manca di utilizzatori reali.

### 4.4 Due parser per la stessa sintassi

*ex §3.8 · shell · **P1** — dalla [seduta 4](04-chi-vede-il-modello-parsato.md) ([decisione 0018](../decisions/0018-chi-vede-il-modello-parsato.md)); **chiusa dalla [0115](../decisions/0115-la-verita-e-la-dichiarazione.md) — i parser ammontavano a tredici, superando i due previsti. La verità risiede nella dichiarazione. La shell adesso la legge escludendo la riscrittura***

- [x] **Il blocco è rimosso con una modalità inattesa**. 
  - Il secondo livello della §18.1 (semantica dagli `Span` del modello) richiedeva un canale. 
  - La 0018 conferma il canale per il lato interno (`HostApi::read_model`). 
  - Lo scarta definitivamente verso la webview. 
  - Il modello rappresenta il **file**. La live preview decora un **buffer** potenzialmente sporco. Un modello trasmesso oltre confine risulterebbe valido solo nei momenti di minore utilità.
- [x] **Il confine, dichiarato**. Il conteggio presentava un errore di undici. 
  - Il buffer appartiene a Lezer. Il file appartiene al modello. Questa distinzione permane. 
  - All'interno di `frontend/` la sintassi compariva **tredici** volte in **sei** costrutti. Coinvolgeva tre moduli isolati. Le tre versioni divergevano tra loro e rispetto al modello. 
  - Su `> - [ ] x` la live preview disegnava una casella ignorata da `Mod-Enter`. Su `vedi.#tag` il modello indicizzava un tag omesso dalla live preview. Su `#Café` decomposto il tag visibile superava in lunghezza quello indicizzato. 
  - La nuova architettura prevede **uno** spazio unificato (`frontend/src/rules/sintassi.ts`). Dichiara esplicitamente le tre varianti conviventi di regole: generata, rispecchiata, scritta una volta.
- [x] **Togliere il moltiplicatore a favore del canale.** 
  - La sintassi richiede una dichiarazione singola. `SyntaxRuleSpec` trasporta il trigger come dato. Questa premessa della voce si è rivelata esatta. 
  - La shell **legge** le regole. `sintassi.generated.ts` deriva da un montaggio reale. Il simbolo `==` scompare dalla shell e diventa il trigger di `HighlightRule`. 
  - Una sintassi inline registrata in Rust gestisce le proprie decorazioni. 
  - La casella residua riguarda **il canale a runtime (a tempo di esecuzione)**. Il codice generato subisce la compilazione. Conosce le regole del core ma ignora quelle di un plugin esterno. 
  - Il verbale misura le ragioni della chiusura temporanea. Il `SyntaxRegistry` opera sotto il prestito di scrittura. La sua condivisione richiede una decisione sulla concorrenza del kernel. 
  - L'accessore previsto per il canale esiste già: `Workspace::syntax_forms`.
- [x] **Tracciamento divergenza tra le due grammatiche**. Prima era assente. 
  - Adesso genera un errore tracciabile: `il_corpus.rs` emette l'analisi del modello sulle proprie sorgenti. `frontend/src/editor/corpus.test.ts` confronta questo dato con la passata della shell. 
  - Dichiara le divergenze una per una, specificandone la causa, seguendo il formato della [0060](../decisions/0060-il-modello-dice-il-vero-sui-byte.md) applicato trasversalmente. 
  - Il difetto principale risiedeva nel presidio. Il corpus saltava i casi registrati come **vuoti** dal modello, restando cieco a una passata eccessivamente permissiva. 
  - Rimuovere l'esclusione delle righe di codice lo manteneva verde su tutte e sessantatré le sorgenti.
- [x] **Il secondo livello della ~~§18.1~~ è arrivato qui**. La sua risposta chiude il cerchio della prima casella. 
  - L'affermazione «le decorazioni semantiche vengono dal modello» viene abbandonata. Il canale richiesto risulta inesistente. 
  - La dichiarazione condivisa non sblocca il *modello esterno*, ma **la forma interna**. Questo lavoro risiede ora nella casella del canale a runtime.