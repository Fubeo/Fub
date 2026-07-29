# Roadmap infrastrutturale — reggere il peso di FEATURES.md

Torna a [PIANO.md](PIANO.md). Questo documento chiede una cosa sola:
**[FEATURES.md](FEATURES.md) elenca ~3000 voci — quali pezzi di infrastruttura
mancano perché quelle voci si possano costruire senza riscrivere il kernel, il
contratto e la shell ogni volta?**

Sono uscite 114 voci: novantanove da sette giri sulla stessa domanda, due da una
**misura** (la §8.4, nata dalla [0024](decisions/0024-chi-legge-non-aspetta-chi-legge.md)
e chiusa dalla [0026](decisions/0026-due-query-insieme.md); e la §20.5, nata
misurando la [0052](decisions/0052-cio-che-va-storto-e-un-evento.md) contro il
codice), nove da una
**decisione di prodotto** — la [0025](decisions/0025-la-ricerca-predefinita.md),
che ha stabilito che la ricerca di FubMD è built-in e di classe *omnisearch*
([seduta 21](roadmap/21-la-ricerca-predefinita.md)) — e quattro da due
**verifiche**: la §21.10 dal controllo contro il codice di un'affermazione
arrivata da fuori, e le §22.1–§22.3 dallo stesso controllo su una lettura
esterna dell'intero [FEATURES.md](FEATURES.md)
([seduta 22](roadmap/22-cosa-sa-dire-un-abbonamento.md)). Ottanta sono
chiuse e i loro verbali stanno in [decisions/](decisions/README.md); le altre
trentaquattro sono qui, e questo file è il loro **indice**.

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
| **14** | [Le entry, le cartelle, la lista](roadmap/14-entry-cartelle-lista.md) | quattro lati a coppie, chiusi tutti: l'anagrafe del vault ([0046](decisions/0046-l-anagrafe-del-vault.md)) e la cartella come cittadino con la lista per cartella ([0047](decisions/0047-la-cartella-esiste-nel-kernel.md)); restano **tre** caselle del §14.1 — l'impronta degli allegati, la politica della cartella allegati e le derivate in `.fubmd/data/` | — | — |
| **15** | [Il disco: storage, durabilità, politiche](roadmap/15-il-disco.md) | il supporto, e le politiche di cosa ci finisce sopra; la §15.4 è chiusa con la [0048](decisions/0048-una-radice-sola.md) — una radice sola dentro il vault, la mappa del disco, e la classe di un dato dichiarata da **dove** si scrive — e ne resta la casella additiva, l'implementazione | 6 | — |
| **16** | [I crate, l'SDK, i banchi di prova](roadmap/16-crate-sdk-banchi-di-prova.md) | i banchi e i confini fra crate, **prima** di ciò che li moltiplica | 7 | — |
| **17** | [I presidi che restano](roadmap/17-presidi-che-restano.md) | senza precedenze e senza scadenza | 3 | — |
| **18** | [L'editor e la tastiera, e ciò che resta della shell](roadmap/18-editor-e-tastiera.md) | ciò che resta della shell — comprese le quattro code delle sedute 1–4, chiuse | 6 | — |
| **19** | [Debito riportato dal quarto audit](roadmap/19-debito-quarto-audit.md) | nessuna voce propria: quattro **rimandi** ai quattro giri di audit, di cui uno chiuso; restano **tre** caselle, e il lavoro sta nelle sedute che le hanno assorbite | — | — |
| **20** | [Quando qualcosa va storto, chi lo dice e a chi](roadmap/20-quando-qualcosa-va-storto.md) | lo stesso percorso interrotto in tre punti, e tutti e tre sono chiusi: l'alimentazione ha un esito ([0051](decisions/0051-l-alimentazione-risponde.md)), ciò che va storto è un evento e il kernel non lo butta più ([0052](decisions/0052-cio-che-va-storto-e-un-evento.md)); restano la metà umana e una voce nata misurando | 2 | — |
| **21** | [La ricerca predefinita, e cosa le manca per esserlo](roadmap/21-la-ricerca-predefinita.md) | le quattro di firma sono state decise ([0049](decisions/0049-una-posizione-dentro-un-documento.md), [0050](decisions/0050-cosa-si-chiede-a-una-ricerca.md)); quel che resta è **dove quel comportamento si vede**, cosa lo rende regolabile, cosa gli darà da mangiare, e la sola misura che dice se è veloce | 6 | — |
| **22** | [Cosa sa dire un abbonamento](roadmap/22-cosa-sa-dire-un-abbonamento.md) | tre lati della stessa dichiarazione di interesse — *quando*, *cosa è cambiato*, *per quale esemplare* — e decise separate darebbero tre estensioni della stessa maschera disegnate da tre parti; nate da una **verifica**, e nessuna scade col freeze | 3 | — |

## Le voci

Trentaquattro. Il numero è quello con cui le nomina il resto del repo.

**Se una voce è in questa tabella, è aperta.** Non ci sono spunte da leggere:
una voce chiusa **sparisce** — dalla tabella, dal conteggio della sua seduta e
dal file della seduta — e il suo verbale va in
[decisions/](decisions/README.md). L'assenza è il segnale, e non può mentire:
una casella spuntata resta una promessa scritta da qualcuno, una riga che non
c'è più è stata tolta da chi ha spostato il verbale. Dentro il file di una
seduta le caselle ci sono, e dicono a che punto è la singola voce.

**Ma una voce chiusa può lasciare una casella, e quella casella non è in nessun
totale.** La colonna *Voci* conta le voci **aperte**, e la sua somma per riga fa
trentaquattro come deve; il residuo di una voce **chiusa** è un'altra specie e finora
non aveva dove essere contato — che è il modo in cui la riga della seduta 14 ha
detto «due caselle» mentre il suo file ne aveva tre, e la 19 non ha detto niente
avendone tre. Le caselle residue oggi sono **otto**, e stanno in quattro posti:
[§14.1](roadmap/14-entry-cartelle-lista.md#141-il-vault-non-è-solo-documenti)
(tre: l'impronta degli allegati, la politica della cartella allegati, le
derivate), [§15.4](roadmap/15-il-disco.md#154-i-dati-persistiti-non-hanno-né-una-mappa-né-una-classe)
(una: l'implementazione additiva delle due radici),
[§20.2](roadmap/20-quando-qualcosa-va-storto.md#202-ciò-che-va-storto-ha-un-canale-nel-contratto-e-nessuna-destinazione)
(una: portare dentro il canale i ventisette punti che scrivono su `stderr`) e la
[seduta 19](roadmap/19-debito-quarto-audit.md) (tre rimandi). Non diventano voci
— non reggerebbero il criterio in testa a questo file — ma non devono nemmeno
sparire senza essere state fatte.

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
| **§15.1** | [Astrazione sullo storage](roadmap/15-il-disco.md#151-astrazione-sullo-storage) | 15. Il disco: storage, durabilità, politiche | kernel | **P2** |
| **§15.2** | [Durabilità e recovery](roadmap/15-il-disco.md#152-durabilità-e-recovery) | 15. Il disco: storage, durabilità, politiche | kernel | **P2** |
| **§15.3** | [Una versione di schema su ogni formato persistito](roadmap/15-il-disco.md#153-una-versione-di-schema-su-ogni-formato-persistito) | 15. Il disco: storage, durabilità, politiche | kernel | **P2** |
| **§15.5** | [Politica dei path e del testo, in un modulo solo](roadmap/15-il-disco.md#155-politica-dei-path-e-del-testo-in-un-modulo-solo) | 15. Il disco: storage, durabilità, politiche | kernel | **P2** |
| **§15.6** | [La politica di esclusione è una costante di compilazione](roadmap/15-il-disco.md#156-la-politica-di-esclusione-è-una-costante-di-compilazione) | 15. Il disco: storage, durabilità, politiche | kernel | **P2** |
| **§15.7** | [L'apertura del vault è tutto-o-niente, sincrona e senza ritorno](roadmap/15-il-disco.md#157-lapertura-del-vault-è-tutto-o-niente-sincrona-e-senza-ritorno) | 15. Il disco: storage, durabilità, politiche | kernel | **P1** |
| **§16.1** | [L'SDK come superficie di riuso — oggi è quasi vuoto](roadmap/16-crate-sdk-banchi-di-prova.md#161-lsdk-come-superficie-di-riuso--oggi-è-quasi-vuoto) | 16. I crate, l'SDK, i banchi di prova | presidi | **P1** |
| **§16.2** | [Il banco di prova del kernel è copiato diciotto volte](roadmap/16-crate-sdk-banchi-di-prova.md#162-il-banco-di-prova-del-kernel-è-copiato-diciotto-volte) | 16. I crate, l'SDK, i banchi di prova | presidi | **P1** |
| **§16.3** | [Un crate per bundle di feature](roadmap/16-crate-sdk-banchi-di-prova.md#163-un-crate-per-bundle-di-feature) | 16. I crate, l'SDK, i banchi di prova | presidi | **P1** |
| **§16.4** | [Il contratto si scrive quattro volte a mano](roadmap/16-crate-sdk-banchi-di-prova.md#164-il-contratto-si-scrive-quattro-volte-a-mano) | 16. I crate, l'SDK, i banchi di prova | presidi | **P1** |
| **§16.5** | [Mirror TS↔Rust generati, non scritti](roadmap/16-crate-sdk-banchi-di-prova.md#165-mirror-tsrust-generati-non-scritti) | 16. I crate, l'SDK, i banchi di prova | presidi | **P1** |
| **§16.6** | [Dieta dell'IPC](roadmap/16-crate-sdk-banchi-di-prova.md#166-dieta-dellipc) | 16. I crate, l'SDK, i banchi di prova | presidi | **P1** |
| **§16.7** | [Due presidi sono esaustivi *a memoria*, non per costruzione](roadmap/16-crate-sdk-banchi-di-prova.md#167-due-presidi-sono-esaustivi-a-memoria-non-per-costruzione) | 16. I crate, l'SDK, i banchi di prova | presidi | **P1** |
| **§17.1** | [Corpus, fuzzing, prestazioni](roadmap/17-presidi-che-restano.md#171-corpus-fuzzing-prestazioni) | 17. I presidi che restano | presidi | **P2** |
| **§17.2** | [Test della shell](roadmap/17-presidi-che-restano.md#172-test-della-shell) | 17. I presidi che restano | presidi | **P2** |
| **§17.3** | [Osservabilità](roadmap/17-presidi-che-restano.md#173-osservabilità) | 17. I presidi che restano | presidi | **P2** |
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
| **§22.1** | [Un abbonamento non sa dire quando](roadmap/22-cosa-sa-dire-un-abbonamento.md#221-un-abbonamento-non-sa-dire-quando) | 22. Cosa sa dire un abbonamento | contratto | **P1** |
| **§22.2** | [Un evento dice quale documento, non cosa è cambiato](roadmap/22-cosa-sa-dire-un-abbonamento.md#222-un-evento-dice-quale-documento-non-cosa-è-cambiato) | 22. Cosa sa dire un abbonamento | contratto | **P1** |
| **§22.3** | [La maschera di ridisegno è della view, non dell'esemplare](roadmap/22-cosa-sa-dire-un-abbonamento.md#223-la-maschera-di-ridisegno-è-della-view-non-dellesemplare) | 22. Cosa sa dire un abbonamento | contratto | **P1** |

## Gli allegati

- [Le voci a leva più alta](roadmap/leva.md) — non *quando* prendere una voce ma
  **quali contano di più**: una voce che rende una capacità *inesprimibile* sta
  sopra una che la rende stretta.
- [Dove il contratto si strozza](roadmap/strozzature.md) — l'indice inverso: una
  riga per famiglia di FEATURES, con cosa servirebbe e cosa lo impedisce oggi.
- [Corrispondenza fra la numerazione vecchia e questa](roadmap/numerazione.md) —
  i commit e i commenti nel codice nominano i numeri di prima della
  riorganizzazione; lì si traducono.
- [I verbali delle decisioni chiuse](decisions/README.md) — cinquantadue, uno
  per file. Non stanno qui perché questo è l'elenco di ciò che **resta da
  fare**.
