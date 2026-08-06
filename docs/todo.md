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
([0069](decisions/0069-cosa-sa-dire-un-abbonamento.md)). Centotrentatré sono
chiuse — **tutte** — e i loro verbali stanno in
[decisions/](decisions/README.md); le voci ancora aperte sono
**zero** [conta: voci-aperte], e questo file resta il loro **indice** e il
consuntivo di come sono finite.

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

## Le voci

**Zero** [conta: voci-aperte]: la tabella è vuota, ed è così che si sa che la
roadmap infrastrutturale di M4 è finita. Il numero di ogni voce resta quello con
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

La colonna *Voci* somma **zero** [conta: voci-aperte]: **ogni** seduta è a zero,
e l'ultima ad arrivarci è la 16, con la
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

## I difetti da correggere

Non sono voci di roadmap: sono **difetti nel codice di oggi**, arrivati da una
lettura esterna e tenuti solo quelli che hanno retto al confronto coi sorgenti.
Chi li prende non deve decidere niente — c'è già il file, la riga e cosa fa di
sbagliato. Otto delle quattordici affermazioni ricevute erano false o già
risolte in codice, e non stanno qui: la loro smentita sta nel resoconto della
verifica, non in un elenco di lavoro.

- [ ] **Il conto della coda non torna se il notice arriva mentre si aspetta**
  (`crates/fub-kernel/src/bus.rs`). In `Subscription::recv` e
  `recv_timeout`, i rami `self.rx.recv()` e `self.rx.recv_timeout(timeout)`
  restituiscono il notice **senza passare da `taken`**: solo `try_recv` lo
  sottrae. La finestra è stretta — ci si arriva quando la coda era vuota al
  `try_recv` e chi emette la riempie subito dopo — ma il conto sbagliato **non
  si ripara più**, cresce a ogni passaggio, e arrivato a `BACKLOG_CEILING` il
  bus comincia a buttare gli eventi ricuperabili di un abbonato che in realtà
  non è indietro di niente. Il rimedio è di una riga per ramo.
- [ ] **Il lucchetto esclusivo del watcher tiene dentro il disco**
  (`crates/fub-host/src/watcher.rs`). Il lotto prende `workspace.write()` e
  sotto quel lucchetto fa il parse di ogni file cambiato **e** `flush_indexes()`,
  che scrive gli indici sul disco. Chi legge — ricerca, autocompletamento, il
  disegno dei pannelli — aspetta la fine di un'I/O che non ha niente a che fare
  con lui, e su un vault grande la sincronizzazione da fuori si vede come una
  pausa dell'interfaccia. La regola della [0024](decisions/0024-chi-legge-non-aspetta-chi-legge.md)
  è esattamente questa, applicata qui: mutare in memoria sotto il lucchetto,
  rilasciarlo, rendere durevole fuori.
- [ ] **Un frontmatter che non si serializza sparisce senza dirlo**
  (`crates/fub-format-markdown/src/serialize.rs`). L'`if let Ok(yaml)` salta il
  blocco intero quando `to_string` fallisce: il documento si riscrive **senza il
  suo frontmatter**, e il giro completo modello → sorgente → disco diventa una
  perdita di dati muta. È il caso in cui il fallimento deve risalire, non
  essere assorbito. Accanto, e più lieve, `parse_frontmatter`
  (`crates/fub-format-markdown/src/parse.rs`): uno YAML rotto cade in
  `Frontmatter::default()` con un `_ =>`, e chi ha sbagliato una virgola nelle
  proprietà vede le proprietà svanire senza un avviso.
- [ ] **L'eco del proprio salvataggio si conta troppo tardi**
  (`frontend/src/panels/document.ts`). `buf.echi += 1` sta **dopo**
  `await api.writeDocument`, ma l'evento che quell'eco descrive lo emette il
  kernel *dentro* la scrittura, cioè prima che la promise risolva. Se arriva per
  primo, `cambioSotto` non trova nessun eco da consumare e classifica
  `riscrittura`: compare «il file è cambiato sotto di te» per una scrittura
  nostra, che è esattamente l'avviso a vuoto che quella funzione esiste per non
  dare. Va incrementato prima di chiamare, e sottratto nei rami di fallimento.
- [ ] **I campi di testo restano attaccati all'azione del primo disegno**
  (`frontend/src/ui/node.ts`). `collega` toglie e rimette l'ascoltatore a ogni
  riconciliazione; `scatta` e il `keydown` dell'Invio no — vengono registrati
  una volta sola alla costruzione del campo, con l'`ActionRef` catturato nella
  chiusura. Un `text_input` riusato dal riconciliatore (§2.8) aggiorna il valore
  e continua a mandare l'azione **vecchia**. Non è un accumulo di ascoltatori,
  come era stato riferito: è peggio, perché il campo funziona e manda la cosa
  sbagliata.
- [ ] **Che il vault avvelenato uccida l'applicazione è una scelta, e non è stata
  fatta** (`crates/fub-app/src/lib.rs`, `crates/fub-host/src/watcher.rs`,
  `crates/fub-host/src/runner.rs`). Il runner scrive `.expect("workspace
  avvelenato")` — sembra una decisione presa; gli handler IPC scrivono
  `.unwrap()` nudo, che è la stessa cosa detta per abitudine. In tutti e due i
  casi, un panico qualunque mentre si tiene il lucchetto rende l'app muta a
  ogni chiamata successiva, senza una riga che dica perché. Delle due l'una:
  se il fallimento è irrecuperabile va detto **una volta**, con un messaggio,
  invece di ripetersi a ogni IPC; se non lo è, si ricupera con `into_inner`.
  Quello che non va bene è che i due strati rispondano in modo diverso alla
  stessa domanda.
- [ ] **`id` e `class` del contenuto di una nota entrano nel DOM della shell**
  (`frontend/src/ui/sanitize.ts`). Sono ammessi apposta — l'`id` è l'ancora di
  blocco, la `class` è il contratto col provider markdown — ma la shell cerca i
  propri elementi con `document.getElementById` (`save-state`, `activity-panel`,
  `context-menu`, `key-pending`, …), e una nota che contenga HTML con uno di
  quegli `id` glielo prende. Non è un'esecuzione di codice e non arriva da un
  estraneo: arriva da un vault, che però può essere stato scaricato. Il rimedio
  non è togliere l'attributo ma **separare i due spazi di nomi** — un prefisso
  sugli `id` che vengono dal contenuto, con la risoluzione delle ancore che lo
  applica dalla stessa parte — e va scritto tenendo insieme le due metà, o
  l'ancora di blocco si rompe.

## Gli allegati

- [Le voci a leva più alta](roadmap/leva.md) — non *quando* prendere una voce ma
  **quali contano di più**: una voce che rende una capacità *inesprimibile* sta
  sopra una che la rende stretta.
- [Dove il contratto si strozza](roadmap/strozzature.md) — l'indice inverso: una
  riga per famiglia di FEATURES, con cosa servirebbe e cosa lo impedisce oggi.
- [Corrispondenza fra la numerazione vecchia e questa](roadmap/numerazione.md) —
  i commit e i commenti nel codice nominano i numeri di prima della
  riorganizzazione; lì si traducono.
- [I verbali delle decisioni chiuse](decisions/README.md) — **centodiciassette** [conta: verbali],
  uno per file. Diceva «cinquantasette» quando erano cinquantanove, e il comando
  che lo ricava era già scritto qui accanto senza che nessuno lo eseguisse: dalla
  [0072](decisions/0072-un-numero-si-scrive-accanto-a-come-si-ricava.md) lo esegue
  la CI. Non stanno qui perché questo è l'elenco di ciò che **resta da
  fare**.
