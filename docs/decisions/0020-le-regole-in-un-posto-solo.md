# 0020 — Le regole in un posto solo

|  |  |
|---|---|
| **Decisa** | 2026-07-27 |
| **Origine** | `todo.md` §6.1–§6.2 (seduta 6, *ex* §1.37, §4.11) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/06-le-regole-in-un-posto-solo.md)

---

Due voci, e una frase che le tiene insieme: **«un posto solo» era vero finché
l'implementazione era una**. Le regole che il contratto promette — come si
confrontano due `PropertyValue`, dove ordina chi non ha la chiave, quando un
path relativo diventa un `DocId`, cosa conta come link rotto — vivevano in
quattro `mod` senza `pub` dentro il kernel, e la [decisione 0019](0019-il-canale-dati.md)
aveva appena reso possibile una seconda implementazione: un indice di terzi può
servire proprietà e tag, e la sua idea di «maggiore di» non aveva nulla che la
legasse a quella del kernel. Dall'altro lato la shell le riscriveva in
TypeScript, e l'unica delle cinque copie che avesse un legame lo aveva scritto a
mano.

Le due voci sono chiuse.

## La risposta, in una frase

**Le regole stanno nel contratto, e ciò che resta scritto due volte è legato da
una fixture generata.**

- **§6.1** — [`fub_abi::rules`](../../crates/fub-abi/src/rules/mod.rs):
  [`path`](../../crates/fub-abi/src/rules/path.rs) (la chiave di risoluzione,
  i link markdown relativi, il percent-encoding),
  [`properties`](../../crates/fub-abi/src/rules/properties.rs) (filtro,
  ordinamento, faccette, e la coda di una risposta a `Documents`),
  [`tag`](../../crates/fub-abi/src/rules/tag.rs) (la gerarchia),
  [`health`](../../crates/fub-abi/src/rules/health.rs) (cosa è un link rotto).
  Il kernel le usa da lì come chiunque altro; i quattro `mod` privati non ci sono
  più.
- **§6.2** — [`tests/rules_mirror.rs`](../../crates/fub-abi/tests/rules_mirror.rs)
  genera `frontend/src/__fixtures__/rules-samples.json` — coppie input→output
  con la risposta **di Rust** — e il gemello vitest
  [`rules-mirror.test.ts`](../../frontend/src/rules/rules-mirror.test.ts) passa
  gli stessi input alla gemella TypeScript. Le regole rispecchiate stanno in un
  file solo: [`frontend/src/rules/mirrored.ts`](../../frontend/src/rules/mirrored.ts).

## Le decisioni prese, da NON ridiscutere senza motivo

- **`fub-abi`, non l'SDK.** Erano le due strade che la seduta poneva, e la
  differenza non è di comodità: l'SDK è **facoltativo**, e una regola facoltativa
  non è una regola. Chi vuole essere d'accordo col kernel — un indice di terzi, un
  guest WASM a M5 — non deve dover adottare anche un toolkit per esserlo. È lo
  stesso spostamento che la [decisione 0003](0003-modello-del-documento.md) aveva
  fatto per `heading_slug` e `canonical_tag`, da funzioni private del provider
  markdown a funzioni del contratto, applicato al kernel invece che a un provider.
- **`unicode-normalization` entra nella chiusura del contratto, ed è una scelta.**
  La chiave di risoluzione è trim + **NFC** + minuscolo, e senza NFC un vault
  sincronizzato con macOS (nomi file in NFD) non fa risolvere `[[Café]]`. Farla
  salire senza la sua dipendenza avrebbe voluto dire lasciarla nel kernel, cioè
  non farla salire. L'allowlist transitiva di `dependency_invariant.rs` esiste
  esattamente per rendere questo un gesto deliberato: il crate resta senza I/O,
  senza runtime e senza parser — che è la condizione perché la fine corsa del
  §6.2 (compilarlo a wasm32) resti praticabile.
- **È salita anche una regola che il §6.1 non nominava: `properties::finish`.** È
  la coda di *ogni* risposta a `Documents` — ordine, colonne, finestra — e stava
  nel pianificatore del kernel con due chiamanti e un commento che diceva «due
  implementazioni divergerebbero sul caso che nessuno prova». Il terzo chiamante
  è arrivato con la 0019 e non ha il kernel: un indice che rivendichi `Documents`
  oggi deve reinventare dove ordina chi non ha la chiave di ordinamento e cosa
  succede a pari rilevanza. La regola per capire cosa sale è quella, non l'elenco
  dei quattro `mod`: **se una risposta del contratto ha una parte che non dipende
  da chi la dà, quella parte è del contratto.**
- **Chi ha l'indice non è chi ha la regola.** `health::broken_target` ha bisogno
  di sapere se un link risolve, e la risoluzione è del grafo, che è del kernel.
  Il confine è un trait di tre righe, [`LinkResolver`]: il grafo lo implementa e
  **presta** ciò che sa, il giudizio («un URL non è rotto, un allegato nemmeno,
  un wikilink che non risolve sì») resta nel contratto. Senza, o la regola
  restava nel kernel o il grafo saliva con lei.
- **La fixture ammette solo regole che esistono in due lingue.** È la disciplina
  che tiene onesto il presidio: legare una regola che ha un'implementazione sola
  non presidia niente, e obbligherebbe a scrivere una gemella TypeScript senza
  clienti — cioè una terza copia da tenere allineata, per finta. Oggi le chiavi
  sono cinque, e sono la tabella del §6.2 meno la riga che il §4.4 dichiara fuori:
  `page_name`, `resolution_key`, `task_checked`, e i due versi degli offset.
  Quando la shell avrà bisogno di `canonical_tag` o di `is_attachment`, le
  regole sono già nel contratto e la fixture le accoglie con una riga.
- **Le due metà si nominano a vicenda.** Il gemello vitest pretende che le chiavi
  della fixture e quelle della sua tabella di handler **coincidano**, nei due
  versi: una regola nuova non può entrare da un lato e restare non rispecchiata,
  né restare di là senza casi. È la differenza fra un presidio e una lista che
  invecchia.
- **La fixture ha un test che la difende dallo svuotamento.** Un presidio a
  campioni si può neutralizzare senza diventare rosso: si potano i casi ostili e
  restano quelli facili. `every_rule_has_cases_that_disagree_with_each_other`
  pretende che ogni regola abbia almeno due risposte diverse, e il lato TS
  pretende le tre proprietà che rendono questi casi capaci di distinguere due
  implementazioni: NFC e NFD che collassano sulla stessa chiave, un dotfile fra i
  nomi, un testo in cui byte e code unit non coincidono.
- **L'ordine di presentazione è della shell, e la domanda del §6.2 è chiusa.** Il
  kernel ordina per `DocId` — ordine di byte — e non è una scelta estetica: una
  risposta paginata che cambiasse ordine fra una pagina e l'altra ripeterebbe e
  salterebbe righe, quindi serve un ordine **totale, stabile e calcolabile senza
  un locale**. La sidebar ordina con un collatore italiano, che è l'ordine di
  lettura di un umano e dipende dalla lingua di chi guarda. Non sono due copie
  della stessa regola: sono due requisiti che **devono** divergere, e una fixture
  che li legasse nascerebbe rossa e resterebbe rossa. Il kernel **non** esporrà
  un ordine di presentazione; chi vuole quello dell'umano lo applica dopo aver
  ricevuto la pagina, perché è l'unico che sa chi è l'umano. Sta scritto in testa
  a `fub_abi::rules`, accanto alle regole, che è dove lo cercherà chi si porrà
  di nuovo la domanda.
- **Il test scritto a mano è stato ritirato.**
  `docid_page_name_agrees_with_the_frontend_on_hostile_names` elencava nove nomi
  ostili e il commento sopra `pageName` diceva «è la stessa regola, riga per
  riga»: la forma giusta con lo strumento sbagliato — dichiarava la duplicazione
  invece di presidiarla, e i due elenchi potevano divergere in silenzio come le
  due funzioni. Gli stessi nove nomi sono adesso nel generatore, e il confronto
  lo fa la fixture.

## Trovato per strada, e chiuso

**Il lato TypeScript non faceva NFC affatto.** Le due copie della chiave di
risoluzione — `organizer.ts` per la folder note, `completions.ts` per i nomi
pagina ambigui — erano un `toLowerCase()`, mentre il kernel fa trim + NFC +
minuscolo. Su Linux non si vede niente; su un vault sincronizzato con macOS, che
scrive i nomi file in NFD, la folder note di `Città/` non si trovava e due note
omonime con un accento non venivano riconosciute come ambigue — mentre il kernel
le risolveva benissimo. È il difetto esatto che il §6.2 prevedeva senza averlo
trovato, ed è il primo che il presidio ha reso rosso: la gemella TypeScript è
adesso `resolutionKey`, e la riga che glielo impone è un caso della fixture
(`Café` in NFC e in NFD devono dare la stessa chiave).

Vale la pena notare **come** si è visto: non da un bug report — il caso richiede
un Mac, un accento e un occhio — ma perché mettere le due implementazioni una
accanto all'altra è ciò che una fixture generata costringe a fare.

## Cosa NON è stato fatto, e perché

- **La fine corsa resta aperta.** `fub-abi` compilato a wasm32 dentro
  `frontend/src/rules/` toglierebbe la duplicazione invece di presidiarla, ed è
  praticabile proprio perché l'invariante del crate è stata tenuta. Non si fa
  adesso: vuol dire una catena di build (`wasm-pack` o equivalente) nel giro del
  frontend, e il prezzo va pagato quando le regole condivise sono abbastanza da
  giustificarlo — oggi sono quattro. Il presidio è ciò che rende il rinvio sicuro
  invece che indefinito.
- **I due parser restano due.** La grammatica di wikilink, tag, evidenziato e
  checkbox è la scelta dichiarata del §4.4: la live preview deve decorare mentre
  si digita, senza un giro IPC per tasto. Ciò che è entrato nel presidio è il
  *significato* di ciò che il parser trova (`task_checked`), non dove comincia e
  dove finisce il token.
- **Il `Workspace` non è stato scomposto.** Il kernel perde due moduli e ne
  alleggerisce due, ma l'oggetto-dio del §8.1 è dove era.
- **Nessun `rules::offsets` in Rust.** La conversione byte ↔ code unit UTF-16 è
  l'unica regola della fixture che di là non ha una funzione, e non deve averla:
  uno `Span` è in byte perché è così che Rust indicizza le stringhe. Quello che
  serviva era un **oracolo**, e nella fixture c'è — è `str`, cioè la definizione
  di «byte» e di «code unit», non una libreria che potremmo scrivere male.
- **`fub-kernel` esporta ancora `health` come modulo privato.** La camminata
  sul vault (quali documenti, in che ordine) è rimasta lì: è orchestrazione,
  chiede alla cache dei metadati, e non è una regola. Solo il giudizio è salito.

## Verifica

`cargo test --workspace`: **523 verdi** (erano 518), fra cui i quattro nuovi
delle regole salite (la chiave di risoluzione che collassa NFC e NFD,
`strip_ext` sull'ultimo segmento, la gerarchia dei tag, l'allegato), i due del
mirror delle regole, e l'invariante di dipendenza con l'allowlist ritagliata a
mano. `npx tsc` pulito, **172 test vitest** (erano 165: sette li porta il mirror
delle regole), `vite build` ok. `cargo clippy --workspace --all-targets` pulito.

Il presidio è stato **provato rompendolo**: tolto `.normalize("NFC")` da
`resolutionKey`, `rules-mirror.test.ts` diventa rosso su `Café` con i due valori
che a schermo sembrano identici — che è precisamente il difetto che senza
fixture nessuno avrebbe visto.

**Non verificato visivamente nell'app Tauri.** Una cosa meriterebbe un occhio
quando qualcuno la aprirà, ed è l'unica che cambia comportamento: la **folder
note** e l'**autocompletamento dei wikilink** adesso confrontano i nomi con la
chiave del kernel invece che col minuscolo. Su un vault senza accenti non
dovrebbe cambiare nulla; è proprio il caso in cui cambia — un nome accentato — a
non essere riproducibile su questa macchina.

[`LinkResolver`]: ../../crates/fub-abi/src/rules/health.rs
