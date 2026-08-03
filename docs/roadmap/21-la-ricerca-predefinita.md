# 21. La ricerca predefinita, e cosa le manca per esserlo

Una **seduta** della [roadmap infrastrutturale](../todo.md): la ricerca è built-in e di classe *omnisearch* ([decisione 0025](../decisions/0025-la-ricerca-predefinita.md)); qui sta la distanza fra quella frase e il repo.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

**Questa seduta non l'ha trovata un giro.** Le altre venti nascono da una delle
sei domande con cui il piano cerca le voci; questa nasce da una **decisione di
prodotto** — la [0025](../decisions/0025-la-ricerca-predefinita.md), che ha
stabilito che il comportamento che gli utenti di Obsidian conoscono come
*omnisearch* è la ricerca dell'app e non un plugin da installare. Deciso quello,
le voci non sono più opinioni: sono la sottrazione fra ciò che quel
comportamento richiede e ciò che il contratto sa dire oggi.

**Le quattro P0 sono state decise, e non sono più qui.** Stavano insieme perché
erano lo stesso record e la stessa scadenza: `TextQuery` non sapeva dire *«a meno
di un refuso»* né *«l'ultimo termine è incompleto»*
([0050](../decisions/0050-cosa-si-chiede-a-una-ricerca.md)), e nessuna delle due
risposte del canale — l'estratto di un risultato, il documento che un
riferimento nomina — sapeva dire **a che punto del documento**
([0049](../decisions/0049-una-posizione-dentro-un-documento.md)). Erano quattro
voci e due decisioni, perché la §21.3 e la §21.10 chiedevano la stessa primitiva
da due firme diverse e la §21.1 e la §21.2 toccavano lo stesso record: deciderle
separate significava aprire due volte la stessa firma, la seconda con la prima
già congelata — che è esattamente ciò che è successo al lotto e all'origine, e
per cui la [0012](../decisions/0012-origine-degli-eventi.md) ha dichiarato di
volersi decidere insieme alla [0011](../decisions/0011-il-lotto.md).

Quello che resta non ha più niente che scada col freeze di M4. **Sono due
voci, e sono tutte e due comportamento**: dove il comportamento si vede (§21.7)
e cosa gli darà da mangiare (§21.8). La prima poggia su ciò che le P0 hanno
appena messo nel contratto.

**Erano tre.** La §21.6 — i pesi dei campi — è chiusa dalla
[decisione 0084](../decisions/0084-un-peso-e-una-preferenza.md), ed è la quinta
di fila in questa seduta a chiudersi **senza spendere contratto**: un peso è una
preferenza e non un fatto sul vault, quindi va nelle impostazioni e non nella
query. I due boost cablati sono diventati quattro chiavi, e la parte che era
davvero una decisione non era quale numero: era che `query()` non riceve un host,
quindi i pesi vivono in una copia in RAM — e una copia ha bisogno di qualcuno che
la rinfreschi, o la chiave resta configurabile per finta.

**E le superfici ci sono tutte e quattro.** La §21.4 — cercare *dentro* la nota
aperta — è chiusa dalla [decisione 0082](../decisions/0082-una-porta-per-chi-cerca.md),
che l'ha decisa insieme alla regola della §21.5 perché erano la stessa cosa vista
dai due lati: costruire una superficie che cerca senza decidere da dove passano
tutte quelle che cercano avrebbe aggiunto la quinta. La metà che restava della
§21.5 — lavoro e non decisione — l'ha chiusa la
[decisione 0083](../decisions/0083-le-due-superfici-che-restavano.md): il quick
switcher è nato sulla porta unica invece che da sé, l'autocompletamento è
passato alla query con prefisso, e il giro per battuta che la 0082 aveva
scelto senza misurarlo adesso è **misurato** — il banco della seduta ha una
quinta fase apposta.

**E la sesta — la §21.9, la sola che chiedesse una misura invece di un
comportamento — è chiusa**, dalla
[decisione 0074](../decisions/0074-selezionare-non-e-raccontare.md). La risposta
è che i due numeri lontani due ordini di grandezza misuravano cose diverse e
avevano ragione tutti e due: una query non costava, costava **raccontare**
duemila righe per mostrarne venti — il pianificatore chiede senza finestra, e il
contratto non sapeva dire *«per adesso mi bastano gli id»*. Adesso lo sa
(`Excerpts`), la query dalla porta del workspace è passata da 22,3 a 3,4 ms, e la
seduta ha il proprio banco: [`una_ricerca.rs`](../../crates/fub-features/examples/una_ricerca.rs).
Vale anche come precondizione delle §21.1 e §21.2 — un motore tollerante espande
i termini e un prefisso apre un intervallo nel dizionario, cioè le due operazioni
che moltiplicano il lavoro per query, e adesso si sa su quale numero
moltiplicheranno.

Un avvertimento che vale per tutta la seduta: nessuna di queste voci è
«aggiungere il fuzzy». Il fuzzy in sé è una riga di configurazione di un motore.
Ciò che manca è il modo di **dire** in una query quanto si vuole essere
indovinati, e il modo di **tornare indietro** da un risultato al punto del testo
che lo ha prodotto.

### 21.5 Quattro superfici cercano, e rischiano di nascere con quattro ranking

*nuova con la [decisione 0025](../decisions/0025-la-ricerca-predefinita.md) · shell · **P1** — **CHIUSA** in due tempi: la regola dalla [decisione 0082](../decisions/0082-una-porta-per-chi-cerca.md), le due superfici che mancavano dalla [decisione 0083](../decisions/0083-le-due-superfici-che-restavano.md). Le caselle restano per il racconto; la voce non è più in [todo.md](../todo.md)*

- [x] ~~**Il quick switcher (8.1) non esiste ancora**, ed è la superficie che si
      usa più della ricerca stessa: si preme una scorciatoia, si scrivono tre
      lettere, si apre una nota. Se nasce da sé, nasce su `list_documents` con un
      confronto di sottostringhe — cioè una **seconda ricerca**, peggiore della
      prima, sulla strada più battuta dell'app.~~ Adesso c'è
      ([0083](../decisions/0083-le-due-superfici-che-restavano.md)):
      `panels/quick-switcher.ts` su `Mod-o`, e **non** su `list_documents` —
      `nomeCercato` in `host/contract.ts` è la porta unica con `TextField::Name`
      e il prefisso, `noteDalNome` in `host/query.ts` è il giro. Nel pannello non
      compare né `IndexQuery` né `QueryExpr`, che è la regola resa verificabile.
      A mani vuote mostra le note aperte di recente, in una memoria che vive
      quanto la finestra: dove una cronologia si **scriva** lo decide la §21.7.
- [x] ~~**La palette dei comandi c'è** ([0009](../decisions/0009-registro-dei-comandi.md))
      e non cabla nessun id: legge le spec e disegna. È la prova che la forma
      giusta è già stata trovata una volta, e il modello da ripetere.~~
- [x] ~~**La regola che questa voce chiede è una sola**: tutto ciò che nella shell
      accetta del testo e propone delle note passa da `IndexQuery::Documents`.
      Il quick switcher è quella query con i campi pesati sul nome
      (`TextField::Name`, che esiste per questo); la casella di ricerca è la
      stessa senza vincoli sui campi. Una porta, due configurazioni — non due
      porte.~~ Decisa dalla [0082](../decisions/0082-una-porta-per-chi-cerca.md),
      che aggiunge **dove** sta scritta: le query si compongono in
      `host/contract.ts`, non nel pannello che le usa — una superficie che se la
      compone in casa è già una seconda implementazione. La prima a passarci è
      la ricerca dentro la nota (ex §21.4).
- [x] ~~**Le superfici sono quattro, e la quarta è già scritta.**
      L'autocompletamento dei wikilink esiste
      (`frontend/src/editor/completions.ts`) e la sua sorgente chiede al canale
      dati **l'elenco intero del vault** a ogni apertura di `[[`
      (`frontend/src/panels/document.ts`), col commento che lo dichiara
      provvisorio — *«l'autocompletamento vuole i nomi di tutte le note, quindi
      qui la lista resta intera: cambia la porta, non la domanda»*. È la regola
      di questa voce vista dalla superficie che la viola per prima: accetta del
      testo e propone delle note, e non passa da `IndexQuery::Documents`.~~
      Adesso ci passa ([0083](../decisions/0083-le-due-superfici-che-restavano.md)):
      la sorgente prende il **prefisso** e riceve una finestra ordinata. Le due
      righe che contano sono una sparita e una nuova: `validFor` non c'è più —
      era ciò che rendeva sostenibile l'elenco intero, e con la query sul
      prefisso terrebbe buona una finestra vecchia — e `filter: false` c'è,
      perché l'ordine di quelle opzioni **è** la rilevanza del kernel e il fuzzy
      di CodeMirror la rimescolerebbe.
- [x] ~~**E su questa la regola non basta, perché il budget non è per
      invocazione: è per battuta.**~~ **Decisa: la query con prefisso**
      ([0082](../decisions/0082-una-porta-per-chi-cerca.md)). La lista spinta
      perde per la ragione scritta nella casella qui sotto — sarebbe un indice
      alimentato dagli eventi, su un ponte che scarta per progetto — e la
      migrazione di `completions.ts` resta da fare. Il testo di prima: Le altre tre pagano un giro quando si
      aprono; questa lo pagherebbe a ogni tasto, e su un vault da 50k note
      l'elenco intero non è una risposta — né come costo di trasporto né come
      cosa da ordinare nella shell. Le uscite sono due, e sono una decisione di
      progetto e non un dettaglio di implementazione: la **query con prefisso**
      (che è la [§21.2](#212-il-prefisso-mentre-si-digita-non-è-uneuristica-della-casella),
      già P0 e già la lingua giusta — un giro per battuta, ma piccolo), oppure
      la **lista dei candidati spinta nella shell** e tenuta aggiornata dagli
      eventi (nessun giro, ma uno stato da mantenere consistente).
- [x] ~~**La seconda uscita ha un vincolo che il progetto ha già scritto per gli
      indici, ed è ciò che la rende decidibile.** Una lista di candidati
      mantenuta dagli eventi **è** un indice alimentato dagli eventi: la cosa
      che [PIANO.md](../PIANO.md) rifiuta con l'argomento *«un indice che perde
      un aggiornamento non tace: risponde sbagliato, in silenzio»*. E il ponte
      verso la shell perde per progetto — freno e raggruppamento dalla
      [0034](../decisions/0034-il-freno-e-il-raggruppamento.md), col tetto della
      raffica che emette `Event::Overflow` al posto di ciò che ha scartato
      (`host/bridge.rs`). Spingere si può, ma **solo** con la rigenerazione su
      `Overflow`, e oggi quel segnale arriva al confine e nella shell non lo
      legge nessuno (`frontend/src/` non lo nomina). Senza, l'autocompletamento
      propone un vault vecchio e non lo dice — che è la
      [decisione 0051](../decisions/0051-l-alimentazione-risponde.md)
      trasportata dall'altra parte del confine: là un indice che perde un
      documento adesso lo nomina, qui la shell non ha ancora niente di
      equivalente.~~ Il vincolo ha deciso, e la [0083](../decisions/0083-le-due-superfici-che-restavano.md)
      ha **misurato** il prezzo di ciò che ha scelto: fase 5 di
      [`una_ricerca.rs`](../../crates/fub-features/examples/una_ricerca.rs), ~3 ms
      per battuta nel caso peggiore (la prima lettera, che combacia con tutto) e
      metà del budget risparmiata con `Excerpts::Omit`, perché chi propone dei
      nomi non disegna estratti. Il numero onesto da ricordare è l'altro: di lato
      kernel l'elenco intero costa **meno** (0,13 ms) — quei 3 ms comprano la
      correttezza, non la velocità, ed è ciò che il vincolo diceva.
- [x] ~~Va col §1.2 per **dove** compare il modale — e quella metà adesso c'è
      ([0078](../decisions/0078-i-riquadri-sono-un-fatto-della-shell.md)): il
      riquadro col fuoco è una domanda con una risposta, quindi «aprire il
      risultato *dove*» ha dove atterrare.~~ Il risultato apre nel riquadro col
      fuoco, come ogni altra apertura. La §18.2 **resta**, e non per questa voce:
      l'accordo è dichiarato in `SHELL_KEYS` e visto dal presidio della
      [0081](../decisions/0081-un-accordo-ha-un-proprietario.md), ma una
      scorciatoia di un comando di shell non è ancora riconfigurabile.

### 21.6 I pesi dei campi sono una costante di compilazione

*nuova con la [decisione 0025](../decisions/0025-la-ricerca-predefinita.md) · kernel · **P2** — andava con la ~~§11.1~~, che le ha dato dove atterrare · **CHIUSA** dalla [decisione 0084](../decisions/0084-un-peso-e-una-preferenza.md). Le caselle restano per il racconto; la voce non è più in [todo.md](../todo.md)*

- [x] ~~**Il boost ×4 su `page_name` è cablato in `search.rs`** (ed è documentato
      in [M2](../milestones/M2-search-graph.md): «chi cerca *Rust* vuole prima la
      nota *intitolata* Rust»). È un default buono e resta il default; il punto è
      che non è **toccabile**, e omnisearch quei pesi li rende regolabili perché
      un vault di ricette e uno di paper non vogliono la stessa cosa.~~ Resta il
      default, e adesso è *il default di una chiave*: `search.boost.name`. Le
      chiavi sono **quattro** e non due — anche corpo e tag — perché tre chiavi su
      quattro campi indicizzati lasciavano un caso speciale da spiegare a voce.
- [x] ~~**Metà è già dicibile e metà no.** `TextQuery.fields` dice **dove**
      cercare; nessun campo dice **quanto** pesa ciascun campo. La domanda da
      decidere è se il peso stia nella query o nelle impostazioni, e la risposta
      plausibile è la seconda: un peso è una **preferenza**, non un fatto sul
      vault, e i fatti sul vault sono ciò che il linguaggio delle query contiene
      (`abi/query.rs`, «un predicato è un fatto sul vault, non un servizio»).~~
      È la seconda, e la firma non si è mossa di un campo. La domanda che è
      rimasta dopo quella — e che la voce non aveva visto — è che
      `IndexProvider::query` non riceve un `HostApi`: i pesi si leggono in
      `activate` e si tengono nel provider, cioè sono una **copia**. Un
      `EventHandler` sul prefisso `search.boost.` la rinfresca a vault aperto,
      perché un peso si tara e una taratura che passa dalla riapertura non la fa
      nessuno.
- [x] ~~**Ma le impostazioni oggi sono variabili d'ambiente** (§11.1), quindi
      questa voce non ha dove atterrare finché quella è aperta.~~ Il contenitore
      c'è ([0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md)): il
      provider di ricerca dichiara le chiavi nel proprio manifest e le legge da
      lì. Resta P2 e non diventa P1, perché non è mai stata bloccata da una
      firma: era bloccata da un contenitore, e adesso è solo lavoro.

### 21.7 Ricerche recenti, e la nota che la ricerca non ha trovato

*nuova con la [decisione 0025](../decisions/0025-la-ricerca-predefinita.md) · shell · **P2***

- [ ] **Ricerche recenti e suggerimenti** sono già in FEATURES §9.1 e non hanno
      un posto dove stare: sono uno dei tre stati senza contenitore del §11.2.
      La cronologia va **opzionale e spegnibile** — è materia del capitolo 23
      (privacy), non un dettaglio di comodo: cosa si è cercato dice di una
      persona più di cosa ha scritto.
      **E adesso questa voce ha un cliente che l'aspetta**: il quick switcher
      mostra a mani vuote le note aperte di recente
      ([0083](../decisions/0083-le-due-superfici-che-restavano.md)), da una lista
      che vive **quanto la finestra** (`state/recenti.ts`) proprio per non
      anticipare la decisione di qui. Chi chiuderà questa voce decide dove una
      cronologia si scrive e come si spegne; quel modulo ne diventa il lettore,
      e non è un secondo posto da riconciliare.
- [ ] **Dal risultato vuoto si crea la nota cercata.** È il gesto che chiude il
      giro in omnisearch, e da noi manca **solo il chiamante**: `note.create`
      esiste ([0013](../decisions/0013-elenco-delle-capacita.md)), sa proporre un
      nome libero (`free_name`) e rifiuta un path occupato. È anche il punto in
      cui la ricerca smette di essere sola lettura, quindi la nota nasce con
      l'`Origin` di chi l'ha chiesta ([0012](../decisions/0012-origine-degli-eventi.md)).

### 21.8 Il testo che sta dentro gli allegati

*nuova con la [decisione 0025](../decisions/0025-la-ricerca-predefinita.md) · kernel · **P2** — bloccata dalla §14.1*

- [ ] **PDF, immagini con OCR, audio e video trascritti** sono nove voci di
      FEATURES §9.1, e in omnisearch arrivano da un'estensione a parte che
      estrae il testo e glielo passa. Da noi il blocco è **prima**: finché
      `Vault::list_documents` filtra per estensione dei `FormatProvider`, un PDF
      **non esiste** — non c'è niente da indicizzare (§14.1).
- [ ] **E c'è un secondo blocco, più profondo**: `parse(source: &str)` e
      `Vault::read -> String`. Un formato binario non entra nel contratto
      (`strozzature.md`, riga dei documenti non-testo). Un estrattore di testo è
      un provider, ma il canale che dovrebbe percorrere oggi accetta solo testo.
- [ ] **Questa voce non chiede di risolvere né l'uno né l'altro.** Chiede di
      dichiarare che **la ricerca è il cliente** di quel lavoro, così che chi
      aprirà la §14.1 sappia chi lo aspetta a valle e non progetti una entry di
      vault che sa dire il proprio mime type e non sa produrre testo.

