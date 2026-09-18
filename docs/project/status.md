# Stato del progetto

> **Stato aggiornato per:** `main` al commit
> `7c263d2950176846bc45d85381c72f46b822bfd8`, 18 settembre 2026.

## Stato post-merge

L'integrazione audit è conclusa:

- G14 è completato **56/56**, senza finding nelle classi
  `NOT_RECONSTRUCTED`, `PARTIAL` o `IMPLEMENTED_UNVERIFIED`;
- G15/GO è registrato sulla
  [PR #53](https://github.com/Fubeo/Fub/pull/53);
- la PR #53 è stata integrata in `main` con merge commit
  `7c263d2950176846bc45d85381c72f46b822bfd8`;
- le due run push post-merge sullo stesso SHA sono verdi;
- i rischi residui accettati da G15 restano espliciti e tracciati, ma non sono
  gate di merge retroattivi.

Non esiste più un blocco globale di integrazione audit. Il record della baseline
post-merge è l'[issue #54](https://github.com/Fubeo/Fub/issues/54).

## Release corrente

Fub non ha ancora pubblicato un tag. Il workspace e la shell dichiarano
`0.1.0`; il contratto plugin è `fub:abi@0.1.2`, con Grid v1 in ABI/WIT e
mirror TypeScript. Il protocollo Grid negozia famiglia e versione prima
dell'invocazione e mantiene fallback, limiti e parità nativo/WASM nei percorsi
coperti.

Le milestone 1–4 sono assorbite nel prodotto e nell'architettura correnti.
**M5, fase 10 delle superfici condivise e remediation audit sono implementate
in `main`** tramite la PR #53 e il merge SHA sopra indicato.

## CI post-merge

Le evidenze autorevoli per `main@7c263d…` sono:

- **test applicativi:** run CI
  [35331754822](https://github.com/Fubeo/Fub/actions/runs/35331754822),
  con invarianti ABI/WIT, fmt/Clippy, test Rust su Linux/macOS/Windows,
  type-check, test e build del client e guard documentali;
- **supply chain Rust:** nella stessa run CI, `cargo deny`, generazione SBOM
  SPDX e pubblicazione dell'artifact sono completati con successo;
- **supply chain NPM:** run
  [35331754778](https://github.com/Fubeo/Fub/actions/runs/35331754778),
  con installazione da lockfile, audit high/critical, SBOM SPDX e controllo
  licenze completati con successo;
- **benchmark osservazionali:** il job client della run CI esegue
  `bench:graph-scale` a 2k nodi e il soak osservativo a 10k;
- **visuali e accessibilità:** lo stesso job esegue `bench:verify` e
  `bench:a11y`. La griglia ha inoltre test ARIA e tastiera dedicati; una scena
  visuale Grid esplicita non è ancora nel catalogo del banco e resta un punto
  di verifica della Definition of Done di #11.

## Implementato

### Core e storage

- workspace local-first;
- modello comune del documento;
- provider Markdown;
- CRUD del vault, rename e cestino;
- revisioni, bozze e versioning;
- anagrafe, organizzazione, impostazioni e journal;
- apertura a fasi con file non letti dichiarati;
- eventi accodati e job cancellabili;
- remediation audit per custody, CAS cooperativa, lifecycle e percorsi di
  scrittura, integrata in `main`.

### Conoscenza e shell

- ricerca full-text;
- wikilink, tag, backlink, outline e proprietà;
- Graph View;
- motore testuale CodeMirror condiviso e profili Markdown/plain text;
- sorgente, live preview e lettura;
- più riquadri e `DocumentSession` condivisa;
- UI dichiarativa, comandi e impostazioni;
- tema generato, banco visuale e accessibilità;
- fase 10 di #11: `DocumentSurfaceRegistry`, superficie Grid v1, negoziazione
  di famiglia/versione, finestre, patch, invalidazioni, fallback, ownership e
  teardown.

### Estensibilità

- trait condivisi in `fub-abi`;
- WIT vivo e frozen, con `fub:abi@0.1.2` e Grid v1;
- feature ufficiali indipendenti;
- provider nativi e component model Wasmtime;
- lifecycle `Plugin` e `CommandProvider` WASM;
- `FormatProvider`, `ViewProvider` e `GridProvider` nativi/WASM nei
  percorsi esercitati;
- capability, timeout, memoria, UI non fidata ed errori tipizzati;
- inventario macchina persistente separato dai dati del vault;
- installazione da file scelto, consenso
  (`undecided`/`denied`/`granted`), scelta `enabled`, restart e
  rimozione da disabilitato.

L'inventario pubblica il blob prima del record e rifiuta collisioni di id,
versioni implicite, digest alterati e file incompleti. Lo startup seleziona
solo `enabled && consent == granted`; il consenso non concede capability e
`enabled` non equivale a un'istanza montata. La rimozione ritira prima il
record, richiede disabilitazione e non cancella `.fub/plugins/<id>/`.

## Limiti correnti

I rischi accettati da G15 restano limiti tecnici osservabili, non condizioni
per reintegrare quanto è già in `main`:

- la CAS è esatta tra writer Fub cooperativi che rispettano il lock; writer
  esterni che ignorano il protocollo possono correre con confronto e
  pubblicazione;
- il rename di dominio è staged e non costituisce una transazione globale:
  un writer esterno può intervenire fra le fasi nonostante riconvalida e
  generazioni;
- `IndexProvider` e `EventHandler` inbound non sono esposti ai componenti
  WASM; `host-events` outbound resta supportato;
- deadline a epoche e limite di memoria confinano il guest, ma non sono una
  quota assoluta di CPU/RAM dell'intero processo.

Questi limiti sono conservati nelle pagine permanenti di architettura e nelle
guide autori; gli identificatori di rischio di G15 restano nel registro audit.

## Lavoro residuo

### Riconciliazione e verifica di completamento

Le issue #8 e #10 rappresentano capacità M5 già consegnate; resta da verificare
formalmente i rispettivi criteri e lasciare il commento di chiusura. Lo stesso
vale per #11 rispetto alle superfici condivise e alla sua regola di uscita.

Le issue #7, #12, #13 e #17 restano in **verifica di completamento**: lo stato
del tracker da solo non prova che manchi l'implementazione, ma le rispettive
matrici devono essere riconciliate con le evidenze presenti in `main`.

### Residui reali

- #5 conserva lavoro reale sul ripristino atomico degli snapshot del database e
  va completato contro i suoi criteri di accettazione;
- #9 richiede una decisione esplicita rispetto al primo release candidate:
  completarlo prima della release oppure rinviarlo come lavoro post-release,
  senza chiusura artificiale.

## Bloccato

Non esiste più un blocco globale di integrazione audit: G14 è completo,
G15/GO è registrato, la PR #53 è in `main` e la CI post-merge è verde.

Eventuali blocchi successivi appartengono alle singole issue o ai criteri del
release candidate; non riaprono il gate di merge audit già concluso.

## Prossimi passi

1. riconciliare tracker e PR storiche;
2. verificare la chiusura di #8, #10, #11, #17, #7, #12 e #13;
3. completare il residuo reale di #5;
4. decidere #9 rispetto alla release;
5. preparare il primo release candidate.

## Fonti

- [Roadmap](roadmap.md)
- [M5](m5-wasm-runtime.md)
- [TODO sulle superfici di editing](todo-superfici-di-editing-condivise.md)
- [Changelog](../../CHANGELOG.md)
- [Baseline post-merge #54](https://github.com/Fubeo/Fub/issues/54)
- [Issue aperte](https://github.com/Fubeo/Fub/issues)
