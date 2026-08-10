# Roadmap infrastrutturale — reggere il peso di FEATURES.md

Torna a [PIANO.md](PIANO.md). Questo documento chiede una cosa sola:
**[FEATURES.md](FEATURES.md) elenca ~3000 voci — quali pezzi di infrastruttura
mancano perché quelle voci si possano costruire senza riscrivere il kernel, il
contratto e la shell ogni volta?**

Dal 2026-08-10 quella domanda ha un secondo piano di lettura: otto file di
[microfeature](microfeatures/) scompongono dodici sezioni di FEATURES.md in
**424 gesti** atomici — un tasto, un clic, un trascinamento per riga. La
domanda non cambia; cambia la **grana** a cui la si può misurare, ed è da
quella misura che è nata la
[seduta 26](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md).

Sono uscite 151 voci: novantanove da sette giri sulla stessa domanda, due da una
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
([0069](decisions/0069-cosa-sa-dire-un-abbonamento.md)) — e tre da un
**consuntivo**: la seduta 24, nata rileggendo contro i sorgenti le novantadue
osservazioni che `docs/issues.md` teneva da un audit e che nessuno aveva mai
lavorato — e **sette** da una **rilettura**: la
[seduta 25](roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md), che
non ha cercato pezzi mancanti del piano ma ha rimisurato contro i sorgenti del
2026-08-07 le osservazioni che questo repo si portava avanti di giro in giro, e
le ha **smentite più spesso di quanto le abbia confermate** — e **otto** da una
**misura fra due elenchi**: la
[seduta 26](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md), che ha messo
i 424 gesti di [microfeatures/](microfeatures/) contro i sorgenti di oggi e non
ha cercato ciò che manca all'app — quello lo elenca FEATURES.md — ma i punti in
cui **un gesto che l'app compie non ha nessun dato che lo dichiari**.
Centoquarantuno
sono chiuse, e i loro verbali stanno in
[decisions/](decisions/README.md); le voci ancora aperte sono
**otto** [conta: voci-aperte], e questo file resta il loro **indice** e il
consuntivo di come sono finite.

Da quello stesso consuntivo viene la **terza specie** che questo file conta: i
[difetti misurati](#i-difetti-misurati), che non sono voci e non sono caselle.

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
al contratto per permetterlo si calcola. Le altre venticinque sedute descrivono
un debito, la [21](roadmap/21-la-ricerca-predefinita.md) descrive una promessa.

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

E una **dodicesima**, che non guarda un elenco solo ma **due elenchi alla stessa
grana**. Le prime undici strade partono tutte da un testo — una domanda, un
verbale, un audit, un «resta fuori» — e lo mettono contro il codice. Questa mette
contro il codice un **elenco di gesti**: le otto sezioni di
[microfeatures/](microfeatures/) scompongono FEATURES.md in 424 righe che dicono
ciascuna una cosa sola e verificabile — *questo tasto fa questo*, *questo
trascinamento sposta quello* — e a quella grana la domanda cambia forma. Non è
più «che pezzo di infrastruttura manca», che è la domanda del piano ed è finita;
è «**questo gesto, chi lo dichiara?**». La differenza è che un gesto che l'app
già compie non compare in nessun elenco di cose mancanti, e quindi nessuna delle
undici strade lo può trovare: funziona, e proprio per questo è invisibile. Le
otto voci della [seduta 26](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md)
sono tutte di questa forma, e la regola che se ne ricava è che **un elenco più
fine non produce più voci dello stesso tipo: ne produce di un tipo che prima non
si vedeva**.

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
| **15** | [Il disco: storage, durabilità, politiche](roadmap/15-il-disco.md) | il supporto, e le politiche di cosa ci finisce sopra | — | 3 |
| **16** | [I crate, l'SDK, i banchi di prova](roadmap/16-crate-sdk-banchi-di-prova.md) | **chiusa** — i banchi e i confini fra crate, **prima** di ciò che li moltiplica; l'ultima voce è andata via lasciando la casella che una condizione tiene fuori | — | 2 |
| **17** | [I presidi che restano](roadmap/17-presidi-che-restano.md) | **chiusa** — senza precedenze e senza scadenza: il criterio è se il costo cresce con l'attesa, e su una voce ha deciso in tre pezzi invece che in due | — | 2 |
| **18** | [L'editor e la tastiera, e ciò che resta della shell](roadmap/18-editor-e-tastiera.md) | **chiusa** — definita per esclusione: ciò che resta della shell e non appartiene a nessuna delle sedute sopra, code delle sedute 1-4 comprese | — | 4 |
| **19** | [Debito riportato dal quarto audit](roadmap/19-debito-quarto-audit.md) | nessuna voce propria: rimandi ai quattro giri di audit, e il lavoro sta nelle sedute che li hanno assorbiti | — | 2 |
| **20** | [Quando qualcosa va storto, chi lo dice e a chi](roadmap/20-quando-qualcosa-va-storto.md) | **chiusa** — lo stesso percorso interrotto in più punti: chi non può dirlo, chi lo butta via, chi non ha dove scriverlo | — | — |
| **21** | [La ricerca predefinita, e cosa le manca per esserlo](roadmap/21-la-ricerca-predefinita.md) | la ricerca è built-in e di classe *omnisearch*: qui sta la distanza fra quella frase e il repo | — | — |
| **22** | [Cosa sa dire un abbonamento](roadmap/22-cosa-sa-dire-un-abbonamento.md) | le cose che un abbonamento non sa dire — e il cappello che le teneva insieme si è rivelato sbagliato due volte su tre | — | 2 |
| **23** | [Cosa le decisioni chiuse costano a chi usa Fub](roadmap/23-cosa-costano-le-decisioni-chiuse.md) | **chiusa** — prezzi dichiarati da un verbale, ognuno in una riga, che nessun elenco ha poi sommato | — | 3 |
| **24** | [Tre firme che il freeze rende definitive](roadmap/24-tre-firme-che-il-freeze-rende-definitive.md) | **chiusa** — tre voci aperte perché toccavano una firma, e su due delle tre quel criterio non reggeva | — | — |
| **25** | [Sette scelte che il codice ha preso senza dirlo](roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md) | **chiusa** — sette punti in cui il codice ha già preso una posizione senza che nessuno la scegliesse, e in sei la risposta era già scritta altrove nel repo: [0135](decisions/0135-una-rinomina-che-atterra-su-una-nota-viva.md), [0136](decisions/0136-una-regola-di-identita-di-un-nome-si-dichiara.md), [0137](decisions/0137-una-scrittura-su-disco-dentro-un-comando-ipc-si-accoda-nella-shell.md), [0138](decisions/0138-una-finestra-di-220-caratteri-attorno-al-link.md), [0139](decisions/0139-un-guasto-dell-avvio-si-tira-non-si-spinge.md), [0140](decisions/0140-dove-stanno-i-byte-di-un-kind-di-terzi.md), [0141](decisions/0141-la-prima-fotografia-di-un-vault-esce-dalla-fase-1.md) | — | 2 |
| **26** | [Otto gesti che l'app fa e nessuno può dichiarare](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md) | otto gesti che l'app compie e che **nessun dato dichiara**: in tutti e otto la mossa che li renderebbe dichiarabili il repo l'ha già fatta accanto, su un problema confinante | 8 | — |

## Le voci

**Otto** [conta: voci-aperte], tutte della
[seduta 26](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md), aperte il
2026-08-10. La cosa da dire subito è che **la prima domanda di questo file non è
cambiata, ed è tornata a produrre voci**: a cambiare è stata la grana a cui la si
misura. Finché l'elenco a destra era FEATURES.md, la domanda trovava pezzi di
infrastruttura mancanti, e ha smesso di trovarne. Con gli otto file di
[microfeatures/](microfeatures/) l'elenco a destra è fatto di **424 gesti**
singoli, e alla grana del gesto salta fuori una specie che prima non si poteva
vedere: non ciò che manca, ma ciò che **c'è e nessun dato dichiara** — un tasto
premuto che nessun comando nomina, una superficie che si disegna e non si sa a
che livello sta, un rilascio che sposta un file senza che nessuno abbia
dichiarato il bersaglio. Sette delle otto sono di **contratto** e una di
**shell**; una sola è **P0**, la §26.6, e come la §25.1 **non è una firma** — ma
per una ragione diversa: non è un dato che si perde, è un permesso la cui
finestra si chiude col primo manifest di terzi, quindi **prima** del freeze e non
con lui. Le otto si tengono anche per una seconda proprietà, ed è quella che le
rende decidibili in una volta sola: in tutte e otto **la mossa che le
dichiarerebbe questo repo l'ha già fatta accanto**, su un problema confinante e a
verbale — così nessuna delle otto discute *se* si dichiara, ma solo *dove*.

Le ultime prima di queste erano della
[seduta 25](roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md), che
ne aveva aperte sette e le ha chiuse tutte e sette.
**Non hanno riaperto la roadmap infrastrutturale di M4, che resta finita**:
nessuna era un pezzo che manca al piano, e la prova è da dove sono venute. Non sono uscite cercando cosa serva per costruire FEATURES.md
— quella domanda ha finito di produrre voci — ma da una **rilettura** che ha
rimisurato ciò che il repo si portava avanti, e sono dello stesso tipo: una
**scelta di prodotto o di contratto** che il codice ha già preso scrivendosi,
e che nessuno ha mai posto come domanda. L'unica P0 era la §25.1, e **non era
una firma**: era una perdita di dati, quindi non scadeva col freeze e non è
per questo che stava in cima. L'ha
chiusa la [0135](decisions/0135-una-rinomina-che-atterra-su-una-nota-viva.md),
che di quella voce prende la forma (a) e lascia la (b) scritta e aperta. La
seconda a cadere è stata la §25.2, con la
[0136](decisions/0136-una-regola-di-identita-di-un-nome-si-dichiara.md), ed è la
voce che meglio mostra da dove viene questa seduta: la sua premessa — che
quarantaquattro regole per la stessa domanda siano una duplicazione da unificare
— era **falsa**, e a dirlo erano quattro verbali già scritti. La terza è stata
la §25.6, con la
[0137](decisions/0137-una-scrittura-su-disco-dentro-un-comando-ipc-si-accoda-nella-shell.md):
la sua premessa sui due chiamanti di `scriviStato` era falsa — sono **cinque**,
in tre moduli, con quattro chiavi — ed è proprio quel fatto che ha deciso dove
sta la coda: nel posto che tutti i chiamanti attraversano, non in `store.ts`. La
quarta è stata la §25.4, con la
[0138](decisions/0138-una-finestra-di-220-caratteri-attorno-al-link.md): il
contesto di un backlink è una finestra di 220 caratteri attorno al link, la
regola sta in `fub-abi::rules::snippet` con la costante della ricerca migrata
in un posto solo, e con lei si chiude il difetto `0110` — che non diceva tre
copie ma due copie e una move, e la chiusura è «vera e trascurabile, detta coi
numeri»: 969 KB invece di 54 MB. La
quinta è stata la §25.5, con la
[0139](decisions/0139-un-guasto-dell-avvio-si-tira-non-si-spinge.md): la
cartella di configurazione che non si può scrivere — o non c'è — si dice una
volta per sessione su un `Event::Trouble` di severità `Warning`, e la porta è
un **tiraggio** che la shell chiede appena il router è in piedi, perché una
spinta all'avvio sarebbe emessa nel vuoto: il ponte nasce solo al primo vault
aperto. La sesta è stata la §25.7, con la
[0140](decisions/0140-dove-stanno-i-byte-di-un-kind-di-terzi.md): la chiave del
carico di un `kind` di terzi è `source`, e si **dichiara** in
`fub-abi::rules::carichi` invece di essere campionata a tre chiavi cablate — la
voce lascia aperta la sola forma (a), un campo `carichi` nel WIT, che resta come
casella. L'ultima a cadere è stata la §25.3, con la
[0141](decisions/0141-la-prima-fotografia-di-un-vault-esce-dalla-fase-1.md): la
prima fotografia di un vault esce dalla fase 1 e la chiama il runner prima della
prima fetta, la finestra scoperta resta **zero**, e la premessa che è caduta è la
forma stessa che era stata approvata — un host per-capacità chiudeva un ciclo di
lock, e la prova l'ha ridotta alla passata sotto l'esclusivo.

Il criterio della scadenza ha già mostrato una volta di non bastare. La
[seduta 24](roadmap/24-tre-firme-che-il-freeze-rende-definitive.md) aveva aperto
tre voci con quel criterio solo — **toccano una firma**, e una firma scade col
freeze — e **su due delle tre non reggeva**: a scoprirlo è stato ogni volta il
giro che le ha chiuse, mai chi le aveva scritte. La §24.1
([0130](decisions/0130-ogni-tipo-del-contratto-si-vede-dalla-radice.md)) perché
un `pub use` è additivo — a scadere era il frattempo — e la §24.2
([0131](decisions/0131-tre-stati-e-la-firma-che-ne-diceva-due.md)) perché
`enabled` è un metodo Rust di comodo che al confine WIT non esiste. Solo la
§24.3 ([0132](decisions/0132-un-rifiuto-non-e-una-frase.md)) scadeva davvero, e
si è vista perché la linea di base congelata si è dovuta ritagliare. **Ciò che
la seduta lascia è quel due su tre**: che una firma scada non si deduce
leggendo la voce, si misura andando a vedere se attraversa il confine — e
finché la misura non è fatta, «P0» dice quanto si è preoccupato chi scriveva,
non quanto costa aspettare. Il numero di ogni voce resta quello con
cui la nomina il resto del repo, e si ritrova in
[decisions/](decisions/README.md) e nella
[corrispondenza](roadmap/numerazione.md).

**Se una voce è in questa tabella, è aperta.** Non ci sono spunte da leggere:
una voce chiusa **sparisce** — dalla tabella, dal conteggio della sua seduta e
dal file della seduta — e il suo verbale va in
[decisions/](decisions/README.md). L'assenza è il segnale, e non può mentire:
una casella spuntata resta una promessa scritta da qualcuno, una riga che non
c'è più è stata tolta da chi ha spostato il verbale. Dentro il file di una
seduta le caselle ci sono, e dicono a che punto è la singola voce.

**Ma una voce chiusa può lasciare una casella, e quella casella è di un'altra
specie.** La colonna *Voci* conta le voci **aperte**, e la sua somma fa
**otto** [conta: voci-aperte] come deve. Il residuo di una voce **chiusa** non
ci rientra, e per molto tempo non ha avuto dove essere contato: è il modo in cui
la riga della seduta 14 ha detto «due caselle» mentre il suo file ne aveva tre,
e la 19 non ha detto niente avendone tre. Adesso ha una colonna sua —
*Caselle* — e le due somme sono separate perché contano cose separate: una voce
aperta è lavoro che qualcuno deve ancora **decidere**, una casella residua è
lavoro già deciso che qualcuno deve ancora **fare**. Sommarle avrebbe dato un
numero che non risponde a nessuna domanda.

**E poi c'è una terza specie, che ha voluto un terzo conto per lo stesso
argomento.** Un [difetto misurato](#i-difetti-misurati) non chiede una decisione
— quindi non è una voce — e non è il residuo di un verbale — quindi non è una
casella: è lavoro che nessuno ha ancora deciso di fare *e* che non ha niente da
decidere. La forma di questo file era già pronta a riceverlo, e la prova è che
non è servito inventare un criterio nuovo: è bastato rileggere quello con cui
*Caselle* si era staccata da *Voci*.

La colonna *Voci* somma **otto** [conta: voci-aperte], e stanno tutte in **una
riga sola**: le prime venticinque sedute sono a zero, la ventiseiesima porta le
otto. Questa distribuzione va letta insieme a quella del giorno prima, perché lo
zero di allora diceva qualcosa che adesso si vede meglio. Il 2026-08-09 la
tabella è stata **vuota**, per la prima e finora unica volta: tutte e
venticinque le sedute a zero. Ci erano arrivate una per volta — l'ultima delle
ventiquattro è stata la 24, con la
[0132](decisions/0132-un-rifiuto-non-e-una-frase.md), prima di lei la 16, con la
[0116](decisions/0116-lo-scope-di-una-chiave-segue-la-vita-di-chi-la-dichiara.md),
e la venticinquesima il giorno dello zero — e ogni volta lo zero è stato il
segnale che **una domanda** aveva finito di produrre voci: quello delle
ventiquattro diceva che la roadmap infrastrutturale è finita, quello della 25 che
aveva finito anche la **rilettura**, che era una domanda diversa. Il giorno dopo
ne sono uscite otto, e non è una smentita di nessuno dei due: le otto non vengono
da nessuna delle due domande, vengono da un **elenco più fine** che prima non
c'era. Che è esattamente ciò che lo zero significava e non di più — *quella*
domanda è finita, non *le* domande. Restano anche le caselle, che non sono voci:
lavoro già deciso da fare.
Della 20 non resta nemmeno una casella: si è chiusa con la
[0111](decisions/0111-il-budget-e-un-tetto-sul-lavoro.md), l'ultima delle cinque
voci nate dalla domanda «cosa fallisce senza produrre nessun segnale». La 23 era
diciassette voci, la più grande mai aperta qui dentro, e la sua riga resta con
la sola colonna *Caselle* — un consuntivo invece di un elenco di lavoro. Vale la pena scrivere com'è finita, perché era anche la più squilibrata:
la sua forma — *prezzi dichiarati e mai risommati* — attraversa tutte le altre
sedute invece di stare accanto a loro, e questo è ciò che l'ha resa chiudibile
una voce per volta senza mai aspettare le altre. Il taglio che a un certo punto
sembrava servire — spezzarla per **lente**, le §23.9–§23.17 rispondono a una
domanda più stretta delle prime otto — non è mai servito.

Le caselle residue oggi sono **venticinque**, e stanno in venti posti:
la [§11.2](roadmap/11-impostazioni-e-i-tre-stati.md) (una: i workspace salvati
con un nome — la casa è decisa, il formato aspetta di vedere assetti veri),
[§14.1](roadmap/14-entry-cartelle-lista.md#141-il-vault-non-è-solo-documenti)
(tre: l'impronta degli allegati, la politica della cartella allegati, le
derivate),
[§15.4](roadmap/15-il-disco.md#154-i-dati-persistiti-non-hanno-né-una-mappa-né-una-classe)
(una: l'implementazione additiva delle due radici), la
[§16.3](roadmap/16-crate-sdk-banchi-di-prova.md#163-un-crate-per-bundle-di-feature)
(una: lo **split di `fub-features` in un crate per bundle** — l'unica casella di
questo elenco che non aspetta qualcuno ma una **condizione**, il primo import fra
due moduli di feature che non sia un link di documentazione, e l'unica che ha un
guardiano che la valuta invece di una riga che la ricorda
([0073](decisions/0073-una-condizione-che-nessuno-valuta.md))), il
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
dell'host, fino a un minuto che l'utente **vede**), la
[§17.3](roadmap/17-presidi-che-restano.md#173-osservabilità) (una: la porta da
cui si è entrati non arriva nell'evento — la
[0105](decisions/0105-una-porta-si-nomina-e-un-presupposto-si-compila.md) ha
fatto delle tredici porte un dato, `Gate`, ma nell'`Event::Trouble` della
[0052](decisions/0052-cio-che-va-storto-e-un-evento.md) arriva ancora solo la
frase; portarcela dentro farebbe **raggruppare** al centro notifiche e
**contare** a chi legge il registro, ed è un campo in un tipo del contratto,
cioè una decisione sulla firma che quella voce non chiedeva) e la
[§7.1](roadmap/07-il-confine.md#la-casella-rimasta) (una, e **ristretta**: le
allowlist dei permessi hanno un **parametro**, e fino alla
[0097](decisions/0097-un-recinto-che-vale-anche-quando-nessuno-guarda.md) non ne
leggeva nessuno. Adesso `fub:network` sì, quindi ciò che resta sono i **prefissi
di path** di `read-vault`/`write-vault` — un plugin ristretto a `Progetti/` legge
ancora tutto — e restano una casella a sé perché un host e un path non si
confrontano allo stesso modo, che è la ragione per cui `Policy::denies_host` è
stretta invece di generica; la [0021](decisions/0021-il-confine.md) l'aveva
lasciata in attesa del §15.5, «la politica dei path in un modulo solo», che la
[0058](decisions/0058-un-nome-che-nasce.md) ha chiuso) e la
[§23.7](roadmap/23-cosa-costano-le-decisioni-chiuse.md#237-una-data-scritta-come-la-scrive-lutente-non-è-una-data-e-non-cè-modo-di-dirlo)
(una: i **nomi dei mesi** — `5 luglio 2026` non è un ordine di campi ma una
tabella per lingua, e le tabelle non ci sono; leggerli in due lingue vorrebbe
dire tacere di più proprio sui vault più lontani, quindi la casella aspetta un
secondo cliente per quelle tabelle) e la
[§15.6](roadmap/15-il-disco.md#156-la-politica-di-esclusione-è-una-costante-di-compilazione)
(due: leggere il `.gitignore` — la
[0110](decisions/0110-la-struttura-non-e-una-preferenza.md) ha fatto della
politica di esclusione un dato per-vault, e un **file** come sorgente di quel
dato è un'altra cosa: ha una sintassi propria — pattern, non nomi — una
precedenza propria e un proprietario che non è Fub. La casella ha il posto dove
atterrare, un terzo modo di costruire un `IgnorePolicy`, e non ha la forma; e
un modo di cambiare le cartelle escluse **dall'app**, che oggi non c'è — la
shell disegna le liste in sola lettura e chi le cambia è il comando che le
scrive, ma per questa chiave quel comando non esiste, e non può essere un
comando qualunque perché la chiave non è `program_writable` di proposito) e la
[§17.1](roadmap/17-presidi-che-restano.md#171-corpus-fuzzing-prestazioni) (una:
le otto famiglie dell'indice del kernel che continuano a costruire tutto per
mostrarne venti — la
[0113](decisions/0113-il-banco-conta-le-operazioni.md) ha portato al banco la
sola anagrafe, e delle altre ne ha misurata una: `Folders` costa otto
allocazioni per nota, e non è un caso di ritaglio sbagliato — il prezzo sta
*dentro* la costruzione di ogni riga che si tiene, non fuori dalla finestra.
Per quelle che **ordinano** o **aggregano** il ritaglio in memoria resta la
risposta giusta; ciò che manca a tutte è la riga di banco che dica quanto
costano) e la
[§2.9](roadmap/18-editor-e-tastiera.md#29-prestazioni-della-ui) (due: la
**finestra scorrevole** vera, e con lei il gesto «mostra le altre» — la
[0114](decisions/0114-una-finestra-non-si-omette.md) ha fatto la metà che sta
*prima* del layout, cioè quanto attraversa il ponte e quanti elementi nascono, e
la riga che dice quante voci sono rimaste fuori non è attivabile perché il gesto
che la aprirebbe non c'è; disegnare *ciò che si vede* vuole il layout, che in
`happy-dom` non esiste — è il buco n. 5 della
[0112](decisions/0112-un-e2e-contro-un-host-finto-prova-il-cablaggio.md) — e
scriverlo qui vorrebbe dire scrivere codice che nessun presidio di questo repo
può guardare. E il **rendering incrementale dell'anteprima**, che è la casella
con l'indirizzo più preciso e il cliente più incerto: la precondizione è quella
della [0018](decisions/0018-chi-vede-il-modello-parsato.md) — una chiave di
`RenderOptions` che faccia scrivere nell'HTML da quale byte viene un elemento —
e non è di strato shell; ma la ragione per cui la casella resta ferma è
un'altra, ed è misurata: **il suo primo cliente non esiste**. `updatePreview`
gira quando cambia il documento del riquadro e quando si entra in Lettura, mai a
ogni battuta, perché `PaneMode` è un enum di modalità esclusive e ciò che si
rende è il sorgente *salvato* — rendere incrementalmente vuol dire non rifare la
parte che non è cambiata, e lì sono cambiate tutte. Il cliente vero è
un'anteprima affiancata che segue chi scrive, e quella superficie non c'è) e la
[§4.4](roadmap/18-editor-e-tastiera.md#44-due-parser-per-la-stessa-sintassi)
(una: il **canale a runtime** che porti la sintassi dichiarata alla superficie di
scrittura. La [0115](decisions/0115-la-verita-e-la-dichiarazione.md) ha fatto
leggere alla shell la dichiarazione invece di riscriverla, ma il file che gliela
porta è **generato alla compilazione**: conosce le regole del core e non quelle
di un plugin di terzi, che si registra a caldo. La forma della rotta è già
decisa — una variante di `IndexQuery`, perché un elenco è dati e i dati hanno un
canale solo ([0013](decisions/0013-elenco-delle-capacita.md)) — e la risposta
esiste già, `Workspace::syntax_forms`; quel che manca è che chi serve il canale
dati possa arrivarci, e oggi il `SyntaxRegistry` vive sotto il prestito
esclusivo di chi scrive e viene attraversato a ogni parse, quindi condividerlo è
una decisione sulla concorrenza del kernel
([0024](decisions/0024-chi-legge-non-aspetta-chi-legge.md)) e non un pezzo di
quella voce) e la
[§25.1](roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md#251-una-rinomina-che-atterra-su-una-nota-viva)
(una: la **forma (b)** — migrare senza mai schiacciare, invece di degradare a
rimozione più aggiunta. La [0135](decisions/0135-una-rinomina-che-atterra-su-una-nota-viva.md)
ha preso la (a), che toglie il 100% della perdita misurata e non obbliga a
decidere niente sulla fusione; la (b) resta, e ha un modello già scritto a cui
guardare — la politica di collisione che sta in `versioning.rs` accanto a
`VersionStore::rename`, che le due storie le unisce in ordine di tempo. Ma le
politiche da scrivere sono **tre**, una per canale, e non sono la stessa: due
bozze non salvate non si fondono senza inventare un testo che nessuno ha
scritto. Nessuna è urgente finché la guardia impedisce la perdita) e la
[§25.7](roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md#257-dove-stanno-i-byte-di-un-kind-di-terzi)
(una: la **forma (a)** — un campo `carichi` in fondo a `syntax-rule-spec`, che
la [0140](decisions/0140-dove-stanno-i-byte-di-un-kind-di-terzi.md) ha lasciato
aperta prendendo la (b), cioè dichiarando che la chiave è `source` invece di
spendere un tipo nel contratto. La casella ha un innesco scritto, e non una
data: **il primo `kind` di terzi che deve dichiarare il proprio carico**. Finché
non esiste, la (a) costerebbe un tipo additivo per sempre — il prezzo che la
[0002](decisions/0002-additivita-del-contratto.md) rende caro — per un caso che
nessuno esercita).
Non diventano voci
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
| **§26.1** | [Un accordo ha un contesto, o non ce l'ha](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md#261-un-accordo-ha-un-contesto-o-non-ce-lha) | 26. Otto gesti che l'app fa e nessuno può dichiarare | contratto | **P1** |
| **§26.2** | [Cinque registri di tastiera, e il presidio ne guarda due](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md#262-cinque-registri-di-tastiera-e-il-presidio-ne-guarda-due) | 26. Otto gesti che l'app fa e nessuno può dichiarare | shell | **P1** |
| **§26.3** | [La grammatica di un accordo non sta nel contratto](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md#263-la-grammatica-di-un-accordo-non-sta-nel-contratto) | 26. Otto gesti che l'app fa e nessuno può dichiarare | contratto | **P2** |
| **§26.4** | [Il livello di una superficie non è un dato](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md#264-il-livello-di-una-superficie-non-è-un-dato) | 26. Otto gesti che l'app fa e nessuno può dichiarare | contratto | **P1** |
| **§26.5** | [Il menu contestuale: la superficie c'è, il bersaglio del clic no](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md#265-il-menu-contestuale-la-superficie-cè-il-bersaglio-del-clic-no) | 26. Otto gesti che l'app fa e nessuno può dichiarare | contratto | **P1** |
| **§26.6** | [Gli appunti sono una spunta sola, e le domande sono due](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md#266-gli-appunti-sono-una-spunta-sola-e-le-domande-sono-due) | 26. Otto gesti che l'app fa e nessuno può dichiarare | contratto | **P0** |
| **§26.7** | [Un rilascio si consegna, un bersaglio non si dichiara](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md#267-un-rilascio-si-consegna-un-bersaglio-non-si-dichiara) | 26. Otto gesti che l'app fa e nessuno può dichiarare | contratto | **P1** |
| **§26.8** | [La terza pila: l'annulla dentro una view che non è del core](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md#268-la-terza-pila-lannulla-dentro-una-view-che-non-è-del-core) | 26. Otto gesti che l'app fa e nessuno può dichiarare | contratto | **P2** |

**La tabella è stata vuota un giorno solo, ed è servito a qualcosa.** Dal
2026-08-09 — quando la §25.3 ne è uscita con la
[0141](decisions/0141-la-prima-fotografia-di-un-vault-esce-dalla-fase-1.md), e
non restava nessuna riga — al 2026-08-10, quando ci sono entrate le otto della
seduta 26. Il conto era nato per poter reggere proprio quel giorno: `voci-aperte`
porta un `|| true` in coda **apposta**, perché `grep -c` esce 1 quando non trova
niente e a tabella vuota il registro direbbe «non ha contato» invece di «zero».
Ha fatto il suo lavoro, e la riga resta dov'è: la tabella tornerà vuota, e non
c'è ragione di riscoprire la stessa cosa una seconda volta.

L'altra metà di quella dichiarazione vale adesso, nel verso opposto: **se una
voce è in questa tabella, è aperta** — le otto qui sopra non hanno nessuno
stato, nessuna spunta e nessuna percentuale, e l'unico modo di chiuderne una è
**toglierla di qui** e mettere il suo verbale in
[decisions/](decisions/README.md).

## I difetti misurati

**Ottantacinque** [conta: difetti-aperti], e non sono voci. Nessuno chiede una
decisione — è il criterio che li tiene fuori dalla tabella qui sopra — e nessuno
è il residuo di un verbale, che è ciò che li tiene fuori dalla colonna *Caselle*.
Sono la **terza specie**, e ha voluto un conto suo per la stessa ragione per cui
*Caselle* è nata separata da *Voci*: sommarli avrebbe dato un numero che non
risponde a nessuna domanda.

**Da dove vengono.** Da un audit del 2026-07-31 che aveva prodotto novantadue
osservazioni in `docs/issues.md`, un file che nessuno ha mai lavorato e in cui
settantuno righe rimandavano a voci **mai committate** — il rimando cieco che
[`roadmap/numerazione.md`](roadmap/numerazione.md) esiste per impedire, arrivato
dal lato che quella disciplina non copre. Rilette una per una contro i sorgenti
del 2026-08-06: sedici erano già chiuse, una era **falsa il giorno stesso**
(`note.task.toggle` che «non spunta mai un task» — c'è un banco che prova il
contrario, `commands_e2e.rs:688`, e la premessa sul parser era sbagliata), cinque
non erano difetti ma comportamenti decisi. Settanta reggevano: **tre** sono
diventate la [seduta 24](roadmap/24-tre-firme-che-il-freeze-rende-definitive.md)
perché toccano una firma, queste sessantasette sono il resto. `issues.md` non
esiste più: il file si è **svuotato**, non è stato tolto.

**Il secondo blocco, `0093` in su**, viene da un'altra parte e per questo
comincia dove l'altro finisce: diciassette misure che vivevano in un file-diario
non tracciato, riscritto a ogni giro e che **nessun presidio guardava**. Una
misura che vive in due posti invecchia nel posto che nessuno presidia, ed è
l'unica ragione per cui sono qui. Rimisurate una per una contro i sorgenti del
2026-08-06 prima di entrare: nessuna era scaduta, e una diciottesima è rimasta
fuori perché non è un difetto ma una firma ([§24](roadmap/24-tre-firme-che-il-freeze-rende-definitive.md)
è il posto di quelle).

**Il terzo blocco, `0110`–`0145`**, è il giro del 2026-08-07, e non viene da un
file: viene dalla stessa **rilettura** che ha aperto la
[seduta 25](roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md).
Trentasei righe, e il modo in cui sono nate è la parte che conta. Venticinque
sono uscite rimisurando contro i sorgenti di oggi le osservazioni che i giri
precedenti si portavano avanti: **tre erano false** e **dieci dicevano una cosa
diversa** da quella che si osserva — non più piccola, diversa, con un altro
soggetto o un altro meccanismo — e **due difetti veri sono stati trovati accanto
a una riga falsa**, cercando la prova che la smentiva. Le altre undici sono il
residuo delle sette voci: ciò che, dentro ognuna, non ha niente da decidere. Una
ventiseiesima riga era pronta e **non è stata scritta**, perché *dove* debba
stare la prima fotografia di un vault è precisamente la
[§25.3](roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md#253-dove-sta-la-prima-fotografia-di-un-vault),
e un difetto la cui riparazione dipende da una decisione non è un difetto; il suo
numero, `0115`, è andato a un'altra misura. E c'è una cosa da sapere prima di
leggerli: **i numeri di questo elenco e quelli dei
[verbali](decisions/README.md) hanno finito lo spazio libero e si sovrappongono**
— `0115` è **sia** una decisione **sia** un difetto, e non sono la stessa cosa.
Chi ne cita uno dice quale delle due.

**Il quarto blocco, `0148`–`0150`**, è del 2026-08-10 e viene dalla stessa
misura che ha aperto la
[seduta 26](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md): i 424 gesti di
[microfeatures/](microfeatures/) contro i sorgenti di oggi. Sono il residuo di
quella misura — ciò che ha trovato e che **non ha niente da decidere**, quindi
non è diventato una voce. Una quarta riga era pronta e **non è stata scritta**:
`Mod-f` è dichiarato due volte, da `shell.doc.search` e dalla ricerca di
CodeMirror, ma *chi dei due debba tenerlo* è precisamente la
[§26.1](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md#261-un-accordo-ha-un-contesto-o-non-ce-lha),
e vale la stessa regola con cui la §25.3 aveva tenuto fuori il suo residuo: **un
difetto la cui riparazione dipende da una decisione non è un difetto**.

**Il quinto blocco, `0151`–`0222`**, è del 2026-08-10 e non viene da una
rilettura dei documenti ma da una **battuta di caccia sui sorgenti**: sedici
letture in parallelo, una per fetta — il supporto, il ciclo di vita del vault, il
registro, bozze e docdata, le impostazioni, l'organizzazione, le scritture e le
mutazioni del workspace, gli indici persistiti, i log del kernel, il recinto
dell'host, il watcher, il runner di sessione, la shell, il serializzatore
Markdown, il contratto — con una domanda sola: *dove si possono perdere byte
dell'utente, o dove il disco può divergere dalla memoria senza che nessuno lo
dica?* Sono uscite centodiciannove osservazioni, e qui ce n'è meno di due terzi.
Il resto è caduto, e per ragioni che vale la pena separare.

**Otto erano già riparate** nell'albero di lavoro dello stesso giorno — la
rinomina di solo caso del docdata, il `workspace.json` mancante che ripartiva
dal `default`, il parse dopo la rename in `rename_document_in_batch`, il recinto
di `.fub/`/`.trash/` sui `DocId` (che era la stessa osservazione ripetuta da tre
fette), la conferma del cestino che chiudeva il documento sbagliato, gli escape
persi in serializzazione, il titolo di un callout. **Una era falsa**: l'àncora
duplicata quando un blocco finisce con un inline non testuale non si riproduce.
**Diciotto erano doppioni** fra fette confinanti, e qui sono una riga sola —
chi conta le righe non conta le osservazioni.

**E venti non sono state scritte**, per la regola con cui la §25.3 e la §26.1
avevano già tenuto fuori i loro residui: *un difetto la cui riparazione dipende
da una decisione non è un difetto*. Sono tre grappoli, e si nominano qui perché
non vadano persi. Il primo: `Journal::append` passa da `O_APPEND` senza lock
mentre `pota` e `clear` passano da `update`, quindi una riga appesa da un altro
processo cade nella riscrittura — e la [0067](decisions/0067-il-registro-di-cio-che-e-successo.md)
**rifiuta a verbale** un lock per riga, quindi chi la ripara emenda un verbale.
Il secondo, il più largo: `std::fs::rename` **sostituisce la destinazione in
silenzio**, e sotto ci stanno tutte le guardie del repo che controllano e poi
muovono — il cestino che sceglie un candidato libero, la rinomina di documento e
di entry, il restore, `Drafts::migrate`, `create_document`, `free_name`, il
commento di `create_note` che dice «a quel punto è la scrittura a dirlo» e non è
vero. La riparazione è **un'ottava operazione di `VaultStorage`** (una mossa che
non rimpiazza, `renameat2(RENAME_NOREPLACE)` dove c'è e un `create_new` di sonda
dove non c'è), cioè un allargamento del supporto unico: è una voce, non una
riga. Il terzo: il ramo `SulPosto` di `write_con` tronca senza temp+rename per
symlink, hardlink e `NomiDelFile::Ignoto`, e con esso `pota`/`clear` su un
registro collegato — è un **tradeoff già documentato** in `storage.rs`, e
disfarlo significa scegliere fra atomicità e conservazione dell'inode. La stessa
cosa vale per il compare-and-swap di `DescendsFrom`, che fra il confronto della
revisione e la scrittura non ha niente di atomico fra processi.

**Il sesto blocco, `0223`–`0224`**, è dello stesso 2026-08-10 ma di una misura
diversa: non «dove si perdono byte», ma **quante volte la stessa cosa è
scritta**. Sono uscite una sessantina di copie, e quasi tutte non sono difetti —
sono ripetizioni che il compilatore prende, o impalcatura di banchi che costa
noia e non rischio. Due sole hanno la proprietà che rende un difetto un difetto:
**se le copie divergono, nessuno se ne accorge**, e quello che si rompe non è la
comodità di chi legge ma un dato o una promessa. Il resto della misura non è
andato perso: è diventato la regola qui sotto,
[dove va una regola scritta due volte](#dove-va-una-regola-scritta-due-volte),
che serve a impedire che quelle sessanta copie diventino sessanta voci.

La `0223` **è stata riparata lo stesso giorno** e per questo non è più nella
tabella: le due costanti di FNV-1a stanno adesso in un posto solo — il tipo
`Fnv1a` di `fub-abi`, che si mangia a pezzi perché chi impronta un documento non
ha un blocco unico di byte ma una sequenza di campi da separare — e
`Revision::of_bytes`, l'indice di ricerca e lo store delle versioni passano
tutti e tre di lì. L'estrazione da sola però non chiude niente, perché il
difetto non era che le tre copie fossero diverse: erano identiche, ed era il
*gesto che ricomincia* a costare — un quarto posto che vuole un `u64` stabile e
si riscrive le sue due `const`, che in quel momento sono due righe. Quello lo
prende un conto, `una_sola_impronta.rs`, sul modello di
`una_sola_tabella_di_escape.rs`: cammina ogni `.rs` sotto un `src/`, normalizza
via gli `_` e non ammette le due costanti fuori da `edit.rs`. Accanto stanno i
due vettori canonici di FNV-1a scritti a mano (`l_impronta_non_si_muove`), che
sono l'unica cosa che tiene fermo il *valore*: da quando i due archivi passano
dalla stessa funzione, cambiarla non fa più fallire niente per conto suo — ogni
archivio resta coerente con sé stesso — ma rende illeggibile ciò che è già su
disco.

**Il settimo blocco, `0225`–`0226`**, è dello stesso 2026-08-10 e viene
da una domanda fatta a voce: se uno studente al secondo anno di informatica —
non svogliato, appassionato — aprisse `docs/`, capirebbe cosa legge? La misura
dice che il problema non è dove stanno i file: sono 217 tracciati in sette
cartelle, `docs/README.md` è già una mappa con sette porte, e i link sono
presidiati. È che **il glossario definisce le parole del prodotto e non quelle
del metodo**, e sono queste ultime a stare nella prima pagina che uno apre. Non
apre una voce perché non c'è niente da decidere: il glossario esiste, la sua
forma è quella di novantuno voci già scritte, e i termini sono già in uso. La
`0226` è la stessa misura vista dall'altro capo: non le parole che mancano al
lettore, ma la pagina che manca al repo. Come si riparano tutte e due sta scritto
per esteso in [come si semplifica la documentazione](#come-si-semplifica-la-documentazione),
e sta lì e non qui perché sono istruzioni da eseguire, non misure da leggere.

I difetti `0225` e `0226` **sono stati riparati lo stesso giorno** (2026-08-10) e per questo non sono più nella tabella: le undici voci sono state aggiunte al glossario e il file `leggimi-prima.md` è stato creato e inserito negli indici.

Quello che invece **non** è entrato è la domanda grossa — se il dialetto vada
tenuto e basta glossarlo, o se `banco` debba diventare `test` in duemila e
settecento posti. Quella è una decisione: cambia chi è il lettore che il repo si
sceglie, tocca i nomi di due file di roadmap e di alcuni banchi, e i verbali non
si riscrivono. Finché non è presa, questa riparazione è la parte che vale
comunque in tutti e due i casi — anche chi decidesse di tradurre tutto avrebbe
prima bisogno dell'elenco dei termini e del loro significato, che è esattamente
ciò che manca.

**Il numero è quello di `issues.md` e non scala**, per la stessa regola dei `§`:
è citato dai verbali e dai messaggi di commit, e rinumerarlo trasformerebbe ogni
citazione in un rimando cieco. I buchi nella sequenza sono le ventidue righe che
non sono sopravvissute alla rilettura, più quelle riparate dopo essere state
scritte — la `0223` è la prima. Il conto perciò **conta le righe**, e da
`0100` ha voluto un pattern più largo: quello vecchio si fermava a `0099` e
avrebbe dichiarato meno difetti di quanti ce ne sono.

**L'ancora è al simbolo, non alla riga.** Ogni riga porta il posto misurato il
giorno del suo blocco — 2026-08-06 fino alla `0145`, 2026-08-10 da lì in avanti:
i numeri di riga si saranno mossi, il simbolo no. Chi ne prende una
**riconta**, non deduce.

| # | Difetto | Dove | Famiglia |
|---|---|---|---|
| 0112 | l'anagrafe non ha forma incrementale: `EntryStore::open` deserializza l'intera `BTreeMap<DocId, StoredEntry>` e `EntryStore::store` la riserializza e la sostituisce tutta con una `VaultStorage::write`, così ogni apertura paga il vault intero anche quando non è cambiato un file | `fub-kernel` · `entries.rs` `EntryStore::store` | prestazioni |
| 0113 | il prestito esclusivo di `finish_index` copre in fila cinque fasi, tre delle quali toccano il disco — ricostruzione integrale del grafo, riconciliazione degli indici, flush degli indici, ricongiungimento delle rinomine che cammina l'anagrafe persistita, riscrittura integrale di `entries.json` — così un lettore concorrente aspetta la somma di tutte e cinque e non la sola indicizzazione | `fub-kernel` · `workspace.rs` `Workspace::finish_index` | lock e I/O |
| 0115 | risolvere un wikilink scandisce tutta l'anagrafe: `named_entry_in` calcola fino a due `resolution_key` per voce e chiude con un `min_by_key` che non cortocircuita, quindi trovare costa quanto non trovare — 27,8 ms a chiamata su 20.000 voci — e `entry_rewrite_plan` la chiama una volta per ogni link di ogni documento, cioè quarantasei minuti per rinominare un allegato | `fub-kernel` · `index/core.rs` `named_entry_in` | prestazioni |
| 0118 | `DEFAULT_EXCLUDED` è `.obsidian`, `.git`, `node_modules` e non contiene `target`: su un vault che è anche un repo Rust ogni file di `target/` prende un `DocId` ed entra in anagrafe, perché il filtro a valle assegna una specie e non scarta nulla | `fub-kernel` · `ignore.rs` `DEFAULT_EXCLUDED` | regole |
| 0127 | un verbale è immutabile ma il codice che descrive no, e non c'è nessun registro che tenga i due allineati: due verbali — la decisione 0121 sul `<div>` vuoto e su `heading_slug`, la 0062 sull'unico caso di `StderrSink` — affermano di `crates/` cose che a HEAD sono false, i commit che le hanno rese false hanno toccato solo `todo.md`, e chi legge non ha nessun segnale di stare leggendo un fatto scaduto | `docs` · `CONTRIBUTING.md` `Chiudere una decisione` | regole |
| 0130 | due letture che rispondono con dei dati hanno un comando IPC proprio invece di una variante di `IndexQuery`, e siccome `IndexQuery` non ha una variante di resa e l'`HostApi` non ha una capacità di render, un `ViewProvider` non ha nessuna porta per mostrare un documento reso mentre la shell ne ha due | `fub-app` · `lib.rs` `render_preview` / `render_embed` | regole |
| 0140 | quattro regole di identità di un nome non fanno la normalizzazione NFC che `resolution_key` fa — `canonical_tag`, `canonical_anchor`, `heading_slug`, `prefix_len_ci` — così paglia in NFD e ago in NFC non si incontrano in nessuno dei due versi, e `heading_slug` su NFD non diverge soltanto: **cancella** l'accento, perché una `Mn` non è alfanumerica | `fub-abi` · `model.rs` `canonical_tag` (con `canonical_anchor`, `heading_slug`, `occurrences.rs` `prefix_len_ci`) | regole |
| 0141 | «sta dentro questa cartella?» ha tre risposte incompatibili in produzione — `query::within_folder` taglia gli slash finali e ha il ramo su sé stessa, `rules::events::folder_contains` li taglia e non ce l'ha, `transfer::in_folder` taglia entrambi i capi — e il banco di `transfer.rs` asserisce vero ciò che `within_folder` dà falso, mentre la prosa di `traits.rs` scrive che la regola «è una, e due copie divergerebbero sul caso che nessuno prova» | `fub-abi` · `transfer.rs` `in_folder` | regole |
| 0147 | il totale delle voci in testa a questo file (151) non quadra con chiuse + aperte dichiarate (141 + 8), e nessuna voce tolta o assorbita lo spiega — le uniche del repo sono chiuse da un verbale o dichiarate non-voci; un `[conta:]` non può esistere, perché le voci chiuse non hanno criterio meccanico (tre formati di stato nei file di seduta, sedute 1–13/18/19/24 in prosa senza sezioni): se la riga regredisce non la vede nessun conto, e la rimisura è a mano | `docs` · `todo.md` «Sono uscite 151 voci» | regole |
| 0148 | la forma canonica di un accordo è scritta tre volte e le due copie Rust non sono quella che dicono di essere: entrambe si annunciano «come lo normalizza la shell», ma spezzano solo su `-` e ricuciono con `-`, mentre in TypeScript una scorciatoia è una **sequenza** di accordi separati da spazio e la funzione risponde `null` per ciò che questa shell non sa premere — un primo tasto senza modificatori, un modificatore che non esiste. Oggi nessun comando dichiara una sequenza, quindi la divergenza non si vede: il giorno che la dichiara, l'oscuramento per prefisso lo vede solo la shell — `prefissiOscurati` non ha copia di là — e un accordo impremibile passa verde di qua perché la copia Rust normalizza qualunque stringa invece di rifiutarla | `fub-features` · `tests/command_keys.rs` `normalizza` (con la copia gemella in `fub-host` · `tests/shell_keys_mirror.rs`, e il presidio che le usa è `no_two_official_commands_want_the_same_chord`) | regole |
| 0149 | due superfici catturano il fuoco con la stessa `intrappolaFuoco` — la palette (`ui/palette.ts:312`) e la superficie modale delle view (`ui/views.ts:301`) — ma stanno su due piani lontani e nessuno dei due è dichiarato rispetto all'altro: la palette si chiama `.modale` nel suo stesso commento e dipinge a `--z-popover` (70), sotto `#settings-panel` a `--z-dialog` (80) e sotto `#views-modal` a `--z-modal` (90), che si chiama modale anche lui. Chi prende il fuoco non è chi sta sopra, e la regola che dice quale delle due vince non esiste da nessuna parte; nello stesso elenco `--z-overlay` (50) porta un commento che ne spiega il ruolo ed è citato da **zero** regole | `frontend` · `style.css` `.modale` (con `theme/tokens.css` `--z-overlay`) | regole |
| 0150 | la pagina che descrive le superfici dice due numeri scaduti dalla [0079](decisions/0079-il-grafo-esce-dall-overlay.md): «questa shell ne ospita **sette**» e «le tre che restano — area principale, menu, menu contestuale», mentre da quel verbale l'area principale **è** ospitata e le non ospitate «passano da tre a **due**». Chi legge il protocollo per sapere dove può ancorare una view legge il repo di prima della 0079, e nessun conto lo guarda: il numero sta in prosa e non ha un `[conta:]` possibile, perché contare le superfici ospitate non ha criterio meccanico | `docs` · `architecture/ui-protocol.md` «Le superfici: dove una view si ancora» | regole |
| 0151 | il file di lock non viene mai rimosso: `lock_esclusivo` crea `.{nome}.lock` accanto al bersaglio e non lo toglie all'uscita, così un vault accumula un `.lock` per ogni file che ha protetto — impostazioni, organizzazione, anagrafe, `vaults.json` fuori dal vault — e chi guarda la cartella con `show-hidden` vede dei file che nessuno spiega e che nessuna riparazione spazza | `fub-kernel` · `storage.rs` `lock_esclusivo` | lock e I/O |
| 0152 | `lock_esclusivo` blocca senza scadenza: un processo morto male, un lock di rete che non si rilascia o un'altra installazione ferma dentro l'`update` fanno aspettare per sempre chi salva un'impostazione, e non c'è nessun timeout, nessun errore e nessun modo per l'utente di sapere che cosa sta aspettando | `fub-kernel` · `storage.rs` `lock_esclusivo` | lock e I/O |
| 0153 | la 0065 promette «questi byte o niente» e la mantiene con temp+fsync+rename+fsync della directory, ma `rename`, `remove`, `remove_dir_all` — le operazioni che muovono o tolgono l'**unica copia** della nota, cioè cestinazione, ripristino, spostamento, rimozione della bozza e del docdata — non sincronizzano niente: su un filesystem senza journaling la mossa può sparire dopo un Ok, lasciando una voce di cestino che punta al nulla o una nota che risorge dov'era, con il registro che dice il contrario | `fub-kernel` · `storage.rs` `FsStorage::rename` (con `remove` e `remove_dir_all`) | lock e I/O |
| 0154 | il doppio in memoria non si comporta come il supporto che imita in tre punti, e un doppio che diverge fa passare verdi dei banchi che sul disco sarebbero rossi: scrivere su un path che è già una directory riesce invece di fallire, il mtime di una directory è sempre zero, e `fondi` può avvelenare il `Mutex` lasciando ogni accesso successivo in panico | `fub-kernel` · `storage.rs` `MemStorage` | regole |
| 0155 | i temporanei di scrittura `.{nome}.tmp{pid}-{n}` si puliscono solo sui rami di errore: un crash fra `File::create` e la rename li lascia sul posto per sempre, la policy di ignore li rende invisibili e nessuna routine di apertura li spazza, così ogni crash lascia un sedimento che cresce e che il riuso di un pid può far confondere con un temporaneo vivo | `fub-kernel` · `storage.rs` `tmp_path` | lock e I/O |
| 0156 | `symlink_metadata(path).ok()` tratta ogni errore come «non è un symlink»: permessi, I/O, path troppo lungo finiscono tutti nello stesso ramo, e siccome da quella risposta dipende la **scelta di come scrivere**, un errore ingoiato può mandare una scrittura sul ramo sbagliato senza che nessuno lo veda | `fub-kernel` · `storage.rs` `come_scrivere` | lock e I/O |
| 0157 | `empty_trash` toglie le voci una per una e poi cammina `.trash/` con `remove_dir_all`: ciò che un altro processo cestina dentro la finestra o viene cancellato in silenzio o fa fallire la camminata a metà, senza rollback, senza conteggio parziale e senza una riga di registro per ciò che è stato distrutto — è la stessa forma del bug noto `il_vault_che_sparisce`; la mossa giusta è rinominare `.trash/` con un nome temporaneo e camminare **quello**. In coda, l'errore sui sidecar è ingoiato da un `let _`, quindi i metadati orfani non li segnala nessuno | `fub-kernel` · `vault.rs` `Vault::empty_trash` | lock e I/O |
| 0158 | il recinto di `leave_trash` è lessicale e non risolve `..`: controlla che il path di destinazione cominci per la radice del vault confrontando i segmenti così come sono scritti, quindi un `to` che risale e ridiscende passa la guardia e il ripristino atterra fuori dal vault | `fub-kernel` · `vault.rs` `leave_trash` | regole |
| 0159 | il `drop` del watcher non aspetta il debouncer: la chiusura del vault lascia il thread di debounce a consegnare eventi su un workspace che sta sparendo, e il rilascio della radice non ha nessuna barriera che garantisca che nessuno stia più scrivendo dentro `.fub/` | `fub-kernel` · `vault.rs` `Vault::drop` | lock e I/O |
| 0160 | aprire un vault non verifica niente: `Vault::open` e `Vault::on` accettano una radice che non esiste, che è un file invece di una directory o su cui non si ha permesso di scrittura, e l'errore arriva solo alla prima operazione che tocca il disco — cioè a giro avanzato, con eventi già emessi e un'interfaccia che ha già mostrato un vault aperto | `fub-kernel` · `vault.rs` `Vault::open` | regole |
| 0161 | il commento di `pota` dichiara chiusa una finestra che è ancora aperta: dice che l'`update` protegge dalla riga che cade fra la lettura e la riscrittura, ma l'`update` protegge solo chi passa dal lock e `append` non ci passa, quindi la prosa promette più di quanto il lock faccia. Il lock su `append` è una decisione (la 0067 lo rifiuta a verbale) ma la promessa falsa è un difetto: o la si corregge, o chi legge crede di avere una garanzia che non ha | `fub-kernel` · `journal.rs` `Journal::pota` | regole |
| 0162 | `ripara_la_coda` legge il registro fuori dal lock e poi ci appende: fra la lettura che decide che la coda è mezza scritta e la scrittura che la ripara ci sta comodamente un'altra riga, e la riparazione la mangia | `fub-kernel` · `journal.rs` `ripara_la_coda` | lock e I/O |
| 0163 | una riga appesa a metà non fa perdere sé stessa ma **quella dopo**: la coda troncata si ricuce col primo pezzo del record successivo, che diventa illeggibile e viene scartato dalla lettura, quindi il costo di un'interruzione è una riga in più di quella interrotta | `fub-kernel` · `journal.rs` `Journal::append` | lock e I/O |
| 0164 | `Journal::read` ingoia gli errori di lettura e risponde «registro vuoto»: un file illeggibile per permessi o per I/O diventa indistinguibile da un vault senza storia, e da lì l'undo non ha niente da disfare senza che nessuno dica perché | `fub-kernel` · `journal.rs` `Journal::read` | lock e I/O |
| 0165 | la guardia che rifiuta una destinazione occupata fa fallire **ogni** rinomina di solo caso su un filesystem case-insensitive: `nota.md` → `Nota.md` trova sé stessa, `Drafts::migrate` risponde `AlreadyExists` e la bozza resta orfana sotto la chiave vecchia mentre il documento si è mosso — la guardia serve, ma deve confrontare l'identità del file e non il suo nome | `fub-kernel` · `drafts.rs` `Drafts::migrate` | regole |
| 0166 | `Drafts::read` tratta un `list` fallito come «non ci sono bozze»: una directory illeggibile fa sparire in silenzio il lavoro non salvato dell'utente dalla vista, e il salvataggio successivo lo sovrascrive convinto che non ci fosse niente | `fub-kernel` · `drafts.rs` `Drafts::read` | lock e I/O |
| 0167 | `docdata::migrate` rimuove la destinazione senza guardarne la forma e con l'errore ingoiato: se sotto la chiave nuova c'è già uno spazio-documento di un altro documento, quello viene tolto — annotazioni, pin, miniature — e se la rimozione fallisce nessuno lo segnala, così la migrazione prosegue su un posto che non è vuoto | `fub-kernel` · `docdata.rs` `migrate` | lock e I/O |
| 0168 | fra la rinomina del documento e la migrazione del suo docdata c'è una finestra di crash non coperta da niente: il file è al nome nuovo e i suoi dati per-documento sono ancora sotto la chiave vecchia, dove la prima `collect` successiva li spazza perché non corrispondono a nessun documento vivo | `fub-kernel` · `workspace.rs` `rename_document_in_batch` (con `docdata.rs` `migrate`) | lock e I/O |
| 0169 | i rami di fallimento di `Drafts::migrate` lasciano lo stato a metà: a seconda di dove si ferma restano due bozze per un documento solo, oppure una bozza il cui campo `doc` nomina un documento che non esiste più, e nessuna delle due configurazioni viene riconciliata da qualcosa | `fub-kernel` · `drafts.rs` `Drafts::migrate` | regole |
| 0170 | il cancello che decide se si può scrivere nel vault viene da una bandiera letta **una volta** all'apertura: se il vault diventa illeggibile o di sola lettura dopo, le scritture continuano a partire e falliscono una per una invece di essere fermate, e se lo era e non lo è più restano rifiutate finché non si riapre | `fub-kernel` · `settings.rs` `vault_readable` | regole |
| 0171 | la prima scrittura in un vault avviene senza lock: quando `.fub/` non esiste ancora, `lock_esclusivo` non ha dove creare il proprio file e il ramo di creazione procede senza protezione, cioè proprio nel momento in cui due installazioni che aprono lo stesso vault nuovo si pestano | `fub-kernel` · `settings.rs` `store_vault` | lock e I/O |
| 0172 | `MachineSettings::write` tiene il `values.write()` per tutta la durata dell'I/O: ogni lettore di un'impostazione aspetta il disco invece della sola sostituzione in memoria, e su un supporto lento questo blocca la shell su un'operazione che con la 0066 dovrebbe costare solo la fusione | `fub-kernel` · `settings.rs` `MachineSettings::write` | lock e I/O |
| 0173 | `store_vault` fa `expect` sul downcast del supporto: chi passa un `VaultStorage` che non è `FsStorage` — un doppio, un supporto di terzi il giorno che esisterà — non riceve un errore ma un panico, e la 0032 dice che un panico uccide il processo | `fub-kernel` · `settings.rs` `store_vault` | regole |
| 0174 | le chiavi JSON duplicate si perdono in silenzio: la fusione sotto lock rilegge il file e riscrive la mappa, quindi un file scritto a mano (o da un'altra versione) con due volte la stessa chiave ne conserva una sola e l'utente non sa quale delle due ha perso | `fub-kernel` · `settings.rs` `Durevole::aggiorna` | regole |
| 0175 | `migra` produce doppioni in `order` e in `pinned`: la migrazione riscrive le liste senza deduplicare, quindi un id che era già presente compare due volte e da lì l'ordine dell'esploratore mostra la stessa voce in due posti | `fub-kernel` · `organization.rs` `migra` | regole |
| 0176 | l'esclusione guarda il nome e non la specie: una cartella dichiarata esclusa esclude anche i **file** che si chiamano allo stesso modo, e una dichiarazione scritta con lo slash finale — `build/`, la forma che chiunque venga da `.gitignore` scrive per prima — non combacia mai con niente, quindi non esclude un bel niente e nessuno lo dice | `fub-kernel` · `ignore.rs` `is_ignored` | regole |
| 0177 | le chiavi di `Organization` non passano dallo stesso recinto dei `DocId` nuovi: una chiave con `..` o con una barra rovescia arriva dal file su disco e viene usata per comporre un path, quindi un `workspace.json` scritto a mano può nominare posizioni fuori dal vault | `fub-kernel` · `organization.rs` (chiavi di `order` / `pinned`) | regole |
| 0178 | il confronto della revisione ingoia con `.ok()` ogni errore di lettura e lo racconta come «la base non combacia»: chi non riesce più a leggere la propria nota per permessi o per un disco che sta fallendo riceve «il documento è cambiato sotto di te», e un conflitto vero non si distingue da un supporto rotto | `fub-kernel` · `workspace.rs` `write_document` (ramo `DescendsFrom`) | regole |
| 0179 | `touch_entry` ristata il file appena scritto per prenderne mtime e dimensione, e se in quella finestra qualcuno lo elimina risponde togliendo la voce: la scrittura ha risposto Ok, l'evento `DocumentChanged` è uscito, e l'anagrafe dice che il documento non c'è — i byte scritti bastavano a rispondere senza tornare sul disco | `fub-kernel` · `workspace.rs` `touch_entry` | lock e I/O |
| 0180 | se il documento esisteva o no lo decide l'anagrafe in memoria e non il disco: un file creato da un'altra applicazione e non ancora indicizzato fa registrare `Created` dove il fatto è `Written`, e il registro — che la 0067 dichiara autorevole — racconta un evento che non è successo | `fub-kernel` · `workspace.rs` `write_document` | regole |
| 0181 | `sync_renamed_path_here` sposta prima di rileggere, cioè la forma che il codice stesso documenta come difetto in `restore_from_trash` e lì evita: se la rilettura o il parse della destinazione fallisce, la funzione risponde `Err` con il disco già spostato e memoria, grafo, indici, registro ed eventi fermi al nome vecchio | `fub-kernel` · `workspace.rs` `sync_renamed_path_here` | lock e I/O |
| 0182 | la rinomina di solo caso salta il controllo su disco **anche** dove il filesystem distingue le maiuscole: il commento motiva lo skip con macOS e Windows, dove `exists(to)` vedrebbe lo stesso file, ma su Linux un omonimo-per-caso davvero diverso e non ancora indicizzato viene rimpiazzato senza un errore | `fub-kernel` · `workspace.rs` `rename_document_in_batch` (`solo_il_caso`) | regole |
| 0183 | l'esportazione scrive direttamente sul destinatario: `File::create` tronca il file precedente all'apertura, i byte vanno sul path finale senza temp né rename, e la ricevuta `Delivered` esce dopo un semplice `flush()` che non garantisce niente sul disco — un export interrotto ha già distrutto quello di prima e ne certifica come consegnato uno a metà | `fub-kernel` · `transfer.rs` `DirectorySink::open_artifact` (con `close_artifact`) | lock e I/O |
| 0184 | la rinomina **esterna** di un allegato ne perde i dati per-documento mentre quella interna li migra: il riconoscimento dell'identità filtra sui soli documenti, quindi un'immagine rinominata dal Finder degrada a «sparita e ricomparsa» e annotazioni, pin e miniatura vengono spazzate dalla prima `collect` successiva | `fub-kernel` · `workspace.rs` `sync_renamed_path_here` | regole |
| 0185 | la bandiera `replaying` si alza e si abbassa a mano attorno al batch invece che con un guardiano che la rimette a posto uscendo: un panico dentro il replay la lascia alzata, e da lì ogni `undo.push` viene scartato in silenzio | `fub-kernel` · `workspace.rs` `undo_last` | regole |
| 0186 | il ripristino dal cestino può atterrare dentro `.fub/` o `.trash/`: la destinazione passa da `Naming::Existing`, che non blocca i segmenti nascosti come fa `Naming::New` per creazione, rinomina e importazione, quindi il restore è la porta rimasta aperta e ci si crea pure la voce fantasma in anagrafe | `fub-kernel` · `workspace.rs` `restore_from_trash` | regole |
| 0187 | la finestra «pulito per caso» si calcola sul momento del **salvataggio** e non su quello della scansione: l'indice confronta con `written_at`, quindi un file cambiato fra la scansione e la scrittura dell'indice risulta già coperto e resta indicizzato con il contenuto vecchio fino a un evento che lo tocchi di nuovo | `fub-kernel` · `index` (uso di `written_at`) | regole |
| 0188 | l'indice di ricerca scrive i propri segmenti direttamente sul filesystem invece che attraverso `VaultStorage`, che il repo dichiara **il supporto unico** dei byte: quei file non passano da temp+rename, non passano da lock, non li vede un doppio in memoria, e ogni banco che monta un supporto finto ha un pezzo di vault che gli sfugge | `fub-kernel` · `index` (segmenti tantivy) | regole |
| 0189 | `EntryStore::store` riscrive l'anagrafe senza prendere il lock che le altre riscritture integrali prendono: due processi che chiudono insieme si sovrascrivono l'anagrafe a vicenda, e vince l'ultimo che finisce | `fub-kernel` · `entries.rs` `EntryStore::store` | lock e I/O |
| 0190 | l'ordine fra anagrafe e indici è asimmetrico fra i due punti che li scrivono — `finish_index` li salva in un ordine e `close_with` nell'altro — quindi un'interruzione a metà lascia due stati incoerenti diversi a seconda di quale dei due percorsi stava correndo, e nessuno dei due è quello che la riapertura si aspetta | `fub-kernel` · `workspace.rs` `finish_index` / `close_with` | lock e I/O |
| 0191 | il log del kernel non regge né due processi né il mondo esterno: la rotazione non è protetta fra installazioni e può far perdere il file vecchio, le scritture non sincronizzano mai, e se qualcuno elimina o ruota il file da fuori il `FileSink` non se ne accorge e continua a scrivere in un descrittore morto **per sempre**, cioè proprio quando il log servirebbe per capire cos'è successo | `fub-kernel` · `log.rs` `FileSink` | lock e I/O |
| 0192 | `Condizione::cambia` salta il `notify_all` se il closure che modifica lo stato va in panico: chi aspetta la condizione resta appeso senza che nessuno lo svegli, e il panico che l'ha causato è già stato inghiottito dal `Mutex` avvelenato | `fub-kernel` · `sync.rs` `Condizione::cambia` | lock e I/O |
| 0193 | due percorsi che cancellano alberi lo fanno con `remove_dir_all` e con l'errore ingoiato — la riparazione del vault e la raccolta degli spazi-documento — quindi una cancellazione parziale non si distingue da una riuscita e ciò che resta non lo segnala nessuno | `fub-kernel` · `vault.rs` `repair` (con `docdata.rs` `collect`) | lock e I/O |
| 0194 | `controlla_path` è solo lessicale: confronta i segmenti come sono scritti e non risolve i link, quindi un symlink piazzato dentro il vault porta una scrittura fuori dal vault passando una guardia che crede di aver controllato | `fub-kernel` · `path` `controlla_path` | regole |
| 0195 | il secondo cancello di `Guard::undo_last` è più largo del primo: chi ha ottenuto il permesso per una famiglia di scrittura può far disfare un'operazione che non avrebbe potuto compiere, perché il controllo sul disfacimento non ricontrolla la specie dell'operazione da disfare | `fub-host` · `guard.rs` `Guard::undo_last` | regole |
| 0196 | ogni salvataggio del kernel torna dentro dal watcher: la scrittura produce un evento che il montaggio non riconosce come proprio, quindi il documento appena scritto viene riletto, riparsato e reingerito a ogni battuta — il costo si paga su ogni salvataggio di ogni nota | `fub-host` · `watcher` (eco della rename) | prestazioni |
| 0197 | il watcher legge un file mentre qualcuno lo sta ancora scrivendo: non c'è nessuna prova di stabilità — né un secondo `stat` che confermi la stessa dimensione, né un'attesa — quindi un file grande scritto da un'applicazione esterna entra in anagrafe a metà e ci resta finché non arriva un altro evento | `fub-host` · `watcher` (ingestione dell'evento) | lock e I/O |
| 0198 | una rinomina esterna lenta viene spezzata in due dal debounce: se l'evento di partenza e quello di arrivo cadono in due finestre diverse, il montaggio non li riconosce come la stessa mossa, l'identità del documento si perde e con essa la bozza non salvata che ci stava attaccata | `fub-host` · `watcher` (debounce delle rinomine) | regole |
| 0199 | la parte «da» di una rinomina orfana non esce mai: quando l'evento di arrivo manca, quello di partenza resta appeso in attesa del gemello e nessuno lo emette come rimozione, quindi il documento sparito dal disco resta vivo in anagrafe finché non si riapre il vault | `fub-host` · `watcher` (accoppiamento delle rinomine) | regole |
| 0200 | gli errori di sincronizzazione per-file vengono ingoiati dentro la battuta: un documento che non si riesce a sincronizzare non fa fallire il lotto e non produce nessun segnale, quindi resta indietro rispetto al disco senza che l'utente o il log lo sappiano | `fub-host` · `watcher` (battuta di sync) | lock e I/O |
| 0201 | i temporanei di scrittura delle **altre** applicazioni entrano in anagrafe: la policy che riconosce i temporanei conosce solo la forma di quelli del kernel, quindi un `.goutputstream-xxxx` o un `~$nota.md` diventa una voce che compare nell'esploratore e sparisce da sola poco dopo | `fub-host` · `watcher` (filtro dei temporanei) | regole |
| 0202 | una voce nata da `set_look` o da `set_favorite` nasce con `last_opened` a zero, cioè col valore che la politica di sfratto legge come «la più vecchia di tutte»: l'aspetto o il preferito che l'utente ha appena scelto è il primo candidato a essere buttato via | `fub-host` · `mount` `set_look` / `set_favorite` | regole |
| 0203 | un workspace avvelenato lascia un job senza esito: la richiesta viene rifiutata prima di entrare, ma il canale di risposta non riceve né un risultato né un errore, quindi chi ha chiesto aspetta per sempre — e siccome è il ramo che si imbocca quando qualcosa è già andato storto, è proprio lì che l'interfaccia si pianta | `fub-host` · `session` (runner dei job) | regole |
| 0204 | `ricorda_i_tasti_visti` legge l'insieme dei tasti già visti, lo modifica e lo riscrive senza tenerlo fermo in mezzo: due sessioni che imparano un tasto nello stesso momento se ne perdono uno | `fub-host` · `session.rs` `ricorda_i_tasti_visti` | lock e I/O |
| 0205 | la chiusura dell'applicazione non forza il salvataggio pendente: il salvataggio è ritardato di circa un secondo e mezzo, e chiudere la finestra mentre il ritardo corre butta via l'ultima battitura senza chiedere niente e senza lasciarne traccia nella bozza | `frontend` · chiusura dell'app (salvataggio ritardato) | regole |
| 0206 | `flushPendingSave` ignora l'esito del salvataggio che forza: se la scrittura fallisce, la funzione risponde comunque e il chiamante prosegue come se i byte fossero sul disco — e `convertToFolder`, che sposta il documento, non forza affatto il salvataggio prima di muoverlo | `frontend` · `flushPendingSave` (con `convertToFolder`) | regole |
| 0207 | un file con fine riga CRLF viene riscritto tutto LF al primo salvataggio: l'editor normalizza in ingresso e nessuno ricorda la forma originale, quindi aprire una nota e battere un carattere produce un diff che tocca ogni riga del file | `frontend` · editor (fine riga) | regole |
| 0208 | cestinare una nota ne lascia la bozza: il documento se ne va nel cestino e il lavoro non salvato resta sotto la chiave vecchia, dove non è più raggiungibile da nessuna vista e dove la prima raccolta lo spazza | `frontend` · cestino (con `fub-kernel` · `drafts.rs`) | regole |
| 0209 | le bozze di crash possono smettere di essere scritte senza dirlo: se la scrittura periodica fallisce una volta il ciclo non riparte e non c'è nessun segnale, quindi la rete di sicurezza che esiste per il caso peggiore è spenta proprio mentre l'utente crede di averla | `frontend` · bozze di crash | regole |
| 0210 | un tasto premuto dentro la finestra di migrazione di una rinomina ricrea il nome vecchio: il salvataggio parte con l'identità di prima mentre il file si è già mosso, e il risultato è la stessa nota in due posti con due contenuti diversi | `frontend` · rinomina (finestra di migrazione) | regole |
| 0211 | `suspendSave` e `resumeSave` hanno un posto solo: due sospensioni annidate — una rinomina dentro una conversione, un'importazione mentre una modale è aperta — si pestano, e la seconda ripresa riaccende il salvataggio che la prima voleva ancora fermo; dalla stessa parte nasce la bozza transitoria marcata «superata» che compare e sparisce senza che nessuno l'abbia chiesta | `frontend` · `suspendSave` / `resumeSave` | regole |
| 0212 | `scriviStato` non porta l'identità del vault: lo stato dell'interfaccia si salva con una chiave sola, quindi aprire un secondo vault ci scrive sopra e riaprire il primo ne restituisce la vista dell'altro | `frontend` · `scriviStato` | regole |
| 0213 | un frontmatter vuoto — le due sole righe di trattini — sparisce alla riscrittura: chi lo aveva messo per marcare che la nota ha dei metadati ancora da compilare se lo ritrova tolto senza averlo chiesto | `fub-format-markdown` · `serialize.rs` (frontmatter) | regole |
| 0214 | un alias esplicito uguale al bersaglio si perde: `[[Nota\|Nota]]` viene riscritto `[[Nota]]` perché la scrittura confronta il testo con il bersaglio e omette l'alias quando coincidono, ma quell'alias era scritto a mano e la riscrittura lo toglie | `fub-format-markdown` · `serialize.rs` (wikilink) | regole |
| 0215 | il numero di partenza di una lista ordinata si perde: una lista che comincia da 3 torna a cominciare da 1, e il documento riscritto dice una cosa diversa da quello letto | `fub-format-markdown` · `serialize.rs` (liste ordinate) | regole |
| 0216 | una nota a piè di pagina su più blocchi viene appiattita in uno solo: i paragrafi, gli elenchi e i blocchi di codice dentro la definizione si fondono, e ciò che rientra non è ciò che era uscito | `fub-format-markdown` · `serialize.rs` (note a piè di pagina) | regole |
| 0217 | `render_link_label` ignora le `RenderOptions` che riceve: l'etichetta di un link esce sempre nella stessa forma qualunque cosa il chiamante abbia chiesto, quindi una via di configurazione del contratto è dichiarata e non ha effetto | `fub-format-markdown` · `render_link_label` | regole |
| 0218 | le destinazioni di link con spazi o parentesi non vengono escapate né racchiuse fra parentesi angolari: un link a un file il cui nome contiene uno spazio esce come Markdown rotto, e alla rilettura non è più un link | `fub-format-markdown` · `serialize.rs` (destinazioni dei link) | regole |
| 0219 | il doppio del contratto risponde con un codice diverso dal kernel sugli stessi fatti — `BadArgs` dove il kernel dice `already-exists` o `not-found`, la forma dell'id di `trash_document` diversa, e la manopola `scritture_negate` che insegna `io` dove il kernel risponde `internal` — quindi chi sviluppa contro il doppio scrive gestione di errore che sul kernel non combacia | `fub-abi` · `MemoryHost` | regole |
| 0220 | il doppio del contratto non applica **nessun** recinto sui path: accetta `..`, path assoluti e segmenti nascosti che il kernel rifiuta, quindi una view di terzi che passa la conformità può essere rifiutata dal vero host — e, peggio, chi scrive i banchi non ha modo di accorgersi che il proprio recinto non esiste | `fub-abi` · `MemoryHost` | regole |
| 0221 | il kernel contraddice il proprio `not-found` in lettura: chiedere un documento che non c'è risponde `io` invece di `not-found`, cioè il codice che il contratto dichiara per quel caso, e chi distingue i due rami non può | `fub-kernel` · lettura di un documento assente | regole |
| 0222 | la suite di conformità non copre le famiglie di **scrittura**: prova le letture e le query, mentre creazione, scrittura, rinomina, cestinazione e ripristino — cioè tutto ciò che tocca i byte dell'utente — non hanno nessun banco che verifichi che due host rispondano allo stesso modo, ed è esattamente lì che i due divergono | `fub-abi` · suite di conformità | regole |
| 0224 | `expand` in Rust ed `espandi` in TypeScript sono lo stesso motore di sostituzione `{nome}` scritto due volte, e sono **l'unica coppia dichiarata gemella che nessuna fixture presidia**: `rules-samples.json` lega `mirrored.ts` alle regole di `fub-abi` e non nomina né l'una né l'altra, mentre `strings.test.ts` prova `espandi` solo contro attese scritte lì accanto. Le due divergono **già**: in Rust il nome è tutto ciò che precede la prima `}` (quindi `foo-bar` è un nome), in TypeScript solo `\w+`; ogni regola nuova — un escape, una graffa letterale — va portata identica in due motori senza niente che li confronti | `fub-abi` · `text.rs` `expand` (con `frontend` · `i18n/strings.ts` `espandi`) | regole |


## Dove va una regola scritta due volte

Questa sezione non elenca niente: dice **dove si mette una cosa che è scritta
più volte**, e serve perché la domanda torna a ogni giro e la risposta facile è
sbagliata.

La risposta facile è «una libreria condivisa»: si raccolgono le copie e si
mettono in un posto nuovo fatto apposta. Questo repo ha già scelto diversamente,
e l'ha scritto in testa a
[`util.rs`](../crates/fub-format-markdown/src/util.rs) il giorno in cui ha tolto
di lì due funzioni. La ragione registrata non è che erano doppie:

> «la regola che genera un indirizzo (`[[Nota#Titolo]]`) deve valere per
> chiunque lo risolva — due provider con due slugify diversi danno due id allo
> stesso titolo» … «chi produce markup non è solo il provider — `CustomRendering::Html`
> è una via del contratto — quindi la tabella è del contratto».

Cioè: **la regola sale dove appartiene, e chi la possiede lo dice chi ha diritto
di farla valere**, non quante volte è scritta. Una libreria di utilità raccoglie
per *forma del codice*; questo repo colloca per *proprietà della regola*. Sono
due criteri diversi, e il secondo è quello che ha già prodotto
`fub_abi::model::heading_slug` e `fub_abi::html`.

**Le case sono cinque, e quattro esistono già.** Nessuna va creata:

| Dove | Cosa ci va | Il precedente |
|---|---|---|
| `fub-abi` | ciò che vale per chiunque risolva la stessa domanda: l'ultimo segmento di un path, nome ed estensione, «sta dentro questa cartella», il primo nome libero, l'impronta, gli accessor di `IndexResult` | `heading_slug`, `fub_abi::html` |
| `fub-testkit` | l'impalcatura dei banchi: la cartella usa-e-getta, i provider giocattolo, il montaggio di un vault di prova, la camminata del modello | `TestoDiProva`, `Banco` |
| un modulo privato del crate | ciò che non esce di lì: il controllo di versione dei file di macchina, la fusione sotto lock, il prologo dei comandi | `update_atomic` in `storage.rs` |
| i moduli che il frontend ha già (`ui/`, `rules/`) | la modale, il freno, l'avviso di guasto, il predicato di scopo | `ui/highlight.ts`, `ui/corsa.ts` |
| **nessuna casa — si presidia** | tutto ciò che è scritto una volta in Rust e una in TypeScript | `rules_mirror.rs` → `rules-samples.json` |

L'ultima riga è la più importante e la più facile da sbagliare: una regola
gemella fra i due linguaggi **non si estrae a mano**. Finché `fub-abi` non
compila a wasm32 le due copie servono entrambe, e ciò che le tiene uguali è un
banco che le confronta su casi generati. Toglierne una a mano toglie la
sorveglianza senza dare l'unificazione — ed è esattamente il difetto `0224`, che
è quella coppia lasciata scoperta.

**Un crate nuovo non è una casa.** Aggiungerne uno costa tre presidi
(`check-cargo-versioni`, `check-cargo-feature-default`, i membri del workspace) e
una riga di architettura, e per ora non compra niente che `fub-abi` e
`fub-testkit` non diano già.

**E l'ordine non è quello del numero di copie.** La domanda che ordina è: *se le
due copie diventano diverse, chi se ne accorge?*

1. **Nessuno, e si rompe un dato o una promessa.** Sono difetti e stanno nella
   tabella qui sopra — `0224` è quello che resta di questa famiglia (la `0223`,
   l'impronta scritta tre volte, è già riparata), insieme ai quattro che i giri
   precedenti avevano già trovato per altra strada (`0140` la
   normalizzazione di quattro regole di identità, `0141` le tre risposte a «sta
   dentro questa cartella», `0148` le due copie Rust di `normalizza`, `0149` le
   due superfici che catturano il fuoco).
2. **Il compilatore.** Costa una modifica coordinata e non un rischio: si fa
   quando si passa di lì per altri motivi, non prima.
3. **Nessuno, ma non si rompe niente.** Un bottone, una riga vuota, un builder.
   Si lascia stare: il diff costa più di quanto tolga.

## Come si semplifica la documentazione

Tre mosse, e **non sono la stessa specie**. Le prime due sono difetti — la
`0225` e la `0226` — perché non c'è niente da decidere: sono additive, non
tolgono una frase a nessun documento esistente, e se domani non convincono si
cancellano. La terza è una decisione, e sta scritta qui sotto senza una riga in
tabella apposta.

L'ordine non è un'opinione: **la terza non si prende prima di aver fatto le
prime due**, perché è la sola irreversibile e perché è probabile che dopo le
prime due sia molto più piccola. Se il testo diventa leggibile quando le undici
parole hanno una definizione, il dialetto non era il problema.

Le istruzioni qui sotto sono scritte per essere **eseguite senza dedurre
niente**: chi le prende — persona o modello — non deve andare a cercare cosa
intendeva chi le ha scritte.

### 1. Chiudere il glossario (difetto `0225`)

**Cosa si fa.** Si aggiungono **undici voci** a [glossario.md](glossario.md),
tutte dentro la sezione `## Il metodo`, in ordine alfabetico fra le dieci che ci
sono già (`buco dichiarato`, `giro`, `leva`, `P0 / P1 / P2`, `presidio`,
`seduta`, `strato`, `strozzatura`, `verbale`, `voce`).

| termine | volte in `docs/` | cosa vuol dire, in una riga | dove è già usato per esteso |
|---|---|---|---|
| `banco` | 423 | un test — il tipo `Banco` di `fub-testkit` è il costruttore che quasi tutti usano | [PIANO.md](PIANO.md), `crates/fub-testkit/src/lib.rs` |
| `casa` | 59 | il modulo che ha **il diritto** di imporre una regola, che è dove la regola va scritta una volta sola | la sezione qui sopra, `crates/fub-format-markdown/src/util.rs` |
| `casella` | 367 | ciò che resta da fare dopo che una decisione è chiusa: nessuna scelta, solo lavoro | l'apertura di questo file |
| `difetto` | 530 | qualcosa di misurato nel codice che si ripara senza decidere niente — se la riparazione dipende da una decisione, non è un difetto | l'apertura di questo file |
| `gemella` | 45 | una funzione scritta due volte in due linguaggi che devono restare d'accordo | la riga `0224`, `crates/fub-abi/tests/rules_mirror.rs` |
| `gesto` | 171 | una singola interazione dell'utente — un tasto, un clic, un trascinamento — presa alla grana più fine | [FEATURES.md](FEATURES.md) §32, [microfeatures/](microfeatures/) |
| `grana` | 92 | quanto è fine la misura che si sta facendo: «alla grana del gesto» vuol dire un'osservazione per interazione | questo file, [roadmap/](roadmap/) |
| `innesco` | 13 | l'evento che fa scattare una casella, scritto al posto di una data quando la data non si sa | questo file |
| `lente` | 12 | la domanda stretta con cui si guarda il codice in una seduta, dichiarata **prima** di guardare | questo file, §23.9 |
| `residuo` | 45 | ciò che di una voce non aveva niente da decidere e diventa un difetto o una casella | questo file |
| `specie` | 267 | una delle tre categorie che questo file conta separatamente: voci, caselle, difetti | l'apertura di questo file |

**La forma di una voce** è fissata dal glossario stesso e non si inventa:

```
### il termine
`TipoRust` · [`file`](percorso/relativo/vero) · [verbale](decisions/NNNN-....md)

Cos'è, in due o tre righe.
```

Le tre coordinate si riempiono così: il **tipo** solo se esiste davvero un
identificatore con quel nome nei sorgenti — per queste undici parole succede una
volta sola, `Banco` — altrimenti `—`; il **file** è la colonna «dove è già usato
per esteso» qui sopra, scritta come link relativo vero, perché
[check-doc-links](../.github/scripts/check-doc-links.mjs) lo verifica; il
**verbale** solo se ce n'è uno che decide quel termine, altrimenti `—`.

**Le quattro regole che vincolano il testo**, e sono quelle che rendono la mossa
sicura:

1. **Due o tre righe, mai di più.** Il glossario dice di sé stesso «qui c'è la
   frase minima che permette di leggere gli altri documenti senza fermarsi».
   Una voce che spiega il metodo diventa il secondo posto in cui il metodo è
   spiegato, e il secondo posto invecchia.
2. **Si rimanda, non si ripete.** Ogni voce punta al documento che tratta la
   cosa per esteso. Se scrivendola viene voglia di aggiungere una precisazione,
   quella precisazione appartiene al documento puntato.
3. **Non si tocca nient'altro.** Undici blocchi nuovi dentro `## Il metodo` e
   zero righe modificate altrove. Il diff deve essere fatto di sole aggiunte.
4. **Ogni voce si regge da sola, in italiano normale.** È la regola che vale più
   delle altre tre, perché queste undici parole *sono* il dialetto: una voce
   scritta nel dialetto è circolare, e un glossario circolare è peggio di uno
   assente — sembra una risposta. La prova è meccanica: **si legge la voce
   avendo letto solo quella**, e se per capirla serve un'altra delle undici, la
   voce è da riscrivere. Dove l'altra parola serve davvero, o si glossa in tre
   parole dentro la frase stessa (*«una casella — il lavoro che resta dopo una
   decisione —»*) o si scrive la cosa in italiano e basta.

   La colonna «cosa vuol dire, in una riga» della tabella qui sopra **non è il
   testo finale** ed è scritta apposta per chi il repo lo conosce già: `residuo`
   ci sta come «ciò che di una **voce** non aveva niente da decidere e diventa
   un **difetto** o una **casella**», che sono tre parole del dialetto dentro la
   definizione del dialetto. Lo stesso vale per `innesco` e `specie`. È il
   significato, non la frase: la frase si scrive per il lettore dichiarato più
   sotto, che è lo stesso della mossa 2.

   Valgono qui, identiche, **le quattro regole di registro della mossa 2** — la
   parola inventata si definisce nella stessa frase, prima la cosa e poi il
   perché, mai una definizione per sola negazione, frasi corte. Sono scritte una
   volta sola, là, e questa riga è il rimando.

**Cosa cambia intorno.** L'apertura di `glossario.md` elenca dieci termini come
esempio del lessico non standard (`lotto, porta, ponte, anagrafe, sidecar,
superficie, seduta, strozzatura, derivato, autorevole`) e sono tutti del
prodotto: aggiungerne due del metodo — `banco`, `difetto` — è l'unica modifica a
una frase esistente che vale la pena fare, ed è una parola in più in un elenco.
Stessa cosa in [README.md](README.md) alla riga «Non capisco una parola», che
ripete lo stesso elenco.

**Come si verifica.** `node .github/scripts/check-doc-links.mjs` (i link nuovi
sono veri) e `node .github/scripts/check-prosa.mjs`. Il numero di voci del
glossario **non** è sotto conto automatico: se una frase dice «novantuno voci»,
va riletta a mano — è esattamente la famiglia di errori del commit `441d376`.

### 2. Il file d'ingresso (difetto `0226`)

**Cosa si fa.** Si scrive **un file nuovo**, `docs/leggimi-prima.md`, di due
pagine. Non si modifica nessun documento esistente tranne i due indici, e come.

**Perché in `docs/` e non in radice**: lo decide [README.md](README.md) e non
chi scrive — tutta la prosa sta in `docs/`, e un documento che riguarda il repo
come progetto pubblico sta al primo livello, accanto a `CONTRIBUTING.md`.

**Per chi è scritto**, e va tenuto in mente frase per frase: qualcuno al secondo
anno di informatica, che sa cos'è un test e cos'è un `trait` ma non ha mai visto
questo repo, e che ha dieci minuti. Se una frase richiede di aver già letto un
altro documento di `docs/`, quella frase è sbagliata per questo file.

**Cosa ci va, in quest'ordine e niente altro:**

1. **Cos'è Fub** — in cinque righe, senza architettura: un'applicazione per
   prendere note su una cartella di file `.md`, compatibile con i vault di
   Obsidian, con un nucleo che non sa cos'è il markdown e dei provider che
   glielo insegnano.
2. **Com'è diviso** — i crate in ordine di dipendenza e cosa fa ciascuno in una
   riga, più il frontend. Chi vuole il disegno vero lo trova in
   [architecture/mappa-visuale.md](architecture/mappa-visuale.md), e il rimando
   basta.
3. **I quattro documenti che contano e a cosa servono** — `decisions/` (perché
   una cosa è così, un file per decisione, non si riscrivono), `todo.md` (cosa
   manca, in tre specie che si contano separatamente), `architecture/` (com'è
   fatto adesso), `FEATURES.md` (dove si vuole arrivare, non dove si è).
4. **Il dizionario del dialetto** — le undici parole della mossa 1 più
   `presidio`, `verbale`, `seduta`, `voce`, in una tabella di due colonne:
   parola, e cosa vuol dire in italiano normale. Qui si **ripete** ciò che sta
   nel glossario, ed è l'unica ripetizione consentita in tutto il repo: si
   dichiara nel file stesso che il glossario è la sede vera e che questa tabella
   è una scorciatoia per la prima lettura.
5. **Da dove si comincia a toccare il codice** — il ciclo locale, che sta già in
   [CONTRIBUTING.md](CONTRIBUTING.md): si rimanda, non si copia.

**Il registro**, che è tutto il punto del file:

- Nessuna parola inventata senza la sua definizione **nella stessa frase**.
- Prima la cosa, poi il perché. Non «ciò che fa diventare rossa
  un'affermazione quando smette di essere vera è un presidio», ma «un presidio è
  un test che fallisce se una promessa del repo smette di valere».
- Niente definizioni per negazione come **unica** definizione: «non è un errore
  ma un caso previsto» dice cosa una cosa non è. Prima si dice cos'è.
- Frasi corte. Se una frase ha tre subordinate, sono tre frasi.

**Cosa cambia intorno, e va fatto nello stesso diff** — è la parte che si rompe
in silenzio se qualcuno la salta:

- [README.md](README.md), sezione «Da dove si comincia»: la porta «Non conosco
  il progetto» oggi manda a `PIANO.md`. Deve mandare **prima** a
  `leggimi-prima.md` e poi a `PIANO.md`.
- [README.md](README.md), sezione «Le aree»: la tabella dei documenti di primo
  livello prende una riga nuova, con la colonna «chi la mantiene aggiornata»
  compilata come le altre.
- [README.md](README.md), stessa sezione: la frase dice «**Quattro** raccontano
  il progetto» e «**Cinque** riguardano il repo come progetto pubblico». Uno dei
  due numeri cambia, e **nessun presidio se ne accorge** — è un numero scritto
  in lettere dentro una frase.
- [PIANO.md](PIANO.md) contiene la mappa dettagliata di tutti i documenti: va
  cercato se elenca i file di primo livello, e in quel caso aggiornato.

**Come si verifica.** `node .github/scripts/check-doc-links.mjs`,
`node .github/scripts/check-prosa.mjs`, e una rilettura umana dei due numeri in
lettere qui sopra.

### 3. La sostituzione dei termini — che è una decisione, non un difetto

Tradurre il dialetto — `banco` → `test` in 423 posti, `presidio` → qualcos'altro
in 814 — **non ha una riga in tabella**, e la ragione è la regola di questo file:
un lavoro la cui esecuzione dipende da una scelta non è un difetto. Le scelte
aperte sono due e nessuna delle due è tecnica: *chi è il lettore che il repo si
sceglie*, e *quali parole si traducono e con cosa*. Finché non hanno una
risposta scritta, chiunque cominci sta decidendo per tutti mentre modifica file.

Se la decisione si prende, apre una **seduta** in [roadmap/](roadmap/) — sarebbe
la 27 — e queste sono le tre cose che quella seduta deve già sapere, misurate:

1. **I verbali non si riscrivono.** `docs/decisions/` sono 142 file immutabili
   per convenzione ([CONTRIBUTING.md](CONTRIBUTING.md), *Chiudere una
   decisione*): un verbale reso più chiaro è un verbale che dice una cosa che
   nessuno ha deciso. Se un verbale è illeggibile, gli si affianca una nota; non
   lo si tocca. Questo mette fuori dal perimetro **il 65% dei file di `docs/`**.
2. **Alcuni termini stanno nei nomi.** `roadmap/16-crate-sdk-banchi-di-prova.md`,
   `roadmap/17-presidi-che-restano.md`,
   `crates/fub-abi/tests/una_sola_tabella_di_escape.rs` e i nomi di parecchi
   banchi contengono la parola. Rinominare un file rompe i link — e quello
   almeno lo prende `check-doc-links`, che ne verifica 4.572. Rinominare un test
   non rompe niente e fa sparire una citazione in un messaggio di commit.
3. **`presidio` non è sinonimo di `test`.** Un presidio è un test che difende
   una *classe* di regressione, spesso strutturale: `una_sola_impronta.rs` non
   prova che un'impronta è giusta, impedisce che ne nasca una quarta copia.
   Tradurlo con `test` perde esattamente la distinzione per cui la parola
   esiste. O si tiene e si glossa — che è la mossa 1 — o si traduce con due
   parole.

**E una cosa va costruita prima di lasciar riscrivere qualunque testo a
chiunque**, modello o persona: un conto che, dati un file prima e dopo,
verifichi che non siano cambiati **i numeri, i percorsi, gli identificatori fra
backtick e i link**. Non dice che il senso è salvo — quello non lo dice
nessuno — ma prende tutta la famiglia di errori del commit `441d376`, dove la
prosa diceva ventiquattro e la colonna sommava venticinque in diciannove posti
senza che nessun presidio potesse vederlo. Sono una trentina di righe accanto
agli altri undici script.

## Gli allegati

- [Le voci a leva più alta](roadmap/leva.md) — non *quando* prendere una voce ma
  **quali contano di più**: una voce che rende una capacità *inesprimibile* sta
  sopra una che la rende stretta.
- [Dove il contratto si strozza](roadmap/strozzature.md) — l'indice inverso: una
  riga per famiglia di FEATURES, con cosa servirebbe e cosa lo impedisce oggi.
- [Corrispondenza fra la numerazione vecchia e questa](roadmap/numerazione.md) —
  i commit e i commenti nel codice nominano i numeri di prima della
  riorganizzazione; lì si traducono.
- [I verbali delle decisioni chiuse](decisions/README.md) — **centoquarantuno** [conta: verbali],
  uno per file. Diceva «cinquantasette» quando erano cinquantanove, e il comando
  che lo ricava era già scritto qui accanto senza che nessuno lo eseguisse: dalla
  [0072](decisions/0072-un-numero-si-scrive-accanto-a-come-si-ricava.md) lo esegue
  la CI. Non stanno qui perché questo è l'elenco di ciò che **resta da
  fare**.
