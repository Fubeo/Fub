# Contribuire a Fub

Il progetto ha **un** manutentore. Questo documento dice tre cose a chi arriva
da fuori: dove guardare prima di scrivere, quali regole non si negoziano, e come
scoprire di aver rotto qualcosa **prima** che lo dica la CI.

Vale la regola del resto di [`docs/`](README.md): la prosa non si ripete, si
linka.

## Prima di scrivere una riga

| Voglio… | Leggo |
|---|---|
| capire l'idea iniziale e come avviare Fub | [00-inizia-qui/01-cos-e-fub.md](00-inizia-qui/01-cos-e-fub.md) |
| capire i concetti chiave con analogie semplici | [01-concetti/01-il-vault.md](01-concetti/01-il-vault.md) |
| consultare la scheda di un componente specifico | [02-componenti/01-panoramica.md](02-componenti/01-panoramica.md) |
| vedere i diagrammi UML e il grafo delle dipendenze | [03-uml/01-trait-fub-abi.md](03-uml/01-trait-fub-abi.md) |
| comprendere o creare un plugin | [04-plugin/01-nativo-vs-wasm.md](04-plugin/01-nativo-vs-wasm.md) |
| toccare un trait del contratto o il modello dati | [06-contratto/01-i-trait-in-rust.md](06-contratto/01-i-trait-in-rust.md) |
| aggiungere o modificare un pannello o la UI | [07-ui/01-la-shell-e-il-frontend.md](07-ui/01-la-shell-e-il-frontend.md) |
| consultare i verbali delle decisioni storiche | [decisions/README.md](decisions/README.md) |
| consultare lo stato dei lavori aperti | [todo.md](todo.md) |

Le decisioni storiche hanno un verbale. Leggilo prima di riaprire una
discussione.

## Le cinque invarianti che non si negoziano

Non sono consigli. Ognuna ha un presidio (un test automatico) che diventa
**rosso** se la si viola.

| Invariante | Perché | Chi la fa fallire |
|---|---|---|
| `fub-abi` e `fub-kernel` non conoscono `comrak`, `tauri`, `wasmtime`; `fub-host` non conosce `tauri` | Il core è agnostico al formato. Chi assembla deve potersi avviare senza interfaccia webview. | [`crates/fub-abi/tests/dependency_invariant.rs`](../crates/fub-abi/tests/dependency_invariant.rs) |
| `fub-abi` e `crates/fub-abi/wit/fub/abi.wit` si rispecchiano | Il contratto WIT è il confine per `M5`. Se divergono, il confine si spezza. | [`crates/fub-abi/tests/wit_conformance.rs`](../crates/fub-abi/tests/wit_conformance.rs) |
| il contratto cresce **solo per aggiunta** rispetto a `wit/frozen/` | Garantisce il freeze di `M4`. Senza presidio, la promessa decade in silenzio. | [`crates/fub-abi/tests/wit_additivity.rs`](../crates/fub-abi/tests/wit_additivity.rs) |
| i link fra documenti e codice non marciscono | Un documento che cita `traits.rs` deve fallire se si sposta. | [`.github/scripts/check-doc-links.mjs`](../.github/scripts/check-doc-links.mjs) |
| il diagramma dei componenti dice le dipendenze che dicono i `Cargo.toml` | Un disegno non compilato mente. Un crate nuovo deve apparire nel diagramma. | [`the_diagram_declares_the_real_dependencies`](../crates/fub-abi/tests/dependency_invariant.rs) |

La **terza** si può rompere apposta: si tocca `0.1.0.wit` in un commit che lo
dichiara, e in review si vede.

La **sesta** regola — «tutta la prosa sta in `docs/`» — la controlla solo chi
legge. Nessuno script sa distinguere un `README.md` legittimo da uno fuori
posto, quindi in CI non fallisce.

## Il ciclo locale

```bash
# Rust
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

# frontend (dentro frontend/)
npx tsc --noEmit      # `vite build` traspila senza controllare i tipi
npm test
npm run build
npm run bench:a11y    # il contrasto della pagina vera, nelle due luci (§31.1)
npm run bench:verify  # confronto a pixel sul runner Linux (§31.1)

# shell (dalla radice, come la CI)
node .github/scripts/check-listeners.mjs
node .github/scripts/check-races.mjs
node .github/scripts/check-npm-copies.mjs

# documenti
node .github/scripts/check-doc-links.mjs
node .github/scripts/check-prose.mjs
node .github/scripts/check-tables.mjs

# invarianti
node .github/scripts/check-cargo-versions.mjs
node .github/scripts/check-cargo-feature-default.mjs
node .github/scripts/check-crate-type.mjs
node .github/scripts/check-dev-profile.mjs

# le feature ufficiali si spengono davvero (§16.3)
cargo build -p fub-features --no-default-features
cargo build -p fub-features --no-default-features --features outline
cargo build -p fub-host --no-default-features --features outline,notify-watcher

# presidio del ciclo stesso
node .github/scripts/check-locale-loop.mjs

# supply chain (serve `cargo install cargo-deny`)
cargo deny check
```

### Le eccezioni al ciclo

Un comando della CI non sta nel ciclo locale, e la ragione sta dopo il `—`:

- `cargo check -p fub-kernel --all-targets --target x86_64-pc-windows-msvc` —
  vuole installato il target `x86_64-pc-windows-msvc`.
- `cargo build --manifest-path tools/varco-wasm/Cargo.toml --target wasm32-unknown-unknown` —
  vuole installato il target `wasm32-unknown-unknown`. È il contratto portato di
  là dal confine e compilato (verbale 0146); il crate sta fuori dal workspace
  apposta, così `cargo test --workspace` non chiede quel target a nessuno.
- `cargo build --manifest-path esempi/ping-wasm/Cargo.toml --target wasm32-wasip2` —
  vuole installato il target `wasm32-wasip2`, che è quello dei **componenti**
  (l'altro, `wasm32-unknown-unknown`, dà un modulo core). L'esempio sta fuori dal
  workspace per la stessa ragione del varco. In CI la riga sta nel job `test` e
  non fra le invarianti perché il target lo pretende `cargo test --workspace`: il
  test di `fub-wasm-host` costruisce il componente da sé invece di caricare un
  `.wasm` committato. Chi non ha il target lo scoprirà da quel test — con un
  messaggio che dice cosa manca — e non da qui.

Tutto il resto lo esegue anche la CI: se passa in locale, passa in CI. I test
girano su Linux, macOS e Windows, e a rompersi sono quasi sempre i path e i lock
file di `.fub/data/`. Se ciclo locale e CI divergono, `check-locale-loop.mjs`
diventa rosso.

### Il banco visivo in CI e la provenienza delle baseline

Il banco del [§31.1](roadmap/31-da-dove-viene-cio-che-si-vede.md) fotografa la
shell vera in tutte e due le luci e confronta con le baseline in repo. Nel ciclo
qui sopra e nel job `frontend` di CI girano sia il **confronto a pixel** sia il
contrasto reso.

Un browser pinnato garantisce lo stesso motore; la
[§31.3](roadmap/31-da-dove-viene-cio-che-si-vede.md#313-la-voce-del-tema-i-caratteri)
ha portato nel bundle anche i tre caratteri, così la resa non dipende dai font
della macchina. Le baseline canoniche in repo provengono da `ubuntu-latest`, lo
stesso runner Linux sul quale CI esegue `npm run bench:verify`: quando il
cambiamento è voluto, anche `npm run bench:update` va eseguito in quell'ambiente
prima di commettere le nuove immagini. Su un confronto rosso, CI allega foto
attuali, differenze e foglio di contatto come artifact del job.

Chi tocca il tema lo lancia anche a mano e guarda il foglio di contatto:

```bash
# dentro frontend/, la prima volta: npx playwright install chromium
npm run bench:verify     # rosso se una scena è cambiata
npm run bench:update     # riscrive le baseline, quando il cambiamento è voluto
npm run bench            # il banco a mano, su http://localhost:1431
```

Il foglio di contatto — le due luci affiancate, scena per scena — esce in
`frontend/bench/.output/foglio-di-contatto.html` a ogni corsa. È il cancello
umano di ogni tappa della seduta, ed è scritto qui perché non resti l'abitudine
di una persona sola.

### Tre file del tema sono generati

Dalla [§31.2](roadmap/31-da-dove-viene-cio-che-si-vede.md) i colori dei due
fogli non si scelgono: si **ricavano**. La sorgente è
`frontend/src/theme/serie/recipe.ts` — dichiara di ogni ruolo la tinta, il
croma, sopra cosa sta e quanto contrasto vuole reggere — e i due
`sheet-*.css` sono un derivato, con scritto in testa che lo sono.

Dalla [§31.4](roadmap/31-da-dove-viene-cio-che-si-vede.md) la **skin** è il
terzo. Si scrive un componente per volta in `serie/skin/`, e
`serie/skin.css` è il file che i pezzi compongono nell'ordine che
`serie/skin/order.ts` dichiara — perché in CSS l'ordine di due regole della
stessa specificità decide chi vince, e montare per ordine alfabetico vorrebbe
dire che rinominare un file cambia ciò che si vede. Dentro il derivato, un
filetto per pezzo dice da dove viene ciò che segue: quando un presidio o il
browser puntano dentro `skin.css`, è così che si risale al pezzo da toccare.

```bash
# dentro frontend/
npm run theme:generate   # riscrive i due fogli e la skin dalle loro sorgenti
npm run theme:verify     # dice se su disco c'è ciò che le sorgenti producono
```

Nessuno dei due sta nel ciclo locale, e non è una dimenticanza: la verifica la
fa già `npm test`, che confronta i tre file **byte per byte** con ciò che le
sorgenti producono (`src/theme/recipe.test.ts`, `src/theme/skin.test.ts`).
`theme:verify` è la stessa domanda fatta senza avviare vitest, e serve a chi
sta lavorando sulla sorgente; `theme:generate` è un gesto, non un verdetto.

Un esadecimale ritoccato a mano in un foglio — o una regola scritta dentro la
pelle montata — sparisce alla prima rigenerazione, e fino ad allora dice il
falso sulla sorgente. È la ragione per cui il presidio esiste, ed è lo stesso
schema dei `*.generated.ts`.


I fuzzer del §17.1 girano **dentro** `cargo test --workspace`, con seme fisso.
Alzare il conteggio serve a cercare bug a mano, non a presidiare:

```bash
FUB_FUZZ_CASI=5000000 cargo test --release -p fub-format-markdown \
  --test the_corpus -- no_corpus_mutation
FUB_FUZZ_TRASFERIMENTO=1000000 cargo test --release -p fub-format-markdown \
  --test transfer_e2e -- no_mutation_of
FUB_FUZZ_NOMI=100000 cargo test --release -p fub-format-markdown \
  --test transfer_e2e -- no_mutated_name
```

Queste variabili non configurano Fub: vivono solo dentro `#[test]`. Di quelle
che l'app legge davvero parla la [decisione
0036](decisions/0036-le-impostazioni-e-i-tre-stati.md).

## Cosa presidia la CI

**Sei** job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml):

| Job | Cosa presidia | Quando gira |
|---|---|---|
| `invarianti` | le prime **tre** invarianti | push e PR |
| `supply chain` | licenze e advisory secondo [`deny.toml`](../deny.toml), SBOM SPDX 2.3 | push, PR **e** settimanale |
| `fmt + clippy` | formattazione e lint (warning = errori) | push e PR |
| `build + test` | il workspace su Linux, Windows e macOS | push, PR **e** settimanale |
| `docs` | link interni e promessa del ciclo locale | push e PR |
| `frontend` | type-check, test e build della shell, più il contrasto reso del banco visivo | push, PR **e** settimanale |

I job pesanti girano anche di lunedì: le dipendenze e l'ambiente cambiano anche
quando il repo sta fermo.

## I commit

Il manutentore lavora su `main`. I contributi esterni arrivano via pull request.

Formato: `tipo(scope,scope): frase`.

- **tipo**: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `style`.
- **scope**: il crate senza `fub-` (`abi`, `kernel`, `host`, `features`, `sdk`,
  `app`), più `wit`, `frontend`, `docs`, `ci`.
- **frase**: minuscola, in italiano, senza punto finale. Spiega **cosa cambia**
  e non quali file tocca.

Niente trailer `Signed-off-by` né `Co-Authored-By`: l'autore è chi firma il
commit. Ogni commit lascia l'albero verde e funzionante — se una cosa vuole
**due** passaggi, resta **un solo** commit.

Non c'è un `CODEOWNERS`, perché c'è **un solo** manutentore.

## Aggiungere un documento

[README.md](README.md) spiega dove metterlo.

- I nomi sono minuscoli e in italiano.
- I numeri (verbali, voci aperte) vivono in [todo.md](todo.md) e
  [decisions/README.md](decisions/README.md).

## Chiudere una decisione

Un verbale nuovo prende il primo numero libero.

- Il **contenuto** — le decisioni prese, le alternative scartate — è immutabile.
- La **forma** no: si può riscrivere per renderlo più chiaro, senza falsificarne
  il senso.
- Numero e nome del file non cambiano mai.
- Una decisione che ne supera un'altra è un verbale nuovo che la cita.

Se un verbale nomina file o tipi che a `HEAD` non esistono più, **non** si
corregge al presente: si mette un avviso in cima che dice che è invecchiato.
(Chiude il difetto 0127.)

I dettagli sono in [decisions/README.md](decisions/README.md).

## Il resto

- Vulnerabilità: [SECURITY.md](SECURITY.md).
- Condotta: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- Versioni: [versionamento.md](versionamento.md).
- Licenza: `MIT OR Apache-2.0` ([LICENSE-MIT](../LICENSE-MIT),
  [LICENSE-APACHE](../LICENSE-APACHE)).
