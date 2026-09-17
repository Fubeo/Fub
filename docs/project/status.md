# Stato del progetto

> **Stato aggiornato per:** tree `audit-close` al merge
> `2cc2e44c3f6dc619218354f6cc89fff2c1517cf2`, con tree
> `e8b9e0c0445ca9cf98ce503d4e07402097f9da62`, 17 settembre 2026.
> `ARCH-001` e G3 restano chiusi sulla linea audit; questo non è `main`.

## Governance di integrazione

Il piano `PIANO-AZIONE-FUB-AUDIT-2026-09-01.md` della linea
`fix/audit-integration` resta operativo. La roadmap non lo ritira e il verde
di una PR basata su `main` non costituisce un'autorizzazione al merge.

**NOT READY FOR PHASE 9 — NON MERGIARE IN `main`.**

La riconciliazione del 9 settembre ha confrontato la baseline `main` con
`fix/audit-integration`; la linea audit conserva il lavoro esclusivo delle due
storie e non autorizza a riscrivere o riaprire la correzione #22.

Il tree corrente viene verificato sulla linea audit senza sovrascriverne i
contratti. Il passaggio a `main` richiede G0–G14 e un G15/GO esplicito sul
candidato corrente, seguito dalla verifica dello SHA integrato.
`ARCH-001` e G3 sono chiusi, ma il piano audit non è completato e i finding
ancora privi di evidenza finale restano aperti.

## Stato della base audit

Il tree `2cc2e44c` integra la consegna della fase 10 di #11 nella base
`fix/audit-integration`, con merge tree `e8b9e0c`. La certificazione del
candidato e quella post-merge sono registrate nella [PR #49](https://github.com/Fubeo/Fub/pull/49):
questa evidenza vale per la base audit, non promuove il lavoro in `main`.

Sul tree corrente sono presenti anche le consegne M5: inventario installato,
installazione e rimozione, consenso e scelta `enabled`, startup autorizzato,
`FormatProvider`, `ViewProvider` e `GridProvider` con i loro percorsi nativi e
WASM coperti. #8 e #10 restano **OPEN** come issue tracker: la presenza delle
implementazioni su questa base non ne chiude formalmente le issue né sostituisce
la matrice G14.

La decisione di integrazione resta **NO-GO — NOT READY FOR PHASE 9 — NON
MERGIARE IN `main`**. Il piano audit non è completato e G14 non ha ancora la
matrice finale 56/56; G15/GO non è stato ottenuto.

Restano vincolanti i WIT frozen e le guardie dell'audit: niente `allow` per
Clippy, test ignorati o saltati, `sleep` usati come sincronizzazione o mutex
globale introdotto per serializzare le suite.

Il rischio residuo reale è il rollback di una rename in concorrenza con un
processo esterno: `VaultStorage` non offre rename condizionale né reservation.
Il candidato verifica l'identità osservata del file, ma non promette una
transazione globale contro modifiche esterne.


## Release corrente

Fub non ha ancora pubblicato un tag. Il workspace e la shell dichiarano
`0.1.0`; il contratto plugin è `fub:abi@0.1.2`, con Grid v1 in ABI/WIT e mirror
TypeScript. Il protocollo Grid negozia famiglia e versione prima dell'invocazione
e mantiene fallback, limiti e parità nativo/WASM.

Milestone 1–4 sono assorbite nel prodotto e nell'architettura correnti.
La consegna M5 e la fase 10 sono presenti nel tree audit corrente; non sono
ancora una consegna di `main` e non chiudono i gate G14/G15.

## CI e qualità visuale

La regressione del fallback dei blocchi Markdown personalizzati è risolta in
[PR #22](https://github.com/Fubeo/Fub/pull/22). La
[run di riferimento del 6 settembre](https://github.com/Fubeo/Fub/actions/runs/34039818672)
è verde sul commit indicato: test Rust sulle piattaforme supportate, frontend,
baseline visuali e accessibilità. La correzione non rigenera le immagini e non
cambia le soglie del banco.

La provenienza e la stabilità delle baseline di
[#17](https://github.com/Fubeo/Fub/issues/17) sono certificate sul candidato:
il commit `7463f725` le ha rigenerate sul runner `ubuntu-latest`, ha spiegato
l'allineamento delle fixture e la neutralizzazione del puntatore e ha ripetuto
il banco 42/42 senza modificare le soglie. Il foglio di contatto canonico è
stato riesaminato nelle due luci. Le run `34966343591` e `34966348108` sullo
stesso SHA hanno poi completato consecutivamente banco visuale e accessibilità
nello stesso ambiente. Un controllo locale fuori dal runner ha isolato il
drift a rasterizzazione di testo e canvas, senza promuoverlo a baseline. #16
resta assorbita; #17 si chiude con l'integrazione autorizzata di queste
evidenze.

## Implementato

### Core e storage

- workspace local-first;
- modello comune del documento;
- provider Markdown;
- CRUD del vault, rename e cestino;
- revisioni, bozze e versioning;
- anagrafe, organizzazione, impostazioni e journal;
- apertura a fasi con file non letti dichiarati;
- eventi accodati e job cancellabili.

### Conoscenza e shell

- ricerca full-text;
- wikilink, tag, backlink, outline e proprietà;
- Graph View;
- motore testuale CodeMirror condiviso e profili Markdown/plain text;
- sorgente, live preview e lettura;
- più riquadri e `DocumentSession` condivisa;
- UI dichiarativa, comandi e impostazioni;
- tema generato, banco visuale e accessibilità.

### Estensibilità

- trait condivisi in `fub-abi`;
- WIT vivo e frozen, con `fub:abi@0.1.2` e Grid v1;
- feature ufficiali indipendenti;
- provider nativi e component model Wasmtime;
- lifecycle `Plugin` e `CommandProvider` WASM;
- `FormatProvider`, `ViewProvider` e `GridProvider` nativi/WASM nei percorsi
  esercitati;
- capability, timeout, memoria, UI non fidata ed errori tipizzati;
- inventario macchina persistente separato dai dati del vault;
- installazione da file scelto, consenso (`undecided`/`denied`/`granted`),
  scelta `enabled`, restart e rimozione da disabilitato.

L'inventario pubblica il blob prima del record e rifiuta collisioni di id,
versioni implicite, digest alterati e file incompleti. Lo startup seleziona
solo `enabled && consent == granted`; il consenso non concede capability e
`enabled` non equivale a un'istanza montata. La rimozione ritira prima il
record, richiede disabilitazione e non cancella `.fub/plugins/<id>/`.

La fase 10 di #11 è consegnata su questo tree: il protocollo Grid v1 attraversa
ABI/WIT, provider nativo e componente WASM, con finestre, patch, invalidazioni,
ownership e teardown. Il TODO conserva le sue checkbox vincolate alla consegna
in `main`, non descrive un'assenza nel tree audit.

## Lavoro residuo
Per #11, la fase 10 è consegnata sulla base audit `2cc2e44c`; il pannello monta
Markdown, plain text e `.fubsheet` attraverso `DocumentSurfaceRegistry`, con
collisioni, fallback e teardown posseduto. Il contratto Grid v1 è in ABI/WIT,
ha clienti nativo e WASM e mantiene finestre, patch coordinate, invalidazioni,
limiti, fallback e parità nei casi coperti. Questa consegna non è stata portata
in `main`.

### Qualità e resilienza

- [#5 — ripristino atomico degli snapshot del database](https://github.com/Fubeo/Fub/issues/5)
- [#6 — prova di scala e durata della Graph View](https://github.com/Fubeo/Fub/issues/6)
- [#7 — esercitazione di backup e ripristino](https://github.com/Fubeo/Fub/issues/7)
- [#9 — endurance e riconciliazione della sincronizzazione](https://github.com/Fubeo/Fub/issues/9)
- [#17 — evidenze e stabilità delle baseline visuali](https://github.com/Fubeo/Fub/issues/17)

### Architettura della shell

- [#11 — superfici di editing condivise](https://github.com/Fubeo/Fub/issues/11)
  ([piano operativo](todo-superfici-di-editing-condivise.md))
- [#12 — modularizzazione della Graph View 2.0](https://github.com/Fubeo/Fub/issues/12)
- [#13 — contratto dei temi e consegna agli autori](https://github.com/Fubeo/Fub/issues/13)

Per #11, le fasi 0–9 e la fase 10 sono consegnate sulla base audit corrente.
Il pannello monta Markdown, plain text e `.fubsheet` attraverso
`DocumentSurfaceRegistry`, con collisioni, fallback e teardown posseduto.
Il contratto Grid v1 è in ABI/WIT, ha clienti nativo e WASM e mantiene
finestre, patch coordinate, invalidazioni, limiti, fallback e parità nei casi
coperti. Questa consegna non è stata portata in `main`.

## Bloccato

Il merge in `main` resta bloccato dai gate audit successivi. Il tree
`2cc2e44c` è una base audit aggiornata, non `main`: G14 resta aperto senza la
matrice finale 56/56 e G15/GO non è stato ottenuto. #8 e #10 restano aperte nei
tracker anche se le capacità M5 esercitate sono presenti su questa base.
Decisione: **NO-GO — NOT READY FOR PHASE 9 — NON MERGIARE IN `main`**.

## Prossimi passi

1. completare le evidenze residue del piano audit e la matrice G14 senza
   promuovere in `main` le consegne non ancora autorizzate;
2. consolidare la chiusura documentale di #8 e #10 sulla base delle prove
   effettive, senza dichiarare chiuse le issue in questa pagina;
3. completare ripristino atomico e backup/restore #5/#7;
4. separare e misurare la Graph View con #12/#6;
5. completare le evidenze manuali e ripetibili di #17;
6. completare il contratto dei temi #13;
7. decidere esplicitamente se #9 blocca la prima release e verificarla oppure
   motivarne il rinvio senza chiuderla artificialmente;
8. ottenere G15/GO esplicito prima di autorizzare qualunque merge finale in
   `main`.

## Fonti

- [Roadmap](roadmap.md)
- [M5](m5-wasm-runtime.md)
- [TODO sulle superfici di editing](todo-superfici-di-editing-condivise.md)
- [Changelog](../../CHANGELOG.md)
- [Issue aperte](https://github.com/Fubeo/Fub/issues)
