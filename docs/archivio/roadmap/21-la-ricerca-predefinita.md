# 21. La ricerca predefinita, e cosa le manca per esserlo

Una **seduta** (un gruppo di attività pianificate) della
[roadmap infrastrutturale](../todo.md). La ricerca è built-in (integrata) e di
classe *omnisearch* (la ricerca globale su tutti i file)
([decisione 0025](../decisions/0025-la-ricerca-predefinita.md)). Qui sta la
distanza fra quella frase e il repo.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) ·
[i verbali delle decisioni chiuse](../decisions/README.md)

---

**Origine della seduta** Questa seduta esula dai giri standard. Le altre venti
nascono da una delle sei domande di ricerca voci del piano. Questa nasce da una
**decisione di prodotto**: la
[0025](../decisions/0025-la-ricerca-predefinita.md). La decisione stabilisce il
comportamento omnisearch (la ricerca globale integrata) come ricerca principale
dell'app. Le voci diventano i requisiti necessari. Rappresentano la differenza
tra il comportamento richiesto e il contratto (l'interfaccia di comunicazione)
attuale.

**Stato delle P0 (priorità massima)** Le quattro P0 sono state decise. Non
figurano più qui. Condividevano lo stesso record (la struttura dati) e la stessa
scadenza. `TextQuery` (l'oggetto della richiesta testuale) mancava di:
* Ricerca tollerante: «a meno di un refuso».
* Ricerca per prefisso: «l'ultimo termine è incompleto»
  ([0050](../decisions/0050-cosa-si-chiede-a-una-ricerca.md)).

Le due risposte del canale (l'estratto o il documento) omettevano **a che punto
del documento** si trovasse la corrispondenza
([0049](../decisions/0049-una-posizione-dentro-un-documento.md)).

Erano quattro voci e due decisioni. La §21.3 e la §21.10 chiedevano la stessa
primitiva da due firme diverse. La §21.1 e la §21.2 toccavano lo stesso record.
Deciderle separate imponeva di aprire due volte la stessa firma. La seconda
apertura avrebbe trovato la prima firma congelata. Questo è accaduto in passato.
La [0012](../decisions/0012-origine-degli-eventi.md) ha stabilito di volersi
decidere insieme alla [0011](../decisions/0011-il-lotto.md) per lo stesso
motivo.

**Chiusura della seduta** La seduta è chiusa. Risultato: dieci voci, otto
verbali. L'ultima a cadere è stata la §21.8 (il testo dentro gli allegati)
tramite la
[decisione 0087](../decisions/0087-il-testo-che-sta-dentro-gli-allegati.md).

**Il caso della §21.8** Questa voce è l'unica della seduta chiusa **omettendo
l'azione richiesta**. Nominava due blocchi. Entrambi sono caduti prima
dell'esecuzione:
* La [0046](../decisions/0046-l-anagrafe-del-vault.md) ha rimosso
  `list_documents`.
* La [0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md) ha
  introdotto `DocumentSource::Bytes` nel contratto.

Il problema rimasto riguardava il **tragitto** (il percorso dei dati). Il
descrittore di formato governava l'apertura. L'indicizzazione lo ignorava. Lo
stesso file affrontava due destini. Il sistema accettava un provider (il
fornitore di dati) a byte all'apertura utente. Il sistema scartava il file in
silenzio all'apertura del vault (l'archivio locale dei documenti). Lezione
appresa: **una voce ferma esige una rimisurazione prima dell'esecuzione**. Le
condizioni possono evolvere e i veri ostacoli possono risiedere altrove.

**Bilancio finale** Di otto verbali, **tre** hanno speso contratto prima di
questo: le due P0 e la 0074. Questo è il quarto. È il solo giunto dopo la
chiusura delle P0.

**Ricerche recenti e stato vuoto** Erano due, e la seconda è chiusa. La §21.7
(le ricerche recenti e la nota mancante) è chiusa dalla
[decisione 0086](../decisions/0086-una-cronologia-e-la-sua-porta.md). È la
**sesta** di fila a chiudersi senza spendere contratto. Il problema era
localizzare la cronologia. La sede opportuna è lo stato di vista della shell
(l'interfaccia utente). Il recinto dipende dal proprietario. L'id dello
scrittore costituisce un dato fisso. L'operazione «cancella la cronologia» **non
può** figurare nel registro (il sistema che mappa i comandi). È inaccessibile da
CLI (l'interfaccia a riga di comando).

**Pesi dei campi** Erano tre. La §21.6 (i pesi dei campi) è chiusa dalla
[decisione 0084](../decisions/0084-un-peso-e-una-preferenza.md). È la quinta di
fila a chiudersi **senza spendere contratto**. Un peso costituisce una
preferenza. Non riflette un fatto sul vault. Risiede nelle impostazioni e non
nella query. I due boost (gli incrementi di rilevanza) cablati sono diventati
quattro chiavi. La vera decisione: `query()` esclude l'host (il sistema ospite).
I pesi popolano una copia in RAM (la memoria di lavoro). La copia richiede un
aggiornamento dinamico, altrimenti la configurazione diventa inefficace.

**Unificazione delle quattro superfici** Le superfici ci sono tutte e quattro.
La §21.4 (cercare *dentro* la nota aperta) è chiusa dalla
[decisione 0082](../decisions/0082-una-porta-per-chi-cerca.md). È decisa insieme
alla regola della §21.5. I due lati affrontavano lo stesso problema. Costruire
una superficie senza unificare i percorsi avrebbe aggiunto la quinta.

La metà operativa della §21.5 è chiusa dalla
[decisione 0083](../decisions/0083-le-due-superfici-che-restavano.md):
* Il quick switcher (la barra di navigazione rapida) sfrutta la porta unica.
* L'autocompletamento (il suggerimento automatico del testo) adotta la query con
  prefisso.
* Il giro per battuta della 0082 risulta ora **misurato**. Il banco della seduta
  include una quinta fase dedicata.

**Ottimizzazione delle prestazioni** La sesta voce (la §21.9) chiedeva una
misura in luogo di un comportamento. È chiusa dalla
[decisione 0074](../decisions/0074-selezionare-non-e-raccontare.md). I due
numeri lontani due ordini di grandezza misuravano grandezze distinte. Avevano
ragione tutti e due. Il costo esulava dalla query. Il costo riguardava il
**raccontare** (estrarre i risultati di) duemila righe per mostrarne venti. Il
pianificatore (il gestore dell'esecuzione) opera senza finestra. Il contratto
difettava della formula *«per adesso mi bastano gli id»*.

Adesso il contratto supporta l'omissione (`Excerpts`). La query dalla porta del
workspace scende da 22,3 a 3,4 ms. La seduta possiede il proprio banco:
[`una_ricerca.rs`](../../crates/fub-features/examples/una_ricerca.rs). Questo
funge da precondizione per la §21.1 e la §21.2. Un motore tollerante espande i
termini. Un prefisso apre un intervallo nel dizionario. Le due operazioni
moltiplicano il lavoro. Adesso la base di moltiplicazione è definita.

**Avviso sul fuzzy (la ricerca approssimata)** Nessuna voce impone di
«aggiungere il fuzzy». Il fuzzy costituisce una riga di configurazione del
motore. Mancano le seguenti capacità:
* **Dire** nella query il grado di approssimazione tollerato.
* **Tornare indietro** da un risultato all'esatto punto del testo originario.

### 21.5 Quattro superfici cercano, e rischiano di nascere con quattro ranking (ordinamenti dei risultati)

*Nuova con la [decisione 0025](../decisions/0025-la-ricerca-predefinita.md) ·
shell · **P1** — **CHIUSA** in due tempi: la regola dalla
[decisione 0082](../decisions/0082-una-porta-per-chi-cerca.md), le due superfici
mancanti dalla
[decisione 0083](../decisions/0083-le-due-superfici-che-restavano.md). Le
caselle restano per il racconto; la voce non è più in [todo.md](../todo.md)*

- [x] ~~**Il quick switcher (8.1) non esiste ancora.** Costituisce l'interfaccia
      prevalente della ricerca. Il flusso prevede la scorciatoia, la digitazione
      di tre lettere, l'apertura della nota. Appoggiarlo su `list_documents` con
      confronto di sottostringhe instaurerebbe una **seconda ricerca**.
      L'esperienza risulterebbe peggiore della prima, esattamente sulla via più
      frequentata.~~ Adesso esiste
      ([0083](../decisions/0083-le-due-superfici-che-restavano.md)):
      `panels/quick-switcher.ts` su `Mod-o`. Evita `list_documents`. Usa
      `nomeCercato` in `host/contract.ts` (la porta unica con `TextField::Name`
      e prefisso). La query esegue in `noteDalNome` in `host/query.ts`. Il
      pannello omette `IndexQuery` e `QueryExpr`. Questa è la regola
      verificabile. Mostra le note aperte di recente all'avvio. La memoria dura
      quanto la finestra. La §21.7 regola la scrittura della cronologia.
- [x] ~~**La palette dei comandi c'è**
      ([0009](../decisions/0009-registro-dei-comandi.md)). Omette id rigidi.
      Legge le spec (le specifiche) e disegna. Costituisce il modello
      corretto.~~
- [x] ~~**La regola impone un perimetro preciso:** ogni input testuale della
      shell finalizzato a proporre note adopera `IndexQuery::Documents`. Il
      quick switcher sfrutta la query con campi pesati sul nome
      (`TextField::Name`). La casella di ricerca rimuove i vincoli sui campi.
      Una porta, due configurazioni — non due porte.~~ Decisa dalla
      [0082](../decisions/0082-una-porta-per-chi-cerca.md). Definisce la sede
      compositiva: `host/contract.ts`. Le query sfuggono al pannello
      utilizzatore. Una superficie autonoma genererebbe una seconda
      implementazione. La prima a passarci è la ricerca dentro la nota (ex
      §21.4).
- [x] ~~**Le superfici sono quattro, e la quarta è già scritta.**
      L'autocompletamento dei wikilink (i collegamenti tra note) compare in
      `frontend/src/editor/completions.ts`. La sua sorgente reclama **l'elenco
      intero del vault** all'inserimento di `[[`
      (`frontend/src/panels/document.ts`). Questo tradisce la regola escludendo
      `IndexQuery::Documents`.~~ Adesso rispetta la porta
      ([0083](../decisions/0083-le-due-superfici-che-restavano.md)). La sorgente
      acquisisce il **prefisso**. Ricava una finestra ordinata. Modifiche
      applicate:
  * Omissione di `validFor`. Il parametro proteggeva l'elenco intero,
    invalidando la query sul prefisso.
  * Inserimento di `filter: false`. L'ordine stabilisce la rilevanza del kernel
    (il nucleo dell'applicazione). Il fuzzy di CodeMirror (l'editor di testo)
    comprometterebbe tale ordine.
- [x] ~~**La regola da sola risulta insufficiente. Il budget (il limite di
      risorse) copre la battuta, non l'invocazione.**~~ **Decisa: la query con
      prefisso** ([0082](../decisions/0082-una-porta-per-chi-cerca.md)). La
      lista precaricata perde il confronto progettuale. La migrazione di
      `completions.ts` rimane pendente. Testo antecedente: le altre tre pagano
      l'esecuzione all'apertura. L'autocompletamento impegna ogni tasto. Su un
      vault da 50k note l'elenco intero crolla (per trasporto e per
      ordinamento). Le uscite sono due:
  * La **query con prefisso** (è la
    [§21.2](#212-il-prefisso-mentre-si-digita-non-è-uneuristica-della-casella),
    già P0 e già la lingua giusta — un giro per battuta, ma piccolo).
  * La **lista dei candidati spinta nella shell** e tenuta aggiornata dagli
    eventi (nessun giro, ma uno stato da mantenere consistente).
- [x] ~~**La seconda uscita urta i fondamenti architetturali.** Una lista
      governata da eventi **è** un indice alimentato da eventi.
      [PIANO.md](../PIANO.md) boccia tale modello. Il bridge (il ponte di
      comunicazione) verso la shell tronca il flusso in eccesso
      ([0034](../decisions/0034-il-freno-e-il-raggruppamento.md)). L'evento
      `Event::Overflow` rimpiazza le emissioni scartate (`host/bridge.rs`).
      Spingere si può, ma **solo** rigenerando la lista su `Overflow`: oggi quel
      segnale arriva al confine e nella shell non lo legge nessuno
      (`frontend/src/` non lo nomina). Senza, l'autocompletamento propone un
      vault vecchio e non lo dice. (Replica la
      [decisione 0051](../decisions/0051-l-alimentazione-risponde.md) sul
      confine del kernel).~~ Il vincolo ha prevalso. La
      [0083](../decisions/0083-le-due-superfici-che-restavano.md) ha
      **misurato** la scelta (fase 5 di
      [`una_ricerca.rs`](../../crates/fub-features/examples/una_ricerca.rs)).
      Risultati: ~3 ms per battuta nel caso peggiore (la prima lettera).
      Ottimizzazione: metà del budget preservato tramite `Excerpts::Omit`. I
      nomi proposti non disegnano estratti. Nota finale: sul lato kernel
      l'elenco intero risulta inferiore (0,13 ms). I 3 ms acquistano la
      correttezza formale, a discapito della velocità pura.
- [x] ~~Va unificata al §1.2 per decidere **dove** compare il modale (il
      riquadro di dialogo).~~ Risolto
      ([0078](../decisions/0078-i-riquadri-sono-un-fatto-della-shell.md)). Il
      riquadro col fuoco gestisce la risposta. Il risultato approda in quel
      contenitore. L'accordo risiede in `SHELL_KEYS`, supervisionato dalla
      [0081](../decisions/0081-un-accordo-ha-un-proprietario.md). La
      [0116](../decisions/0116-lo-scope-di-una-chiave-segue-la-vita-di-chi-la-dichiara.md)
      dota la scorciatoia di una chiave di macchina. Il comando di shell precede
      il vault.

### 21.6 I pesi dei campi sono una costante di compilazione

*Nuova con la [decisione 0025](../decisions/0025-la-ricerca-predefinita.md) ·
kernel · **P2** — andava con la ~~§11.1~~ (per decidere la destinazione) ·
**CHIUSA** dalla
[decisione 0084](../decisions/0084-un-peso-e-una-preferenza.md). Le caselle
restano per il racconto; la voce non è più in [todo.md](../todo.md)*

- [x] ~~**Il boost (l'incremento di rilevanza) ×4 su `page_name` dimora cablato
      in `search.rs`** (documentato in [M2](../milestones/M2-search-graph.md)).
      Fornisce un default solido e mantiene tale ruolo. Il difetto risiede
      nell'immutabilità. L'omnisearch (la ricerca globale integrata) esige pesi
      configurabili per vault eterogenei.~~ Il default persiste. Adesso
      rappresenta *il default di una chiave*: `search.boost.name`. Le chiavi
      ammontano a **quattro** e non due (coinvolgono corpo e tag). Tre chiavi su
      quattro campi indicizzati avrebbero generato irregolarità esplicative.
- [x] ~~**Metà è dicibile, metà no.** `TextQuery.fields` regola il **dove**
      della ricerca. Omette **quanto** pesa ciascun campo. La destinazione del
      peso contrappone la query alle impostazioni. La risposta privilegia le
      impostazioni: un peso rappresenta una **preferenza**, separandosi dai
      fatti sul vault (i predicati di `abi/query.rs`).~~ L'impostazione trionfa.
      La firma rimane inalterata. La sfida residua: `IndexProvider::query`
      preclude l'ingestione di un `HostApi` (l'interfaccia del sistema ospite).
      I pesi si popolano in `activate` e albergano nel provider come **copia**.
      Un `EventHandler` (il gestore di eventi) intercetta `search.boost.` e
      ristabilisce la copia. L'assenza di un rinfresco attivo svaluta la
      configurabilità a mero orpello.
- [x] ~~**Le impostazioni appaiono come variabili d'ambiente** (§11.1). La voce
      manca di un approdo stabile in pendenza di quel capitolo.~~ Il contenitore
      sorge con la [0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md).
      Il provider di ricerca annota e consulta le chiavi nel proprio manifest
      (il file di configurazione). Resta P2 senza variazioni, dipendendo dal
      contenitore e non da blocchi strutturali.

### 21.7 Ricerche recenti, e la nota che la ricerca non ha trovato

*Nuova con la [decisione 0025](../decisions/0025-la-ricerca-predefinita.md) ·
shell · **P2** — **CHIUSA** dalla
[decisione 0086](../decisions/0086-una-cronologia-e-la-sua-porta.md). Le caselle
restano per il racconto; la voce non è più in [todo.md](../todo.md)*

- [x] ~~**Ricerche recenti e suggerimenti** (FEATURES §9.1) fluttuano senza
      dimora. Appartengono ai tre stati orfani di contenitore del §11.2.~~ **Il
      §11.2 è chiuso.** Lo stato di vista trova asilo con la
      [0037](../decisions/0037-lo-stato-di-vista.md). Il layout (la disposizione
      visiva) segue la
      [0078](../decisions/0078-i-riquadri-sono-un-fatto-della-shell.md). Il
      posto figurava già; la validità restava l'incognita. I dati occupano lo
      stato di vista della shell (chiave `history`, adiacente a `layout`). Non
      assecondano la sincronizzazione del vault. Lo spazio `data_*` della
      feature impone la replica, innescando l'effetto opposto al desiderato. I
      suggerimenti **mancano** deliberatamente. Un suggerimento precede la
      narrazione storica; questa voce investigava la storia.
- [x] ~~La cronologia richiede la modalità **opzionale e spegnibile** (capitolo
      23 sulla privacy). Le ricerche svelano i comportamenti più dei contenuti
      redatti.~~ Il governo spetta a `history.enabled` in `fub.core`. La lettura
      compete alla **shell** (entità priva di manifest). Esclude
      `program_writable` (limite imposto dalla
      [0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md)). Il default è
      **accesa** (confinamento locale del dato). La persistenza opera per
      **vault**. L'interruttore viaggia tra macchine senza propagare lo stato.
      Lo spegnimento innesca la cancellazione.
- [x] ~~**Il quick switcher attende come cliente.** Espone le note recenti in
      assenza di testo
      ([0083](../decisions/0083-le-due-superfici-che-restavano.md)). Il bacino
      temporaneo dura **quanto la finestra** (`state/recenti.ts`). La chiusura
      definirà le coordinate definitive di scrittura e oscuramento.~~ L'accordo
      si realizza letteralmente. `recenti.ts` ospita la logica integrata.
      Conserva il tetto fisso (dieci elementi), la regola di propulsione
      (`conInCima`), l'interruttore e l'inibizione. Le note aperte acquisiscono
      persistenza condivisa.
- [x] ~~**Dal risultato vuoto scaturisce la nota cercata.** L'azione chiude
      l'esperienza omnisearch. Manca **solo il chiamante**. `note.create` opera
      stabilmente ([0013](../decisions/0013-elenco-delle-capacita.md)). Fornisce
      il nome libero (`free_name`) ed evita collisioni sul path (il percorso).
      Aggiunge l'`Origin` dell'esecutore
      ([0012](../decisions/0012-origine-degli-eventi.md)).~~ L'`Origin`
      preesisteva. `invoke_command` marca `Actor::User` senza ingerenze di JS
      (JavaScript). L'ostacolo gravita intorno a **cosa si passa come `name`**.
      `name` descrive un path, non un'etichetta testuale. La risposta emerge in
      `rules/nome-cercato.ts`. La validazione del nome spetta esclusivamente al
      vault.
- [x] ~~Il gesto coinvolge **due** superfici, non una.~~ Comprende lo stato
      vuoto della ricerca base (`panels/search.ts`) e il quick switcher. Esclude
      terzi incomodi. `panels/doc-search.ts` usa la chiave `search.empty`, ma il
      deficit di risultati in nota aperta diverge dall'esigenza creativa.

### 21.8 Il testo che sta dentro gli allegati

*Nuova con la [decisione 0025](../decisions/0025-la-ricerca-predefinita.md) ·
kernel · **P2** — **CHIUSA** dalla
[decisione 0087](../decisions/0087-il-testo-che-sta-dentro-gli-allegati.md). Le
caselle restano per il racconto; la voce non è più in [todo.md](../todo.md)*

- [x] ~~**PDF, immagini con OCR (il riconoscimento ottico dei caratteri), audio
      e video trascritti** (nove voci in FEATURES §9.1). In omnisearch (la
      ricerca globale integrata) dipendono da estensioni separate. Il blocco
      risiede **prima**. `Vault::list_documents` setaccia per estensione
      `FormatProvider`. Il PDF **non esiste** (§14.1).~~ **Il blocco risultava
      estinto.** La [0046](../decisions/0046-l-anagrafe-del-vault.md) ha tolto
      `list_documents` da `vault.rs`. `IndexQuery::Entries` porta un
      `VaultEntry` (la voce di archivio) per **ogni** file: un PDF esiste, ha
      una dimensione e una data. Le nove voci restano lavoro dei provider.
      Nessun crate (il pacchetto software) di parsing entra nel workspace senza
      una decisione sua.
- [x] ~~**Un secondo blocco, più profondo.** `parse(source: &str)` e
      `Vault::read -> String` osteggiano l'ingresso dei binari
      (`strozzature.md`). L'estrattore urta contro un canale riservato al
      testo.~~ **Parzialmente errato, parzialmente corretto.** La criticità
      albergava altrove. `parse` riceve un `&DocumentSource` (dalla
      [0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md)). Il
      parser gestiva i byte. `strozzature.md` ha incassato le dovute rettifiche
      (dalla [0087](../decisions/0087-il-testo-che-sta-dentro-gli-allegati.md)).
      I colli di bottiglia ammontavano a **due**:
  * L'indicizzazione eludeva `FormatDescriptor::source`. Ora il descrittore vive
    confinato in `DocumentStore::source_from_disk`.
  * Il **confine dei plugin**. La spesa contrattuale risiede nell'aggiunta di
    `read-document-bytes` a corredo di `read-document` (medesimi permessi).
    Fornisce all'estrattore terzo l'aggancio diretto ai byte dell'allegato.
- [x] ~~**Questa voce impone di dichiarare la ricerca come cliente di quel
      lavoro.** Chi affronta la §14.1 deve evitare entry incapaci di
      testualizzazione.~~ **La casella accompagna il destino del destinatario.**
      La §14.1 collassa sotto la 0046. Le tre caselle restanti (impronta,
      cartella, derivate) divergono dall'estrazione del testo. La misurazione
      dell'impianto residuo supera l'utilità della notifica inattiva.