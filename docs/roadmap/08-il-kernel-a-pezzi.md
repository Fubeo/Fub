# 8. Il kernel a pezzi, e chi lo monta

Una **seduta** della [roadmap infrastrutturale](../todo.md): l'oggetto-dio è scomposto ([0022](../decisions/0022-il-kernel-a-pezzi.md)), il montaggio è un crate ([0023](../decisions/0023-chi-monta-il-kernel.md)), il lock è a grana fine ([0024](../decisions/0024-chi-legge-non-aspetta-chi-legge.md)) e la ricerca non si rimette più in fila da sé ([0026](../decisions/0026-due-query-insieme.md)); qui non resta niente.

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

**E la quarta voce non l'ha scritta un giro: l'ha scritta quella stessa misura.**
La §8.4 è nata dal banco della 0024 — di sei letture, cinque andavano da 7 a 25
volte più veloci e la ricerca stava ferma, perché `SearchIndex::query` si
dichiarava una lettura e poi prendeva un `Mutex` suo. La chiude la
[decisione 0026](../decisions/0026-due-query-insieme.md), e le due cose che
lascia sono queste:

- **Il contratto non dice niente di nuovo, e la scadenza non c'era.** La voce era
  P0 *condizionale*: scadeva col freeze solo se la risposta fosse stata un campo
  che chi implementa deve fornire. Non lo è — `Send + Sync` e `&self` dicono già
  che chiamare `query` da N thread è lecito, e una dichiarazione avrebbe potuto
  parlare solo di *quanto si aspetta*, cioè di un fatto che nessuno può
  verificare e su cui nessun chiamante può agire. Restano un paragrafo di prosa
  nel trait e nel WIT (che non è un cambio di contratto) e un presidio per
  indice, perché la concorrenza di una query è una qualità di chi la implementa.
- **E il guadagno che l'utente vede è arrivato adesso.** La 0024 aveva dovuto
  scrivere che il carico misto dava 1,0× perché una ricerca era il 99,6% del
  tempo del mix; con l'indice che non si serializza più, lo stesso banco dà
  **6,8×** a otto thread e 9,1× a sedici. Il numero della 0024 non era sbagliato:
  era incompleto di una voce.

Resta ciò che la 0022 ha visto e non ha preso: **`CoreIndex` è un oggetto-dio
annidato** — trenta accessi a `indexes` su trentuno passano da `indexes.core`. È
lo stesso lavoro un giro più in basso, e non ha ancora un numero. (Non ha invece
il problema della §8.4: di lock interni non ne ha nessuno, e risponde da ciò che
ha già in mano.)

E resta ciò che le quattro decisioni hanno **spostato senza risolvere**, che è il
modo in cui questa seduta consegna alle altre: il registry dei bundle (§9.3), lo
spegnimento (§9.5), le sessioni multiple (§9.6) e gli errori tipizzati (§12.2)
hanno adesso un posto solo dove atterrare — `fubmd-host` — invece di ventidue
comandi Tauri; i due punti dell'8.3 che non erano dell'8.3 — il lavoro lungo
fuori dal lock e la cancellazione — sono andati dove stanno i loro impedimenti,
cioè §9.1, §9.3 e §10.3; e *quanto costa* una query — i ~21 ms su duemila note,
che questa seduta ha fatto dividere per otto senza spiegarli — è della
[§21.9](21-la-ricerca-predefinita.md#219-una-query-costa-23-ms-su-duemila-note-e-nessuno-sa-perché).
