# Roadmap infrastrutturale — reggere il peso di FEATURES.md

Torna a [PIANO.md](PIANO.md). Questo documento chiede una cosa sola:
**[FEATURES.md](FEATURES.md) elenca ~3000 voci — quali pezzi di infrastruttura
mancano perché quelle voci si possano costruire senza riscrivere il kernel, il
contratto e la shell ogni volta?**

Sono uscite 133 voci: novantanove da sette giri sulla stessa domanda, due da una
**misura** (la §8.4, nata dalla [0024](decisions/0024-chi-legge-non-aspetta-chi-legge.md)
e chiusa dalla [0026](decisions/0026-due-query-insieme.md); e la §20.5, nata
misurando la [0052](decisions/0052-cio-che-va-storto-e-un-evento.md) contro il
codice), nove da una
**decisione di prodotto** — la [0025](decisions/0025-la-ricerca-predefinita.md),
che ha stabilito che la ricerca di Fub è built-in e di classe *omnisearch*
([seduta 21](roadmap/21-la-ricerca-predefinita.md)) — e venti da cinque
**verifiche**: la §21.10 dal controllo contro il codice di un'affermazione
arrivata da fuori, e le §22.1–§22.3 dallo stesso controllo su una lettura
esterna dell'intero [FEATURES.md](FEATURES.md)
([seduta 22](roadmap/22-cosa-sa-dire-un-abbonamento.md)), e le §23.1–§23.3 dalla
**terza**, che non guardava un'affermazione esterna ma i verbali stessi
([seduta 23](roadmap/23-cosa-costano-le-decisioni-chiuse.md)) — cinque dalla
**quarta**, che ha ripercorso la terza su un insieme scelto invece che in fila —
i **primi dieci verbali**, riletti uno per uno contro i sorgenti di oggi — otto
dalla **quinta**, che li ha presi **tutti** con una lente dichiarata (§23.9–§23.16)
— una dalla
**undicesima** (la §23.17, nata da un «resta fuori» ripetuto identico da tre
verbali di fila) — e **due** da una
**separazione**: la §16.8, staccata dal §16.7 nel momento in cui lo si chiudeva
([0056](decisions/0056-un-elenco-che-e-la-sorgente.md)), e la §22.4, staccata
dalla §22.1 allo stesso modo — «alle 9» non è la stessa domanda di «ogni ora»,
perché vuole un fuso e una regola sull'ora legale
([0069](decisions/0069-cosa-sa-dire-un-abbonamento.md)). Centodiciotto sono
chiuse e i loro verbali stanno in [decisions/](decisions/README.md); le altre
quindici [conta: voci-aperte] sono qui, e questo file è il loro **indice**.

## Come è organizzato

Le voci sono raggruppate per **seduta**, non per strato: una seduta è un insieme
di voci che conviene decidere in una volta sola, perché sono la stessa domanda
vista da lati diversi. Ogni seduta è un file in [`roadmap/`](roadmap/), con le
voci per esteso e in testa la ragione per cui stanno insieme.

Lo **strato** resta come etichetta su ogni voce, perché fissa la **scadenza**:

- **contratto** — la forma scade col **freeze di M4**: oggi costa un campo, dopo
  costa una migrazione di versione. È il criterio che fa di una voce una P0, non
  la sua importanza.
- **kernel**, **shell**, **presidi** — l'implementazione può seguire. Se una di
  queste è P0, è perché ha una **metà** che è firma (la chiave dei nodi, la
  classe di un dato persistito, il routing dichiarato alla registrazione).

Priorità: **P0** prima del freeze, **P1** insieme a M3, **P2** quando la scala
lo chiede. Le sedute sono in ordine di lavoro: chi le prende dall'alto trova le
precondizioni prima di ciò che le richiede.

## Il criterio

FEATURES.md è impossibile da implementare a mano una voce alla volta. È
possibile solo se **la stragrande maggioranza di quelle voci è un provider** —
`ViewProvider`, `CommandProvider`, `IndexProvider`, `FormatProvider`,
`EventHandler` — che si registra e sparisce dal kernel. Ogni voce che oggi *non
può* essere un provider diventa un comando Tauri bespoke, un pannello cablato in
`main.ts` e un ramo `if` nel kernel.

Le domande con cui i giri hanno cercato le voci restano il modo di trovarne di
nuove, e vanno fatte in quest'ordine:

1. **Cosa manca** — un pezzo che non c'è.
2. **Cosa c'è con la forma sbagliata** — e che il freeze rende definitivo: una
   firma che manca si aggiunge, una firma sbagliata si migra.
3. **Cosa c'è e non mantiene** — un varco dichiarato aperto che non regge il
   primo cliente vero, o una promessa vera a metà e in silenzio.
4. **Quante volte è scritto, e da cosa cresce quel numero** — il moltiplicatore
   invece della migrazione: non lo si paga aggiungendo la voce, lo si paga a
   ogni voce successiva, ed è per questo che resta invisibile finché il fattore
   è basso.
5. **La risposta a una domanda che nessuno ha posto** — chi vede il modello
   parsato, cosa è una view mentre è viva, chi può rispondere a una query, come
   si spegne il tutto. Le risposte scritte nelle firme erano: solo il kernel;
   una funzione pura e sincrona senza stato; il kernel per sette varianti su
   nove; non si spegne. Tutte riaperte e decise
   ([0018](decisions/0018-chi-vede-il-modello-parsato.md),
   [0016](decisions/0016-cosa-e-una-view.md),
   [0019](decisions/0019-il-canale-dati.md), e la
   [seduta 9](roadmap/09-il-lavoro-lungo-e-lo-spegnimento.md) per lo
   spegnimento).
6. **Cosa fallisce senza produrre nessun segnale** — né per un test, né per un
   log, né per l'utente, finché il danno non è già fatto. Ha aperto la
   [seduta 20](roadmap/20-quando-qualcosa-va-storto.md), che ha una proprietà
   sua: quasi nulla di ciò che trova **scade col freeze**, quindi nessun
   criterio di scadenza l'avrebbe portata in cima, mentre il costo si paga
   adesso. Il presupposto da non dare per buono: che un `Result` restituito sia
   un `Result` letto, e che un messaggio scritto sia un messaggio arrivato.

E una settima strada, che non è una domanda: **una decisione di prodotto presa a
verbale**. La [0025](decisions/0025-la-ricerca-predefinita.md) non ha trovato
voci cercandole, le ha **create**: deciso cosa l'app deve fare, quello che manca
al contratto per permetterlo si calcola. Le altre ventidue sedute descrivono un
debito, la [21](roadmap/21-la-ricerca-predefinita.md) descrive una promessa.

E un'ottava, che non è nemmeno una strada: **una verifica**. La §21.10 è uscita
dal controllo, riga per riga contro il codice, di un'affermazione arrivata da
fuori sull'architettura di una feature nuova. L'affermazione diceva che mancava
il riferimento a blocco nel contratto; il contratto ce l'ha dalla
[0003](decisions/0003-modello-del-documento.md), e il buco stava un centimetro
più in là — nella risposta, che non ha dove metterlo. Vale come metodo e non come
aneddoto: **un'affermazione plausibile sull'architettura di questo repo va
verificata contro i sorgenti prima di diventare una voce**, perché quella
sbagliata avrebbe fatto riaprire una firma già a posto e lasciato aperta quella
che scade.

E una **nona**, che non cerca niente: chiudendo una voce ci si accorge che ne
teneva due. È successo due volte. La §16.8 era la seconda metà del §16.7 — stesso *difetto*, un elenco
che smette di dire il vero senza diventare rosso, ma non lo stesso *presidio*:
uno è un insieme che un test estrae dai sorgenti, l'altra è un'affermazione
scritta in italiano dentro un documento. È il rovescio dell'accorpamento della
[0053](decisions/0053-il-contratto-ha-una-sorgente.md), e lo stesso criterio: un
verbale è un ragionamento intero. La §22.4 è il secondo caso, e con una
differenza: là il pezzo che restava era lo **stesso difetto** con un presidio
diverso, qui è la **stessa parola** — *quando* — con due domande sotto. «Ogni
ora» si misura in tempo trascorso e «alle 9» vuole un fuso e una regola sull'ora
legale, e a fargliele sembrare una sola cosa era stato l'elenco di esempi della
voce, scritto per dire *quanto è largo il buco* e letto come se dicesse *quanto è
grande il lavoro*
([0069](decisions/0069-cosa-sa-dire-un-abbonamento.md)).

E una **decima**, che è l'ottava con l'oggetto cambiato: una verifica che non
guarda un'affermazione arrivata da fuori ma **i verbali stessi**, riletti in fila
con una domanda che nessuna delle sei qui sopra pone. Le sei guardano il sistema;
questa guarda **chi usa l'app** e **chi scriverà un plugin**: *una decisione
presa bene, cosa costa a loro?* Ne sono uscite tre voci, e la proprietà che le
lega è che in tutte e tre la decisione regge e la sua **premessa** no — un'unica
alternativa guardata, un invariante vero nel documento che lo scrive e falso su
una superficie cresciuta dopo, due bloccanti caduti in due sedute che non
sapevano di toccarli. Nessuna delle tre si vede rileggendo un verbale contro i
sorgenti **del suo tempo**, che è il modo in cui una premessa si riverifica di
solito ([0069](decisions/0069-cosa-sa-dire-un-abbonamento.md)). E quello che
questa strada produce soprattutto sono **falsi positivi**: cinque, in quel primo
giro, ed è la [seduta 23](roadmap/23-cosa-costano-le-decisioni-chiuse.md) a
elencarli, perché chi la ripercorre non li ribatta.

**La decima si ripercorre, e cambia di poco.** Un secondo giro ne ha prese
**dieci** — i primi dieci verbali — e invece di rileggerle in fila le ha lette
una per una contro i sorgenti di oggi. Ne sono uscite altre cinque voci
(§23.4–§23.8), tre falsi positivi in più e un **doppione**, che è il rischio
nuovo di questa variante: partendo dai verbali vecchi si ritrovano per forza le
voci già aperte, e una voce scritta due volte non si vede come un errore ma come
due lavori. La cosa che il secondo giro insegna al terzo è però un'altra, e non
stava nel primo: due delle cinque hanno una premessa che era **incompleta il
giorno stesso** — un criterio scritto benissimo nel verbale e non applicato a una
riga del verbale stesso, una capacità la cui documentazione dice «che ore sono» e
il cui contenuto è il testo dell'utente. Non si vedono rileggendo il verbale
contro i sorgenti del suo tempo *né* contro quelli di oggi: si vedono solo
**eseguendo il criterio del verbale sul verbale**.

**Il terzo giro cambia due cose, e sono di metodo.** Ha preso **tutti e novanta**
i verbali invece di dieci, letti in cinque lotti in parallelo, e ha portato una
**lente dichiarata in anticipo** invece della domanda larga delle prime due:
*questa decisione toglie a chi usa l'app qualità, libertà di modificare e
scegliere, o privacy?* Ne sono uscite otto voci (§23.9–§23.16) e cinque falsi
positivi.

La prima cosa che insegna è che una lente stretta trova ciò che una larga
attraversa senza vedere, **ma solo se qualcuno legge tutto insieme**: le tre voci
migliori del giro sono **coppie** — due verbali difendibili separatamente il cui
prodotto non ha guardato nessuno — e una coppia non si vede né leggendo in fila
né leggendo un sottoinsieme, perché le due metà stanno in verbali che non si
nominano a vicenda. È la forma della §23.3, ritrovata tre volte in un giro solo:
va promossa da aneddoto a **cosa da cercare apposta**.

La seconda è più scomoda e riguarda questo file. Il primo falso positivo del terzo
giro nominava una funzione che **non esiste** — l'accusa era plausibile,
argomentata, e la funzione citata non c'era — e il difetto vero stava un
centimetro più in là, come nella §21.10. Ma la §21.10 verificava un'affermazione
arrivata **da fuori**, ed è per quel caso che l'ottava strada è scritta. Questa
l'affermazione l'aveva prodotta una nostra rilettura, e per un'affermazione di
casa nessuna riga chiedeva la verifica. **La regola vale per la plausibilità, non
per la provenienza**: si verifica contro i sorgenti ciò che suona giusto, e una
rilettura che produce decine di affermazioni plausibili in un colpo è la sorgente
che ne genera di più.

E una **undicesima**, che non guarda né il sistema né i verbali ma **il proprio
elenco di ciò che resta fuori**: la stessa riga, ripetuta da tre verbali di fila,
è una voce che nessuno ha scritto. La §23.17 è nata così — «resta fuori il
pannello che i permessi li mostra» compare identica nella
[0095](decisions/0095-cosa-guardo-e-cosa-sto-scrivendo.md), nella
[0096](decisions/0096-una-bozza-non-e-una-nota.md) e nella
[0097](decisions/0097-un-recinto-che-vale-anche-quando-nessuno-guarda.md), tre
commit consecutivi che aggiungono tre permessi e nessuna superficie per leggerli.
Una riga in fondo a un verbale la legge chi apre quel verbale, e nessun totale la
nomina: è la stessa diagnosi che il §16.7 fa agli elenchi — *chi lo legge, lo
trova?* — applicata al posto in cui questo repo scrive i propri debiti. La regola
che se ne ricava è un numero: **alla terza volta che un «resta fuori» si ripete
identico, non è una dichiarazione, è una voce**.

## Le sedute

Cosa c'è in questa tabella, e cosa no: la colonna *Perché insieme* dice la
ragione per cui quelle voci si decidono in una volta sola — la stessa frase che
sta in testa al file della seduta, e non un riassunto di ciò che è stato deciso.
Le decisioni stanno nei [verbali](decisions/README.md), indicizzati per § di
provenienza; ripeterle qui vorrebbe dire tenerne una terza copia, che è la cosa
che questo piano passa il tempo a togliere dal codice.

| # | Seduta | Perché insieme | Voci | Caselle |
|---|---|---|---|---|
| **1** | [La forma della shell](roadmap/01-forma-della-shell.md) | dove sta cosa, prima che la superficie cresca | — | — |
| **2** | [Cosa è una view](roadmap/02-cosa-e-una-view.md) | le firme dicono insieme che una view è una funzione pura, sincrona, senza stato | — | — |
| **3** | [Chi disegna ciò che il core non conosce](roadmap/03-chi-disegna-cio-che-il-core-non-conosce.md) | una decisione sola vista da tre lati: sintassi, blocco, renderer nella shell | — | — |
| **4** | [Chi vede il modello parsato](roadmap/04-chi-vede-il-modello-parsato.md) | *chi vede la struttura di un documento?* | — | — |
| **5** | [Il canale dati: chi risponde, e chi instrada](roadmap/05-il-canale-dati.md) | *chi risponde a una query, e chi la instrada?* | — | — |
| **6** | [Le regole in un posto solo](roadmap/06-le-regole-in-un-posto-solo.md) | la stessa regola serve a tre consumatori: provider, shell, e a M5 un guest WASM | — | — |
| **7** | [Il confine](roadmap/07-il-confine.md) | la disciplina del confine, vista da chi lo attraversa e da chi lo presta | — | 1 |
| **8** | [Il kernel a pezzi, e chi lo monta](roadmap/08-il-kernel-a-pezzi.md) | l'oggetto-dio, chi lo monta e chi lo blocca: scomporlo senza decidere il lock lo avrebbe rifatto a grana grossa | — | — |
| **9** | [Il lavoro lungo, e come un componente smette](roadmap/09-il-lavoro-lungo-e-lo-spegnimento.md) | lo spegnimento visto per intero: un componente, un vault, tutti i vault, e chi esegue ciò che è ancora in corso | — | — |
| **10** | [Gli eventi: grana, freno, destinatari](roadmap/10-gli-eventi.md) | lo stesso canale a tre distanze: chi si abbona, quanti messaggi passano, chi li mostra | — | — |
| **11** | [Le impostazioni, e i tre stati](roadmap/11-impostazioni-e-i-tre-stati.md) | tre stati che, decisi separati, nascono con tre meccanismi che non si parlano | — | 1 |
| **12** | [Le stringhe, gli errori, il locale](roadmap/12-stringhe-errori-locale.md) | chi localizza le stringhe localizza anche gli errori, e a tutti e due serve prima il locale | — | — |
| **13** | [L'identità di un documento](roadmap/13-identita-del-documento.md) | la stessa domanda a tre distanze: l'identità, ciò che le sta attaccato, la sua storia | — | — |
| **14** | [Le entry, le cartelle, la lista](roadmap/14-entry-cartelle-lista.md) | lo stesso lavoro visto da quattro lati: entry, metadati, cartelle, lista | — | 3 |
| **15** | [Il disco: storage, durabilità, politiche](roadmap/15-il-disco.md) | il supporto, e le politiche di cosa ci finisce sopra | 2 | 1 |
| **16** | [I crate, l'SDK, i banchi di prova](roadmap/16-crate-sdk-banchi-di-prova.md) | i banchi e i confini fra crate, **prima** di ciò che li moltiplica | 1 | 1 |
| **17** | [I presidi che restano](roadmap/17-presidi-che-restano.md) | senza precedenze e senza scadenza: il criterio è se il costo cresce con l'attesa | 2 | — |
| **18** | [L'editor e la tastiera, e ciò che resta della shell](roadmap/18-editor-e-tastiera.md) | ciò che resta della shell e non appartiene a nessuna delle sedute sopra, code delle sedute 1-4 comprese | 2 | 1 |
| **19** | [Debito riportato dal quarto audit](roadmap/19-debito-quarto-audit.md) | nessuna voce propria: rimandi ai quattro giri di audit, e il lavoro sta nelle sedute che li hanno assorbiti | — | 2 |
| **20** | [Quando qualcosa va storto, chi lo dice e a chi](roadmap/20-quando-qualcosa-va-storto.md) | lo stesso percorso interrotto in più punti: chi non può dirlo, chi lo butta via, chi non ha dove scriverlo | 1 | — |
| **21** | [La ricerca predefinita, e cosa le manca per esserlo](roadmap/21-la-ricerca-predefinita.md) | la ricerca è built-in e di classe *omnisearch*: qui sta la distanza fra quella frase e il repo | — | — |
| **22** | [Cosa sa dire un abbonamento](roadmap/22-cosa-sa-dire-un-abbonamento.md) | le cose che un abbonamento non sa dire — e il cappello che le teneva insieme si è rivelato sbagliato due volte su tre | — | 2 |
| **23** | [Cosa le decisioni chiuse costano a chi usa Fub](roadmap/23-cosa-costano-le-decisioni-chiuse.md) | prezzi dichiarati da un verbale, ognuno in una riga, che nessun elenco ha poi sommato | 7 | 2 |

## Le voci

Quindici [conta: voci-aperte]. Il numero è quello con cui le nomina il resto del repo.

**Se una voce è in questa tabella, è aperta.** Non ci sono spunte da leggere:
una voce chiusa **sparisce** — dalla tabella, dal conteggio della sua seduta e
dal file della seduta — e il suo verbale va in
[decisions/](decisions/README.md). L'assenza è il segnale, e non può mentire:
una casella spuntata resta una promessa scritta da qualcuno, una riga che non
c'è più è stata tolta da chi ha spostato il verbale. Dentro il file di una
seduta le caselle ci sono, e dicono a che punto è la singola voce.

**Ma una voce chiusa può lasciare una casella, e quella casella è di un'altra
specie.** La colonna *Voci* conta le voci **aperte**, e la sua somma fa
quindici [conta: voci-aperte] come deve. Il residuo di una voce **chiusa** non
ci rientra, e per molto tempo non ha avuto dove essere contato: è il modo in cui
la riga della seduta 14 ha detto «due caselle» mentre il suo file ne aveva tre,
e la 19 non ha detto niente avendone tre. Adesso ha una colonna sua —
*Caselle* — e le due somme sono separate perché contano cose separate: una voce
aperta è lavoro che qualcuno deve ancora **decidere**, una casella residua è
lavoro già deciso che qualcuno deve ancora **fare**. Sommarle avrebbe dato un
numero che non risponde a nessuna domanda.

La colonna *Voci* somma **quindici** [conta: voci-aperte], e la seduta 23 ne
tiene sette da sola. Non è uno squilibrio da correggere: è ciò che succede
quando una strada nuova viene percorsa tre volte di fila e produce voci ogni
volta, e la sua forma — *prezzi dichiarati e mai risommati* — attraversa tutte le
altre sedute invece di stare accanto a loro. Se un giorno converrà spezzarla, il
taglio naturale non è il numero ma la **lente**: le §23.9–§23.17 rispondono a una
domanda più stretta delle prime otto.

Le caselle residue oggi sono **quattordici**, e stanno in undici posti:
la [§11.2](roadmap/11-impostazioni-e-i-tre-stati.md) (una: i workspace salvati
con un nome — la casa è decisa, il formato aspetta di vedere assetti veri),
[§14.1](roadmap/14-entry-cartelle-lista.md#141-il-vault-non-è-solo-documenti)
(tre: l'impronta degli allegati, la politica della cartella allegati, le
derivate),
[§15.4](roadmap/15-il-disco.md#154-i-dati-persistiti-non-hanno-né-una-mappa-né-una-classe)
(una: l'implementazione additiva delle due radici), il
[§16.6](roadmap/16-crate-sdk-banchi-di-prova.md#166-dieta-dellipc) (una: i due bespoke
del render ancora da migrare — erano cinque fino alla
[0075](decisions/0075-una-view-non-chiede-con-una-finestra.md) — ed è la prima
casella residua che **non vive in una riga di prosa**, perché il suo numero lo
asserisce un test), la
[§3.3](roadmap/18-editor-e-tastiera.md#33-la-ui-di-un-plugin-non-ha-modo-di-entrare-nella-shell)
(una: aprire in un riquadro una view principale che **non** sia il grafo — oggi
lo fa `shell.graph`, che è il comando di quel componente, e il secondo cliente
vorrà un gesto generico), la
[seduta 19](roadmap/19-debito-quarto-audit.md) (due rimandi: il terzo — le «tre
copie» custodite da un flag TS — è caduto con la
[0089](decisions/0089-da-cosa-e-partita-una-scrittura.md), e non fondendo le tre
ma togliendo a una di esse il compito di avere ragione) e la
[§22.3](roadmap/22-cosa-sa-dire-un-abbonamento.md#223-la-maschera-di-ridisegno-è-della-view-non-dellesemplare)
(una: la query incorporata in una nota, che non è un esemplare di `ViewSpec` e
non ha un canale di invalidazione affatto), la
[§22.4](roadmap/22-cosa-sa-dire-un-abbonamento.md#224-un-orario-di-parete-non-è-un-intervallo)
(una: il recupero di una sveglia di parete **attraverso un riavvio** dell'app —
la finestra di `catch_up_seconds` è onorata dentro una sessione e attraverso il
sonno della macchina, non attraverso una chiusura, perché lo scheduler non
persiste dove è arrivato) e la
[§23.4](roadmap/23-cosa-costano-le-decisioni-chiuse.md#234-selection-ne-porta-una-sola-e-il-tipo-di-un-campo-non-è-additivo)
(una: `note.task.toggle` su più cursori — il comando spunta il task sotto **il**
cursore e la sua posizione è un argomento scalare di una `CommandSpec`
pubblicata, quindi farne una lista è una decisione di firma che la
[0093](decisions/0093-le-selezioni-sono-n-e-il-buffer-e-uno.md) non ha preso di
straforo), la
[§23.3](roadmap/23-cosa-costano-le-decisioni-chiuse.md#233-due-bloccanti-caduti-e-la-rete-non-se-nè-accorta)
(una: fermare una richiesta di rete **già partita** — la
[0097](decisions/0097-un-recinto-che-vale-anche-quando-nessuno-guarda.md) ha
staccato la `fetch` dal prestito del workspace e rilegge il permesso a ogni
chiamata, ma chi annulla un job non aspetta la rete: aspetta il tetto di tempo
dell'host, fino a un minuto che l'utente **vede**) e la
[§7.1](roadmap/07-il-confine.md#la-casella-rimasta) (una, e **ristretta**: le
allowlist dei permessi hanno un **parametro**, e fino alla
[0097](decisions/0097-un-recinto-che-vale-anche-quando-nessuno-guarda.md) non ne
leggeva nessuno. Adesso `fub:network` sì, quindi ciò che resta sono i **prefissi
di path** di `read-vault`/`write-vault` — un plugin ristretto a `Progetti/` legge
ancora tutto — e restano una casella a sé perché un host e un path non si
confrontano allo stesso modo, che è la ragione per cui `Policy::denies_host` è
stretta invece di generica; la [0021](decisions/0021-il-confine.md) l'aveva
lasciata in attesa del §15.5, «la politica dei path in un modulo solo», che la
[0058](decisions/0058-un-nome-che-nasce.md) ha chiuso). Non diventano voci
— non reggerebbero il criterio in testa a questo file — ma non devono nemmeno
sparire senza essere state fatte.

E una casella su cui è scritto **quale voce** la risolverà vale più di una
scritta a vuoto: la prima che avesse quell'indirizzo — le tre righe di `.fub/`
che scrivevano con `write_atomic` — è stata risolta proprio da quella voce.
Vale la pena scriverlo quando si sa. La seconda mostra però l'altro esito
possibile, e va scritto con la stessa onestà: il filtro per prefisso dei
permessi aspettava il §15.5, il §15.5 è chiuso da trentadue verbali, e nessuno è
tornato a prendere la casella. **Un indirizzo dice chi potrà, non chi lo farà**,
e una casella indirizzata a una voce che si chiude senza guardarla resta ferma
esattamente come una scritta a vuoto — con l'aggravante che sembra sistemata.

**Una seduta chiusa non tiene le proprie code.** Le prime quattro sedute hanno
il verbale, ma qualcuna aveva lasciato dietro dei punti di **esecuzione**: sono
tutti di strato shell e stanno in fondo alla
[seduta 18](roadmap/18-editor-e-tastiera.md), che è la seduta definita per
esclusione — *ciò che resta della shell*. Lì stanno accanto alle voci con cui si
incastrano, e l'ordine in cui si sbloccano (§1.2 → §3.3) si vede solo tenendole
nello stesso file. **Il numero resta il suo**: `§4.4` è ancora `§4.4`, e la
colonna *Seduta* dice dov'è adesso, con la provenienza fra parentesi.

**I numeri non scalano.** Un numero chiuso si **ritira**: non si riusa e non
viene rimpiazzato da quello che segue, e ne resta la riga nella
[corrispondenza](roadmap/numerazione.md). Un `§X.Y` è citato nei commenti del
codice e nei messaggi di commit, e una numerazione che si ricompatta a ogni
chiusura trasforma ogni citazione in un rimando cieco.

| § | Voce | Seduta | Strato | |
|---|---|---|---|---|
| **§2.9** | [Prestazioni della UI](roadmap/18-editor-e-tastiera.md#29-prestazioni-della-ui) | 18. L'editor e la tastiera *(da 2)* | shell | **P2** |
| **§4.4** | [Due parser per la stessa sintassi](roadmap/18-editor-e-tastiera.md#44-due-parser-per-la-stessa-sintassi) | 18. L'editor e la tastiera *(da 4)* | shell | **P1** |
| **§15.3** | [Una versione di schema su ogni formato persistito](roadmap/15-il-disco.md#153-una-versione-di-schema-su-ogni-formato-persistito) | 15. Il disco: storage, durabilità, politiche | kernel | **P2** |
| **§15.6** | [La politica di esclusione è una costante di compilazione](roadmap/15-il-disco.md#156-la-politica-di-esclusione-è-una-costante-di-compilazione) | 15. Il disco: storage, durabilità, politiche | kernel | **P2** |
| **§16.3** | [Un crate per bundle di feature](roadmap/16-crate-sdk-banchi-di-prova.md#163-un-crate-per-bundle-di-feature) | 16. I crate, l'SDK, i banchi di prova | presidi | **P1** |
| **§17.1** | [Corpus, fuzzing, prestazioni](roadmap/17-presidi-che-restano.md#171-corpus-fuzzing-prestazioni) | 17. I presidi che restano | presidi | **P2** |
| **§17.2** | [Test della shell](roadmap/17-presidi-che-restano.md#172-test-della-shell) | 17. I presidi che restano | presidi | **P2** |
| **§20.5** | [Il budget del dispatch tronca senza guardare cosa sta troncando](roadmap/20-quando-qualcosa-va-storto.md#205-il-budget-del-dispatch-tronca-senza-guardare-cosa-sta-troncando) | 20. Quando qualcosa va storto | kernel | **P2** |
| **§23.2** | [L'invariante dei terzi ha una seconda eccezione, e non è scritta](roadmap/23-cosa-costano-le-decisioni-chiuse.md#232-linvariante-dei-terzi-ha-una-seconda-eccezione-e-non-è-scritta) | 23. Cosa le decisioni chiuse costano | presidi | **P1** |
| **§23.6** | [Un import sta tutto in memoria, e la cosa che si importa più spesso è un vault intero](roadmap/23-cosa-costano-le-decisioni-chiuse.md#236-un-import-sta-tutto-in-memoria-e-la-cosa-che-si-importa-più-spesso-è-un-vault-intero) | 23. Cosa le decisioni chiuse costano | contratto | **P1** |
| **§23.7** | [Una data scritta come la scrive l'utente non è una data, e non c'è modo di dirlo](roadmap/23-cosa-costano-le-decisioni-chiuse.md#237-una-data-scritta-come-la-scrive-lutente-non-è-una-data-e-non-cè-modo-di-dirlo) | 23. Cosa le decisioni chiuse costano | kernel | **P2** |
| **§23.8** | [Due file che differiscono per una maiuscola sono lo stesso arco](roadmap/23-cosa-costano-le-decisioni-chiuse.md#238-due-file-che-differiscono-per-una-maiuscola-sono-lo-stesso-arco) | 23. Cosa le decisioni chiuse costano | kernel | **P2** |
| **§23.9** | [Il registro non si spegne, e per una modifica chirurgica porta i byte dell'utente](roadmap/23-cosa-costano-le-decisioni-chiuse.md#239-il-registro-non-si-spegne-e-per-una-modifica-chirurgica-porta-i-byte-dellutente) | 23. Cosa le decisioni chiuse costano | kernel | **P1** |
| **§23.15** | [La rete che regge i panici non ha un presidio, ha una nota](roadmap/23-cosa-costano-le-decisioni-chiuse.md#2315-la-rete-che-regge-i-panici-non-ha-un-presidio-ha-una-nota) | 23. Cosa le decisioni chiuse costano | presidi | **P2** |
| **§23.16** | [Su Windows un hardlink si stacca in silenzio](roadmap/23-cosa-costano-le-decisioni-chiuse.md#2316-su-windows-un-hardlink-si-stacca-in-silenzio) | 23. Cosa le decisioni chiuse costano | kernel | **P2** |

## Gli allegati

- [Le voci a leva più alta](roadmap/leva.md) — non *quando* prendere una voce ma
  **quali contano di più**: una voce che rende una capacità *inesprimibile* sta
  sopra una che la rende stretta.
- [Dove il contratto si strozza](roadmap/strozzature.md) — l'indice inverso: una
  riga per famiglia di FEATURES, con cosa servirebbe e cosa lo impedisce oggi.
- [Corrispondenza fra la numerazione vecchia e questa](roadmap/numerazione.md) —
  i commit e i commenti nel codice nominano i numeri di prima della
  riorganizzazione; lì si traducono.
- [I verbali delle decisioni chiuse](decisions/README.md) — **centouno** [conta: verbali],
  uno per file. Diceva «cinquantasette» quando erano cinquantanove, e il comando
  che lo ricava era già scritto qui accanto senza che nessuno lo eseguisse: dalla
  [0072](decisions/0072-un-numero-si-scrive-accanto-a-come-si-ricava.md) lo esegue
  la CI. Non stanno qui perché questo è l'elenco di ciò che **resta da
  fare**.
