# Tema theme-2

Fonte generata: `npm run theme:generate`. Verifica: `npm run theme:verify`.

Il contratto richiede **154 ruoli**, espone **1196 hook**, **7 stati** (639 assegnazioni su 188 componenti) e lascia ridichiarare alla persona **123 token**. Gli elenchi, le coppie di contrasto e il vocabolario CSS in più sono in `contract.json`, generato dalle sorgenti della shell.

## Struttura minima

Una cartella installabile contiene `manifest.json`, un foglio per ogni luce dichiarata (`sheet-light.css` e/o `sheet-dark.css`), `skin.css` opzionale e asset locali. Il campione `sample/` è un bundle non-serie completo, generato dagli stessi cancelli.

Il manifest usa `engine: theme-2`; l'id deve essere un singolo componente di path sicuro e `asset_namespace` deve essere esattamente `theme://<id>/`. Il tema non dichiara permessi; può dichiarare impostazioni sue (`settings`), che la shell mostra nelle Preferenze. Un engine sconosciuto, un id insicuro, un namespace diverso, un manifest malformato o una luce non dichiarata vengono rifiutati. Un tema `theme-1` resta installato ma la shell non lo monta: lo segnala con una diagnosi e ricade sul tema di serie.

## Limiti e pubblicazione

- `manifest.json`: massimo 64 KiB.
- Ogni foglio CSS e `skin.css`: massimo 4 MiB.
- Asset: massimo 1.024 file, 64 MiB per file e 256 MiB complessivi.
- Link simbolici, traversal e file non regolari sono rifiutati.
- L'installazione copia in `<config>/themes/.tmp-…` e pubblica con rename atomico; un id già presente è una collisione e non viene sovrascritto.

## Fallback e anteprima

La shell valida ogni luce prima di mostrarla nel catalogo. Se un tema installato non è leggibile o non supera il gate client, non viene montato e la resa ricade sul tema di serie con una diagnosi. La preview delle Preferenze è temporanea: non scrive `appearance.theme` né la cache, Annulla o la chiusura del pannello rimontano la selezione precedente, e solo Applica persiste la nuova scelta.

## Ciclo autore

Da `apps/client`: eseguire `npm run theme:generate`, poi `npm run theme:verify`; per la resa usare anche `npm run bench:verify` e `npm run bench:a11y`. Non modificare a mano `contract.json`, questo README o i file del campione: sono derivati e la verifica byte-per-byte deve restare verde.
