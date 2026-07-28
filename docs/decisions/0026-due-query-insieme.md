# 0026 — Due query insieme: nessuna dichiarazione, una misura

|  |  |
|---|---|
| **Decisa** | 2026-07-27 |
| **Origine** | `todo.md` §8.4 (seduta 8) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/08-il-kernel-a-pezzi.md)

---

Questa voce non l'ha trovata un giro: l'ha trovata una **misura**, ed è l'unica
del piano che nasca così. Il banco della
[0024](0024-chi-legge-non-aspetta-chi-legge.md) aveva visto che di sei letture
cinque andavano da 7 a 25 volte più veloci col prestito condiviso e una — la
ricerca, cioè quella che l'utente scatena più spesso — stava ferma a 43
operazioni al secondo con un thread e 43 con otto.

Il motivo si vedeva subito: `SearchIndex::query` prende `&self`, si dichiara una
lettura, e poi prende il proprio `Mutex<Inner>`. Ma la domanda che la voce
poneva non era «come si toglie quel `Mutex`»: era **se il contratto dovesse dire
qualcosa**, perché quella era la metà con una scadenza. Un `IndexProvider` che
si rimette in fila da sé è conforme e invisibile, e per il presidio
dell'additività ([0002](0002-additivita-del-contratto.md)) una dichiarazione
aggiunta dopo il freeze di M4 non rompe il WIT ma rompe **chi implementa**.

## La risposta, in una frase

**No: `Send + Sync` e `&self` dicono già tutto ciò che un contratto può
pretendere, quindi la concorrenza di una query resta una qualità del singolo
indice — il WIT guadagna un paragrafo di prosa e zero campi, la voce perde la
scadenza, e l'unico indice che aveva il difetto non ce l'ha più.**

| banco della 0024, 8 thread | prima | adesso |
|---|---|---|
| `query_index` testo | 43 → 43 op/s (**1,0×**) | 47 → 320 op/s (**6,8×**) |
| carico misto (le sei letture) | **1,0×** | **6,8×** (e 9,1× a 16 thread) |

Il banco è lo stesso di allora e non è stato toccato — è
[`crates/fubmd-host/examples/contesa.rs`](../../crates/fubmd-host/examples/contesa.rs),
e si rilancia con `cargo run --release -p fubmd-host --example contesa`. La
seconda riga è la frase che la 0024 aveva dovuto lasciare aperta: «finché la
§8.4 è aperta, una schermata con la ricerca aperta non vede il guadagno». Adesso
lo vede, e per la ragione che la 0024 aveva già spiegato — una ricerca costava il
99,6% del tempo del mix, quindi il mix **era** la ricerca.

## Le decisioni prese, da NON ridiscutere senza motivo

- **Una dichiarazione non poteva cambiare ciò che è lecito, e quindi non era una
  clausola.** `IndexProvider` è `Send + Sync` e `query` prende `&self`: chiamarla
  da N thread sulla stessa istanza **è già** permesso, per costruzione, e nessun
  campo aggiunto potrebbe renderlo di più o di meno permesso. Ciò che un
  `concurrent-queries: bool` direbbe non è *cosa si può fare* ma *quanto si
  aspetterà*: è un suggerimento sulle prestazioni travestito da firma.
- **E nessun chiamante avrebbe potuto agirci.** Il kernel non parallelizza le
  query per conto proprio — la concorrenza gliela portano i chiamanti, N comandi
  IPC e N view — quindi con un `false` in mano non ha niente da smettere di
  fare. Non può rifiutare la registrazione (un indice lento è un indice), non
  può serializzare meglio di quanto già si serializzi il provider, e non può
  dirlo all'utente in una forma su cui l'utente possa fare qualcosa. Un fatto su
  cui nessuno può agire, dentro un record che si congela, è un costo senza
  contropartita.
- **Mentirci non produce un errore, ed è la prova che non è un contratto.**
  Dichiarare «giro insieme» e poi prendersi un lock non rompe niente: fa
  aspettare. Dichiarare «mi serializzo» ed essere invece parallelo, idem. Ciò
  che distingue una clausola da un commento è che sbagliarla **rompa** qualcosa,
  e qui non c'è niente che diventi impossibile.
- **Quindi la scadenza non c'è, ed era tutta la P0.** La voce era **P0
  condizionale**: scadeva col freeze *solo se* la risposta fosse stata qualcosa
  che chi implementa deve fornire. Non lo è. Un paragrafo di commento nel WIT non
  è un cambio di contratto — non ha discriminante, non ha ordine, non compare in
  nessuna firma — e si può scrivere oggi come fra un anno. La voce si chiude
  senza aver consumato nulla del budget del freeze, ed è il verso in cui una P0
  condizionale deve risolversi quando può.
- **La prosa si scrive lo stesso, perché è l'unica cosa che sarebbe servita.**
  Il trait ([`IndexProvider::query`](../../crates/fubmd-abi/src/traits.rs)) e il
  WIT ([`index.query`](../../crates/fubmd-abi/wit/fubmd/abi.wit)) adesso dicono per esteso ciò che
  era implicito: due `query` possono essere in volo insieme, serializzare è
  **permesso e sconsigliato**, e chi vuole sapere se il proprio indice scala lo
  misura. Non è una garanzia e non finge di esserlo: è la differenza fra un
  comportamento che nessuno aveva scritto e uno che si è deciso di non
  pretendere.
- **Al posto della dichiarazione c'è una misura, e la porta ogni indice.** Se la
  qualità è del singolo indice, il presidio è del singolo indice: la ricerca ha
  il suo (`due_ricerche_stanno_nell_indice_insieme`, in `features/search.rs`), e
  un indice di terzi che tenga alla propria concorrenza scriverà il proprio. È
  la forma della 0024 applicata un livello più in basso — il termine di paragone
  sta nella stessa corsa e nello stesso binario, non in un ramo git.
- **Contare chi è *dentro* `query` sarebbe stato un presidio falso, e serve
  dirlo.** Un contatore alzato prima della chiamata e abbassato dopo vede due
  thread «dentro» anche quando l'indice ha un `Mutex` suo — uno dei due è fermo
  ad aspettare, ma il contatore non lo sa. Sarebbe passato proprio nel caso che
  deve bocciare. Il presidio misura quindi il **tempo**, contro le stesse
  ricerche serializzate da un lock esterno nella stessa corsa: se l'indice ha un
  lock dentro, le due colonne coincidono. Provato al contrario, con un `Mutex`
  rimesso attorno a `query`: rapporto 0,95 e test rosso, contro 0,23–0,40 e test
  verde senza (soglia a 0,75).
- **La garanzia del commit pigro non è stata toccata: è caduto il prezzo di chi
  non la usa.** «Chi interroga vede le proprie scritture» resta vero e resta a
  carico del provider. Ciò che è cambiato è che committare serve **solo quando
  c'è qualcosa da committare**: `dirty` è un atomico, e una query che lo trova
  spento — il caso normale, perché chi scrive passa da `&mut self`, cioè dal
  prestito esclusivo del workspace — non tocca nessun lock. Il doppio controllo
  sotto il lock evita che due query concorrenti committino a vuoto, e le due
  `Ordering` che contano legano lo spegnimento di `dirty` al `reload` che l'ha
  reso vero: chi legge «pulito» vede anche l'indice ricaricato.
- **E il lock che resta non sta su tutto, sta sul writer.** `IndexWriter::commit`
  vuole `&mut self`; `add_document` e `delete_term` no, prendono `&self`. Quindi
  tantivy non aveva mai chiesto un `Mutex` attorno all'indice intero: quel lock
  era il prezzo di aver messo `commit` dentro `search`. `fingerprints` e
  `manifest_at` sono adesso campi normali, perché cambiano solo sotto `&mut
  self` — è il compilatore a tenerli fuori dalla concorrenza, non un lock.

## Trovato per strada

- **L'avvelenamento migliora una seconda volta, e per la stessa ragione della
  prima.** La [0024](0024-chi-legge-non-aspetta-chi-legge.md) aveva notato che
  con il `RwLock` una view che pania *disegnando* non si porta più via il vault,
  perché disegnare è una lettura. Qui succede l'analogo un livello più in basso:
  prima, una query che paniasse mentre teneva il `Mutex<Inner>` avvelenava
  l'indice e ogni ricerca successiva sarebbe morta sull'`.expect("mutex")`.
  Adesso una query pania senza tenere niente, e il solo modo di avvelenare
  l'indice è paniare **mentre si committa**. Non è la 24.2 nemmeno stavolta: il
  panico attraversa ancora il chiamante.
- **`CoreIndex` non aveva il problema, e non per fortuna.** È l'altro
  `IndexProvider` vero del repo, e non ha nessun lock interno: risponde da ciò
  che ha già in mano, che è esattamente ciò che il commento del trait chiedeva a
  un indice di fare. Il difetto era di chi doveva committare, cioè di chi ha uno
  stato durevole — che è anche la classe di provider di terzi in cui tornerà.
- **Il costo di una query non si è mosso, e doveva non muoversi.** 47 op/s con un
  prestito esclusivo vuol dire ~21 ms per ricerca, che è lo stesso numero di
  prima: questa voce non ha reso una query più veloce, ha fatto passare N query
  insieme. Le due cose sono diverse ed è la §21.9 a dirlo per intero.

## Cosa NON è stato fatto, e perché

- **Nessun presidio generale su «ogni `IndexProvider` scala».** Non si può
  scrivere, ed è il punto della voce: il kernel non ha modo di misurare un
  provider che non conosce senza fargli girare un carico inventato, e un carico
  inventato non dice niente sul carico vero. Chi tiene alla propria concorrenza
  la prova da sé, come fa la ricerca.
- **Niente lock più fini dentro l'indice.** Il writer resta uno solo, e va bene
  così: sta sul percorso di chi scrive, e chi scrive è già serializzato dal
  prestito esclusivo del workspace un livello più su. Spezzarlo comprerebbe
  parallelismo dentro un percorso che non ne ha da spendere.
- **I 23 ms per query restano, e restano della [§21.9](../roadmap/21-la-ricerca-predefinita.md#219-una-query-costa-23-ms-su-duemila-note-e-nessuno-sa-perché).**
  Con la [0025](0025-la-ricerca-predefinita.md) quella domanda ha un proprietario
  suo, e ha ancora due numeri a due ordini di grandezza di distanza da spiegare
  (108 µs misurati a M2, ~21–23 ms qui). Questa voce ha tolto la ragione per cui
  quei millisecondi **non si dividevano per otto**; non ha spiegato perché siano
  tanti.
- **Il banco non è stato toccato.** Le sue tre fasi misuravano già la cosa
  giusta, e la prima esisteva proprio perché «un provider può avere un lock
  proprio dentro il prestito condiviso». Cambiarlo mentre si cambia ciò che
  misura avrebbe reso incomparabili le due corse.

## Verifica

- `cargo build --workspace` — pulita, zero warning; anche
  `-p fubmd-host --no-default-features`.
- `cargo clippy --workspace --all-targets` — pulita nelle due configurazioni.
- `cargo test --workspace` — **55 suite, 0 fallimenti**. Sono le stesse 55 della
  [0024](0024-chi-legge-non-aspetta-chi-legge.md), e il numero non sale apposta:
  il presidio nuovo (`due_ricerche_stanno_nell_indice_insieme`) sta **dentro**
  la suite di `fubmd-features`, che passa da 93 a 94 test, perché è una qualità
  di quell'indice e non una proprietà del kernel da provare a parte. Nessun test
  preesistente è stato tolto; uno è stato *adattato* di una riga
  (`inner.get_mut().dirty` → `dirty.load(…)`, perché il campo che leggeva ha
  cambiato tipo).
- Il presidio nuovo, provato al contrario: rimettendo un `Mutex` attorno a
  `query`, il rapporto fra le due colonne passa da 0,23–0,40 a 0,95 e il test
  fallisce con il proprio messaggio.
- Il banco rilanciato in release: `query_index` 47 → 320 op/s (6,8×), carico
  misto 6,8× a 8 thread e 9,1× a 16, attesa di chi salva invariata (0,11 ms
  mediana, 331 scritture riuscite contro 1).
- `cargo fmt --all` — pulita.

