# Roadmap infrastrutturale — reggere il peso di FEATURES.md

Torna a [PIANO.md](PIANO.md). Questo documento chiede una cosa sola:
**[FEATURES.md](FEATURES.md) elenca ~3000 voci — quali pezzi di infrastruttura
mancano perché quelle voci si possano costruire senza riscrivere il kernel, il
contratto e la shell ogni volta?**

Sono uscite 143 voci: novantanove da sette giri sulla stessa domanda, due da una
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
le ha **smentite più spesso di quanto le abbia confermate**. Centotrentasei sono
chiuse, e i loro verbali stanno in
[decisions/](decisions/README.md); le voci ancora aperte sono
**sette** [conta: voci-aperte], e questo file resta il loro **indice** e il
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
al contratto per permetterlo si calcola. Le altre ventiquattro sedute descrivono
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
| **25** | [Sette scelte che il codice ha preso senza dirlo](roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md) | sette punti in cui il codice ha già preso una posizione senza che nessuno la scegliesse, e in sei la risposta è già scritta altrove nel repo | 7 | — |

## Le voci

**Sette** [conta: voci-aperte], e sono tutte della
[seduta 25](roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md).
**Non riaprono la roadmap infrastrutturale di M4, che resta finita**: nessuna
delle sette è un pezzo che manca al piano, e la prova è da dove vengono. Non
sono uscite cercando cosa serva per costruire FEATURES.md — quella domanda ha
finito di produrre voci — ma da una **rilettura** che ha rimisurato ciò che il
repo si portava avanti, e sono tutte e sette dello stesso tipo: una **scelta di
prodotto o di contratto** che il codice ha già preso scrivendosi, e che nessuno
ha mai posto come domanda. Cinque delle sette hanno il codice che dice una cosa e
un verbale che, sullo stesso problema, ne dice un'altra; sei su sette hanno la
risposta già scritta da qualche parte in questo repo. Per taglia: una P0, quattro
P1, due P2 — e **la P0 non è una firma**, è una perdita di dati, quindi non
scade col freeze e non è per questo che sta in cima.

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
**sette** [conta: voci-aperte] come deve. Il residuo di una voce **chiusa** non
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

La colonna *Voci* somma **sette** [conta: voci-aperte], e stanno **tutte in una
riga**: le prime ventiquattro sedute sono a zero, la venticinquesima è a sette.
È una distribuzione che vale la pena leggere, perché è la seconda volta che
capita e la prima è finita: le ventiquattro ci sono arrivate una per volta —
l'ultima è stata la 24, con la
[0132](decisions/0132-un-rifiuto-non-e-una-frase.md), prima di lei la 16, con la
[0116](decisions/0116-lo-scope-di-una-chiave-segue-la-vita-di-chi-la-dichiara.md)
— e ogni volta lo zero è stato il segnale che una domanda aveva finito di
produrre voci. Vale ancora: lo zero delle ventiquattro dice che la roadmap
infrastrutturale è finita, e la riga della 25 non lo contraddice, perché non
viene da quella domanda.
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

Le caselle residue oggi sono **ventitré**, e stanno in diciotto posti:
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
quella voce).
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
| **§25.1** | [Una rinomina che atterra su una nota viva](roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md#251-una-rinomina-che-atterra-su-una-nota-viva) | 25. Sette scelte che il codice ha preso senza dirlo | kernel | **P0** |
| **§25.2** | [Quante regole di identità di un nome vuole Fub](roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md#252-quante-regole-di-identità-di-un-nome-vuole-fub) | 25. Sette scelte che il codice ha preso senza dirlo | contratto | **P1** |
| **§25.3** | [Dove sta la prima fotografia di un vault](roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md#253-dove-sta-la-prima-fotografia-di-un-vault) | 25. Sette scelte che il codice ha preso senza dirlo | kernel | **P1** |
| **§25.4** | [Quanto contesto porta un backlink](roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md#254-quanto-contesto-porta-un-backlink) | 25. Sette scelte che il codice ha preso senza dirlo | contratto | **P1** |
| **§25.5** | [Quando la cartella di configurazione non si può scrivere](roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md#255-quando-la-cartella-di-configurazione-non-si-può-scrivere) | 25. Sette scelte che il codice ha preso senza dirlo | kernel | **P1** |
| **§25.6** | [Chi paga la latenza di una scrittura fatta dentro un comando IPC](roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md#256-chi-paga-la-latenza-di-una-scrittura-fatta-dentro-un-comando-ipc) | 25. Sette scelte che il codice ha preso senza dirlo | shell | **P2** |
| **§25.7** | [Dove stanno i byte di un `kind` di terzi](roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md#257-dove-stanno-i-byte-di-un-kind-di-terzi) | 25. Sette scelte che il codice ha preso senza dirlo | contratto | **P2** |

## I difetti misurati

**Trentadue** [conta: difetti-aperti], e non sono voci. Nessuno chiede una
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

**Il numero è quello di `issues.md` e non scala**, per la stessa regola dei `§`:
è citato dai verbali e dai messaggi di commit, e rinumerarlo trasformerebbe ogni
citazione in un rimando cieco. I buchi nella sequenza sono le ventidue righe che
non sono sopravvissute alla rilettura. Il conto perciò **conta le righe**, e da
`0100` ha voluto un pattern più largo: quello vecchio si fermava a `0099` e
avrebbe dichiarato meno difetti di quanti ce ne sono.

**L'ancora è al simbolo, non alla riga.** Ogni riga porta il posto misurato al
2026-08-06: i numeri di riga si saranno mossi, il simbolo no. Chi ne prende una
**riconta**, non deduce.

| # | Difetto | Dove | Famiglia |
|---|---|---|---|
| 0018 | risoluzione dei link rotti: scansione lineare con `resolution_key` per voce, per ogni riferimento | `fub-kernel` · `index/core.rs` `resolve_entry_in` | prestazioni |
| 0038 | i comandi Tauri sono sincroni e prendono lock + I/O sul thread pool dell'IPC | `fub-app` · `lib.rs` | lock e I/O |
| 0040 | `vault_replace` senza `docs` legge **ogni** documento del vault invece di chiedere all'indice | `fub-features` · `commands.rs:1287` | prestazioni |
| 0041 | il doppio controllo di `dirty` in `SearchIndex::commit` ferma le letture per tutta la durata del commit | `fub-features` · `search.rs` `commit` | prestazioni |
| 0043 | senza finestra il tetto della ricerca è `total`: `TopDocs::with_limit(total)` su un vault grande | `fub-features` · `search.rs:1149` | prestazioni |
| 0045 | `rebuild_from_store` carica ogni snapshot in memoria solo per calcolarne l'impronta | `fub-features` · `versioning.rs:938` | prestazioni |
| 0049 | `StatsView` dichiara `ContextMask::all()` e rilegge il documento intero a ogni movimento del cursore | `fub-features` · `stats.rs:82` | prestazioni |
| 0070 | `prefix_len_ci` confronta i minuscoli code point per code point e sbaglia sulle espansioni (`İ`) | `fub-kernel` · `occurrences.rs:215` | regole |
| 0073 | `set_view_state` scrive `view-state.json` in modo sincrono sul thread IPC, a ogni scroll | `fub-app` · `lib.rs:645` | lock e I/O |
| 0093 | `heading_slug` non normalizza in NFC: `# Café` scritto da macOS e lo stesso link digitato altrove danno due slug diversi | `fub-abi` · `model.rs` `heading_slug` | regole |
| 0110 | lo stesso testo di contesto è copiato per intero tre volte lungo la catena — una `String` per ogni link in `inlines_del_blocco`, poi di nuovo in `register_links`, poi in `backlinks()` — dove basterebbe una fetta condivisa del sorgente | `fub-format-markdown` · `parse.rs` `inlines_del_blocco` | prestazioni |
| 0111 | una riga vuota in mezzo a una tabella GFM la chiude e lascia le righe successive come un paragrafo unico, e succede in due file — `docs/decisions/README.md` riga 90 (58 righe, 214.447 byte in un solo paragrafo) e `docs/architecture/wit-congelato.md` riga 98 (8 righe, 11.174 byte) — senza che nessun conto della CI guardi l'integrità di una tabella | `docs` · `decisions/README.md` riga 90 (con `architecture/wit-congelato.md` riga 98) | regole |
| 0112 | l'anagrafe non ha forma incrementale: `EntryStore::open` deserializza l'intera `BTreeMap<DocId, StoredEntry>` e `EntryStore::store` la riserializza e la sostituisce tutta con una `VaultStorage::write`, così ogni apertura paga il vault intero anche quando non è cambiato un file | `fub-kernel` · `entries.rs` `EntryStore::store` | prestazioni |
| 0113 | il prestito esclusivo di `finish_index` copre in fila cinque fasi, tre delle quali toccano il disco — ricostruzione integrale del grafo, riconciliazione degli indici, flush degli indici, ricongiungimento delle rinomine che cammina l'anagrafe persistita, riscrittura integrale di `entries.json` — così un lettore concorrente aspetta la somma di tutte e cinque e non la sola indicizzazione | `fub-kernel` · `workspace.rs` `Workspace::finish_index` | lock e I/O |
| 0115 | risolvere un wikilink scandisce tutta l'anagrafe: `named_entry_in` calcola fino a due `resolution_key` per voce e chiude con un `min_by_key` che non cortocircuita, quindi trovare costa quanto non trovare — 27,8 ms a chiamata su 20.000 voci — e `entry_rewrite_plan` la chiama una volta per ogni link di ogni documento, cioè quarantasei minuti per rinominare un allegato | `fub-kernel` · `index/core.rs` `named_entry_in` | prestazioni |
| 0117 | aprire un vault paga la latenza dell'IPC una volta per domanda invece che una volta per gruppo: `openVaultPath` mette in fila sette `await` che nessun dato lega — quattro caricatori di stato e tre elenchi del kernel — collassabili in due `Promise.all` senza toccare l'ordine che i commenti dichiarano; quattro siti in tutto, questo è il peggiore | `frontend` · `main.ts` `openVaultPath` | prestazioni |
| 0118 | `DEFAULT_EXCLUDED` è `.obsidian`, `.git`, `node_modules` e non contiene `target`: su un vault che è anche un repo Rust ogni file di `target/` prende un `DocId` ed entra in anagrafe, perché il filtro a valle assegna una specie e non scarta nulla | `fub-kernel` · `ignore.rs` `DEFAULT_EXCLUDED` | regole |
| 0119 | `Journal::open` legge `.fub/journal.jsonl` due volte di fila — una per `ripara_la_coda` e una per `pota(0)` — e una terza la fa `Workspace::pota_il_registro` appena il bundle dichiara `journal.retention.days`, perché `pota` rilegge il file invece di ricevere i byte che il chiamante ha appena letto | `fub-kernel` · `journal.rs` `Journal::open` | lock e I/O |
| 0123 | gli avvisi non fatali del montaggio viaggiano nell'`Ok(Vec<String>)` di `BundleRegistry::enable`, e i due chiamanti che accendono un bundle scartano quel payload con un `?` che non lega: l'utente accende un componente e i provider non entrati non compaiono né nel valore di ritorno né nel log | `fub-host` · `session.rs` `Host::set_plugin_enabled` | regole |
| 0126 | gli estratti di un provider si raccolgono con `.collect()` in una `BTreeMap<DocId, DocumentMatch>`: due righe per lo stesso documento si sovrascrivono in silenzio, dove `Matches::insert` — a poche righe di distanza — avrebbe chiamato `absorb` e fuso score, proprietà e occorrenze | `fub-kernel` · `index/plan.rs` `told` | regole |
| 0127 | un verbale è immutabile ma il codice che descrive no, e non c'è nessun registro che tenga i due allineati: due verbali — la decisione 0121 sul `<div>` vuoto e su `heading_slug`, la 0062 sull'unico caso di `StderrSink` — affermano di `crates/` cose che a HEAD sono false, i commit che le hanno rese false hanno toccato solo `todo.md`, e chi legge non ha nessun segnale di stare leggendo un fatto scaduto | `docs` · `CONTRIBUTING.md` `Chiudere una decisione` | regole |
| 0128 | i blocchi compongono la classe CSS col `custom_kind` intero mentre gli inline la fanno passare per `class_of`, che taglia il namespace fidandosi di un `data-kind` che nessun ramo emette: `terzi:spoiler` e `altri:spoiler` collidono su `.inline-spoiler` senza nulla che li distingua | `fub-format-markdown` · `render.rs` `class_of` | regole |
| 0129 | `convert_inlines` non ha un ramo per l'HTML inline e lo lascia cadere nel catch-all che ricorre sui figli, ma quel nodo porta il markup in `literal` e non ha figli, quindi sparisce senza lasciare nemmeno i byte grezzi — mentre `convert_block` salva il `literal` dell'HTML di blocco | `fub-format-markdown` · `parse.rs` `convert_inlines` | regole |
| 0130 | due letture che rispondono con dei dati hanno un comando IPC proprio invece di una variante di `IndexQuery`, e siccome `IndexQuery` non ha una variante di resa e l'`HostApi` non ha una capacità di render, un `ViewProvider` non ha nessuna porta per mostrare un documento reso mentre la shell ne ha due | `fub-app` · `lib.rs` `render_preview` / `render_embed` | regole |
| 0131 | `deleted_at` non è un dato salvato ma l'mtime del file nel cestino diviso 1000, ricavato in `walk_trash`, quindi qualsiasi tocco al file — un rename, un backup, una sync — riscrive la data di cancellazione, e per giunta invalida il sidecar, che usa lo stesso mtime come controllo d'identità | `fub-kernel` · `vault.rs` `walk_trash` | regole |
| 0136 | l'etichetta di un wikilink senza alias la sintetizza comrak dal bersaglio, e `convert_inlines` la scandisce per i tag come fosse prosa: `[[#Sezione]]` fa nascere un tag `Sezione` che nessuno ha scritto, con lo span dentro quello del link | `fub-format-markdown` · `parse.rs` ramo `NodeValue::WikiLink` | regole |
| 0137 | il dry-run della rinomina chiede `IndexQuery::Backlinks` con `page: None` e poi destruttura `BacklinkRef { source, .. }`: si fa consegnare i contesti — 203 KB mediani, fino a 1,5 MB — per costruire un elenco di percorsi, mentre la foglia `QueryPredicate::Linked` che il docstring di `backlinks()` gli indica esiste già | `fub-features` · `commands.rs` (dry-run della rinomina) | prestazioni |
| 0138 | `set_setting_for_user` e `reset_setting_for_user` prendono il prestito **esclusivo** del workspace e ci attraversano una scrittura su disco, mentre i quattro fratelli che fanno la stessa cosa prendono quello condiviso e `set_view_state` ha la ragione scritta accanto a sé: «prendere qui quello esclusivo bloccherebbe chi legge per il tempo di una scrittura su disco» | `fub-host` · `session.rs` `Host::set_setting_for_user` | lock e I/O |
| 0139 | `togliDappertutto` chiama `chiudiTab` in ciclo e ogni giro fa un `cambiato()`, cioè una scrittura su disco con `fsync`: cancellare un documento aperto in cinque riquadri costa cinque scritture dove ne basterebbe una alla fine | `frontend` · `layout.ts` `togliDappertutto` | prestazioni |
| 0140 | quattro regole di identità di un nome non fanno la normalizzazione NFC che `resolution_key` fa — `canonical_tag`, `canonical_anchor`, `heading_slug`, `prefix_len_ci` — così paglia in NFD e ago in NFC non si incontrano in nessuno dei due versi, e `heading_slug` su NFD non diverge soltanto: **cancella** l'accento, perché una `Mn` non è alfanumerica | `fub-abi` · `model.rs` `canonical_tag` (con `canonical_anchor`, `heading_slug`, `occurrences.rs` `prefix_len_ci`) | regole |
| 0141 | «sta dentro questa cartella?» ha tre risposte incompatibili in produzione — `query::within_folder` taglia gli slash finali e ha il ramo su sé stessa, `rules::events::folder_contains` li taglia e non ce l'ha, `transfer::in_folder` taglia entrambi i capi — e il banco di `transfer.rs` asserisce vero ciò che `within_folder` dà falso, mentre la prosa di `traits.rs` scrive che la regola «è una, e due copie divergerebbero sul caso che nessuno prova» | `fub-abi` · `transfer.rs` `in_folder` | regole |
| 0142 | il test della rinomina a solo caso è scritto a mano due volte, identico, con un `to_lowercase()` nudo senza NFC e senza trim: è una quattordicesima regola di piegatura del caso, e può contraddire `resolution_key` proprio sul rename che deve proteggere | `fub-kernel` · `workspace.rs` `case_only` (due siti) | regole |

## Gli allegati

- [Le voci a leva più alta](roadmap/leva.md) — non *quando* prendere una voce ma
  **quali contano di più**: una voce che rende una capacità *inesprimibile* sta
  sopra una che la rende stretta.
- [Dove il contratto si strozza](roadmap/strozzature.md) — l'indice inverso: una
  riga per famiglia di FEATURES, con cosa servirebbe e cosa lo impedisce oggi.
- [Corrispondenza fra la numerazione vecchia e questa](roadmap/numerazione.md) —
  i commit e i commenti nel codice nominano i numeri di prima della
  riorganizzazione; lì si traducono.
- [I verbali delle decisioni chiuse](decisions/README.md) — **centotrentaquattro** [conta: verbali],
  uno per file. Diceva «cinquantasette» quando erano cinquantanove, e il comando
  che lo ricava era già scritto qui accanto senza che nessuno lo eseguisse: dalla
  [0072](decisions/0072-un-numero-si-scrive-accanto-a-come-si-ricava.md) lo esegue
  la CI. Non stanno qui perché questo è l'elenco di ciò che **resta da
  fare**.
