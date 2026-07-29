# Sicurezza

Questo documento dice **dove si segnala** una vulnerabilità, **cosa è dentro il
perimetro** e **cosa il progetto già presidia**. Non è un'analisi delle minacce:
quella non esiste ancora, e dichiararla dove non c'è sarebbe la prima cosa
falsa del documento.

## Segnalare una vulnerabilità

**Non aprire una issue pubblica.** Il canale è privato:

1. **GitHub Security Advisories** — [apri una segnalazione privata](https://github.com/Fubeo/FubMD/security/advisories/new).
   È il canale primario: tiene insieme la discussione, la CVE se serve e la
   patch, senza che nulla sia visibile prima del tempo.
2. In alternativa, **fabio99marchetti@gmail.com**. È l'indirizzo che sta già in
   ogni commit di questo repo, quindi usarlo non aggiunge esposizione a nessuno.

Cosa serve per essere utile, in ordine di importanza: il percorso per
riprodurre, la versione o il commit, il sistema operativo, e cosa ottiene chi
attacca. Un proof-of-concept accorcia tutto; una descrizione generica di
categoria («possibile path traversal») senza un caso che funziona è un'ipotesi,
e va detta come tale.

## Tempi, dichiarati per quello che sono

Il progetto ha **un manutentore** e nessun impegno contrattuale con nessuno. Le
finestre qui sotto sono aspettative oneste, non un SLA:

| Passo | Aspettativa |
|---|---|
| Primo riscontro | entro 7 giorni |
| Valutazione (confermata / non riproducibile / non nel perimetro) | entro 30 giorni |
| Correzione di una vulnerabilità confermata | prima del rilascio successivo |
| Divulgazione | concordata con chi ha segnalato, dopo la correzione |

Chi segnala viene citato nell'advisory, salvo richiesta contraria.

## Versioni supportate

| Versione | Stato |
|---|---|
| `0.1.0` (`main`) | in sviluppo, **mai rilasciata** |

Non c'è ancora nessun rilascio: non esiste una versione vecchia da patchare, e
l'unica linea presidiata è `main`. Quando il primo rilascio arriverà, questa
tabella e [versionamento.md](versionamento.md) diranno insieme quali versioni
ricevono correzioni.

## Il perimetro

FubMD è un'applicazione desktop che gira **sulla macchina di chi la usa**, sui
file di quella macchina. Non c'è un servizio, non c'è un account, non c'è un
server che riceve dati.

**Dentro il perimetro** — segnalazioni benvenute:

- **Il contenuto dei file come input non fidato.** Un vault può contenere note
  scaricate, ricevute o clonate da altri. Ogni cosa che, aprendo un `.md`, un
  frontmatter YAML o un sidecar JSON, porti a esecuzione di codice, crash
  sfruttabile o lettura di file fuori dal vault.
- **L'uscita dal vault.** Path traversal in lettura o scrittura, symlink seguiti
  dove non dovrebbero, un rename o un ripristino dal cestino che scrive fuori
  dalla radice.
- **La perdita silenziosa di dati dell'utente.** Il cestino e gli snapshot del
  versioning in `.fubmd-data/` sono la rete di sicurezza: un percorso che li
  aggira, li corrompe o li rende irrecuperabili è un problema di sicurezza, non
  solo un bug.
- **L'anteprima nella webview.** Contenuto di una nota che diventa script
  eseguito, o che aggira la Content-Security-Policy dichiarata in
  [`crates/fubmd-app/tauri.conf.json`](../crates/fubmd-app/tauri.conf.json)
  (`default-src 'self'`, `frame-src 'none'`, `object-src 'none'`).
- **Il confine IPC.** Un comando Tauri che fa più di quello che il suo nome
  promette, o che accetta argomenti che il core non valida.
- **La supply chain.** Una dipendenza compromessa, o una che entra aggirando
  [`deny.toml`](../deny.toml).

**Fuori dal perimetro**, oggi:

- **Il sandbox WASM dei plugin di terzi non esiste.** `fubmd-wasm-host` è una
  riga commentata fra i membri del workspace ([`Cargo.toml:15`](../Cargo.toml)):
  arriva a M5. Ogni provider che gira oggi è codice Rust nativo compilato dentro
  il binario, e il [modello a capacità](architecture/plugin-boundary.md) è per
  ora una **disciplina di progettazione**, non una barriera applicata a runtime.
  Chi trova il modo di far fare a un provider nativo qualcosa che le sue
  capacità non prevedono ha trovato un difetto di progettazione — utile da
  sapere, ma non una vulnerabilità: quel provider è già codice del programma.
- **Chi ha già accesso in scrittura alla macchina.** Se un attaccante può
  modificare il vault o il binario, l'app non può difendere niente, e nessun
  progetto desktop pretende il contrario.
- **Il codice sorgente eseguito volontariamente.** Compilare e lanciare `main`
  è una scelta di chi lo fa.

## Cosa il progetto presidia già

| Presidio | Dove | Cosa copre |
|---|---|---|
| Advisory delle dipendenze, crate yanked, licenze a elenco chiuso | [`deny.toml`](../deny.toml) + job `supply chain` in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | dipendenze vulnerabili o ritirate; girato anche una volta a settimana da solo, senza aspettare un push |
| SBOM SPDX 2.3 come artefatto di build | stesso job | la domanda «cosa c'è dentro questa build», che a valle si fa una volta sola e sempre troppo tardi |
| Content-Security-Policy della webview | [`crates/fubmd-app/tauri.conf.json`](../crates/fubmd-app/tauri.conf.json) | script remoti, iframe, oggetti e form: nessuno dei quattro è permesso |
| Nessun client HTTP nell'albero del workspace | i `Cargo.toml` dei sette crate | l'app non parla con la rete: la capacità `fubmd:network` esiste nel modello dei permessi ([`crates/fubmd-abi/src/options.rs:241`](../crates/fubmd-abi/src/options.rs)) ma nessun provider oggi la chiede |
| Elenco chiuso delle capacità, diviso in famiglie negabili | [decisione 0013](decisions/0013-elenco-delle-capacita.md), [0021](decisions/0021-il-confine.md), [architecture/plugin-boundary.md](architecture/plugin-boundary.md) | la forma che avrà l'applicazione a M5: al confine WIT una famiglia negata non è un rifiuto a runtime, è l'assenza della funzione |
| Contratto congelato e additivo | [architecture/wit-congelato.md](architecture/wit-congelato.md) | un host più nuovo non rompe un plugin più vecchio, e la rottura deliberata si vede in review |

## Cosa manca, detto qui

Non esiste ancora un'analisi strutturata delle minacce sul confine dei plugin —
il modello a capacità dice *cosa* si può negare, non *contro chi* e con quale
probabilità. Finché non c'è, questo documento dichiara il perimetro e i presidi,
e si ferma lì.
