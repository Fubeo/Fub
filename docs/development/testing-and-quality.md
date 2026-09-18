# Test e qualità

> **Domanda:** quale banco dimostra una proprietà e quali guard impediscono la
> deriva?
> **Fonti autorevoli:** test nei crate, test frontend e workflow CI.

## Piramide

```mermaid
flowchart TD
    UNIT["unit test<br/>regola locale"] --> INTEGRATION["integrazione<br/>confine reale"]
    INTEGRATION --> E2E["end-to-end<br/>flusso utente"]
    E2E --> VISUAL["visuale e accessibilità"]
    UNIT --> GUARD["guard statici<br/>architettura e contratti"]
```

Ogni livello risponde a una domanda diversa. Un guard non sostituisce il test
del comportamento; un test end-to-end non sostituisce la verifica di una
invariante strutturale.

## Rust

### Test unitari

Vivono vicino alla regola o nel crate proprietario. Sono adatti a:

- canonicalizzazione;
- parser e serializzazione;
- query;
- compatibilità;
- conversioni;
- errori;
- versioni di schema.

### `MemoryHost`

`fub-sdk::testing::MemoryHost` serve a esercitare provider senza montare
l'intera applicazione. È il primo banco per comandi, view e servizi che usano
`HostApi`.

### `fub-testkit`

`fub-testkit` monta kernel e host con fixture reali. Usalo per:

- lifecycle dei bundle;
- storage;
- eventi;
- registri;
- conflitti;
- aperture e teardown.

Resta una dipendenza di sviluppo.

### Test del contratto

I guard del contratto verificano:

- Rust ↔ WIT;
- additività rispetto a `wit/frozen/`;
- radice pubblica di `fub-abi`;
- proiezioni TypeScript;
- enum e fixture generate;
- dipendenze vietate.
### Drill backup/restore

Il banco d'integrazione eseguibile è:

```bash
cargo +1.89.0 test -p fub-host --lib legacy_tests::backup_restore_drill -- --nocapture
```

Il fixture copre l'intero vault: documenti Markdown, allegati binari, file
sconosciuti, `.trash/` e stato autorevole sotto `.fub/`, inclusi storage di
plugin e versioning. La configurazione macchina resta esclusa. Il manifesto
indipendente verifica per ogni path classe, dimensione, impronta FNV-1a e
schema; la scansione rifiuta symlink e file speciali.

Il drill opera offline in un parent temporaneo privato ed esclusivo. Copia
l'albero in uno staging adiacente alla destinazione e pubblica con un solo
rename. Questo dimostra il flusso del banco, non una garanzia universale di
no-replace concorrente o di durabilità dopo un crash.

Un artefatto corrotto o mancante viene validato prima di creare lo staging e
prima di toccare la destinazione. Una destinazione occupata resta invariata e
lo staging completo resta disponibile. La verifica finale usa `Host` reale:
apertura, attesa dell'indicizzazione e lettura del documento, poi chiusura.

`fub.backup` riguarda soltanto le note nello stesso vault; non è il backup
completo esercitato da questo drill. Il banco documenta il comportamento
presente, mentre l'issue resta aperta fino alla verifica CI.


## Frontend

Vitest 5 usa un fake host. Con `clearMocks: true`, prima di ogni test vengono
svuotate chiamate, istanze e risultati delle spy (`vi.clearAllMocks()`), senza
ripristinare l'implementazione né rimuovere i mock; i test che richiedono un
comportamento diverso devono configurarlo esplicitamente. I test devono
verificare la shell senza avviare Tauri.

Aree importanti:

- conversione byte UTF-8 ↔ offset JavaScript;
- sincronizzazione dell'editor;
- layout e focus;
- lifecycle di listener, observer e timer;
- rendering dichiarativo;
- tema;
- comandi e race cancellabili;
- comportamento end-to-end della shell.

`npm run typecheck`, `npm test` e `npm run build` sono tre controlli distinti.

## Visuale e accessibilità

Il banco visuale usa scene deterministiche e baseline del runner Linux. In caso
di differenza, la CI conserva immagini attuali, diff e foglio di contatto.

Le 42 baseline canoniche discendono dal commit
[`7463f725`](https://github.com/Fubeo/Fub/commit/7463f72587291a61459b8815c1357b584eb166c0):
furono rigenerate su `ubuntu-latest` con Chromium installato dalla revisione
Playwright del lockfile, dopo l'allineamento delle fixture host e la
neutralizzazione del puntatore fra le scene. Il foglio di contatto affianca
sempre luce scura e chiara; la revisione ha confermato contenuto, geometria,
stati, contrasto e assenza di tooltip residui in tutte le 21 scene.

La soglia colore resta `0.01` e una foto passa soltanto con al massimo lo
`0.1%` di pixel diversi. Il campione che ha introdotto tali valori misurava,
nella scena peggiore di due corse uguali, `0.008%` a soglia colore zero e
`0.003%` a `0.01`; un cambio di tavolozza produceva invece `99.3%` a `0.01`.
Il commit canonico ha ripetuto il banco 42/42. Sul candidato
`08fe214b44273a1c6a620cf90f8ef4c457f92c88`, le run
[`34966343591`](https://github.com/Fubeo/Fub/actions/runs/34966343591) e
[`34966348108`](https://github.com/Fubeo/Fub/actions/runs/34966348108) hanno
poi eseguito consecutivamente nello stesso job `ubuntu-latest` banco visuale e
accessibilità, entrambi verdi.

Un confronto locale fuori dal runner canonico può superare il limite per
rasterizzazione di testo o canvas pur senza una regressione applicativa. Va
esaminato il diff; non va promosso a baseline. Un cambiamento intenzionale
richiede invece revisione del foglio, spiegazione delle scene coinvolte e
rigenerazione su `ubuntu-latest`.

L'accessibilità verifica la pagina resa, non soltanto una tabella teorica di
colori.

Regole:

- controllare luce chiara e scura;
- non aggiornare baseline da un sistema diverso;
- spiegare ogni cambiamento intenzionale;
- usare moto ridotto nelle scene pertinenti;
- non mascherare una regressione alzando la soglia.

## Runtime WASM

Un test reale costruisce i componenti in `esempi/`. Le classi minime sono:

| Classe | Proprietà |
|---|---|
| successo | mount, chiamata, esito e teardown |
| compatibilità | ABI incompatibile rifiutata prima dell'attivazione |
| capability | accesso negato come errore tipizzato |
| isolamento | trap o panic non abbatte l'host |
| disponibilità | loop infinito fermato dalla deadline |
| memoria | limite applicato prima dell'istanza |
| forma | arena e output malformati rifiutati |
| lifecycle | registrazioni e risorse rimosse |

## Documentazione

I guard documentali controllano:

- link e target;
- raggiungibilità delle pagine;
- dimensioni;
- struttura Markdown;
- blocchi Mermaid;
- tabelle;
- riferimenti legacy e cronaca vietata;
- allineamento del ciclo locale.

## Matrice per modifica

| Modifica | Test necessari |
|---|---|
| helper puro | unit test |
| provider | unit test e `MemoryHost` |
| mount o sessione | integrazione `fub-testkit` |
| storage | integrazione, corruzione e interruzione |
| IPC | mirror, fixture e test shell |
| UI | Vitest, type-check, build, accessibilità |
| resa | banco visuale |
| WIT | conformità, additività e componente reale |
| docs | tutti i guard documentali |

## Qualità della prova

Un test deve fallire per la proprietà che nomina. Evita:

- conteggi fragili senza significato architetturale;
- snapshot enormi non leggibili;
- test saltati quando manca l'artefatto che dovrebbero costruire;
- attese basate su sleep quando esiste un clock controllabile;
- fixture che copiano l'implementazione;
- verifiche che cercano una sottostringa in un errore tipizzato.
