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

Quello che resta non ha più niente che scada col freeze di M4. **Sono cinque
voci, e sono tutte comportamento**: dove il comportamento si vede (§21.4, §21.5,
§21.7), cosa lo rende regolabile (§21.6) e cosa gli darà da mangiare (§21.8).
Tutte e tre le prime poggiano su ciò che le P0 hanno appena messo nel contratto.

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

### 21.5 Quattro superfici cercano, e rischiano di nascere con quattro ranking

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
- [ ] **Le superfici sono quattro, e la quarta è già scritta.**
      L'autocompletamento dei wikilink esiste
      (`frontend/src/editor/completions.ts`) e la sua sorgente chiede al canale
      dati **l'elenco intero del vault** a ogni apertura di `[[`
      (`frontend/src/panels/document.ts`), col commento che lo dichiara
      provvisorio — *«l'autocompletamento vuole i nomi di tutte le note, quindi
      qui la lista resta intera: cambia la porta, non la domanda»*. È la regola
      di questa voce vista dalla superficie che la viola per prima: accetta del
      testo e propone delle note, e non passa da `IndexQuery::Documents`.
- [ ] **E su questa la regola non basta, perché il budget non è per
      invocazione: è per battuta.** Le altre tre pagano un giro quando si
      aprono; questa lo pagherebbe a ogni tasto, e su un vault da 50k note
      l'elenco intero non è una risposta — né come costo di trasporto né come
      cosa da ordinare nella shell. Le uscite sono due, e sono una decisione di
      progetto e non un dettaglio di implementazione: la **query con prefisso**
      (che è la [§21.2](#212-il-prefisso-mentre-si-digita-non-è-uneuristica-della-casella),
      già P0 e già la lingua giusta — un giro per battuta, ma piccolo), oppure
      la **lista dei candidati spinta nella shell** e tenuta aggiornata dagli
      eventi (nessun giro, ma uno stato da mantenere consistente).
- [ ] **La seconda uscita ha un vincolo che il progetto ha già scritto per gli
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
      equivalente.
- [ ] Va con la §1.2 (il modello di layout) per **dove** compare il modale, e
      con la §18.2 per la scorciatoia che lo apre.

### 21.6 I pesi dei campi sono una costante di compilazione

*nuova con la [decisione 0025](../decisions/0025-la-ricerca-predefinita.md) · kernel · **P2** — andava con la ~~§11.1~~, che adesso le ha dato dove atterrare*

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

