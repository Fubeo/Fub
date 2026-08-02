# Roadmap infrastrutturale — reggere il peso di FEATURES.md

Torna a [PIANO.md](PIANO.md). Questo documento chiede una cosa sola:
**[FEATURES.md](FEATURES.md) elenca ~3000 voci — quali pezzi di infrastruttura
mancano perché quelle voci si possano costruire senza riscrivere il kernel, il
contratto e la shell ogni volta?**

Sono uscite 116 voci: novantanove da sette giri sulla stessa domanda, due da una
**misura** (la §8.4, nata dalla [0024](decisions/0024-chi-legge-non-aspetta-chi-legge.md)
e chiusa dalla [0026](decisions/0026-due-query-insieme.md); e la §20.5, nata
misurando la [0052](decisions/0052-cio-che-va-storto-e-un-evento.md) contro il
codice), nove da una
**decisione di prodotto** — la [0025](decisions/0025-la-ricerca-predefinita.md),
che ha stabilito che la ricerca di Fub è built-in e di classe *omnisearch*
([seduta 21](roadmap/21-la-ricerca-predefinita.md)) — e quattro da due
**verifiche**: la §21.10 dal controllo contro il codice di un'affermazione
arrivata da fuori, e le §22.1–§22.3 dallo stesso controllo su una lettura
esterna dell'intero [FEATURES.md](FEATURES.md)
([seduta 22](roadmap/22-cosa-sa-dire-un-abbonamento.md)) — e **due** da una
**separazione**: la §16.8, staccata dal §16.7 nel momento in cui lo si chiudeva
([0056](decisions/0056-un-elenco-che-e-la-sorgente.md)), e la §22.4, staccata
dalla §22.1 allo stesso modo — «alle 9» non è la stessa domanda di «ogni ora»,
perché vuole un fuso e una regola sull'ora legale
([0069](decisions/0069-cosa-sa-dire-un-abbonamento.md)). Novantatré sono
chiuse e i loro verbali stanno in [decisions/](decisions/README.md); le altre
ventitré sono qui, e questo file è il loro **indice**.

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
al contratto per permetterlo si calcola. Le altre ventuno sedute descrivono un
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

## Le sedute

| # | Seduta | Perché insieme | Voci | P0 |
|---|---|---|---|---|
| **1** | [La forma della shell](roadmap/01-forma-della-shell.md) | dove sta cosa, prima che la superficie cresca | — | — |
| **2** | [Cosa è una view](roadmap/02-cosa-e-una-view.md) | le firme dicono insieme che una view è una funzione pura, sincrona, senza stato | — | — |
| **3** | [Chi disegna ciò che il core non conosce](roadmap/03-chi-disegna-cio-che-il-core-non-conosce.md) | una decisione sola vista da tre lati: sintassi, blocco, renderer nella shell | — | — |
| **4** | [Chi vede il modello parsato](roadmap/04-chi-vede-il-modello-parsato.md) | *chi vede la struttura di un documento?* Deciso con la [0018](decisions/0018-chi-vede-il-modello-parsato.md) | — | — |
| **5** | [Il canale dati: chi risponde, e chi instrada](roadmap/05-il-canale-dati.md) | *chi risponde a una query, e chi la instrada?* Deciso con la [0019](decisions/0019-il-canale-dati.md) | — | — |
| **6** | [Le regole in un posto solo](roadmap/06-le-regole-in-un-posto-solo.md) | *la stessa regola serve a provider, shell e a M5 a un guest WASM.* Deciso con la [0020](decisions/0020-le-regole-in-un-posto-solo.md) | — | — |
| **7** | [Il confine](roadmap/07-il-confine.md) | *la disciplina del confine, da chi lo attraversa e da chi lo presta.* Deciso con la [0021](decisions/0021-il-confine.md) | — | — |
| **8** | [Il kernel a pezzi, e chi lo monta](roadmap/08-il-kernel-a-pezzi.md) | l'oggetto-dio è scomposto ([0022](decisions/0022-il-kernel-a-pezzi.md)), il montaggio è un crate ([0023](decisions/0023-chi-monta-il-kernel.md)), il lock è a grana fine ([0024](decisions/0024-chi-legge-non-aspetta-chi-legge.md)) e la ricerca non si rimette più in fila da sé ([0026](decisions/0026-due-query-insieme.md)) | — | — |
| **9** | [Il lavoro lungo, e come un componente smette](roadmap/09-il-lavoro-lungo-e-lo-spegnimento.md) | **chiusa**: un componente che smette ([0027](decisions/0027-il-lavoro-lungo-vede-il-vault.md), [0028](decisions/0028-come-un-componente-smette.md)), il vault e le sessioni multiple ([0029](decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md)), il rilevamento che si può chiedere ([0030](decisions/0030-il-rilevamento-si-puo-chiedere.md)), chi possiede i bundle ([0031](decisions/0031-chi-possiede-i-bundle.md)) e chi esegue il lavoro lungo ([0032](decisions/0032-il-runner-dei-job.md)) | — | — |
| **10** | [Gli eventi: grana, freno, destinatari](roadmap/10-gli-eventi.md) | **chiusa**: lo stesso canale a tre distanze — chi si abbona ([0033](decisions/0033-la-grana-di-un-abbonamento.md)), cosa passa ([0034](decisions/0034-il-freno-e-il-raggruppamento.md)), chi lo mostra ([0035](decisions/0035-il-lavoro-lungo-si-racconta.md)) | — | — |
| **11** | [Le impostazioni, e i tre stati](roadmap/11-impostazioni-e-i-tre-stati.md) | tre stati che, decisi separati, nascono con tre meccanismi che non si parlano: la [0036](decisions/0036-le-impostazioni-e-i-tre-stati.md) ha chiuso le impostazioni, la [0037](decisions/0037-lo-stato-di-vista.md) lo stato di vista, la [0038](decisions/0038-il-kernel-possiede-il-sidecar.md) il sidecar dell'organizzazione; del §11.2 resta il **layout** | 1 | — |
| **12** | [Le stringhe, gli errori, il locale](roadmap/12-stringhe-errori-locale.md) | **chiusa**: il locale nel contratto ([0039](decisions/0039-il-locale-e-il-caso.md)), chi localizza ([0040](decisions/0040-chi-localizza.md)), l'errore come suo gemello ([0041](decisions/0041-un-errore-e-testo-che-qualcuno-legge.md)) e il catalogo della shell ([0042](decisions/0042-il-catalogo-della-shell.md)) | — | — |
| **13** | [L'identità di un documento](roadmap/13-identita-del-documento.md) | **chiusa**: il path è la chiave per sempre e un id stabile è una proprietà ([0043](decisions/0043-il-path-e-la-chiave.md)), lo stato per-documento ha un posto dichiarato che il kernel migra e raccoglie ([0044](decisions/0044-lo-stato-per-documento.md)), e l'undo ha due pile che non si fondono ([0045](decisions/0045-l-undo-ha-due-pile.md)) | — | — |
| **14** | [Le entry, le cartelle, la lista](roadmap/14-entry-cartelle-lista.md) | quattro lati a coppie, chiusi tutti: l'anagrafe del vault ([0046](decisions/0046-l-anagrafe-del-vault.md)) e la cartella come cittadino con la lista per cartella ([0047](decisions/0047-la-cartella-esiste-nel-kernel.md)); restano **tre** caselle del §14.1 — l'impronta degli allegati, la politica della cartella allegati e le derivate in `.fub/data/` | — | — |
| **15** | [Il disco: storage, durabilità, politiche](roadmap/15-il-disco.md) | il supporto, e le politiche di cosa ci finisce sopra; la §15.4 è chiusa con la [0048](decisions/0048-una-radice-sola.md) — una radice sola dentro il vault, la mappa del disco, e la classe di un dato dichiarata da **dove** si scrive — e ne resta la casella additiva, l'implementazione; e la §15.5 con la [0058](decisions/0058-un-nome-che-nasce.md) — due tolleranze per un nome, la sorgente di uno `Span`, e un `text_policy` che rileva senza convertire; e la §15.1 con la [0064](decisions/0064-il-supporto-sta-sotto.md) — il kernel tocca i byte di un vault da un posto solo, un `trait VaultStorage` con due implementazioni e un presidio che le confronta —, e la §15.2 è **a metà** con la [0065](decisions/0065-una-scrittura-o-c-e-o-non-c-e.md) — la scrittura del supporto o c'è o non c'è, il prezzo dell'inode si paga tranne dove quell'inode ha altri titolari, e le tre righe di `.fub/` salgono sopra il supporto nel momento in cui salirci non vuol più dire perdere qualcosa — e con la [0066](decisions/0066-un-aggiornamento-non-e-una-scrittura.md), che chiude la riga di durabilità che restava: un **aggiornamento** non è una scrittura, si rilegge sotto lock e si fonde, e il prezzo non è stato il lock ma l'MSRV a 1.89; del **recovery** è chiusa la prima delle tre caselle con la [0067](decisions/0067-il-registro-di-cio-che-e-successo.md) — il registro delle mutazioni sta in `.fub/` perché la profondità dichiara la classe, porta l'**inverso** e non il contenuto di prima, e costa l'ottava operazione sul supporto —, e restano il buffer di crash e i comandi di manutenzione; e la §15.7 è **chiusa** in due tempi come la cosa che descrive: con la [0068](decisions/0068-un-vault-si-apre-per-quel-che-si-legge.md) — un documento che non si legge o che non parsa non fa più fallire l'apertura, ma la **scansione** sì, perché il confine è se il vault sappia ancora dire quali documenti esistono — e con la [0070](decisions/0070-un-vault-si-apre-in-due-tempi.md) — l'apertura si taglia sulla scansione, il vault è utilizzabile appena si sa *cosa c'è*, e la seconda fase è un **job** con un progresso e un pulsante per fermarlo | 3 | — |
| **16** | [I crate, l'SDK, i banchi di prova](roadmap/16-crate-sdk-banchi-di-prova.md) | i banchi e i confini fra crate, **prima** di ciò che li moltiplica; il contratto ha **una** sorgente e due confini che non hanno la stessa forma ([0053](decisions/0053-il-contratto-ha-una-sorgente.md), che chiude §16.4 e §16.5 insieme come la seduta chiedeva); i due banchi di prova sono **due**, e lo stesso cappello che là dichiarava un accorpamento qui dichiarava un confine ([0054](decisions/0054-il-banco-del-lato-provider.md) lato provider, [0055](decisions/0055-il-banco-del-lato-host.md) lato host); e un elenco scritto a mano è sano se è **la sorgente** di ciò che elenca o se **si confronta** con essa, mai se ci si itera sopra — la stessa tassonomia con due risposte, perché la produzione può leggere l'inventario delle view e non la macro dei comandi Tauri ([0056](decisions/0056-un-elenco-che-e-la-sorgente.md), [0057](decisions/0057-la-dieta-dell-ipc.md)); e la §16.3 è chiusa **a metà** dalla [0071](decisions/0071-una-feature-si-spegne-dove-si-dichiara.md) — una cargo feature per bundle, tantivy dietro `search`, e il `#[cfg]` sulla **riga dell'inventario** perché è lì che si legge cosa esiste (da 120 crate a 26 compilando la sola `outline`); il secondo tempo, lo split in crate, resta con la sua condizione scritta: il primo import fra due moduli di feature | 2 | — |
| **17** | [I presidi che restano](roadmap/17-presidi-che-restano.md) | senza precedenze e senza scadenza — e il criterio della seduta ha tagliato la §17.1 in **tre**, non in due: il corpus e il fuzzing sono chiusi dalla [0060](decisions/0060-il-modello-dice-il-vero-sui-byte.md) (il costo cresceva con l'attesa), il round-trip sul corpus dalla [0061](decisions/0061-un-giro-che-non-passa-dal-modello.md) (non aspettava una macchina: aspettava il corpus); la §17.3 dall'[0062](decisions/0062-il-log-e-il-pavimento-l-evento-e-la-porta.md) — e la seduta aveva ragione a non dedicarle un turno di *quanto*: il costo del tracing non cresce con l'attesa, ma il canale della [0052](decisions/0052-cio-che-va-storto-e-un-evento.md) aveva due destinazioni e non una; resta il **banco delle prestazioni**, che aspetta una macchina e non una decisione | 2 | — |
| **18** | [L'editor e la tastiera, e ciò che resta della shell](roadmap/18-editor-e-tastiera.md) | ciò che resta della shell — comprese le quattro code delle sedute 1–4, chiuse | 6 | — |
| **19** | [Debito riportato dal quarto audit](roadmap/19-debito-quarto-audit.md) | nessuna voce propria: quattro **rimandi** ai quattro giri di audit, di cui uno chiuso; restano **tre** caselle, e il lavoro sta nelle sedute che le hanno assorbite | — | — |
| **20** | [Quando qualcosa va storto, chi lo dice e a chi](roadmap/20-quando-qualcosa-va-storto.md) | lo stesso percorso interrotto in tre punti, e tutti e tre sono chiusi: l'alimentazione ha un esito ([0051](decisions/0051-l-alimentazione-risponde.md)), ciò che va storto è un evento e il kernel non lo butta più ([0052](decisions/0052-cio-che-va-storto-e-un-evento.md)); restano la metà umana e una voce nata misurando | 2 | — |
| **21** | [La ricerca predefinita, e cosa le manca per esserlo](roadmap/21-la-ricerca-predefinita.md) | le quattro di firma sono state decise ([0049](decisions/0049-una-posizione-dentro-un-documento.md), [0050](decisions/0050-cosa-si-chiede-a-una-ricerca.md)); quel che resta è **dove quel comportamento si vede**, cosa lo rende regolabile, cosa gli darà da mangiare, e la sola misura che dice se è veloce | 6 | — |
| **22** | [Cosa sa dire un abbonamento](roadmap/22-cosa-sa-dire-un-abbonamento.md) | tre lati della stessa dichiarazione di interesse — *quando*, *cosa è cambiato*, *per quale esemplare* — nati da una **verifica**, e nessuno scade col freeze; tutti e tre chiusi: il terzo dalla [0063](decisions/0063-la-maschera-e-dell-esemplare.md) (la maschera è dell'esemplare, additiva, senza un settimo ponte) e gli altri due dalla [0069](decisions/0069-cosa-sa-dire-un-abbonamento.md), che ha ripreso i due tentati con lei e **ritirati** e ha risposto alla domanda che il ritiro poneva — *chi la valuta* —: il *cosa* si filtra per aspetto e si legge per nome, il *quando* non sta nella maschera affatto perché una maschera filtra e non causa. Il cappello della seduta diceva «tre estensioni della stessa maschera» e aveva torto due volte su tre; resta la §22.4, l'orario di parete | 1 | — |

## Le voci

Ventitré. Il numero è quello con cui le nomina il resto del repo.

**Se una voce è in questa tabella, è aperta.** Non ci sono spunte da leggere:
una voce chiusa **sparisce** — dalla tabella, dal conteggio della sua seduta e
dal file della seduta — e il suo verbale va in
[decisions/](decisions/README.md). L'assenza è il segnale, e non può mentire:
una casella spuntata resta una promessa scritta da qualcuno, una riga che non
c'è più è stata tolta da chi ha spostato il verbale. Dentro il file di una
seduta le caselle ci sono, e dicono a che punto è la singola voce.

**Ma una voce chiusa può lasciare una casella, e quella casella non è in nessun
totale.** La colonna *Voci* conta le voci **aperte**, e la sua somma per riga fa
ventitré come deve; il residuo di una voce **chiusa** è un'altra specie e finora
non aveva dove essere contato — che è il modo in cui la riga della seduta 14 ha
detto «due caselle» mentre il suo file ne aveva tre, e la 19 non ha detto niente
avendone tre. Le caselle residue oggi sono **nove**, e stanno in cinque posti:
[§14.1](roadmap/14-entry-cartelle-lista.md#141-il-vault-non-è-solo-documenti)
(tre: l'impronta degli allegati, la politica della cartella allegati, le
derivate),
[§15.4](roadmap/15-il-disco.md#154-i-dati-persistiti-non-hanno-né-una-mappa-né-una-classe)
(una: l'implementazione additiva delle due radici), il
[§16.6](roadmap/16-crate-sdk-banchi-di-prova.md#166-dieta-dellipc) (una: i cinque
bespoke da migrare — ed è la prima casella residua che **non vive in una riga di
prosa**, perché il suo numero lo asserisce un test), la
[seduta 19](roadmap/19-debito-quarto-audit.md) (tre rimandi) e la
[§22.3](roadmap/22-cosa-sa-dire-un-abbonamento.md#223-la-maschera-di-ridisegno-è-della-view-non-dellesemplare)
(una: la query incorporata in una nota, che non è un esemplare di `ViewSpec` e
non ha un canale di invalidazione affatto). Non diventano voci
— non reggerebbero il criterio in testa a questo file — ma non devono nemmeno
sparire senza essere state fatte. La casella della §20.2 — i ventisette punti
che scrivono su `stderr` — non è più fra queste: la
[0062](decisions/0062-il-log-e-il-pavimento-l-evento-e-la-porta.md) l'ha chiusa
dando loro due destinazioni invece di una. E nemmeno quella della §15.1 — le tre
righe di `.fub/` che scrivevano con `write_atomic`: era l'unica che sapesse già
**quale voce** l'avrebbe risolta, e quella voce l'ha risolta
([0065](decisions/0065-una-scrittura-o-c-e-o-non-c-e.md)). Un indirizzo scritto
su una casella si è dimostrato qualcosa di più di un auspicio, ed è la ragione
per cui vale la pena scriverlo quando c'è.

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
| **§1.2** | [Smontare il monolite](roadmap/18-editor-e-tastiera.md#12-smontare-il-monolite) | 18. L'editor e la tastiera *(da 1)* | shell | **P1** |
| **§2.9** | [Prestazioni della UI](roadmap/18-editor-e-tastiera.md#29-prestazioni-della-ui) | 18. L'editor e la tastiera *(da 2)* | shell | **P2** |
| **§3.3** | [La UI di un plugin non ha modo di entrare nella shell](roadmap/18-editor-e-tastiera.md#33-la-ui-di-un-plugin-non-ha-modo-di-entrare-nella-shell) | 18. L'editor e la tastiera *(da 3)* | shell | **P1** |
| **§4.4** | [Due parser per la stessa sintassi](roadmap/18-editor-e-tastiera.md#44-due-parser-per-la-stessa-sintassi) | 18. L'editor e la tastiera *(da 4)* | shell | **P1** |
| **§11.2** | [Tre stati diversi, zero contenitori](roadmap/11-impostazioni-e-i-tre-stati.md#112-tre-stati-diversi-zero-contenitori) | 11. Le impostazioni, e i tre stati | shell | **P2** |
| **§15.2** | [Durabilità e recovery](roadmap/15-il-disco.md#152-durabilità-e-recovery) | 15. Il disco: storage, durabilità, politiche | kernel | **P2** |
| **§15.3** | [Una versione di schema su ogni formato persistito](roadmap/15-il-disco.md#153-una-versione-di-schema-su-ogni-formato-persistito) | 15. Il disco: storage, durabilità, politiche | kernel | **P2** |
| **§15.6** | [La politica di esclusione è una costante di compilazione](roadmap/15-il-disco.md#156-la-politica-di-esclusione-è-una-costante-di-compilazione) | 15. Il disco: storage, durabilità, politiche | kernel | **P2** |
| **§16.3** | [Un crate per bundle di feature](roadmap/16-crate-sdk-banchi-di-prova.md#163-un-crate-per-bundle-di-feature) | 16. I crate, l'SDK, i banchi di prova | presidi | **P1** |
| **§16.8** | [La prosa che conta i sorgenti non ha nessun presidio](roadmap/16-crate-sdk-banchi-di-prova.md#168-la-prosa-che-conta-i-sorgenti-non-ha-nessun-presidio) | 16. I crate, l'SDK, i banchi di prova | presidi | **P1** |
| **§17.1** | [Corpus, fuzzing, prestazioni](roadmap/17-presidi-che-restano.md#171-corpus-fuzzing-prestazioni) | 17. I presidi che restano | presidi | **P2** |
| **§17.2** | [Test della shell](roadmap/17-presidi-che-restano.md#172-test-della-shell) | 17. I presidi che restano | presidi | **P2** |
| **§18.1** | [Editor](roadmap/18-editor-e-tastiera.md#181-editor) | 18. L'editor e la tastiera | shell | **P1** |
| **§18.2** | [Comandi e tastiera](roadmap/18-editor-e-tastiera.md#182-comandi-e-tastiera) | 18. L'editor e la tastiera | shell | **P1** |
| **§20.4** | [La shell non ha una superficie dove dire niente, e il salvataggio non ha esito](roadmap/20-quando-qualcosa-va-storto.md#204-la-shell-non-ha-una-superficie-dove-dire-niente-e-il-salvataggio-non-ha-esito) | 20. Quando qualcosa va storto | shell | **P1** |
| **§20.5** | [Il budget del dispatch tronca senza guardare cosa sta troncando](roadmap/20-quando-qualcosa-va-storto.md#205-il-budget-del-dispatch-tronca-senza-guardare-cosa-sta-troncando) | 20. Quando qualcosa va storto | kernel | **P2** |
| **§21.4** | [La ricerca dentro la nota aperta non esiste](roadmap/21-la-ricerca-predefinita.md#214-la-ricerca-dentro-la-nota-aperta-non-esiste) | 21. La ricerca predefinita | shell | **P1** |
| **§21.5** | [Quattro superfici cercano, e rischiano di nascere con quattro ranking](roadmap/21-la-ricerca-predefinita.md#215-quattro-superfici-cercano-e-rischiano-di-nascere-con-quattro-ranking) | 21. La ricerca predefinita | shell | **P1** |
| **§21.6** | [I pesi dei campi sono una costante di compilazione](roadmap/21-la-ricerca-predefinita.md#216-i-pesi-dei-campi-sono-una-costante-di-compilazione) | 21. La ricerca predefinita | kernel | **P2** |
| **§21.7** | [Ricerche recenti, e la nota che la ricerca non ha trovato](roadmap/21-la-ricerca-predefinita.md#217-ricerche-recenti-e-la-nota-che-la-ricerca-non-ha-trovato) | 21. La ricerca predefinita | shell | **P2** |
| **§21.8** | [Il testo che sta dentro gli allegati](roadmap/21-la-ricerca-predefinita.md#218-il-testo-che-sta-dentro-gli-allegati) | 21. La ricerca predefinita | kernel | **P2** |
| **§21.9** | [Una query costa 23 ms su duemila note, e nessuno sa perché](roadmap/21-la-ricerca-predefinita.md#219-una-query-costa-23-ms-su-duemila-note-e-nessuno-sa-perché) | 21. La ricerca predefinita | kernel | **P1** |
| **§22.4** | [Un orario di parete non è un intervallo](roadmap/22-cosa-sa-dire-un-abbonamento.md#224-un-orario-di-parete-non-è-un-intervallo) | 22. Cosa sa dire un abbonamento | contratto | **P1** |

## Gli allegati

- [Le voci a leva più alta](roadmap/leva.md) — non *quando* prendere una voce ma
  **quali contano di più**: una voce che rende una capacità *inesprimibile* sta
  sopra una che la rende stretta.
- [Dove il contratto si strozza](roadmap/strozzature.md) — l'indice inverso: una
  riga per famiglia di FEATURES, con cosa servirebbe e cosa lo impedisce oggi.
- [Corrispondenza fra la numerazione vecchia e questa](roadmap/numerazione.md) —
  i commit e i commenti nel codice nominano i numeri di prima della
  riorganizzazione; lì si traducono.
- [I verbali delle decisioni chiuse](decisions/README.md) — **settantuno**,
  uno per file (`ls docs/decisions/0*.md | wc -l`; diceva «cinquantasette», ed
  erano cinquantanove). Non stanno qui perché questo è l'elenco di ciò che **resta da
  fare**.
