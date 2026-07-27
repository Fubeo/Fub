# 0024 — Il lock: chi legge non aspetta chi legge, e chi salva non aspetta per sempre

|  |  |
|---|---|
| **Decisa** | 2026-07-27 |
| **Origine** | `todo.md` §8.3 (seduta 8, *ex* §2.4) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/08-il-kernel-a-pezzi.md)

---

La voce aveva una precedenza dura e una regola sola. La precedenza è stata
rispettata — l'[8.1](0022-il-kernel-a-pezzi.md) prima, l'[8.2](0023-chi-monta-il-kernel.md)
poi — e la regola era la sua prima riga: **misurare prima**.

Misurando è cambiata la ragione per farlo. La voce diceva «le letture sono le
view», e prometteva quindi che N view si ridisegnassero senza mettersi in coda:
è vero, ed è il risultato meno importante. Quello che il banco ha trovato è che
sotto il `Mutex` **chi salva una nota poteva aspettare secondi** dietro ai
lettori — 6,4 s in una corsa, 23,4 s in un'altra, con due salvataggi riusciti in
due secondi di tentativi. Non è una lentezza: è una fame, e non aveva un limite
scritto da nessuna parte.

## La risposta, in una frase

**Il `Workspace` sta dietro un `RwLock`, le letture prendono il prestito
condiviso, e chi scrive smette di essere scavalcato.**

| | esclusivo (il `Mutex` di prima) | condiviso (il `RwLock`) |
|---|---|---|
| `render_view` × 4, `render_preview`, 8 thread | 61k–257k op/s | 640k–5,0M op/s (**7×–25×**) |
| `query_index` testo, 8 thread | 43 op/s | 43 op/s (**1,0×** — vedi §8.4) |
| attesa di un salvataggio, 8 lettori | **6,4 s** mediana, 2 riusciti | **0,12 ms** mediana, 0,24 ms peggiore, 328 riusciti |

Il banco è [`crates/fubmd-host/examples/contesa.rs`](../../crates/fubmd-host/examples/contesa.rs),
e si rilancia: `cargo run --release -p fubmd-host --example contesa`.

## Le decisioni prese, da NON ridiscutere senza motivo

- **Il termine di paragone sta nel binario, non in un ramo git.** Sotto un
  `RwLock`, eseguire una *lettura* prendendo `write()` **è** il comportamento
  del `Mutex`: un lettore alla volta. Quindi il banco misura i due mondi nella
  stessa corsa e il «prima» resta verificabile fra un anno, invece di essere un
  numero citato in questo file di cui nessuno può più rifare il conto. È la
  stessa idea del presidio di
  [`dependency_invariant.rs`](../../crates/fubmd-abi/tests/dependency_invariant.rs)
  applicata a una misura invece che a un confine.
- **Il cambio di tipo non ha voluto niente perché era già stato pagato, due
  volte.** Un `Mutex<Workspace>` condiviso chiede `Workspace: Send`; un
  `RwLock<Workspace>` chiede `Send + Sync`, perché presta `&Workspace` a più
  thread insieme. `Workspace` era **già** `Sync`, e lo era perché i sette trait
  di provider dell'ABI sono `Send + Sync` da sempre. L'altra metà l'ha messa la
  [0021](0021-il-confine.md), che ha dato a chi disegna un `ReadHost` costruito
  su `&self`, e la [0022](0022-il-kernel-a-pezzi.md), che ha tenuto le letture
  pure nei componenti e le chiamate rientranti sul `Workspace`. Senza quelle due
  questa voce sarebbe stata un rifacimento; con quelle due è una parola diversa
  in una firma.
- **La tabella di chi legge e chi scrive non l'ha scritta nessuno: c'era già.**
  Quindici siti nell'app, e la conversione è stata `let ws` → `read()`,
  `let mut ws` → `write()`. Nessun binding ha dovuto cambiare, il che è la prova
  che il `&self`/`&mut self` del `Workspace` **era** la classificazione — e che
  il compilatore la difende: da un `RwLockReadGuard` non si chiama
  `write_document`, non per disciplina ma perché non c'è.
- **Il numero che conta è l'attesa di chi salva, non il throughput di chi
  legge.** Con il prestito esclusivo, N lettori in ciclo stretto rilasciano e
  riprendono subito, e chi aspetta di scrivere non è in nessuna coda: perde la
  corsa al futex ogni volta. Con il prestito condiviso, `std` ferma i lettori
  **nuovi** dietro a chi aspetta di scrivere, quindi l'attesa è al più una
  lettura in corso. La proprietà non è «più veloce»: è che *esiste un limite*.
- **Ma che quel limite esista dipende da `std`, e va detto.** La documentazione
  di `RwLock` dichiara la politica di priorità dipendente dal sistema operativo
  e **non** promette che chi aspetta di scrivere blocchi i lettori nuovi. Su
  Linux (futex) lo fa. Il presidio
  [`chi_scrive_non_aspetta_i_lettori_piu_di_un_battito`](../../crates/fubmd-host/tests/concorrenza.rs)
  misura l'attesa peggiore e la vuole sotto 50 ms: il giorno che diventasse
  rosso su una piattaforma, non sarebbe una fiacchezza del test — sarebbe quella
  piattaforma che dice di non avere la proprietà, e a quel punto la coda equa va
  scritta da noi.
- **L'avvelenamento cambia lato, e in meglio.** Un `Mutex` si avvelena quando
  chi lo tiene pania: una view che esplodeva *mentre disegnava* rendeva il vault
  irraggiungibile per sempre, perché `.unwrap()` su un lock avvelenato è un
  panico e i panici erano ventidue, uno per comando IPC. Un `RwLock` si avvelena
  **solo** se a paniare è chi tiene il prestito esclusivo. Disegnare è una
  lettura, quindi il caso più probabile — e l'unico che un provider di terzi
  produrrà davvero, perché disegnare è ciò che un provider fa più spesso — smette
  di portarsi via il vault. **Non è la 24.2**: il panico attraversa ancora il
  chiamante e nessuno lo cattura; quello che cambia è che si porta via *quella
  chiamata* invece del vault. C'è un test, e con `write()` al posto di `read()`
  fallisce con `PoisonError`.
- **`Host::session` resta un `Mutex`, ed è un lock diverso.** Tiene lo slot della
  sessione — chi apre, chi chiude, chi si clona l'handle — e lo si prende per il
  tempo di un `take` o di un `clone`. Non ha lettori da parallelizzare, e
  confonderlo con il lock del workspace vorrebbe dire avere due nomi per due cose
  che si comportano diverso.
- **I presidi sono tre, e mordono tutti e tre.** Girando i tre prestiti condivisi
  in esclusivi, `due_letture_stanno_nel_workspace_insieme` fallisce (nessuna
  sovrapposizione), `chi_scrive_non_aspetta_i_lettori_piu_di_un_battito` fallisce
  (244 ms contro i 50 di soglia) e
  `una_view_che_pania_disegnando_non_avvelena_il_vault` fallisce con
  `PoisonError`. Un `write()` scritto al posto di un `read()` compila, passa ogni
  test funzionale e non si vede in nessuna diff che non sia questa: è
  esattamente l'invariante che nessuno rompe apposta e che tutti romperebbero
  per comodità.

## Trovato per strada

- **La ricerca non ha accelerato di un filo, e diventa la §8.4.** `query_index`
  fa 43 op/s a un thread e 43 a otto, identici nei due modi. Il motivo è che
  `SearchIndex::query` prende `&self` e poi lock**a** il proprio
  `Mutex<Inner>` — perché `Inner::search` vuole `&mut self`, e lo vuole per una
  ragione sola: il commit pigro che fa vedere a chi interroga le proprie
  scritture. Il prestito condiviso del workspace non attraversa il lock di un
  provider, e la lettura che l'utente scatena più spesso è proprio quella che non
  è migliorata. Non era prevedibile senza misurare, ed è la ragione per cui
  «misurare prima» era la prima riga della voce.
- **Ed è per questo che il carico misto dà 1,0×.** Sembra una smentita e non lo
  è: una ricerca costa ~23 ms e le altre cinque letture insieme ne costano ~0,1,
  quindi la ricerca **è** il 99,6% del tempo del mix e il totale non si muove.
  Le due frasi vere sono che tutto ciò che il kernel serve da sé va da 7 a 25
  volte più veloce, e che finché la §8.4 è aperta una schermata con la ricerca
  aperta non lo vede. *Perché* una query costi 23 ms su 2000 note è un'altra
  domanda ancora, e non è di concorrenza.
- **La scansione iniziale era già fuori dal lock, e nessuno lo aveva scritto.**
  `reindex` è `&mut self` e su 2000 note tiene il workspace per ~780 ms — ma
  `Host::open` lo chiama su un `Workspace` che possiede, **prima** di avvolgerlo
  nell'`Arc`. Non c'è nessuno da bloccare perché non esiste ancora nessun altro
  che possa averlo. È l'unica delle cinque operazioni lunghe che la voce
  elencava a stare già dove la voce la voleva; le altre quattro sono qui sotto.

## Cosa NON è stato fatto, e perché

- **I due punti restanti della voce non sono stati fatti, e non erano di questa
  voce.** «Lavoro lungo fuori dal lock» e «cancellazione» non dipendono dal tipo
  del lock: dipendono dal fatto che oggi il lavoro lungo **non può** stare fuori.
  `Plugin::run_job` è senza `HostApi` per costruzione, quindi l'unico modo di
  dargli in pasto il vault è che il chiamante lo legga dentro il giro sincrono —
  cioè faccia in esclusiva esattamente il lavoro che il job doveva togliere da
  lì. È la §9.1, è **P0**, ed è la voce che dice questo di sé stessa. E non c'è
  niente da cancellare finché `spawn_job` accoda e basta: il runner è la §9.3.
  Reindicizzazione, import, export ed embedding aspettano quelle due; il centro
  attività è la §10.3. I tre rimandi sono scritti nelle voci di destinazione, non
  solo qui.
- **Non c'è nessun lock più fine dei cinque componenti della 0022.** Uno per
  `DocumentStore`, uno per `Indexes` e così via si potrebbe: ma ogni chiamata a
  un provider vuole un `HostApi` costruito su **tutto** il workspace (0022), e
  quelle chiamate resterebbero comunque esclusive su tutti e cinque. Si
  pagherebbero cinque lock per parallelizzare ciò che è già parallelo, e si
  comprerebbe la possibilità di prenderli in ordini diversi. La linea giusta era
  quella fra leggere e chiamare, ed è quella che la 0022 aveva tracciato.
- **Nessun `catch_unwind` al confine.** Un provider che pania si porta ancora via
  la chiamata di chi l'ha invocato. Che non si porti più via anche il vault è un
  effetto di questa voce, non il suo scopo: l'isolamento vero — catturare,
  disattivare, avvisare — è la 24.2, e resta aperto.
- **Niente vieta a un chiamante futuro di riprendere il lock mentre lo tiene.**
  Oggi non succede: ogni comando IPC prende una guardia sola, il ponte eventi non
  tocca il workspace, il watcher prende `write()` e basta. Ma un `read()`
  annidato dentro un `read()` mentre uno scrittore aspetta è un blocco, e
  `std::sync::RwLock` non promette di accorgersene. Non c'è un presidio che lo
  impedisca, e non se ne è inventato uno per un problema che nessuno ha: è
  scritto qui perché il giorno che qualcuno lo ha, questa è la riga da ritrovare.

## Verifica

- `cargo build --workspace` — pulita, zero warning. Anche
  `-p fubmd-host --no-default-features`.
- `cargo clippy --workspace --all-targets` — pulita, nelle due configurazioni di
  feature.
- `cargo test --workspace` — **55 suite, 0 fallimenti**. Erano 54 alla
  [0023](0023-chi-monta-il-kernel.md): la nuova è
  `crates/fubmd-host/tests/concorrenza.rs`. **Nessun test preesistente è stato
  aggiunto o tolto**; `tests/headless.rs` è stato *adattato* in cinque righe —
  `.lock()` → `.read()`/`.write()` — perché il tipo che quel file prende in mano
  è cambiato, e non c'era modo di cambiarlo lasciandolo intatto.
- I tre presidi nuovi, provati al contrario: girando i tre prestiti condivisi in
  esclusivi, falliscono tutti e tre, ognuno con il proprio sintomo (nessuna
  sovrapposizione, 244 ms di attesa, `PoisonError`).
- `cargo fmt --all` — pulita.
