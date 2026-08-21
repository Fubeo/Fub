# 12. Le stringhe, gli errori, il locale

Una **seduta chiusa** — un blocco tematico di lavoro ormai concluso — della
[roadmap infrastrutturale](../todo.md). La conclusione è chiara: chi localizza
le stringhe localizza anche gli errori. Il locale serve in ogni caso.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) (leva — il rapporto
fra beneficio e costo —) ·
[i verbali delle decisioni chiuse](../decisions/README.md)

---

**Chiusa.** La seduta contiene una decisione sola con quattro facce. La domanda
principale era una: *chi trasforma un dato in una frase per l'utente, e in che
momento?*

- **Il locale** ([0039](../decisions/0039-il-locale-e-il-caso.md)): il requisito
  fondamentale per poter formulare una risposta. Serve prima ancora di conoscere
  il contenuto della risposta.
- **Chi localizza** ([0040](../decisions/0040-chi-localizza.md)): la soluzione
  adottata. Il testo usa un tipo specifico che porta la propria provenienza.
  Questa soluzione sostituisce l'uso di una semplice `String` o di una chiave.
- **L'errore**
  ([0041](../decisions/0041-un-errore-e-testo-che-qualcuno-legge.md)):
  l'applicazione della stessa struttura ai messaggi di guasto. È il punto in cui
  la forma del testo è più critica.
- **Il catalogo della shell**
  ([0042](../decisions/0042-il-catalogo-della-shell.md)): il componente
  rimanente. Il suo ambito è stato ridimensionato dalle tre decisioni
  precedenti.

Il §12.3 è stato affrontato **per primo**. Questa scelta non deriva dalla
comodità. Era l'unico punto indipendente dalla decisione sulle stringhe. Un
provider ha sempre bisogno del locale per ordinare e formattare i dati. Questo
vale indipendentemente dalle scelte sulla UI. Adesso il provider ottiene questo
dato tramite `HostEnv::user_locale`. La shell pubblica questo valore. Il kernel
compone il valore usando le chiavi `locale.*`. Questo passaggio introduce anche
il **caso** (`random_bytes`). Questo elemento risolve un buco — una mancanza
nota nel sistema — identico a quello dell'orologio.

Poi si è implementata la soluzione definitiva per i testi. I dati usano
`Text::Literal`. I testi da tradurre usano `Text::Message`. Il *kernel* risolve
le traduzioni in uscita dal contratto, usando il catalogo del fornitore
originale. Questo intervento rappresenta la modifica più grande alla linea di
base dopo la [0021](../decisions/0021-il-confine.md). La ragione è identica: il
freeze stabilizza la **forma**, non la larghezza.

L'errore — il componente gemello, ovvero la sua controparte — applica la stessa
forma nei punti critici. Questa decisione introduce un aspetto ulteriore
rispetto alla traduzione: **un errore serve a essere distinto meccanicamente,
non solo a essere letto**.

I dettagli dell'implementazione degli errori:
- Il payload di ogni variante usa il tipo `Text`.
- La struttura trasmessa sulla rete è discriminabile tramite il formato
  `{kind, message}`.
- Tre varianti nuove (`not-found`, `already-exists`, `io`) classificano gli
  errori in precedenza raggruppati sotto `internal`.
- Il blocco `catch` del cestino è ora un ramo condizionale. Prima catturava
  genericamente i fallimenti segnalando "il path è di nuovo occupato".

L'ultima faccia dimostra che le quattro decisioni erano in realtà una sola. Il
§12.4 è stato **ristretto** dalle tre decisioni precedenti, non eseguito alla
lettera. Il kernel risolve le stringhe dei provider. La shell deve quindi
gestire solo i propri testi. Questo problema residuo è identico a quello dei
token e dell'accessibilità. Questi argomenti si trovavano nella stessa voce per
un motivo preciso: *il valore è dichiarato in un posto solo, oppure è ricopiato
in due posti che devono restare d'accordo?*

Esempi di queste dipendenze:
- Il colore definito nei token **e** in `oneDark`.
- Il nome accessibile presente in `aria-label` **e** nel titolo della view.
- La parola scritta nel catalogo **e** nell'HTML.

Ogni punto della voce rappresenta lo scioglimento di una di queste coppie.

Il contrasto visivo è il caso più istruttivo:
- La variabile `--accent-soft` veniva usata come **sfondo** per le righe in
  hover o selezionate.
- Questo generava il contrasto peggiore dell'intera app esattamente sotto il
  cursore del mouse.
- Adesso queste righe utilizzano la variabile `--bg-hover`.
- La variabile `--accent-soft` viene usata solo come inchiostro (testo). Questo
  è il suo ruolo dichiarato, controllato dal presidio — un test che diventa
  rosso se una promessa smette di valere —.

Due concetti rimangono fondamentali oltre i verbali e si ripresenteranno in
futuro:

- **La forma plurale non è supportata.** Il motore dei template (incluso quello
  del contratto) non sa selezionare il plurale. Le frasi coi conteggi usano un
  formato neutro (ad esempio «Parole: 3», non «3 parole»). Una frase contenente
  un operatore ternario non è traducibile e non genera avvisi. Supera i tipi,
  passa i test, ma fallisce in ogni lingua che non declina come l'italiano.
- **La lingua va dichiarata nei test sui testi.** Un presidio — un test che
  diventa rosso se una promessa smette di valere — che verifica del testo deve
  specificare la lingua. In caso contrario, la funzione `t()` usa
  `navigator.language`. Questo rende l'esito dipendente dall'ambiente di
  esecuzione. La lingua è fissata una volta in `frontend/src/test-setup.ts`.

I seguenti temi restano esclusi e appartengono ad altre sedute:

- **L'uso di testo italiano in `SettingKind::rejects()` nell'ABI.** Nessun
  catalogo appartiene all'ABI. Darne uno al contratto è una decisione di forma,
  non un fix meccanico rimasto indietro. Questo comportamento emerge in
  `settings.import`. Qui le motivazioni dei rifiuti viaggiano come dati in
  lingua italiana.
- **La gestione degli errori del backend.**
  - Il [§20.2](20-quando-qualcosa-va-storto.md) definisce l'uso di una variante
    di evento contenente un errore tipizzato (il tipo adesso c'è).
  - Il [§20.4](20-quando-qualcosa-va-storto.md), chiuso dalla
    [0080](../decisions/0080-un-guasto-si-dice-a-chi-sta-lavorando.md), regola
    la visualizzazione degli avvisi prima confinati in `console`.
  - Questi avvisi compaiono ora nel centro notifiche della
    [0035](../decisions/0035-il-lavoro-lungo-si-racconta.md). Ogni avviso
    possiede una propria chiave nel catalogo della shell.
- **L'accessibilità e la configurazione visiva.**
  - La **§25.1** copre l'alto contrasto, le animazioni ridotte (reduced motion),
    le dimensioni del testo e il font per dislessia.
  - Queste funzionalità si basano adesso sui token.
  - Questo sistema risolve anche l'unico debito di contrasto dichiarato
    esplicitamente: il colore dark `--accent-contrast` su `--accent`
    (certificazione AA senza margine).
- **Le personalizzazioni grafiche avanzate.** La sezione **6.2** tratta i temi
  di terze parti, gli snippet CSS e il CSS per nota o cartella. I token
  costituiscono il prerequisito per queste funzionalità.
