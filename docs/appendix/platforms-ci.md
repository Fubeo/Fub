# Piattaforme e CI

## Piattaforme verificate

Il job `build + test` esegue il workspace su:

- Ubuntu;
- Windows;
- macOS.

Linux è la piattaforma primaria di sviluppo, ma path, lock e formati su disco vengono verificati su tutti e tre i sistemi.

## Controlli indipendenti dalla piattaforma

Su Linux girano inoltre:

- invarianti ABI ↔ WIT;
- additività del contratto;
- confini di dipendenza;
- formattazione e Clippy;
- supply-chain e SBOM;
- link, prosa e tabelle dei documenti;
- type-check, test, build, banco visuale e accessibilità del frontend.

## Cosa significa “supportato”

La CI dimostra che il codice compila e che i test passano sui runner previsti. Non equivale a un rilascio ufficiale, a un installer firmato o a una garanzia di assistenza: la repository non ha ancora pubblicato release.

La configurazione autorevole è [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml); il ciclo riproducibile in locale è in [`CONTRIBUTING.md`](../CONTRIBUTING.md).