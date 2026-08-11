# 0129 — Una feature spenta per difetto non è provata da nessuno

**Stato**: accolta **Data**: 2026-08-06 **Chiude**: niente di dichiarato. Nasce
misurando un difetto che diceva un'altra cosa — *«`ureq`: la versione più larga
del workspace, unica dipendenza di rete, dietro una feature opzionale che la CI
di default non compila»* — e di cui **nessuno dei tre fatti** era il difetto
**Commit**: *(questo commit)*

---

## La domanda, com'era posta

Il difetto elencava tre fatti su `ureq` in
[`crates/fub-host/Cargo.toml`](../../crates/fub-host/Cargo.toml) e li dava per
una cosa sola. Separati, sono tre domande diverse, e la terza era quella grossa:
se la CI non compila il client HTTP, allora il recinto della
[0097](0097-un-recinto-che-vale-anche-quando-nessuno-guarda.md) — il permesso
`fub:network`, l'allowlist degli host, `Policy::denies_host` — **non è
verificato da nessuno**, e nessuno se ne accorge.

## La misura, prima di decidere

**Tutte e tre le premesse sono false, e vanno scritte insieme al perché
sembravano vere.**

**«La versione più larga del workspace».** `ureq = "3"` è un vincolo di sola
major, ed è largo. Ma non è il più largo né l'unico: `syn = "2"` in `fub-abi` è
esattamente altrettanto largo. E la domanda «questa versione è scritta nel posto
giusto?» ha già un giudice — `check-cargo-versioni.mjs`, scritto per il difetto
di `tempfile` — che su `ureq` dice **verde**, e ha ragione: `ureq` è dichiarato
in un crate solo e la radice non ne dichiara un'altra, quindi non è né un
doppione né un'ombra. Non c'è un secondo punto di verità da togliere. Sembrava
un difetto perché una versione larga *sembra* imprecisa; ma la precisione di un
vincolo semver non è la stessa domanda del punto di verità, ed è la seconda che
questo repo presidia.

**«Unica dipendenza di rete».** È un fatto, ed è vero. Non è un difetto: la
`Cargo.toml` lo argomenta per venticinque righe, misura il costo in venti
pacchetti di lockfile e spiega perché `ureq` e non `reqwest`. Un fatto
documentato non diventa un difetto perché è scomodo.

**«Una feature opzionale che la CI di default non compila».** **Falsa, e
verificabile in una riga**:
`default = ["notify-watcher", "http-client", "feature-ufficiali"]`.
`http-client` **è** nel default. `cargo build --workspace` e
`cargo test --workspace` del job `test` lo compilano su tre sistemi operativi,
`cargo clippy --workspace --all-targets` lo guarda, e
`cargo tree -p fub-host -i ureq` lo conferma nel grafo senza nessun flag.

E il recinto, misurato, è **il codice meglio presidiato dei tre**: `Guard::fetch`
sta in [`crates/fub-kernel/src/host/guard.rs`](../../crates/fub-kernel/src/host/guard.rs),
cioè in un crate che **non ha nemmeno una cargo feature** — nessuna
configurazione di build lo può far sparire — e conta **dieci** chiamate di prova
fra i suoi test più quelle di
[`crates/fub-kernel/tests/il_confine.rs`](../../crates/fub-kernel/tests/il_confine.rs):
l'host fuori dall'allowlist, il salto di dominio, le credenziali
`https://api.acme.com@evil.example/` che facevano leggere a un umano un indirizzo
e a una macchina un altro, il suffisso `evil-acme.com`, lo schema in chiaro,
l'anello locale e il suo omografo `127.0.0.1.evil.example`. La premessa sembrava
vera perché `ureq` è `optional = true`, e «opzionale» si legge come «spento»;
ma `optional` dice solo che esiste una feature che lo accende — non dice quale,
né se è accesa.

## Il difetto vero, che stava fuori dalla riga

Se la terza premessa è falsa **oggi**, la domanda che resta è: chi garantisce
che resti falsa? La risposta misurata è **nessuno**, e il costo di scoprirlo è
una parola.

Tolta `"http-client"` dall'elenco `default`:

| | prima | dopo |
|---|---|---|
| `cargo test --workspace`, test passati | **1331** | **1328** |
| righe `test result: ok` | 119 | **119** |
| `cargo clippy --workspace --all-targets`, warning | 0 | **0** |
| `check-cargo-versioni.mjs` | verde | **verde** |
| `check-prosa` / `check-doc-links` | verdi | **verdi** |

Tre test spariscono — le tre di
[`crates/fub-host/src/net.rs`](../../crates/fub-host/src/net.rs), cioè
esattamente quelle che tengono in piedi le due decisioni della 0097: che i
redirect non si seguano (un `302` da un host dichiarato porta fuori
dall'allowlist senza che nessuno l'abbia deciso) e che ci si fidi del
verificatore della piattaforma invece delle radici imbarcate. Insieme a loro
sparisce la riga `ws.set_network(…)` di `mount.rs`, quindi ogni `fetch` risponde
`unserved` — l'app perde una capacità **in silenzio**, perché `unserved` è la
risposta legittima di un host che non monta la rete.

Non diventano rossi. Non diventano `ignored`. **Escono dal conto**, e il conto
che la CI stampa — le righe `test result: ok`, che sono i *binari* e non i test
— non si muove di uno. È la classe che questo repo ha già incontrato più di
dodici volte: *una suite che si svuota in silenzio è indistinguibile da una
suite verde*. Qui ha la forma peggiore, perché non serve un `#[cfg]` scritto
male né un `describe.skip`: basta togliere una parola da un elenco, in un file
che si tocca per aggiungere una dipendenza.

## La decisione

**Ogni cargo feature dichiarata da un crate del workspace dev'essere
raggiungibile dal `default` del suo crate** — o dichiarata fuori, in
`FUORI_DAL_DEFAULT`, **insieme al passo di CI che la compila**. A verificarlo è
[`.github/scripts/check-cargo-feature-default.mjs`](../../.github/scripts/check-cargo-feature-default.mjs),
agganciato al job `invariants` accanto a `check-cargo-versioni.mjs`.

La regola non dice che una feature non possa essere spenta: dice che non può
essere spenta **per difetto**, perché quella è la sola configurazione che
nessuno confronta con niente. Che si spenga davvero la CI lo verifica già, ed è
la §16.3 —
`cargo build -p fub-host --no-default-features --features outline,notify-watcher`
sta nello stesso job da prima di questo verbale, e copre proprio il caso
`http-client` assente. Le due domande sono opposte e servono tutte e due:
*questa feature si spegne?* e *questa feature, qualcuno la compila?* Il repo
aveva la prima e non la seconda.

**Perché un elenco di eccezioni con il comando accanto, e non un'eccezione
nuda.** Una feature fuori dal `default` non è vietata — sarà legittima il giorno
che una sarà cara, sperimentale o mutuamente esclusiva con un'altra. Ma allora
qualcuno *deve* compilarla, e la riga di `FUORI_DAL_DEFAULT` è il posto in cui
si scrive chi. Un'esenzione senza quel campo sarebbe una firma su una promessa
vuota, cioè esattamente il difetto che il presidio esiste per non avere.

**Perché non un test Rust in `fub-host`.** Perché la domanda è del workspace e
non di un crate, e perché un test che vive dentro il crate di cui parla è
soggetto alla stessa classe di difetto: sta in un crate che ha feature. Uno
script che legge i manifest dal di fuori non si può spegnere accendendo o
spegnendo niente.

**Il costo, misurato: zero.** Nessun crate nuovo, nessuna feature accesa, nessun
secondo di build — è un lettore di `Cargo.toml` in Node senza dipendenze npm,
come gli altri presidi di quella cartella. La nota di scala che il difetto
temeva — «accendere quella feature in CI aggiunge dieci crate e mezzo minuto» —
non si applica, perché la feature **era già accesa**: qui non si accende niente,
si impedisce a qualcuno di spegnerla senza accorgersene.

**Cosa non è cambiato.** `ureq = "3"` resta com'è, e la scelta è deliberata: la
domanda del punto di verità ha già il suo giudice e dice verde, e stringere il
vincolo a `"3.3"` non risolverebbe nessun difetto misurato — sarebbe una riga in
più da aggiornare a ogni minor. Nessuna firma di contratto toccata, WIT intatto,
nessuna dipendenza nuova.

## La prova che il presidio morde

Verificato **rosso tre volte**, su reversioni distinte:

1. **Il difetto vero**: `"http-client"` tolto dal `default` di `fub-host` →
   `1 violazione`, exit 1, e il messaggio nomina la feature e il numero di riga.
2. **L'elenco esaustivo provato togliendo un elemento**, non aggiungendone uno:
   `"search"` tolto dal `default` di `fub-features` → `1 violazione`. È la forma
   che conta, perché un presidio che si accorge di un elemento *in più* può
   benissimo essere cieco a uno in meno.
3. **Il presidio spento**: puntato su una cartella senza `crates/`, non dice
   `0 violazioni` e verde — dice *«qui il presidio non sta guardando niente»* ed
   esce 1. Stessa disciplina di `check-cargo-versioni.mjs` e
   `check-doc-links.mjs`, e per la stessa ragione: un controllo che non ha
   guardato niente non è verde, è spento.

Il conto che stampa è `25 feature dichiarate` su `2 crate con feature`: undici
in `fub-features` e quattordici in `fub-host`. Se domani quel numero scende
senza che nessuno abbia tolto una feature, il lettore a righe ha smesso di
leggere qualcosa — ed è il motivo per cui il numero si stampa anche quando è
tutto verde.

## Cosa resta fuori, dichiarato

**Le feature delle dipendenze non si guardano.** Questo presidio conta le
feature che i crate del workspace **dichiarano**, non quelle che accendono sulle
proprie dipendenze: `ureq` con `gzip` spenta compilerebbe, e nessuno qui se ne
accorgerebbe. È una domanda diversa — *quale configurazione di una libreria di
terzi stiamo provando* — e vorrebbe un altro attrezzo.

**`--all-features` non è provato, e oggi non serve.** Con ogni feature dentro il
`default`, `--all-features` e `default` sono la stessa build: aggiungere quel
comando in CI sarebbe compilare due volte la stessa cosa. Il giorno che
`FUORI_DAL_DEFAULT` avrà la sua prima voce, quella riga vorrà il suo passo — e
il presidio lo chiede per iscritto proprio lì.

**Il conto dei test non è presidiato.** Il difetto qui è stato *misurato* con il
numero di test passati (1331 → 1328), ma nessuno lo verifica a ogni giro: un
test cancellato a mano esce dal conto esattamente come uno spento da una
feature, e questo presidio non lo vede. Prendere quella classe vorrebbe un
numero atteso scritto da qualche parte, cioè una riga che si aggiorna a ogni
commit — il rimedio costa più del male, e resta dichiarato invece che risolto.
