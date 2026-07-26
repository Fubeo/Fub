# Roadmap infrastrutturale — reggere il peso di FEATURES.md

Torna a [PIANO.md](PIANO.md). Questo documento chiede una cosa sola:
**[FEATURES.md](FEATURES.md) elenca ~3000 voci — quali pezzi di infrastruttura
mancano perché quelle voci si possano costruire senza riscrivere il kernel, il
contratto e la shell ogni volta?**

Sette giri sulla stessa domanda hanno prodotto novantanove voci. Trentasette
sono chiuse, e i loro verbali stanno in [docs/decisions/](decisions/README.md);
le altre sessantadue sono qui, e questo file è il loro **indice**.

## Come è organizzato

Le voci non stanno raggruppate per **strato** (contratto, kernel, shell,
presidi) ma per **seduta**: un capitolo è un insieme di voci che conviene
decidere in una volta sola, perché sono la stessa domanda vista da lati diversi
e deciderle separate significa deciderle male. Il piano lo diceva già, sparso in
una ventina di note («vanno decise insieme», «va prima di», «o due terzi della
risposta saranno inutilizzabili»); questa è quella conoscenza messa nella
struttura invece che nelle note.

Una seduta è un file in [`roadmap/`](roadmap/). Dentro ci sono le sue voci per
esteso, e in testa la ragione per cui stanno insieme — che è la parte da leggere
prima di aprire l'editor.

Lo strato resta, come etichetta su ogni voce, perché è ciò che ne fissa la
**scadenza**:

- **contratto** — la forma scade col **freeze di M4**: oggi costa un campo,
  dopo costa una migrazione di versione. È il criterio che fa di una voce una
  P0, non la sua importanza.
- **kernel**, **shell**, **presidi** — l'implementazione può seguire; se una di
  queste voci è P0 è perché ha una **metà** che è firma (la chiave dei nodi, il
  `durability` di `data_write`, il routing dichiarato alla registrazione).

Le priorità sono tre: **P0** prima del freeze, **P1** insieme a M3, **P2**
quando la scala lo chiede. Le sedute sono in ordine di lavoro: chi le prende
dall'alto trova le precondizioni prima di ciò che le richiede, e l'*ordine
consigliato* che i sei giri avevano scritto in prosa è stato assorbito lì —
nelle intestazioni delle sedute e nelle marcature delle voci.

## Il criterio

FEATURES.md è impossibile da implementare a mano una voce alla volta. È
possibile solo se **la stragrande maggioranza di quelle voci è un provider** —
un `ViewProvider`, un `CommandProvider`, un `IndexProvider`, un
`FormatProvider`, un `EventHandler` — che si registra e sparisce dal kernel.
Ogni voce che oggi *non può* essere un provider diventa un comando Tauri
bespoke, un pannello cablato in `main.ts` e un ramo `if` nel kernel: è il debito
che il piano ha già dichiarato ("UI di produzione = IPC bespoke") e che con la
scala di FEATURES diventa il progetto stesso.

Le domande con cui i giri hanno cercato quelle voci restano il modo di trovarne
di nuove, e vanno fatte in quest'ordine:

1. **Cosa manca** — un pezzo che non c'è (primo giro).
2. **Cosa c'è con la forma sbagliata** — e che il freeze rende definitivo, perché
   una firma esistente si cambia solo con una migrazione (secondo e terzo giro).
3. **Cosa c'è e non mantiene** — un varco che il contratto dichiara aperto e che
   non regge il primo cliente vero, o una promessa vera a metà e in silenzio
   (quarto e quinto giro).
4. **Quante volte è scritto, e da cosa cresce quel numero** — il moltiplicatore
   invece della migrazione: non lo si paga aggiungendo la voce, lo si paga a ogni
   voce successiva, ed è per questo che resta invisibile finché il fattore è
   basso (sesto giro).

E una quinta, che il quinto giro ha aggiunto e nessuno aveva ancora fatto: **la
risposta a una domanda che nessuno ha posto** — chi vede il modello parsato, che
cosa è una view mentre è viva, chi può rispondere a una query, come si spegne il
tutto. Le risposte che i giri hanno trovato scritte nelle firme erano,
nell'ordine: solo il kernel; una funzione pura e sincrona senza stato; il kernel
per sette varianti su nove, e nessuno poteva scavalcarlo; non si spegne. Le prime
tre sono state riaperte e decise ([0018](decisions/0018-chi-vede-il-modello-parsato.md),
[0016](decisions/0016-cosa-e-una-view.md) e [0019](decisions/0019-il-canale-dati.md));
la quarta è ancora quella, e sta nella
[seduta 9](roadmap/09-il-lavoro-lungo-e-lo-spegnimento.md).

E una sesta, dal **settimo giro**: **cosa fallisce senza produrre nessun
segnale** — quale sbaglio di un plugin, del kernel, dell'utente o di un'altra
applicazione che tocca il vault non ha oggi modo di essere notato, né da un
test, né da un log, né dall'utente, finché non ha già fatto danno. È la domanda
che ha aperto la [seduta 20](roadmap/20-quando-qualcosa-va-storto.md), e ha una
proprietà che le altre non hanno: **quasi nulla di ciò che trova scade col
freeze**, quindi nessun criterio di scadenza l'avrebbe mai portata in cima —
mentre il costo non è rimandato al freeze, si sta pagando adesso, in difetti che
non lasciano traccia. Il presupposto da non dare per buono, cercandola: che un
`Result` restituito sia un `Result` letto, e che un messaggio scritto sia un
messaggio arrivato.

## Le sedute

| # | Seduta | Perché insieme | Voci | P0 |
|---|---|---|---|---|
| **1** | [La forma della shell](roadmap/01-forma-della-shell.md) | dove sta cosa, prima che la superficie cresca | — | — |
| **2** | [Cosa è una view](roadmap/02-cosa-e-una-view.md) | le firme dicono insieme che una view è una funzione pura, sincrona, senza stato | — | — |
| **3** | [Chi disegna ciò che il core non conosce](roadmap/03-chi-disegna-cio-che-il-core-non-conosce.md) | una decisione sola vista da tre lati: sintassi, blocco, renderer nella shell | — | — |
| **4** | [Chi vede il modello parsato](roadmap/04-chi-vede-il-modello-parsato.md) | *chi vede la struttura di un documento?* Deciso con la [0018](decisions/0018-chi-vede-il-modello-parsato.md) | — | — |
| **5** | [Il canale dati: chi risponde, e chi instrada](roadmap/05-il-canale-dati.md) | *chi risponde a una query, e chi la instrada?* Deciso con la [0019](decisions/0019-il-canale-dati.md) | — | — |
| **6** | [Le regole in un posto solo](roadmap/06-le-regole-in-un-posto-solo.md) | la stessa regola serve a provider, shell e a M5 a un guest WASM | 2 | — |
| **7** | [Il confine: quante volte si scrive la disciplina](roadmap/07-il-confine.md) | la disciplina del confine, da chi lo attraversa e da chi lo presta | 6 | 2 |
| **8** | [Il kernel a pezzi, e chi lo monta](roadmap/08-il-kernel-a-pezzi.md) | l'oggetto-dio va scomposto **prima** di ciò che gli atterra sopra | 3 | — |
| **9** | [Il lavoro lungo, e come un componente smette](roadmap/09-il-lavoro-lungo-e-lo-spegnimento.md) | le tre facce del momento in cui un componente smette | 7 | 2 |
| **10** | [Gli eventi: grana, freno, destinatari](roadmap/10-gli-eventi.md) | lo stesso canale a tre distanze: chi si abbona, cosa passa, chi lo mostra | 3 | 1 |
| **11** | [Le impostazioni, e i tre stati](roadmap/11-impostazioni-e-i-tre-stati.md) | tre stati che, decisi separati, nascono con tre meccanismi che non si parlano | 3 | — |
| **12** | [Le stringhe, gli errori, il locale](roadmap/12-stringhe-errori-locale.md) | chi localizza le stringhe localizza anche gli errori | 4 | 3 |
| **13** | [L'identità di un documento](roadmap/13-identita-del-documento.md) | l'identità, ciò che le sta attaccato, la sua storia | 3 | 2 |
| **14** | [Le entry, le cartelle, la lista](roadmap/14-entry-cartelle-lista.md) | lo stesso lavoro visto da quattro lati | 4 | — |
| **15** | [Il disco: storage, durabilità, politiche](roadmap/15-il-disco.md) | il supporto, e le politiche di cosa ci finisce sopra | 7 | 1 |
| **16** | [I crate, l'SDK, i banchi di prova](roadmap/16-crate-sdk-banchi-di-prova.md) | i banchi e i confini fra crate, **prima** di ciò che li moltiplica | 7 | — |
| **17** | [I presidi che restano](roadmap/17-presidi-che-restano.md) | senza precedenze e senza scadenza | 3 | — |
| **18** | [L'editor e la tastiera, e ciò che resta della shell](roadmap/18-editor-e-tastiera.md) | ciò che resta della shell — comprese le quattro code delle sedute 1–4, chiuse | 6 | — |
| **19** | [Debito riportato dal quarto audit](roadmap/19-debito-quarto-audit.md) | le voci ancora aperte dei quattro giri di audit | — | — |
| **20** | [Quando qualcosa va storto, chi lo dice e a chi](roadmap/20-quando-qualcosa-va-storto.md) | lo stesso percorso interrotto in tre punti: chi non può dirlo, chi lo butta via, chi non ha dove scriverlo | 4 | 1 |

## Le voci

Sessantadue. Il numero è quello con cui le nomina il resto del repo.

**Se una voce è in questa tabella, è aperta.** Non ci sono spunte da leggere qui
e non servono: una voce chiusa **sparisce** — da questa tabella, dal conteggio
della sua seduta e dal file della seduta — e il suo verbale va in
[decisions/](decisions/README.md). L'assenza è il segnale, e ha il pregio di non
poter mentire: una casella spuntata resta una promessa scritta da qualcuno,
mentre una riga che non c'è più è stata tolta da chi ha spostato il verbale.
Dentro il file di una seduta le caselle ci sono, e dicono a che punto è la
singola voce: oggi ne hanno di spuntate la
[§1.2](roadmap/18-editor-e-tastiera.md#12-smontare-il-monolite) (tre punti su
quattro — l'albero dei moduli, il modo unico di montare un pannello, e il
protocollo di disegno che la seduta 2 le bloccava), la
[§3.3](roadmap/18-editor-e-tastiera.md#33-la-ui-di-un-plugin-non-ha-modo-di-entrare-nella-shell)
(la **decisione** è presa con la [0017](decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md)
e resta il grafo, che è l'ultimo pannello nativo), la
[§4.4](roadmap/18-editor-e-tastiera.md#44-due-parser-per-la-stessa-sintassi)
(il blocco è tolto dalla [0018](decisions/0018-chi-vede-il-modello-parsato.md), e
resta il moltiplicatore) e la
[§18.1](roadmap/18-editor-e-tastiera.md#181-editor) (il ponte inverso, chiuso
con la [decisione 0007](decisions/0007-contesto-di-sessione.md)).

**Una seduta chiusa non tiene le proprie code.** Le prime quattro sedute hanno
il verbale e non hanno più niente da decidere, ma qualcuna aveva lasciato dietro
di sé dei punti di **esecuzione**: sono tutti di strato shell, e sono stati
scritti in fondo alla [seduta 18](roadmap/18-editor-e-tastiera.md), che è la
seduta definita per esclusione — *ciò che resta della shell*. Il motivo è che una
coda lasciata in fondo a un capitolo concluso non la rilegge nessuno, mentre lì
sta accanto alle voci con cui si incastra, e l'ordine in cui si sbloccano
(§1.2 → §3.3) si vede solo tenendole nello stesso file. **Il numero resta il
suo**: `§4.4` è ancora `§4.4`, e la colonna *Seduta* qui sotto dice dov'è
adesso, con la seduta di provenienza fra parentesi.

**I numeri non scalano.** Un numero chiuso si **ritira**, non si riusa e non
viene rimpiazzato da quello che segue: le altre voci restano dove sono, e del
numero ritirato resta la riga nella
[corrispondenza](roadmap/numerazione.md), che dice dove è finito il verbale.
Vale la stessa ragione dei numeri di decisione — un `§X.Y` è citato nei commenti
del codice e nei messaggi di commit, e una numerazione che si ricompatta a ogni
chiusura trasforma ogni citazione in un rimando cieco. Rinumerare è successo una
volta, per passare dallo strato alla seduta; non deve diventare un rito.

| § | Voce | Seduta | Strato | |
|---|---|---|---|---|
| **§1.2** | [Smontare il monolite](roadmap/18-editor-e-tastiera.md#12-smontare-il-monolite) | 18. L'editor e la tastiera *(da 1)* | shell | **P1** |
| **§2.9** | [Prestazioni della UI](roadmap/18-editor-e-tastiera.md#29-prestazioni-della-ui) | 18. L'editor e la tastiera *(da 2)* | shell | **P2** |
| **§3.3** | [La UI di un plugin non ha modo di entrare nella shell](roadmap/18-editor-e-tastiera.md#33-la-ui-di-un-plugin-non-ha-modo-di-entrare-nella-shell) | 18. L'editor e la tastiera *(da 3)* | shell | **P1** |
| **§4.4** | [Due parser per la stessa sintassi](roadmap/18-editor-e-tastiera.md#44-due-parser-per-la-stessa-sintassi) | 18. L'editor e la tastiera *(da 4)* | shell | **P1** |
| **§6.1** | [Le regole che il contratto promette vivono nel kernel, private](roadmap/06-le-regole-in-un-posto-solo.md#61-le-regole-che-il-contratto-promette-vivono-nel-kernel-private) | 6. Le regole in un posto solo | contratto | **P1** |
| **§6.2** | [I *tipi* al confine hanno un presidio; le *regole* no](roadmap/06-le-regole-in-un-posto-solo.md#62-i-tipi-al-confine-hanno-un-presidio-le-regole-no) | 6. Le regole in un posto solo | presidi | **P1** |
| **§7.1** | [Una capacità dell'`HostApi` si implementa quattro volte a mano](roadmap/07-il-confine.md#71-una-capacità-dellhostapi-si-implementa-quattro-volte-a-mano) | 7. Il confine: quante volte si scrive la disciplina | contratto | **P0** |
| **§7.2** | [Una disciplina dei provider sola, non una per famiglia](roadmap/07-il-confine.md#72-una-disciplina-dei-provider-sola-non-una-per-famiglia) | 7. Il confine: quante volte si scrive la disciplina | kernel | **P1** |
| **§7.3** | [Permessi e manifest — il punto di applicazione non esiste](roadmap/07-il-confine.md#73-permessi-e-manifest--il-punto-di-applicazione-non-esiste) | 7. Il confine: quante volte si scrive la disciplina | kernel | **P1** |
| **§7.4** | [Gli id non sono di nessuno: nessuna regola di namespace, nessuna collisione](roadmap/07-il-confine.md#74-gli-id-non-sono-di-nessuno-nessuna-regola-di-namespace-nessuna-collisione) | 7. Il confine: quante volte si scrive la disciplina | contratto | **P0** |
| **§7.5** | [I plugin non hanno un canale per parlarsi](roadmap/07-il-confine.md#75-i-plugin-non-hanno-un-canale-per-parlarsi) | 7. Il confine: quante volte si scrive la disciplina | contratto | **P1** |
| **§7.6** | [Nessun inventario di ciò che è attivo](roadmap/07-il-confine.md#76-nessun-inventario-di-ciò-che-è-attivo) | 7. Il confine: quante volte si scrive la disciplina | kernel | **P1** |
| **§8.1** | [`Workspace` è un oggetto-dio, e ogni voce di questo piano gli aggiunge un campo](roadmap/08-il-kernel-a-pezzi.md#81-workspace-è-un-oggetto-dio-e-ogni-voce-di-questo-piano-gli-aggiunge-un-campo) | 8. Il kernel a pezzi, e chi lo monta | kernel | **P1** |
| **§8.2** | [Il montaggio dell'app vive dentro un comando Tauri](roadmap/08-il-kernel-a-pezzi.md#82-il-montaggio-dellapp-vive-dentro-un-comando-tauri) | 8. Il kernel a pezzi, e chi lo monta | kernel | **P1** |
| **§8.3** | [Concorrenza](roadmap/08-il-kernel-a-pezzi.md#83-concorrenza) | 8. Il kernel a pezzi, e chi lo monta | kernel | **P2** |
| **§9.1** | [Il lavoro lungo non vede il vault](roadmap/09-il-lavoro-lungo-e-lo-spegnimento.md#91-il-lavoro-lungo-non-vede-il-vault) | 9. Il lavoro lungo, e come un componente smette | contratto | **P0** |
| **§9.2** | [Non c'è un ciclo di vita: si apre e basta](roadmap/09-il-lavoro-lungo-e-lo-spegnimento.md#92-non-cè-un-ciclo-di-vita-si-apre-e-basta) | 9. Il lavoro lungo, e come un componente smette | contratto | **P0** |
| **§9.3** | [Registry di plugin/feature e runner dei job](roadmap/09-il-lavoro-lungo-e-lo-spegnimento.md#93-registry-di-pluginfeature-e-runner-dei-job) | 9. Il lavoro lungo, e come un componente smette | kernel | **P1** |
| **§9.4** | [Disattivazione — oggi si può solo *non registrare*](roadmap/09-il-lavoro-lungo-e-lo-spegnimento.md#94-disattivazione--oggi-si-può-solo-non-registrare) | 9. Il lavoro lungo, e come un componente smette | kernel | **P1** |
| **§9.5** | [Nessuno spegne niente: la durabilità dipende dal watcher](roadmap/09-il-lavoro-lungo-e-lo-spegnimento.md#95-nessuno-spegne-niente-la-durabilità-dipende-dal-watcher) | 9. Il lavoro lungo, e come un componente smette | kernel | **P1** |
| **§9.6** | [Sessioni multiple](roadmap/09-il-lavoro-lungo-e-lo-spegnimento.md#96-sessioni-multiple) | 9. Il lavoro lungo, e come un componente smette | kernel | **P2** |
| **§9.7** | [Il watcher è l'unico che vede le scritture altrui, e la sua morte non si vede](roadmap/09-il-lavoro-lungo-e-lo-spegnimento.md#97-il-watcher-è-lunico-che-vede-le-scritture-altrui-e-la-sua-morte-non-si-vede) | 9. Il lavoro lungo, e come un componente smette | kernel | **P1** |
| **§10.1** | [L'abbonamento agli eventi non filtra](roadmap/10-gli-eventi.md#101-labbonamento-agli-eventi-non-filtra) | 10. Gli eventi: grana, freno, destinatari | contratto | **P0** |
| **§10.2** | [Il ponte degli eventi non ha né freno né raggruppamento](roadmap/10-gli-eventi.md#102-il-ponte-degli-eventi-non-ha-né-freno-né-raggruppamento) | 10. Gli eventi: grana, freno, destinatari | kernel | **P2** |
| **§10.3** | [Notifiche e attività in background](roadmap/10-gli-eventi.md#103-notifiche-e-attività-in-background) | 10. Gli eventi: grana, freno, destinatari | shell | **P2** |
| **§11.1** | [Impostazioni e spegnibilità — oggi sono variabili d'ambiente](roadmap/11-impostazioni-e-i-tre-stati.md#111-impostazioni-e-spegnibilità--oggi-sono-variabili-dambiente) | 11. Le impostazioni, e i tre stati | contratto | **P1** |
| **§11.2** | [Tre stati diversi, zero contenitori](roadmap/11-impostazioni-e-i-tre-stati.md#112-tre-stati-diversi-zero-contenitori) | 11. Le impostazioni, e i tre stati | shell | **P2** |
| **§11.3** | [Il sidecar dell'organizzazione, da assorbire](roadmap/11-impostazioni-e-i-tre-stati.md#113-il-sidecar-dellorganizzazione-da-assorbire) | 11. Le impostazioni, e i tre stati | kernel | **P2** |
| **§12.1** | [Stringhe e localizzazione al confine — decisione, non implementazione](roadmap/12-stringhe-errori-locale.md#121-stringhe-e-localizzazione-al-confine--decisione-non-implementazione) | 12. Le stringhe, gli errori, il locale | contratto | **P0** |
| **§12.2** | [Errori tipizzati al confine, non `String`](roadmap/12-stringhe-errori-locale.md#122-errori-tipizzati-al-confine-non-string) | 12. Le stringhe, gli errori, il locale | contratto | **P0** |
| **§12.3** | [Caso, tempo civile e locale — le capacità che il dogfooding non ha ancora toccato](roadmap/12-stringhe-errori-locale.md#123-caso-tempo-civile-e-locale--le-capacità-che-il-dogfooding-non-ha-ancora-toccato) | 12. Le stringhe, gli errori, il locale | contratto | **P0** |
| **§12.4** | [Tema, token, accessibilità](roadmap/12-stringhe-errori-locale.md#124-tema-token-accessibilità) | 12. Le stringhe, gli errori, il locale | shell | **P2** |
| **§13.1** | [Identità del documento — il path, e l'eventuale seconda chiave](roadmap/13-identita-del-documento.md#131-identità-del-documento--il-path-e-leventuale-seconda-chiave) | 13. L'identità di un documento | contratto | **P0** |
| **§13.2** | [Lo stato per-documento: ogni feature se lo migra da sé](roadmap/13-identita-del-documento.md#132-lo-stato-per-documento-ogni-feature-se-lo-migra-da-sé) | 13. L'identità di un documento | kernel | **P2** |
| **§13.3** | [L'undo non ha un proprietario](roadmap/13-identita-del-documento.md#133-lundo-non-ha-un-proprietario) | 13. L'identità di un documento | contratto | **P0** |
| **§14.1** | [Il vault non è solo documenti](roadmap/14-entry-cartelle-lista.md#141-il-vault-non-è-solo-documenti) | 14. Le entry, le cartelle, la lista | kernel | **P2** |
| **§14.2** | [Nessun metadato di entry: né mtime, né dimensione, né impronta](roadmap/14-entry-cartelle-lista.md#142-nessun-metadato-di-entry-né-mtime-né-dimensione-né-impronta) | 14. Le entry, le cartelle, la lista | kernel | **P2** |
| **§14.3** | [Le cartelle non esistono nel kernel](roadmap/14-entry-cartelle-lista.md#143-le-cartelle-non-esistono-nel-kernel) | 14. Le entry, le cartelle, la lista | kernel | **P2** |
| **§14.4** | [Il canale della lista documenti](roadmap/14-entry-cartelle-lista.md#144-il-canale-della-lista-documenti) | 14. Le entry, le cartelle, la lista | kernel | **P2** |
| **§15.1** | [Astrazione sullo storage](roadmap/15-il-disco.md#151-astrazione-sullo-storage) | 15. Il disco: storage, durabilità, politiche | kernel | **P2** |
| **§15.2** | [Durabilità e recovery](roadmap/15-il-disco.md#152-durabilità-e-recovery) | 15. Il disco: storage, durabilità, politiche | kernel | **P2** |
| **§15.3** | [Una versione di schema su ogni formato persistito](roadmap/15-il-disco.md#153-una-versione-di-schema-su-ogni-formato-persistito) | 15. Il disco: storage, durabilità, politiche | kernel | **P2** |
| **§15.4** | [I dati persistiti non hanno né una mappa né una classe](roadmap/15-il-disco.md#154-i-dati-persistiti-non-hanno-né-una-mappa-né-una-classe) | 15. Il disco: storage, durabilità, politiche | kernel | **P0** |
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
| **§20.1** | [L'alimentazione dell'indice non ha un esito](roadmap/20-quando-qualcosa-va-storto.md#201-lalimentazione-dellindice-non-ha-un-esito-e-un-indice-che-perde-un-documento-non-ha-modo-di-dirlo) | 20. Quando qualcosa va storto | contratto | **P0** |
| **§20.2** | [Ciò che va storto ha un canale nel contratto e nessuna destinazione](roadmap/20-quando-qualcosa-va-storto.md#202-ciò-che-va-storto-ha-un-canale-nel-contratto-e-nessuna-destinazione) | 20. Quando qualcosa va storto | contratto | **P1** |
| **§20.3** | [Il kernel butta via gli esiti che ha già in mano](roadmap/20-quando-qualcosa-va-storto.md#203-il-kernel-butta-via-gli-esiti-che-ha-già-in-mano) | 20. Quando qualcosa va storto | kernel | **P1** |
| **§20.4** | [La shell non ha una superficie dove dire niente, e il salvataggio non ha esito](roadmap/20-quando-qualcosa-va-storto.md#204-la-shell-non-ha-una-superficie-dove-dire-niente-e-il-salvataggio-non-ha-esito) | 20. Quando qualcosa va storto | shell | **P1** |

## Gli allegati

- [Le voci a leva più alta](roadmap/leva.md) — non *quando* prendere una voce
  ma **quali contano di più**, col criterio: una voce che rende una capacità
  *inesprimibile* sta sopra una che la rende stretta.
- [Dove il contratto si strozza](roadmap/strozzature.md) — l'indice inverso: una
  riga per famiglia di FEATURES, con cosa servirebbe e cosa lo impedisce oggi.
- [Corrispondenza fra la numerazione vecchia e questa](roadmap/numerazione.md) —
  i messaggi di commit e i commenti nel codice nominano i numeri di prima della
  riorganizzazione; lì si traducono.
- [I verbali delle decisioni chiuse](decisions/README.md) — diciannove, uno per
  file. Non stanno qui perché questo è l'elenco di ciò che **resta da fare**, e
  un verbale archiviato nel posto in cui si cerca cosa manca non lo rilegge
  nessuno.
