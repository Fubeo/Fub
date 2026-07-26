# 5. Il canale dati: chi risponde, e chi instrada

Una **seduta** della [roadmap infrastrutturale](../todo.md): chi risponde a una query, e chi la instrada — nell'ordine, o il routing nasce su un canale non instradabile.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

L'ordine dentro questo capitolo è vincolato e va rispettato: **5.1 prima di
5.2**, perché «gli indici si provano in ordine finché uno non dice `BadArgs`» è
vero per due varianti su nove — le altre sette il kernel se le risponde da sé e
ritorna prima del ciclo. Un routing dichiarato alla registrazione, messo prima
di quella voce, nascerebbe su un canale che per tre quarti non è instradabile.

La 5.1 ha anche una precedenza verso l'esterno: va fatta **con l'8.1** (la
scomposizione del `Workspace`), perché il core index è uno dei sottosistemi che
quella scomposizione deve accogliere, e farlo dopo vuol dire scomporre due
volte. E la 5.4 va **prima della 16.6**, o l'allowlist dei comandi Tauri si
troverebbe a dire di no a feature che non hanno altra strada.

### 5.1 Sette varianti su nove di `IndexQuery` non arrivano a nessun provider

*ex §2.28 · kernel · **P1** — leva alta: **rende inesprimibile** — va con l'8.1*

- [ ] **`query_index` risponde da sé e ritorna prima del ciclo**
      (`kernel/workspace.rs:1352-1425`): `Backlinks`, `Outline`, `Tags`,
      `Neighbors`, `Properties`, `PropertyValues` e `VaultHealth` sono `return`
      anticipati. Il ciclo sui provider registrati (`:1429-1435`) vede soltanto
      `FullText` e `Custom`.
- [ ] **Il §5.2 descrive il dispatch *fra* provider e non si accorge che a quel
      dispatch sette varianti non ci arrivano.** «Gli indici si provano in
      ordine finché uno non dice `BadArgs`» è vero per due varianti su nove; per
      le altre sette non c'è nessun ordine da sistemare, perché non c'è nessun
      tentativo. Il routing dichiarato che il §5.2 chiede, senza questa voce,
      nascerebbe su un canale che per tre quarti non è instradabile.
- [ ] **È la forma del §3.1 applicata al canale dati.** Là il parser è
      sostituibile e non estendibile; qui il canale dati non è nemmeno
      sostituibile: il kernel non è il provider di default, è il **primo**
      rispondente e non lo si scavalca. Ricadono fuori portata, e nessuna se ne
      accorgerebbe leggendo il contratto: grafo semantico, concept graph ed
      entity graph (7.3), proprietà calcolate, rollup e formula (8.2), health
      score e i suoi detector (7.2, ~30 voci), indice dei task (10), citazioni
      (15.1). Tutte hanno oggi una sola strada — `IndexQuery::Custom` — cioè un
      canale parallelo con un vocabolario privato accanto a quello ufficiale che
      dice la stessa cosa.
- [ ] **È anche una promessa che vale a metà, in silenzio** — il criterio con
      cui si chiude la [decisione 0004](../decisions/0004-il-grafo-e-i-link-non-wiki.md). La [decisione 0005](../decisions/0005-canale-dati-verso-le-view.md) ha appena chiamato `IndexQuery` «il canale
      dati verso le view», e in quel giro ha aggiunto proprio le varianti che
      nessun provider può servire: un autore di plugin che legge il contratto
      vede nove varianti e ne può servire due, senza che niente glielo dica.
- [ ] **L'aggiustamento**: le risposte del kernel diventano un `IndexProvider`
      registrato per primo alla costruzione del workspace
      (`kernel/src/index/core.rs`), non un `match` prima del ciclo. Un percorso
      di dispatch solo, il §5.2 ha un soggetto su cui dichiarare il routing, e
      le regole del §6.1 escono da dietro un `match` privato per diventare
      l'implementazione di un trait — cioè qualcosa che si può leggere, provare
      contro la conformance suite del §16.1 e riusare. Va fatto **con il §8.1**:
      è uno dei sottosistemi che la scomposizione del `Workspace` deve
      accogliere, e farlo dopo vuol dire scomporre due volte.

*Sblocca:* 7.3 (viste a grafo di terzi), 8.2 (proprietà calcolate e rollup),
7.2 (i detector come provider e non come codice del kernel), 9.2, 10, 11, 15.1,
22.1 — e rende vero il §5.2, che oggi instraderebbe due varianti su nove.

### 5.2 Il dispatch delle query è per tentativi

*ex §2.18 · kernel · **P0** — kernel nel titolo, **registrazione — cioè firma** nella sostanza; dopo la 5.1*

- [ ] **`query_index` prova gli indici in ordine di registrazione finché uno non
      risponde `BadArgs`** (`workspace.rs:1426-1435`), e di `BadArgs` arriva al
      chiamante quello dell'**ultimo interpellato**; ogni altro errore torna
      indietro dal **primo** che lo dà, e da fuori i due casi non si
      distinguono. Con un
      indice funziona benissimo. Con quelli che FEATURES chiede — full-text,
      semantico e vettoriale (22.1), proprietà (8.2), task (10), database (11),
      citazioni (15.1) — ogni query gira su tutti, e due indici che rivendicano
      la stessa variante si oscurano a vicenda **in silenzio**.
- [ ] **Manca un routing dichiarato alla registrazione**: quali varianti e
      quali `ns` un indice serve. È esattamente la forma che manca al
      `FormatRegistry` (§3.1, ultimo registrato vince) e alla tabella dei
      provider (§7.2), ed è il presupposto della [decisione 0005](../decisions/0005-canale-dati-verso-le-view.md) e del §5.3 — quelli dicono
      *quali* query esistono e che forma hanno, mai **a chi vanno**.
- [ ] Con il routing arriva gratis anche la diagnostica che oggi non c'è:
      «nessuno serve questa query» distinto da «chi la serve ha fallito» — che
      è il §12.2 applicato al canale più usato dopo la lista documenti.
- [ ] **Va dopo il §5.1, e la ragione è che questa voce descrive metà del
      canale**: «gli indici si provano in ordine» è vero per due varianti su
      nove — le altre sette il kernel se le risponde da sé e ritorna prima del
      ciclo. Un routing dichiarato alla registrazione, messo prima di quella
      voce, nascerebbe su un canale che per tre quarti non è instradabile.

### 5.3 La query è una stringa in un linguaggio di terzi

*ex §2.17 · kernel · **P0** — la stringa opaca non regge né il query builder né l'explain plan*

- [ ] **`IndexQuery::FullText { query: String }` finisce dritta nel
      `QueryParser` di tantivy** (`search.rs`), e la shell interpreta l'errore
      come "Query incompleta" (`main.ts:1326`): la sintassi di ricerca che
      l'utente digita **è** quella di una dipendenza.
- [ ] La [decisione 0005](../decisions/0005-canale-dati-verso-le-view.md) chiede di aggiungere ambito e faccette; il punto più profondo è
      che finché la query è una stringa opaca non hanno su cosa poggiare né il
      query builder visuale (9.2), né le query salvate/parametriche/preparate,
      né l'explain plan e il profiler (9.2), né la possibilità di cambiare
      motore. Serve un **AST di query nel contratto**, con il full-text come
      foglia e la stringa libera confinata dentro quella foglia.

### 5.4 La query non esiste sull'IPC

*ex §2.26 · kernel · **P1** — va **prima** della 16.6*

- [ ] **Tre comandi Tauri avvolgono lo stesso `query_index`** — `search`
      (`app/lib.rs:528`), `list_tags` (`:554`) e `graph_data` (`:698`) — **e un
      quarto non lo avvolge: lo scavalca.** `backlinks` (`:395`) chiama
      `ws.backlinks(&DocId)` diretto sul grafo, senza passare dal canale dati.
      È la stessa voce vista un gradino più in basso: dove sull'IPC un
      `query_index` non c'è, un comando bespoke non si limita a duplicare il
      canale — se lo salta, e con lui salterà il dispatch del §5.2 e la
      paginazione della [decisione 0005](../decisions/0005-canale-dati-verso-le-view.md).
      Un provider può fare qualunque
      query; **la shell no**: ogni variante nuova della [decisione 0005](../decisions/0005-canale-dati-verso-le-view.md) (proprietà, faccette,
      vicinato del grafo, salute del vault) richiederebbe un comando in più.
- [ ] **Manca il gemello di `render_view`/`view_action`**: un `query_index`
      generico sull'IPC, con la stessa disciplina (dispatch del §5.2, errori
      del §12.2, paginazione della [decisione 0005](../decisions/0005-canale-dati-verso-le-view.md)). È la voce che rende **praticabile** la
      dieta dell'IPC del §16.6: senza, l'allowlist si troverebbe a dire di no a
      feature legittime che non hanno altra strada.
- [ ] Con essa i quattro comandi diventano tre righe di `api.ts`, il grafo
      smette di avere un canale privilegiato (§2.2) e i backlink smettono di
      avere il proprio.

### 5.5 `list_documents` e `views()` — le metà nel contratto di §14.4 e §2.3

*ex §1.27 · contratto · **P0** — le metà nel contratto della 14.4 e della 2.3*

Due voci già nel piano hanno una metà **dentro** il contratto, e quella metà
scade col freeze mentre l'altra no:

- [ ] **`HostApi::list_documents() -> Vec<DocId>`** (`abi/traits.rs:158`) è il
      §14.4 visto dal contratto: clona **tutto** il vault a ogni chiamata, e
      `Workspace::documents` lo riordina ogni volta
      (`kernel/workspace.rs:481-485`). È il metodo con cui un provider si
      guarda intorno — il versioning lo chiama a ogni riconciliazione, e ogni
      feature che riparte da `VaultOpened` lo chiamerà. La paginazione della [decisione 0005](../decisions/0005-canale-dati-verso-le-view.md)
      va decisa **anche qui**, non solo sull'IPC.
- [ ] **`ViewProvider::views()` è interrogato a ogni giro**: `view_owner` chiama
      `p.views()` su *ogni* provider registrato per risolvere un id
      (`kernel/workspace.rs:1566-1571`), e ogni chiamata rialloca l'elenco. È
      il gemello del §2.3: con le view istanziabili questa risoluzione
      lineare-e-riallocante diventa il percorso caldo di ogni render. La
      domanda di forma: le spec sono **dato di registrazione** (il kernel le
      tiene, il provider le invalida) o restano una chiamata al provider?
