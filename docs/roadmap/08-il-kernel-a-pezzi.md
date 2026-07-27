# 8. Il kernel a pezzi, e chi lo monta

Una **seduta** della [roadmap infrastrutturale](../todo.md): l'oggetto-dio è scomposto ([0022](../decisions/0022-il-kernel-a-pezzi.md)), il montaggio è un crate ([0023](../decisions/0023-chi-monta-il-kernel.md)) e il lock è a grana fine ([0024](../decisions/0024-chi-legge-non-aspetta-chi-legge.md)); resta ciò che la misura ha trovato.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Precedenza dura, e veniva dal quarto giro: **l'8.1 andava prima dell'8.2 e
dell'8.3**, o il crate host sarebbe nato attorno all'oggetto-dio e il lock non
avrebbe mai potuto essere a grana fine. Le tre sono chiuse, in quest'ordine:

- l'**8.1** con la [decisione 0022](../decisions/0022-il-kernel-a-pezzi.md):
  `Workspace` non ha più ventiquattro campi piatti ma cinque proprietari —
  `DocumentStore`, `Indexes`, `ProviderRegistry`, `Dispatcher`, `Session`;
- l'**8.2** con la [decisione 0023](../decisions/0023-chi-monta-il-kernel.md):
  il composition root è il crate `fubmd-host`, che non dipende da tauri, e
  `fubmd-app` è ciò che resta togliendolo — comandi IPC, ponte eventi, finestre;
- l'**8.3** con la [decisione 0024](../decisions/0024-chi-legge-non-aspetta-chi-legge.md):
  il workspace sta dietro un `RwLock`, le letture prendono il prestito
  condiviso, e la precedenza si è vista tutta — il cambio di tipo non ha voluto
  niente perché `Workspace` era già `Sync` e il percorso `&self` era già
  tracciato.

La precedenza ha pagato anche in un modo che non era previsto: la **ragione**
per prendere l'8.3 non era quella scritta nella voce. Diceva «le letture sono le
view», e prometteva N view che si ridisegnano senza coda — vero, e il risultato
meno importante. Misurando si è visto che sotto il `Mutex` **chi salvava una
nota poteva aspettare secondi** dietro ai lettori, senza nessun limite scritto da
nessuna parte. Era una fame, non una lentezza.

Resta ciò che la 0022 ha visto e non ha preso: **`CoreIndex` è un oggetto-dio
annidato** — trenta accessi a `indexes` su trentuno passano da `indexes.core`. È
lo stesso lavoro un giro più in basso, e non ha ancora un numero.

E resta ciò che le tre decisioni hanno **spostato senza risolvere**, che è il
modo in cui questa seduta consegna alle altre: il registry dei bundle (§9.3), lo
spegnimento (§9.5), le sessioni multiple (§9.6) e gli errori tipizzati (§12.2)
hanno adesso un posto solo dove atterrare — `fubmd-host` — invece di ventidue
comandi Tauri; e i due punti dell'8.3 che non erano dell'8.3 — il lavoro lungo
fuori dal lock e la cancellazione — sono andati dove stanno i loro
impedimenti, cioè §9.1, §9.3 e §10.3.

### 8.4 Il prestito condiviso si ferma al lock di un provider

*ottavo giro · kernel · **P2** — trovata misurando la [0024](../decisions/0024-chi-legge-non-aspetta-chi-legge.md), e non prevedibile senza*

- [ ] **La lettura che l'utente scatena più spesso è l'unica che non è
      migliorata.** Il banco della 0024 misura `query_index` a **43 op/s con un
      thread e 43 con otto**, identici col prestito esclusivo e con quello
      condiviso. Tutte le altre letture del giro vanno da 7 a 25 volte più
      veloci; questa sta ferma.
- [ ] **Il motivo è un lock dentro un provider, e il `RwLock` del workspace non
      lo attraversa.** `SearchIndex::query` prende `&self` — cioè si dichiara una
      lettura, e lo è per il kernel — e poi prende il proprio `Mutex<Inner>`
      (`features/search.rs`), perché `Inner::search` vuole `&mut self`.
      Lo vuole per una ragione sola: il **commit pigro** che fa vedere a chi
      interroga le proprie scritture non ancora rese durevoli. Quindi la
      serializzazione non è un dettaglio implementativo da togliere in silenzio:
      è una garanzia — «chi interroga vede le proprie scritture» — che va
      ridecisa, non aggirata.
- [ ] **La forma della domanda è generale, e la ricerca è solo il primo caso.**
      Il contratto chiede a un `IndexProvider` di essere `Send + Sync` e dà a
      `query` un `&self`; non chiede, e non ha modo di chiedere, che due `query`
      possano davvero girare insieme. Un provider di terzi che metta un `Mutex`
      dentro un `&self` è conforme e invisibile: il workspace lo presta in
      condivisione, e lui si rimette in fila da solo. Va deciso se il contratto
      deve dire qualcosa (e cosa: una dichiarazione? un requisito?) o se resta
      una qualità di ogni singolo indice.
- [ ] **Non confondere con il costo.** Che una query costi ~23 ms su 2000 note è
      un'altra domanda, non di concorrenza: sta accanto alla reindicizzazione
      (24.1) e alle prestazioni del §17.1. Qui il fatto è che quei 23 ms **non si
      dividono per otto**, ed è per questo che il carico misto della 0024 dà
      1,0× mentre ognuna delle sue parti dà molto di più.

*Sblocca:* niente di bloccato, ma è ciò che separa il guadagno misurato della
[0024](../decisions/0024-chi-legge-non-aspetta-chi-legge.md) dal guadagno che
l'utente vede con la ricerca aperta.
