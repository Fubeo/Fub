# Contribuire a FubMD

Il progetto ha **un manutentore**, e questo documento dice cosa cambia per chi
arriva da fuori: dove si guarda prima di scrivere, quali regole non sono
opinioni, e come si fa a sapere di aver rotto qualcosa **prima** che lo dica la
CI.

Il registro è quello del resto di [`docs/`](README.md): niente si scrive due
volte. Se una frase qui dentro ripetesse un documento di architettura, la frase
è di troppo — al suo posto va il link.

## Prima di scrivere una riga

| Voglio… | Leggo |
|---|---|
| capire l'idea architetturale e le decisioni col perché | [PIANO.md](PIANO.md) |
| vedere tutto in un colpo d'occhio | [architecture/mappa-visuale.md](architecture/mappa-visuale.md) |
| toccare un trait del contratto | [architecture/traits.md](architecture/traits.md) e [architecture/wit.md](architecture/wit.md) |
| aggiungere un pannello o una vista | [architecture/ui-protocol.md](architecture/ui-protocol.md) e [architecture/shell.md](architecture/shell.md) |
| sapere perché una cosa è così e non altrimenti | [decisions/](decisions/README.md) |
| sapere cosa manca, e con che priorità | [todo.md](todo.md) |

La domanda «perché è fatto così» ha quasi sempre già una risposta scritta: sono
i verbali. Aprire una discussione su una scelta già chiusa senza aver letto il
suo verbale costa a entrambi il tempo di riscoprirla.

## Le quattro invarianti che non si negoziano

Non sono raccomandazioni: ognuna ha qualcosa che diventa **rosso** se la si
viola, ed è per questo che sono ancora vere.

| Invariante | Perché | Chi la fa fallire |
|---|---|---|
| `fubmd-abi` e `fubmd-kernel` non conoscono `comrak`, `tauri`, `wasmtime`; `fubmd-host` non conosce `tauri` | il core è agnostico rispetto al formato e chi monta dev'essere avviabile da una CLI o da un e2e headless, senza webview | [`crates/fubmd-abi/tests/dependency_invariant.rs`](../crates/fubmd-abi/tests/dependency_invariant.rs) |
| `fubmd-abi` e `crates/fubmd-abi/wit/fubmd/abi.wit` si rispecchiano | il contratto WIT è la stessa superficie detta nella lingua dei componenti: se le due divergono, a M5 diverge il confine | [`crates/fubmd-abi/tests/wit_conformance.rs`](../crates/fubmd-abi/tests/wit_conformance.rs) |
| il contratto cresce **solo per aggiunta** rispetto a `wit/frozen/` | è la promessa su cui poggia il freeze di M4, e senza presidio decade in silenzio — vedi [architecture/wit-congelato.md](architecture/wit-congelato.md) | [`crates/fubmd-abi/tests/wit_additivity.rs`](../crates/fubmd-abi/tests/wit_additivity.rs) |
| i link fra documenti non marciscono — e nemmeno quelli che puntano a un file di codice | un secondo posto in cui si racconta la stessa cosa invecchia perché niente lo compila; un documento che cita `traits.rs` deve diventare rosso quando `traits.rs` si sposta | [`.github/scripts/check-doc-links.mjs`](../.github/scripts/check-doc-links.mjs) |

Rompere deliberatamente la terza è previsto e ha una procedura: si ritaglia la
linea di base con un commit che tocca `0.1.0.wit` e dice perché. Il test non lo
impedisce, lo rende **visibile in review**.

La quinta regola — **tutta la prosa sta in `docs/`** — è nella tabella dei
presidi solo a metà, e va detto: nessuno script sa distinguere un documento
nuovo fuori posto da un `README.md` legittimo. È l'unica delle cinque che si
regge sulla review, ed è per questo che [README.md](README.md) spiega per esteso
dove va ogni genere di documento invece di limitarsi a elencare le cartelle.

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

# documenti
node .github/scripts/check-doc-links.mjs

# supply chain (serve `cargo install cargo-deny`)
cargo deny check
```

La CI non fa niente di più di questo elenco: se passa in locale, passa lì —
salvo il fatto che i test girano anche su Windows e macOS, dove a rompersi sono
quasi sempre i path e i lock file di `.fubmd-data/`.

## Cosa presidia la CI

Sei job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml):

| Job | Cosa presidia | Quando gira |
|---|---|---|
| `invarianti` | le prime tre invarianti della tabella sopra | push e PR |
| `supply chain` | licenze, advisory e provenienza secondo [`deny.toml`](../deny.toml), più l'SBOM SPDX 2.3 come artefatto | push, PR **e** la corsa settimanale |
| `fmt + clippy` | formattazione e lint, con i warning come errori | push e PR |
| `build + test` | l'intero workspace su Linux, Windows e macOS, con la toolchain pinnata all'MSRV | push, PR **e** la corsa settimanale |
| `docs` | i link interni fra i documenti | push e PR |
| `frontend` | type-check, test di unità e build della shell | push, PR **e** la corsa settimanale |

C'è una corsa **schedulata** il lunedì mattina, e la ragione è il job della
supply chain: un advisory nuovo non aspetta il prossimo push, e il costo di
scoprire tardi una dipendenza compromessa è asimmetrico rispetto a tutto il
resto. I tre job veloci (`invarianti`, `fmt + clippy`, `docs`) si tirano fuori
da quella corsa con una condizione esplicita, perché senza un commit di mezzo
non possono aver cambiato esito; `build + test` e `frontend` la condizione non
ce l'hanno, quindi girano anche lì — dove valgono come canarino sull'ambiente,
visto che dipendenze di sistema e immagini dei runner cambiano sotto ai piedi.

## I commit

Il manutentore lavora **direttamente su `main`**, senza branch. Un contributo da
fuori arriva come pull request da un fork; il resto delle regole vale per
entrambi.

Forma del messaggio: `tipo(scope,scope): frase`.

- **tipo** — `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `style`.
- **scope** — il crate senza il prefisso `fubmd-` (`abi`, `kernel`, `host`,
  `features`, `sdk`, `app`), più `wit`, `frontend`, `docs`, `ci`. Si elencano
  tutti quelli toccati.
- **frase** — in italiano, minuscola, senza punto finale, e dice **cosa cambia
  per chi legge il codice dopo**, non quali file sono cambiati. Il diff l'elenco
  dei file ce l'ha già.

I messaggi non portano trailer: nessun `Signed-off-by`, nessun
`Co-Authored-By`. Chi ha scritto il commit sta nel campo autore.

Un commit lascia l'albero verde. Se una modifica ha bisogno di due passaggi per
compilare, è un commit solo.

**Non c'è un `CODEOWNERS`, e non è una dimenticanza.** Quel file serve a
instradare le review verso il proprietario di un'area quando i proprietari sono
più di uno. Qui è uno: qualunque riga si scrivesse assegnerebbe ogni percorso
allo stesso nome, cioè aggiungerebbe un file da tenere aggiornato per produrre
una richiesta di review che sarebbe arrivata comunque. Il giorno in cui i
manutentori saranno due, il file avrà un senso e si scriverà allora.

## Aggiungere un documento

Dove va, lo dice [README.md](README.md) nella sezione delle convenzioni, e non
si ripete qui. Le due cose da ricordare:

- **il nome del file** è minuscolo, con le parole separate da trattini, in
  italiano — salvo le eccezioni elencate lì, che sono storiche o imposte da
  GitHub;
- **i numeri che cambiano** (voci aperte, verbali, stato di una milestone)
  stanno solo in [todo.md](todo.md) e in [decisions/README.md](decisions/README.md).
  Un documento che li ripete è un documento che prima o poi mente.

## Chiudere una decisione

Un verbale si scrive quando una voce di `todo.md` si chiude, prende il **numero
successivo** — mai uno già usato, nemmeno se il verbale che lo portava è stato
superato — e ci si sposta dentro **intero**. I verbali sono immutabili: non si
riscrivono e non si rinumerano; una decisione che ne supera un'altra è un
verbale nuovo che la cita.

Un verbale può chiudere anche mezza voce, quando quel pezzo è una decisione
intera; il criterio, con gli esempi, sta in [decisions/README.md](decisions/README.md).

## Il resto

- Come segnalare una vulnerabilità: [SECURITY.md](SECURITY.md). **Non** si apre
  una issue pubblica.
- Cosa ci si aspetta nelle interazioni: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- Cosa promettono i numeri di versione: [versionamento.md](versionamento.md).
- Con che licenza entra un contributo: `MIT OR Apache-2.0`, come il resto del
  repo ([LICENSE-MIT](../LICENSE-MIT), [LICENSE-APACHE](../LICENSE-APACHE)).
  Aprendo una pull request si accetta che il contributo sia rilasciato con
  quella doppia licenza.
