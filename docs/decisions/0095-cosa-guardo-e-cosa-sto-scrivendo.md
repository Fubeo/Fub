# 0095 — Cosa guardo e cosa sto scrivendo sono due domande

**Data:** 2026-08-04
**Voce:** [§23.5](../roadmap/23-cosa-costano-le-decisioni-chiuse.md#235-il-testo-che-lutente-seleziona-viaggia-sotto-una-capacità-che-nessuno-può-negare)
**Commit:** *(questo commit)*

## Il fatto

`Capability::Env` era documentata come *«sapere che ore sono e cosa guarda
l'utente»*, e la sua `permission()` era `None`: non dichiarabile in un manifest,
non negabile senza negare anche l'orologio. Sotto di lei passava
`active_context()`, cioè quale nota è aperta e il testo che l'utente ha
selezionato, verbatim.

Adesso sono **tre** famiglie:

- `Capability::Env` — l'orologio e il caso. Nessun permesso, perché non c'è
  niente da concedere: sono fatti della **macchina**.
- `Capability::Session` — quale nota è aperta, in che modalità, in che pannello.
  Permesso `fub:read-session`.
- `Capability::SessionSelection` — il testo selezionato. Permesso
  `fub:read-selection`.

`active_context()` diventa **il solo metodo del contratto con due cancelli**:
senza `Session` rende `None`; con `Session` e senza `SessionSelection` rende il
contesto con `selections: None`. Le famiglie del `Guard` passano da quattordici
a **sedici**.

Nessuna firma cambia. **Non c'è ritaglio del congelato.**

## La voce nominava un tipo che non esiste più, e le sue tre premesse sono cadute tutte e tre

Il metodo che ha funzionato nove volte di fila — rileggere la voce contro i
verbali venuti dopo di lei — qui ha dato il raccolto più grosso finora.

**Uno: il tipo.** La voce parla di `Selection.text` «sempre presente». La
[0093](0093-le-selezioni-sono-n-e-il-buffer-e-uno.md), tre commit fa, ha smontato
quel record: ci sono `AnchoredSelection` e `FloatingSelection` dentro un
`SelectionSet` che porta una primaria **più N secondarie**. La premessa regge —
il testo c'è in entrambe le forme — ma la **quantità** no, e la seconda
conseguenza che la voce elenca va riscritta col numero invece che con
l'aggettivo. Non è che un plugin riceve «cosa c'è selezionato» ogni 150 ms:
riceve **tutti i punti in cui l'utente sta lavorando**, ogni 150 ms. La voce
scriveva «non è un dato, è un flusso»; era vero, e la 0093 l'ha moltiplicato per
N senza che nessuna delle due se ne accorgesse. La voce è **peggiorata** stando
ferma, che è il modo meno visibile in cui una voce invecchia — le nove
rimisurazioni precedenti l'avevano sempre trovata più piccola.

**Due: il prezzo dichiarato non esiste.** La voce dice che il pannello
statistiche «dovrà dichiarare `read-vault` per fare una cosa che non legge
nessun documento», e chiama questo *«il caso che rende la decisione non
ovvia»* — è il suo unico argomento a favore della famiglia separata.
`features/src/stats.rs` chiama `host.read_document(&doc)` per contare le parole
della nota, e `PluginManifest::core()` gli concede `read-vault` da sempre. Il
pannello **legge un documento**. Il prezzo era zero.

E non solo per lui: il censimento di tutti i chiamanti di `active_context()` —
statistiche, indice della nota, backlink, versioning, comandi del core — dice che
**ognuno** richiede già `read-vault` o `Query`, che sta sotto lo stesso permesso.
Nessun consumatore di oggi paga niente per il cancello, qualunque forma abbia.

**Tre: l'aggravante non è vera oggi, e la sua ragione si rovescia domani.** La
voce denuncia che «un plugin con `read-vault` ristretto a una cartella riceve
comunque il testo di qualunque selezione». Oggi non è così, e non perché il
contesto sia recintato: perché **nessuna allowlist filtra niente**, il parametro
dei permessi non viene letto da nessuno ed è la casella rimasta del
[§7.1](../roadmap/07-il-confine.md#la-casella-rimasta). Non c'è scavalcamento
perché non c'è recinto. La voce descriveva un difetto futuro al presente.

Il difetto futuro però c'è, e la voce ne dà la ragione sbagliata. Cita il
commento di `Capability::Query` — *«una risposta aggregata non ha un path da
confrontare con una allowlist»* — e dice che «il ragionamento si applica
identico qui». Non si applica: **un `ViewContext` il path ce l'ha**, è il campo
`doc`, lì accanto al testo. La selezione è l'unica cosa di questa famiglia che
un'allowlist di prefissi potrà onorare per costruzione, e questa è la cosa da
lasciare scritta al §7.1 invece che da fare qui.

## Perché non `read-vault`, che è la strada che la voce raccomandava per prima

La voce raccomanda di guardare per prima l'opzione che mette il solo testo dietro
`read-vault`, **perché non inventa niente**. È l'argomento giusto quasi sempre —
è quello che ha vinto nella [0094](0094-un-tetto-che-si-fa-sentire.md) un turno
fa, dove `bad-args` e `permission-denied` dicevano già le due cose e un tipo
nuovo sarebbe stato un ripiego travestito da eleganza. Qui perde, e vale
capire la differenza.

`read-vault` è un permesso **grosso**. Appoggiarci la selezione significa che
negare la selezione è impossibile senza rendere il plugin cieco sul vault: chi
volesse dire *«questo plugin può cercare nelle mie note, non può leggere quello
che sto scrivendo adesso»* non ha una frase per dirlo. Il costo di «non inventare
niente» non era un nome in più nell'elenco dei permessi — era **la scomparsa
della scelta**, cioè esattamente della cosa per cui la voce esiste. Un permesso
riusato è economico finché la sua grana è quella giusta; quando non lo è, il
riuso non è parsimonia, è una decisione presa di nascosto.

C'è anche il verso opposto, e la voce lo nomina bene: un permesso **troppo
grosso per la cosa che si fa** è il modo in cui i permessi smettono di
significare qualcosa. La tensione era vera; ciò che non era vero è che a
scioglierla bastasse scegliere un lato. Due permessi nuovi, ognuno della taglia
della cosa che governa, sciolgono i due lati insieme — e costano due righe in un
elenco che ne ha già dieci.

## Perché **due** permessi e non uno: la misura che ha deciso dove tagliare

La domanda vera non era «recintare o no», era **dove**. Un `ViewContext` ha
quattro campi, e li ho contati invece di ragionarci sopra:

- `pane` — **zero lettori** in tutto il repo, fuori dal tipo che lo definisce.
- `mode` — un lettore solo, `stats.rs`, che legge anche `doc` e `selections`.
- `doc` — cinque lettori.
- `selections` — tre lettori, e uno dei tre (l'indice della nota) usa solo la
  posizione del cursore, non il testo.

Il conto vieta una cosa e ne obbliga un'altra. **Vieta** di tenere `pane` e
`mode` fuori dal cancello, «perché non sono contenuto»: sarebbe un contesto
redatto i cui campi superstiti non li legge nessuno, cioè il caso che nessuno usa
che le 0077, 0090, 0091, 0092, 0093 e 0094 hanno rifiutato sei volte di fila.
**Obbliga** invece a separare `doc` da `selections`, perché lì i clienti sono
davvero due gruppi: l'indice della nota e i backlink vogliono sapere quale nota è
aperta e non toccano il testo; il contatore di parole e il wikilink dei comandi
vogliono il testo. Due permessi con due clienti distinti ciascuno — non un
permesso in cerca di qualcuno che lo dichiari.

Su questo si è chiusa anche la seconda casella della voce, quella sul `DocId`. La
voce chiedeva se «cosa guarda l'utente» dovesse restare concesso a chiunque, e la
risposta è **no**: il nome di una nota è un path, i path sono la cosa che
`read-vault` governa per definizione, e recintare il testo lasciando il nome
sarebbe un cancello che si aggira leggendo l'indice di chi apre cosa. Il diario
di cui la voce parla si tradisce anche solo dai titoli. Costa zero, perché ogni
pannello che dice «stai guardando X» dichiara già abbastanza.

## La forma del rifiuto, e una clausola che si aggiunge al criterio della 0094

`active_context()` è una delle sei capacità senza esito: non ha un `Result`,
quindi il rifiuto è **muto** in entrambi i casi. E in entrambi la risposta nulla
significa già un'altra cosa: `None` è «la shell non ha ancora pubblicato un
contesto», `selections: None` è «nessun cursore» — modalità di lettura, o nessun
documento. **Non è la risposta vera.**

Per il criterio che la 0094 ha appena scritto — *un fallback muto è onesto quando
la risposta nulla è già un caso del dominio, disonesto quando è un valore
inventato per occupare il posto di un errore* — questo sta sul crinale: la
risposta nulla **è** un caso del dominio, ma non è quello in cui ci si trova. Il
`Vec::new()` che la 0094 ha condannato aveva la stessa proprietà.

La differenza che assolve questo caso e non quello è una sola, e vale la pena
scriverla perché è riusabile: **chi riceve la risposta ha già in mano il
motivo**. Un plugin senza `read-selection` non si è dichiarato quel permesso; è
scritto nel suo manifest, che è suo, e lo sa prima di chiamare. Il troncamento
sopra il tetto no — quello dipendeva da una costante dell'host che il chiamante
non poteva conoscere, e arrivava a tempo d'esecuzione senza niente accanto. Il
criterio della 0094 ne esce con una clausola in più:

> Un fallback muto è onesto anche quando la risposta nulla non è quella vera,
> purché chi la legge abbia già in mano il motivo — e un manifest è l'unico posto
> in cui questo capita.

Vale la pena dire cosa **non** giustifica: non giustifica lasciare senza esito le
capacità nuove. La regola della 0021 resta intera, e questa clausola si applica
solo a ciò che è già pubblicato senza `Result` e a cui un permesso dichiarato fa
da spiegazione.

## L'invariante che cambia forma: sedici famiglie, quattordici trait

Fino a oggi `Capability` e i trait di `fub_abi::traits` erano la stessa lista, ed
era una proprietà su cui il `Guard` si appoggiava: *«le due liste devono restare
la stessa lista»*. Da qui in avanti `HostEnv` porta **tre** famiglie, ed è il solo
trait che ne porta più di una.

Era evitabile? La strada della [0021](0021-il-confine.md) — scomporre in
sotto-trait finché ogni famiglia è un trait — **qui non era disponibile**: le tre
cose escono da una firma sola, e un trait in più non spacca un record in due.
L'unico modo di conservare l'uno-a-uno era spaccare il record, cioè la terza
opzione della voce: due chiamate invece di una. Si è scartata perché tocca una
firma pubblicata prima del freeze per ottenere una simmetria interna, e perché il
kernel la decisione la sa prendere da solo — è la stessa domanda della 0094,
*cosa costa averlo promesso per sempre*, e la risposta è che due metodi al
confine sono una promessa e una riga in un enum del kernel no.

L'invariante quindi non muore, cambia forma: non più «una famiglia, un trait», ma
**«nessun trait senza almeno una famiglia»**, che è ciò che il compilatore
presidiava davvero — `Guard` non compila se un trait non è coperto. Ed è stato
scritto accanto all'enum, perché un'eccezione non scritta è un'eccezione che il
prossimo legge come una svista.

Il conto ha anche un effetto materiale che si è visto contandolo: `CapabilitySet`
tiene le famiglie in un `u16`, e a sedici i bit sono **finiti esattamente**. La
diciassettesima vuole un `u32`, e senza una riga che lo dica se ne accorgerebbe
`1 << cap` andando in overflow — in debug con un panic, in release in silenzio.
La riga c'è, dentro il presidio dei discriminanti.

## Perché non c'è ritaglio

Nessuna firma cambia: `active-context: func() -> option<view-context>` è identica
a prima, e ciò che è cambiato sta tutto in `Capability::permission()` e in
`Guard`. Un permesso è una stringa del manifest, che la
[0021](0021-il-confine.md) ha reso una mappa con parametro apposta perché
crescesse senza toccare il contratto.

Il WIT è stato toccato lo stesso, e solo nei **commenti**, perché portava una
frase diventata falsa. L'intestazione di `interface host-env` diceva che
l'orologio e il contesto *«si negano insieme»*: era la descrizione esatta del
difetto che questa voce contesta, scritta al confine come se fosse una proprietà
voluta. Adesso dice che sono tre permessi diversi, e che **un'interfaccia non è
un cancello — il cancello è il permesso**. È la distinzione che serve a chi legge
il WIT per scrivere un manifest, ed è invisibile dalla forma delle firme.

## Perché prima della §23.3, e perché non era P0

Non è P0 e la voce lo diceva bene: non c'è una firma da spostare, quindi il
freeze di M4 non c'entra. Ma aveva un **ordine scritto dentro di sé** — va decisa
prima della §23.3 — e quell'ordine è la ragione per cui è stata presa adesso,
nel primo turno dopo che le P0 sono finite.

L'argomento regge alla verifica, e vale precisarlo: non è che senza rete la
selezione sia al sicuro. È che senza rete l'unico modo di **portarla fuori** è un
plugin nativo, che gira in-process e può fare ciò che vuole comunque — quindi il
cancello varrebbe solo come dichiarazione. Il giorno che `http_fetch` entra, un
componente WASM sotto sandbox può leggere la selezione e spedirla, e lì il
cancello smette di essere una dichiarazione e diventa una barriera vera. Deciderle
insieme avrebbe voluto dire prendere una delle due avendo in testa l'altra a
metà; deciderla prima vuol dire che la §23.3 nasce trovandosi il cancello già
posato.

E vale dire cosa questa voce **non** è, perché il registro è quello che la §23.13
ha già fissato: un plugin nativo può leggere la selezione con o senza permesso, e
nessuna riga di questo verbale glielo impedisce. Il valore è la **dichiarazione**
— che l'utente possa vederla e negarla — non l'imposizione. Gonfiarla in una voce
sulla sicurezza dei plugin sarebbe il difetto che la seduta 22 ha contestato a chi
l'aveva aperta.

## Il presidio

- `host/guard.rs` — tre test nuovi, con una politica che nega una famiglia sola.
  `denying_the_selection_leaves_the_note_visible` è **la voce intera in un
  nome**: il vault concesso, la nota visibile, il testo no. Non sarebbe stato
  scrivibile appoggiando la selezione a `read-vault`, ed è per questo che è il
  test che decide, non quello che verifica.
  `denying_the_session_takes_the_selection_with_it` prova l'altro verso, e
  `the_clock_and_the_session_are_no_longer_the_same_gate` prova la separazione
  in tutti e due i sensi — che negare la sessione non ferma l'orologio, e che
  negare l'orologio non nasconde quale nota è aperta. Quest'ultimo è il test che
  sarebbe stato **impossibile** ieri, perché ieri erano la stessa famiglia.
- `i_discriminanti_coprono_ogni_famiglia` guadagna la riga sui bit dell'`u16`:
  il presidio che c'era vietava buchi e doppioni, non il tetto.
- La fixture dei mirror dell'app è cambiata da sé, e il suo diff è il presidio
  meno costruito di tutti: i due permessi compaiono in `PluginInfo`, cioè nel
  dato che l'inventario porta alla shell. Ciò che si concede si **vede**.

## Cosa resta fuori

- **Il pannello che li mostra all'utente.** `PluginInfo.permissions` attraversa
  l'IPC ed è nel contratto TypeScript, ma nessuna vista della shell lo disegna
  ancora: è il pezzetto di §7.6 che non ha ancora un lettore, la stessa riga che
  la [0042](0042-il-catalogo-della-shell.md) ha lasciato per `registeredPanels()`.
  Un permesso dichiarabile e non mostrato è metà del valore, e va detto invece
  che dato per fatto.
- **Il filtro per prefisso sulla sessione.** `read-session` e `read-selection`
  nascono senza parametro, come tutti gli altri: la casella del §7.1 è quella che
  farà leggere i parametri, e questi due ci arriveranno insieme agli altri. Lì
  sta il ritrovamento di questo verbale — a differenza di `Query`, la sessione
  **un path da confrontare ce l'ha**, ed è `ViewContext.doc`. Una riga lo dice
  adesso nella casella del §7.1, perché il giorno che si scrive quel filtro
  bisogna sapere che questo caso è filtrabile e il canale dati no.
- **La rete.** È la §23.3, con la sua scadenza. Questa voce le lascia la strada
  libera, che è ciò che «prima» voleva dire.
