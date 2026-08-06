# Roadmap infrastrutturale — reggere il peso di FEATURES.md

Torna a [PIANO.md](PIANO.md). Questo documento chiede una cosa sola:
**[FEATURES.md](FEATURES.md) elenca ~3000 voci — quali pezzi di infrastruttura
mancano perché quelle voci si possano costruire senza riscrivere il kernel, il
contratto e la shell ogni volta?**

Sono uscite 136 voci: novantanove da sette giri sulla stessa domanda, due da una
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
lavorato. Centotrentasei sono
chiuse — **tutte**, di nuovo — e i loro verbali stanno in
[decisions/](decisions/README.md); le voci ancora aperte sono
**zero** [conta: voci-aperte], e questo file resta il loro **indice** e il
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

## Le voci

**Zero** [conta: voci-aperte]: la tabella è vuota, ed è così che si sa che la
roadmap infrastrutturale di M4 è finita. C'era già arrivata una volta, e la
[seduta 24](roadmap/24-tre-firme-che-il-freeze-rende-definitive.md) l'ha
riaperta per tre voci con un criterio solo — **toccano una firma**, e una firma
scade col freeze. **Su due delle tre quel criterio non reggeva**, e a scoprirlo
è stato ogni volta il giro che le ha chiuse, mai chi le aveva scritte: la §24.1
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
**zero** [conta: voci-aperte] come deve. Il residuo di una voce **chiusa** non
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

La colonna *Voci* somma **zero** [conta: voci-aperte]: **ogni** seduta è a
zero, e l'ultima ad arrivarci è la 24, con la
[0132](decisions/0132-un-rifiuto-non-e-una-frase.md) — prima di lei c'era la 16,
con la
[0116](decisions/0116-lo-scope-di-una-chiave-segue-la-vita-di-chi-la-dichiara.md).
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

## I difetti misurati

**Ottantaquattro** [conta: difetti-aperti], e non sono voci. Nessuno chiede una
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
| 0001 | `VersionRef` attraversa l'IPC, e per lui `fub-app` dipende da `fub-features` | `fub-app/Cargo.toml` | confini |
| 0002 | `restore_from_trash` ripristina i documenti e non gli asset | `fub-kernel` · `workspace.rs` `restore_from_trash` | cestino |
| 0003 | il contesto di `Session` sopravvive alla disattivazione del plugin che l'ha pubblicato | `fub-kernel` · `workspace.rs` `deactivate_plugin` | spegnimento |
| 0004 | i sidecar orfani in `.fub/data/trash/` non li pota nessuno fino a `empty_trash` | `fub-kernel` · `vault.rs` `remove_trashed` | cestino |
| 0007 | `close_vault` e `with_session` fanno `canonical()` per primo: un vault sparito dal disco non si chiude più | `fub-host` · `session.rs:1015` | vault che sparisce |
| 0008 | `set_plugin_enabled(false)` non ferma i job in volo, e salta `Plugin::deactivate` | `fub-host` · `session.rs` `set_plugin_enabled` | spegnimento |
| 0010 | `close_vault` e `set_plugin_enabled` tornano `Vec<String>`: le notifiche perdono la variante tipizzata sul confine | `fub-app` · `lib.rs:118` | errori |
| 0015 | `basicSetup` da `codemirror` accanto agli import da `@codemirror/*`: due copie dello stato a un aggiornamento di distanza | `frontend` · `editor/editor.ts:9` | shell |
| 0016 | `onLingua` non torna una funzione di disiscrizione | `frontend` · `i18n/strings.ts:870` | shell |
| 0018 | risoluzione dei link rotti: scansione lineare con `resolution_key` per voce, per ogni riferimento | `fub-kernel` · `index/core.rs` `resolve_entry_in` | prestazioni |
| 0019 | `Vault::open` non rende assoluta la radice: un `set_current_dir` sposta `.fub` e `.trash` | `fub-kernel` · `vault.rs:137` | vault che sparisce |
| 0024 | il listener `click` di `showContextMenu` resta appeso se il menu si chiude con Escape | `frontend` · `ui/menu.ts:50` | shell |
| 0025 | `aggiorna` non riallinea le etichette di `select`/`radio` né `placeholder`/`min`/`max`/`step` | `frontend` · `ui/node.ts` `aggiorna` | shell |
| 0027 | `openWikilink` esce su `if (!page) return`: `[[#Sezione]]` e `[[#^blocco]]` non portano da nessuna parte | `frontend` · `panels/document.ts:902` | shell |
| 0028 | `argsFromForm` scrive `false` per un booleano opzionale mai toccato, e copre il default del kernel | `frontend` · `ui/palette.ts:163` | shell |
| 0029 | il wrapper dell'editor non espone `EditorView.destroy` | `frontend` · `editor/editor.ts` `createEditor` | shell |
| 0030 | `saveCurrent` non ha una coda: due salvataggi si accavallano e si contendono `dirty` | `frontend` · `panels/document.ts` | corse |
| 0031 | `updatePreview` innesta senza token: una risposta in ritardo riempie un'anteprima già chiusa | `frontend` · `panels/preview.ts:58` | corse |
| 0033 | `openDocument` non verifica di essere ancora quello atteso dopo l'`await` | `frontend` · `panels/document.ts:851` | corse |
| 0034 | `refreshFromKernel` non ha contatore di generazione: due giri si sovrascrivono fuori ordine | `frontend` · `panels/explorer.ts:141` | corse |
| 0035 | `dispatch_pending` gira solo `if removed_indexes`: un plugin senza indici lascia i `JobDone` in coda | `fub-kernel` · `workspace.rs:1160` | eventi persi |
| 0036 | gli eventi emessi prima dell'`AppHandle` spariscono senza traccia | `fub-app` · `lib.rs:74` | eventi persi |
| 0037 | `let _ = app.emit(...)`: un payload che non serializza si perde in silenzio | `fub-app` · `lib.rs:79` | eventi persi |
| 0038 | i comandi Tauri sono sincroni e prendono lock + I/O sul thread pool dell'IPC | `fub-app` · `lib.rs` | lock e I/O |
| 0039 | `free_name` non riserva il nome: la corsa è dichiarata e chi la perde va gestito | `fub-kernel` · `workspace.rs` `free_name` | corse |
| 0040 | `vault_replace` senza `docs` legge **ogni** documento del vault invece di chiedere all'indice | `fub-features` · `commands.rs:1287` | prestazioni |
| 0041 | il doppio controllo di `dirty` in `SearchIndex::commit` ferma le letture per tutta la durata del commit | `fub-features` · `search.rs` `commit` | prestazioni |
| 0042 | `up_to_date` fa `announced.clear()` in testa e perde le revisioni annunciate a lotti | `fub-features` · `search.rs:1585` | indice |
| 0043 | senza finestra il tetto della ricerca è `total`: `TopDocs::with_limit(total)` su un vault grande | `fub-features` · `search.rs:1146` | prestazioni |
| 0044 | `read_meta` converte un `meta.json` corrotto in `None` con `.ok()`, e la cartella risulta libera | `fub-features` · `versioning.rs:895` | versioning |
| 0045 | `rebuild_from_store` carica ogni snapshot in memoria solo per calcolarne l'impronta | `fub-features` · `versioning.rs:938` | prestazioni |
| 0046 | `VersionStore` tiene il proprio `Mutex` attraverso `data_read`/`data_write` | `fub-features` · `versioning.rs` | lock e I/O |
| 0047 | l'azione `reveal` dell'outline rilegge il documento attivo invece di portarsi dietro il proprio `doc_id` | `fub-features` · `outline.rs:109` | corse |
| 0048 | `escape_attr` non copre l'apice singolo | `fub-features` · `blocks.rs:299` | rendering |
| 0049 | `StatsView` dichiara `ContextMask::all()` e rilegge il documento intero a ogni movimento del cursore | `fub-features` · `stats.rs:82` | prestazioni |
| 0050 | `count` attraversa il testo due volte, su un percorso caldo | `fub-features` · `stats.rs:57` | prestazioni |
| 0051 | il filtro dei tag alloca un `to_lowercase()` per tag a ogni battuta | `fub-features` · `tags.rs:232` | prestazioni |
| 0052 | la chiave di stato del filtro tag è cablata e si fida dell'isolamento implicito dell'host | `fub-features` · `tags.rs:74` | stato di vista |
| 0056 | export verso `markdown.single` con `frontmatter = true`: i frontmatter dal secondo in poi finiscono nel corpo | `fub-format-markdown` · `transfer.rs:225` | markdown |
| 0057 | `link.context` si valorizza solo nel ramo `Paragraph`: i link in intestazioni e tabelle restano senza | `fub-format-markdown` · `parse.rs:570` | markdown |
| 0058 | `restore_from_trash` scrive prima di cancellare: un crash in mezzo lascia due copie | `fub-kernel` · `workspace.rs` `restore_from_trash` | cestino |
| 0059 | `link_rewrite_plan` cerca l'omonimia in `metas` e non in `entries`: gli allegati omonimi sfuggono | `fub-kernel` · `workspace.rs:3352` | anagrafe |
| 0062 | `backlinks()` torna duplicati quando un documento linka due volte lo stesso target, e il contratto non lo dice | `fub-kernel` · `graph.rs:231` | grafo |
| 0064 | un `Overflow` su un canale già disconnesso dice «riconcilia» a chi non riceverà mai la conferma | `fub-kernel` · `bus.rs:234` | eventi persi |
| 0065 | il debouncer del watcher tiene il prestito esclusivo per tutta la raffica **e** per `flush_indexes` | `fub-host` · `watcher.rs:225` | lock e I/O |
| 0067 | `Arc::get_mut` fallisce con un job in volo e `deactivate` non viene chiamato: nessun assert lo presidia | `fub-host` · `registry.rs:396` | spegnimento |
| 0068 | `check(_, Naming::New)` accetta gli spazi in testa che `normalized` trasforma in file nascosti | `fub-abi` · `rules/path_policy.rs:286` | regole |
| 0069 | un panico dentro `workspace.batch()` salta `end_batch` e blocca il dispatch per sempre | `fub-kernel` · `workspace.rs:5044` | eventi persi |
| 0070 | `prefix_len_ci` confronta i minuscoli code point per code point e sbaglia sulle espansioni (`İ`) | `fub-kernel` · `occurrences.rs:215` | regole |
| 0071 | `UndoStack::push` usa `Vec::remove(0)` oltre il tetto | `fub-kernel` · `undo.rs:99` | prestazioni |
| 0072 | `cancel_job` con un `JobId` mai accodato lascia una bandiera orfana in `Flags::live` per sempre | `fub-host` · `runner.rs:135` | spegnimento |
| 0073 | `set_view_state` scrive `view-state.json` in modo sincrono sul thread IPC, a ogni scroll | `fub-app` · `lib.rs:645` | lock e I/O |
| 0074 | riaprire un vault già aperto non aggiorna `last_opened`: i recenti restano nell'ordine vecchio | `fub-host` · `session.rs` `open` | registro vault |
| 0075 | `set_look` con `name: None` non azzera: non c'è modo di tornare al nome della cartella | `fub-host` · `vaults.rs:205` | registro vault |
| 0077 | `portable_dir` non verifica di essere scrivibile e non ripiega su `~/.config/fub` | `fub-host` · `config.rs:133` | configurazione |
| 0078 | il thread del ponte esce dal `while let Ok(...)` senza una riga di log | `fub-host` · `bridge.rs:76` | eventi persi |
| 0079 | `render_link` scrive `data-embed-heading` e ignora `block`: `![[Nota#^b]]` perde l'ancora | `fub-format-markdown` · `render.rs:285` | markdown |
| 0080 | `write_link` serializza `[[page^b]]` invece di `[[page#^b]]` quando `heading` è `None` | `fub-format-markdown` · `serialize.rs:519` | markdown |
| 0081 | lo span di un embed include il `!` nel ripiego testuale e non nel ramo comrak | `fub-format-markdown` · `parse.rs:642` | markdown |
| 0083 | `pickIcon` rimuove il nodo senza chiamare `chiudi()`: listener e trappola del fuoco restano appesi | `frontend` · `ui/menu.ts:68` | shell |
| 0085 | il nome del gruppo `radio` è globale al documento: due form con lo stesso `field` si deselezionano a vicenda | `frontend` · `ui/node.ts:825` | shell |
| 0086 | `viewAction` non è avvolta in un `try/catch`: un errore lascia la vista com'era, senza dirlo | `frontend` · `ui/views.ts:391` | errori |
| 0087 | il ripiego da `patch` a `renderDeclaredView` non ha token di sequenza | `frontend` · `ui/views.ts` `disegna` | corse |
| 0088 | `mountDeclaredViews` smonta prima di sapere se `listViews` riesce | `frontend` · `ui/views.ts:219` | corse |
| 0089 | `forget_vault` esce al primo errore I/O e lascia le forme successive dentro `view_states` | `fub-host` · `session.rs:668` | stato divergente |
| 0090 | `set_plugin_enabled` muta memoria e registro, poi propaga l'errore di `set_setting`: il disco resta indietro | `fub-host` · `session.rs` `set_plugin_enabled` | stato divergente |
| 0091 | chiudendo il vault corrente ne diventa corrente il primo in ordine **alfabetico** | `fub-host` · `session.rs:1024` | registro vault |
| 0093 | `heading_slug` non normalizza in NFC: `# Café` scritto da macOS e lo stesso link digitato altrove danno due slug diversi | `fub-abi` · `model.rs` `heading_slug` | regole |
| 0094 | un `Block::Custom` senza figli e senza renderer registrato si rende `<div>` vuoto: math, diagrammi e HTML grezzo spariscono dall'anteprima | `fub-format-markdown` · `render.rs` `render_block` | rendering |
| 0095 | non c'è modo di chiedere a un `custom_kind` «sei esprimibile in questo formato?»: l'elenco è una catena di `if`, e un secondo `FormatProvider` la riscrive da zero | `fub-format-markdown` · `serialize.rs` `write_custom_block` | confini |
| 0096 | `read_version` prende il prestito **esclusivo** del workspace per una lettura, e ferma chi scrive | `fub-host` · `session.rs` `read_version` | lock e I/O |
| 0097 | `finish_index` cammina il disco con `collect_doc_data` sotto il prestito esclusivo, una volta per apertura | `fub-kernel` · `workspace.rs` `finish_index` | lock e I/O |
| 0098 | `JobBell` ha sei `.expect("campanello avvelenato")`: la ragione è legittima ma è **una frase**, non una decisione presa | `fub-kernel` · `dispatcher.rs` `JobBell` | errori |
| 0099 | `FileSink` pania sul proprio `Mutex`: se muore chi scrive, muore per primo il canale con cui il guasto si denuncia | `fub-kernel` · `log.rs` `FileSink` | errori |
| 0100 | il conto dei lucchetti della 0120 vede solo `fub-host` e `fub-app`: `fub-kernel` ne ha quattordici file, e nessuno li guarda | `fub-kernel`, `fub-features`, `fub-sdk` · `src/` | presidi |
| 0101 | `EntryStore::store` mette la cache a posto **prima** di scrivere: se la scrittura fallisce, memoria e disco divergono fino alla riapertura | `fub-kernel` · `entries.rs` `EntryStore::store` | stato divergente |
| 0102 | fra `scrivi_meta` riuscita e `scrivi_index` fallita un `meta.json` resta «viva» sotto un indice «cestinata»: una ricostruzione dai meta risuscita la nota — gemello del 0044 | `fub-features` · `versioning.rs` `applica` | versioning |
| 0103 | la guardia sui riquadri sta **prima** di `consumaCambioSotto`: l'eco di un documento con un buffer e nessun riquadro non viene consumato mai | `frontend` · `panels/document.ts` `onEvent("document_changed")` | eventi persi |
| 0104 | `intestazioniSchede` ricostruisce **tutte** le linguette a ogni riconciliazione, e chi ci sta sopra col tab perde il fuoco | `frontend` · `ui/node.ts` `intestazioniSchede` | shell |
| 0105 | nei casi `select` e `radio` il lettore registrato da `valore` cattura `node` una volta sola e `aggiorna` non lo rilega: un campo riusato legge la forma di ieri — gemello del 0025 | `frontend` · `ui/node.ts` `disegna` | shell |
| 0106 | il `.speaking()` delle tre irregolari (search, versioning, blocks) è scritto a mano ramo per ramo, e la somma del versioning non la confronta col montaggio nessuno | `fub-host` · `mount.rs` + `tests/i_cataloghi.rs` | presidi |
| 0107 | `crateDelWorkspace` enumera `crates/*` **leggendo la cartella** invece di `[workspace] members`: un membro fuori da lì è invisibile a **entrambi** gli script, e nessuno dei due lo dichiara | `.github/scripts` · `check-cargo-versioni.mjs`, `check-cargo-feature-default.mjs` `crateDelWorkspace` | presidi |
| 0108 | `comandi_registrati` legge il **primo** `generate_handler!` che trova: la superficie IPC è intera perché un `assert` lo pretende, non perché il parser la veda | `fub-app` · `tests/dieta_ipc.rs` `comandi_registrati` | presidi |
| 0109 | gli ancoraggi **fuori tabella** di `versionamento.md` non li verifica nessuno, e oggi sono di nuovo sbagliati tutt'e due: `ABI_VERSION` è a 3773 e non 3650, `abi_compatible` a 4321 e non 4198 | `docs/versionamento.md` | presidi |

## Gli allegati

- [Le voci a leva più alta](roadmap/leva.md) — non *quando* prendere una voce ma
  **quali contano di più**: una voce che rende una capacità *inesprimibile* sta
  sopra una che la rende stretta.
- [Dove il contratto si strozza](roadmap/strozzature.md) — l'indice inverso: una
  riga per famiglia di FEATURES, con cosa servirebbe e cosa lo impedisce oggi.
- [Corrispondenza fra la numerazione vecchia e questa](roadmap/numerazione.md) —
  i commit e i commenti nel codice nominano i numeri di prima della
  riorganizzazione; lì si traducono.
- [I verbali delle decisioni chiuse](decisions/README.md) — **centotrentadue** [conta: verbali],
  uno per file. Diceva «cinquantasette» quando erano cinquantanove, e il comando
  che lo ricava era già scritto qui accanto senza che nessuno lo eseguisse: dalla
  [0072](decisions/0072-un-numero-si-scrive-accanto-a-come-si-ricava.md) lo esegue
  la CI. Non stanno qui perché questo è l'elenco di ciò che **resta da
  fare**.
