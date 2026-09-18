# Stato del progetto

> **Stato aggiornato per:** candidato `audit-close` della
> [PR #50](https://github.com/Fubeo/Fub/pull/50), basato su
> `fix/audit-integration`, 18 settembre 2026.
> La remediation è completa localmente; questo non è ancora `main`.

## Governance di integrazione

Il piano `PIANO-AZIONE-FUB-AUDIT-2026-09-01.md` della linea
`fix/audit-integration` resta l'autorità. La [PR #50](https://github.com/Fubeo/Fub/pull/50)
raccoglie il candidato riconciliato: registro G14 56/56, WIT frozen preservati,
remediation e prove locali complete.

**NOT READY FOR PHASE 9 — NON MERGIARE IN `main` FINO AL G15/GO.**

Il passaggio a `main` richiede i required checks Linux/macOS/Windows e supply
chain sullo stesso commit finale, la chiusura G14 e una decisione G15/GO
esplicita registrata sulla PR. Un run storico o relativo a uno SHA precedente
non soddisfa il gate.

## Stato della base audit

La base `fix/audit-integration` contiene le consegne M5 e fase 10 già integrate;
la PR #50 aggiunge la chiusura della matrice audit e le remediation emerse dalla
review conclusiva. Il candidato serve `FormatProvider`, `ViewProvider` e
`GridProvider` nei percorsi nativo/WASM coperti, con lifecycle, fallback,
limiti e parità verificati.

#8 e #10 restano tracker aperti fino alla registrazione della decisione finale:
la presenza dell'implementazione non sostituisce G14/G15 né i check sullo SHA
di merge.

La decisione resta **NO-GO** finché i check finali o G15 mancano. Dopo il verde
completo, i rischi residui espliciti del registro — writer esterni non
cooperativi, rename staged, famiglie WASM inbound differite e limiti sandbox —
devono essere accettati o dichiarati bloccanti nel record G15.

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
M5, fase 10 e remediation audit sono presenti nel candidato PR #50; diventano
consegna di `main` solo dopo G15/GO, merge e verifica post-merge.

## CI e qualità visuale

Sul candidato locale: Rust 2171 pass/3 ignored in 168 suite; client 95 file e
1380 test; build e typecheck verdi; `npm audit` 0; axe 42/42 scene, 48.612
elementi, 0 failure e 0 debito dichiarato. I 388 `incomplete` axe sono
indeterminati riportati, non violazioni soppresse. L'autorità remota resta il
rollup dei required checks della PR #50 sul commit finale.

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

La fase 10 di #11 è consegnata in `main` tramite #53: il protocollo Grid v1
attraversa ABI/WIT, provider nativo e componente WASM, con finestre, patch,
invalidazioni, ownership e teardown. Le invarianti stabili vivono ora nella
documentazione di frontend/IPC, editor, runtime plugin e ADR 0201; il piano
temporaneo è stato ritirato.

## Lavoro residuo
Per #11 non resta lavoro di consegna del protocollo. Le guardie del registry e
delle famiglie pubbliche rendono meccaniche rispettivamente la validità di
profili/fallback e la presenza di shell, fallback, mirror, nativo e WASM.

### Qualità e resilienza

- [#5 — ripristino atomico degli snapshot del database](https://github.com/Fubeo/Fub/issues/5)
- [#6 — prova di scala e durata della Graph View](https://github.com/Fubeo/Fub/issues/6)
- [#7 — esercitazione di backup e ripristino](https://github.com/Fubeo/Fub/issues/7)
- [#9 — endurance e riconciliazione della sincronizzazione](https://github.com/Fubeo/Fub/issues/9)
- [#17 — evidenze e stabilità delle baseline visuali](https://github.com/Fubeo/Fub/issues/17)

### Architettura della shell

- [#11 — superfici di editing condivise](https://github.com/Fubeo/Fub/issues/11)
- [#12 — modularizzazione della Graph View 2.0](https://github.com/Fubeo/Fub/issues/12)
- [#13 — contratto dei temi e consegna agli autori](https://github.com/Fubeo/Fub/issues/13)

Per #11, le fasi 0–10 sono in `main`. Il pannello monta Markdown, plain text e
`.fubsheet` attraverso `DocumentSurfaceRegistry`, con collisioni, profili e
fallback registrati e teardown posseduto. Il contratto Grid v1 è in ABI/WIT,
ha clienti nativo e WASM e mantiene finestre, patch coordinate, invalidazioni,
limiti, fallback e parità nei casi coperti.

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
- [Changelog](../../CHANGELOG.md)
- [Issue aperte](https://github.com/Fubeo/Fub/issues)
