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

Stanno insieme perché **le prime tre sono lo stesso record**. `TextQuery` porta
il testo, la modalità e i campi; `DocumentMatch` porta l'estratto e gli
evidenziati. La tolleranza ai refusi (21.1), il prefisso mentre si digita (21.2)
e le coordinate dell'estratto (21.3) toccano quei due tipi, tutti e due sono già
nel WIT ([`wit/fubmd/abi.wit`](../../wit/fubmd/abi.wit)), e tutti e due si
congelano a **M4**. Deciderle separate significa aprire tre volte la stessa
firma, e la seconda volta con la prima già congelata — che è esattamente ciò che
è successo al lotto e all'origine, e per cui la
[0012](../decisions/0012-origine-degli-eventi.md) ha dichiarato di volersi
decidere insieme alla [0011](../decisions/0011-il-lotto.md).

Le altre sei sono la coda: dove il comportamento si vede (21.4, 21.5, 21.7),
cosa lo rende regolabile (21.6), cosa gli darà da mangiare (21.8), e la sola
misura che dice se la ricerca predefinita è **veloce** — che oggi non si sa
(21.9).

Un avvertimento che vale per tutta la seduta: nessuna di queste voci è
«aggiungere il fuzzy». Il fuzzy in sé è una riga di configurazione di un motore.
Ciò che manca è il modo di **dire** in una query quanto si vuole essere
indovinati, e il modo di **tornare indietro** da un risultato al punto del testo
che lo ha prodotto.

### 21.1 La tolleranza ai refusi non è dicibile nel contratto

*nuova con la [decisione 0025](../decisions/0025-la-ricerca-predefinita.md) · contratto · **P0** — `text-mode` è già nel WIT, e si congela a M4*

- [ ] **`TextMode` ha due varianti, `Terms` e `Phrase`** (`abi/query.rs`), e
      nessuna delle due dice *«a meno di un refuso»*. È la voce fondativa della
      [0025](../decisions/0025-la-ricerca-predefinita.md): senza, la ricerca
      predefinita può diventare tollerante solo **di nascosto**, cambiando il
      comportamento del provider senza che il contratto se ne accorga.
- [ ] **E l'altra metà è quella che conta: oggi non si può chiedere
      l'esattezza.** L'esattezza è implicita, e ciò che è implicito non si può
      pretendere. Il giorno in cui `SearchIndex` diventa tollerante, diventano
      tolleranti **tutti** i suoi chiamanti nello stesso istante: `vault.replace`
      su N note, le collezioni (8.4), le viste salvate (8.3), i template (16.1) e
      l'automazione su-modifica (16.2). Un motore che indovina, su un canale che
      poi scrive, è un difetto — e la variante va aggiunta **prima** del
      comportamento, non insieme.
- [ ] **La forma è da decidere, e le due candidate non sono equivalenti.**
      Una terza variante di `TextMode` è la più economica ma le tratta come
      esclusive, mentre modalità e tolleranza sono **ortogonali**: una frase
      cercata a meno di un refuso ha senso, e con l'enum non si scrive. Un campo
      a sé (`tolerance`, con `Exact` come default esplicito) le tiene
      indipendenti e costa un campo in più su ogni mirror. Va scelta a verbale:
      dopo M4 la prima si corregge solo con una major.
- [ ] **Nel contratto non deve entrare una distanza di edit.** «Due caratteri»
      è un parametro di un motore, e metterlo in una firma vorrebbe dire che
      cambiare motore cambia il significato delle query salvate. Ciò che il
      contratto deve portare è un'**intenzione** — esatto, tollerante — e la
      traduzione è del provider, come già lo è la tokenizzazione.
- [ ] **`TextField` non nomina gli heading**, e sono tre varianti su tre
      (`Name`, `Body`, `Tags`). Omnisearch li pesa a parte, ed è il campo che
      distingue una nota che *parla* di una cosa da una che ci ha dedicato una
      sezione. Va con questa voce perché è lo stesso record e la stessa scadenza.

### 21.2 Il prefisso mentre si digita non è un'euristica della casella

*nuova con la [decisione 0025](../decisions/0025-la-ricerca-predefinita.md) · contratto (metà) + shell · **P0** per la firma — va decisa con la [§21.1](#211-la-tolleranza-ai-refusi-non-è-dicibile-nel-contratto)*

- [ ] **Cercare `arch` deve trovare *architettura* prima che la parola sia
      finita**, ed è metà di ciò che fa sembrare istantanea una ricerca. Oggi
      nel contratto non c'è modo di dire che **l'ultimo termine è incompleto**.
- [ ] **Se lo aggiunge la shell, la ricerca dell'utente e quella di tutti gli
      altri chiamanti divergono.** La casella potrebbe appendere un `*` da sé, e
      sarebbe la scorciatoia peggiore possibile: la CLI (27.1), l'API locale
      (27.2), le automazioni (16.2) e il centro di comando LLM (22.4)
      interrogherebbero lo stesso indice con una lingua diversa da quella
      dell'utente, e la differenza non sarebbe scritta da nessuna parte. È la
      stessa ragione per cui la sintassi di ricerca non è più quella di tantivy
      ([0019](../decisions/0019-il-canale-dati.md)).
- [ ] **Ma non è una proprietà della query salvata: è una proprietà
      dell'invocazione.** Una query messa in una collezione o in un template non
      deve restare «col prefisso» per sempre — l'utente aveva finito di
      scrivere, e nessuno era lì a vederlo. Questo è il punto che rende la voce
      contratto e non shell: dove si mette un campo che vale *mentre* qualcuno
      digita e non dopo. La risposta plausibile è che stia in `TextQuery` e che
      chi **salva** una query la normalizzi — ma va scritta, o ogni chiamante ne
      inventerà una sua.

### 21.3 Gli estratti sono ancorati allo snippet, non al documento

*nuova con la [decisione 0025](../decisions/0025-la-ricerca-predefinita.md) · contratto · **P0** — `document-match` è già nel WIT*

- [ ] **`DocumentMatch.highlights` sono span in byte *dentro `snippet`***
      (`abi/traits.rs`, e la documentazione del campo lo dice a chiare lettere).
      Per disegnare la riga di un risultato è la forma giusta — chi disegna
      avvolge gli intervalli e nessun provider può iniettare markup. Per
      **tornare al testo** non serve a niente: non c'è nessuna coordinata nel
      documento.
- [ ] **E la destinazione esiste già.** `ViewUpdate::Reveal { doc_id, span }` è
      in repo dal pannello outline, e la shell sa portare l'editor su uno span
      convertendo byte UTF-8 → code unit UTF-16 (`frontend/src/rules/offsets.ts`).
      La ricerca è l'unico cliente naturale di quel giro e **non ha le coordinate
      da passargli**: è una capacità che esiste da un lato e non dall'altro.
- [ ] **`absorb` tiene un estratto solo per documento**, con la ragione scritta:
      «due estratti dello stesso documento sono due finestre sullo stesso testo,
      e mostrarne due sarebbe rumore». È vero della riga di una **collezione** ed
      è falso della **ricerca**: omnisearch mostra N occorrenze per nota e
      permette di saltare all'una o all'altra. La regola non va rovesciata — va
      resa dipendente da chi chiede.
- [ ] **Senza questa voce non esistono tre cose**, e vale la pena elencarle
      perché sono ciò che rende la §21.3 una P0 e non un affinamento: la ricerca
      dentro la nota aperta (§21.4), il «vai all'occorrenza successiva», e i
      risultati multipli per nota. Non sono strette: sono **inesprimibili**.
- [ ] **Da decidere insieme: un risultato è derivato da una revisione.** Uno
      span nel documento invecchia appena il documento cambia sotto, e il
      contratto sa già dirlo altrove — `EditRequest` porta la revisione su cui è
      stato calcolato ([0008](../decisions/0008-modifica-chirurgica.md)). Se
      l'estratto porta una coordinata, deve poter dire **di quando**, o la shell
      porterà il cursore nel punto sbagliato senza accorgersene.

### 21.4 La ricerca dentro la nota aperta non esiste

*nuova con la [decisione 0025](../decisions/0025-la-ricerca-predefinita.md) · shell · **P1** — poggia sulla [§21.3](#213-gli-estratti-sono-ancorati-allo-snippet-non-al-documento)*

- [ ] **È il secondo modale di omnisearch, e non è il trova/sostituisci.**
      FEATURES 4.2 ha già `Trova/sostituisci` e `Sostituzione in file corrente`:
      quello è **editing**, cammina sulle occorrenze grezze in ordine di
      posizione. Questa cerca *dentro* la nota con lo stesso motore di fuori —
      ordinata per rilevanza, con gli estratti, e tollerante ai refusi come il
      resto.
- [ ] **Il linguaggio la esprime già**, e questa è la parte buona: è
      `Docs { docs: [la nota aperta] }` in AND con un `Text`, cioè una clausola
      di due letterali del linguaggio della
      [0019](../decisions/0019-il-canale-dati.md). Non serve nessuna variante
      nuova di `IndexQuery`.
- [ ] **E il contesto pure**: quale nota sia aperta lo dice `active_context`
      ([0007](../decisions/0007-contesto-di-sessione.md)), che porta pannello,
      documento, selezione e modalità. Quindi di questa voce resta **solo** la
      superficie nella shell — più le coordinate della §21.3, senza cui il
      risultato non è cliccabile.

### 21.5 Tre superfici cercano, e rischiano di nascere con tre ranking

*nuova con la [decisione 0025](../decisions/0025-la-ricerca-predefinita.md) · shell · **P1***

- [ ] **Il quick switcher (8.1) non esiste ancora**, ed è la superficie che si
      usa più della ricerca stessa: si preme una scorciatoia, si scrivono tre
      lettere, si apre una nota. Se nasce da sé, nasce su `list_documents` con un
      confronto di sottostringhe — cioè una **seconda ricerca**, peggiore della
      prima, sulla strada più battuta dell'app.
- [ ] **La palette dei comandi c'è** ([0009](../decisions/0009-registro-dei-comandi.md))
      e non cabla nessun id: legge le spec e disegna. È la prova che la forma
      giusta è già stata trovata una volta, e il modello da ripetere.
- [ ] **La regola che questa voce chiede è una sola**: tutto ciò che nella shell
      accetta del testo e propone delle note passa da `IndexQuery::Documents`.
      Il quick switcher è quella query con i campi pesati sul nome
      (`TextField::Name`, che esiste per questo); la casella di ricerca è la
      stessa senza vincoli sui campi. Una porta, due configurazioni — non due
      porte.
- [ ] Va con la §1.2 (il modello di layout) per **dove** compare il modale, e
      con la §18.2 per la scorciatoia che lo apre.

### 21.6 I pesi dei campi sono una costante di compilazione

*nuova con la [decisione 0025](../decisions/0025-la-ricerca-predefinita.md) · kernel · **P2** — va con la §11.1*

- [ ] **Il boost ×4 su `page_name` è cablato in `search.rs`** (ed è documentato
      in [M2](../milestones/M2-search-graph.md): «chi cerca *Rust* vuole prima la
      nota *intitolata* Rust»). È un default buono e resta il default; il punto è
      che non è **toccabile**, e omnisearch quei pesi li rende regolabili perché
      un vault di ricette e uno di paper non vogliono la stessa cosa.
- [ ] **Metà è già dicibile e metà no.** `TextQuery.fields` dice **dove**
      cercare; nessun campo dice **quanto** pesa ciascun campo. La domanda da
      decidere è se il peso stia nella query o nelle impostazioni, e la risposta
      plausibile è la seconda: un peso è una **preferenza**, non un fatto sul
      vault, e i fatti sul vault sono ciò che il linguaggio delle query contiene
      (`abi/query.rs`, «un predicato è un fatto sul vault, non un servizio»).
- [ ] **Ma le impostazioni oggi sono variabili d'ambiente** (§11.1), quindi
      questa voce non ha dove atterrare finché quella è aperta. È la ragione per
      cui è P2 e non P1: non è bloccata da una firma, è bloccata da un
      contenitore.

### 21.7 Ricerche recenti, e la nota che la ricerca non ha trovato

*nuova con la [decisione 0025](../decisions/0025-la-ricerca-predefinita.md) · shell · **P2***

- [ ] **Ricerche recenti e suggerimenti** sono già in FEATURES §9.1 e non hanno
      un posto dove stare: sono uno dei tre stati senza contenitore del §11.2.
      La cronologia va **opzionale e spegnibile** — è materia del capitolo 23
      (privacy), non un dettaglio di comodo: cosa si è cercato dice di una
      persona più di cosa ha scritto.
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

### 21.9 Una query costa 23 ms su duemila note, e nessuno sa perché

*nuova con la [decisione 0025](../decisions/0025-la-ricerca-predefinita.md) · kernel/presidi · **P1** — trovata misurando, come la §8.4, che però è chiusa ([0026](../decisions/0026-due-query-insieme.md))*

- [ ] **I due numeri che abbiamo sono a due ordini di grandezza di distanza.**
      [M2](../milestones/M2-search-graph.md) ha misurato la query peggiore a
      **108 µs** su 2000 note; il banco della
      [0024](../decisions/0024-chi-legge-non-aspetta-chi-legge.md) ha misurato
      **~23 ms** per query sullo stesso ordine di vault, e la sua ultima riga lo
      lascia scoperto per iscritto: «*perché* una query costi 23 ms su 2000 note
      è un'altra domanda ancora, e non è di concorrenza». Nessuno dei due numeri
      è sbagliato, il che vuol dire che i due banchi misurano cose diverse — e
      finché non si sa quale, **«la ricerca è veloce» non è una frase
      verificata**, è un criterio di accettazione spuntato su una misura che non
      copre il caso vero.
- [ ] **Con la §21.1 e la §21.2 il costo può solo salire.** Un motore tollerante
      espande i termini prima di cercarli, e un prefisso apre un intervallo nel
      dizionario: sono esattamente le due operazioni che moltiplicano il lavoro
      per query. Misurare **prima** è la stessa disciplina che la
      [0024](../decisions/0024-chi-legge-non-aspetta-chi-legge.md) ha applicato
      al lock, e con lo stesso motivo: lì misurando è cambiata la ragione per
      fare la voce.
- [ ] **L'altra metà misurata sullo stesso banco — la §8.4 — è chiusa, e questa
      resta.** La [decisione 0026](../decisions/0026-due-query-insieme.md) ha
      tolto il `Mutex` che faceva rimettere in fila da sé `SearchIndex::query`:
      adesso otto ricerche passano insieme, e il carico misto è tornato a scalare
      (6,8× a otto thread). Ma le due voci non erano la stessa — una è *quante ne
      passano insieme*, questa è *quanto costa una* — e infatti il costo non si è
      mosso di un filo: ~21 ms a ricerca allora, ~21 ms adesso. Il banco è lo
      stesso e si rilancia allo stesso modo, il che vuol dire che questa voce ha
      già il proprio strumento.
