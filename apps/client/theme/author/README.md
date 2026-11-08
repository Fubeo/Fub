# Tema theme-2

Fonte generata: `npm run theme:generate`. Verifica: `npm run theme:verify`.

Il contratto richiede **154 ruoli**, espone **1515 hook**, **7 stati** (737 assegnazioni su 219 componenti) e lascia ridichiarare alla persona **187 token**. Gli elenchi, le coppie di contrasto e il vocabolario CSS in più sono in `contract.json`, generato dalle sorgenti della shell.

Dichiara anche **64 ruoli facoltativi** (`optional_roles`): i segni di Fub sulla carta del tema (`--doc-ins`, `--doc-find`, …) e la carta chiara di un file (`--paper-*`). Un tema che non li dichiara ha i ripieghi della struttura; se li dichiara, le loro coppie (`optional_pairs`) si contano come le altre.

## Strati

Ogni hook appartiene a uno strato, e `contract.json` lo dice in `layers`:

- **cornice** (1200 hook): barre, pannelli, menu, righelli, scrivania. È del tema, sempre.
- **segno** (97 hook): ciò che Fub disegna sul contenuto, cioè selezione, cursore, fuoco, ricerca, revisioni, correttore, commenti e maniglie. È del tema, con i colori della carta su cui sta (`--doc-*`).
- **contenuto** (218 hook): ciò che il file dice. Chi ne ha l'autorità lo dichiara la modalità della superficie, con uno di tre aspetti che la shell mette sulla radice del contenuto: `look-tema`, `look-file` o `look-adattato`.

Una regola sul contenuto vale quando il tema lo veste: si scrive sotto `.look-tema`, come `.look-tema .rich-heading`.

Dove una superficie offre anche `file` o `adattato` il cancello lo fa rispettare (`content_gate`): una regola che nomina una delle 13 classi di contenuto di `hooks` fuori da `.look-tema` è rifiutata (`content-look`), con `!important` o senza, e lo stesso un selettore di tipo o `*` dentro una cornice di `scopes` (`.grid-viewport`, `.rich-page`). Vale per i fogli, le pelli e i frammenti CSS.

## Struttura minima

Una cartella installabile contiene `manifest.json`, un foglio per ogni luce dichiarata (`sheet-light.css` e/o `sheet-dark.css`), `skin.css` opzionale e asset locali. Il campione `sample/` è un bundle non-serie completo, generato dagli stessi cancelli.

## Partire dalla serie

Con `"extends": "fub.serie"` nel manifest un tema parte dal tema di serie e porta solo ciò che cambia. I fogli diventano facoltativi: una luce senza foglio usa quello di serie della stessa luce e dello stesso contrasto, anche alto. Un foglio portato dal tema resta completo: passa i ruoli e i contrasti come ogni foglio. La pelle di serie resta montata, e `skin.css` si aggiunge dopo di lei: una regola del tema vince su quella di serie a parità di specificità, e un componente che il tema non nomina resta vestito dalla serie, anche quando arriva con una versione di Fub più nuova. Una `skin.css` assente o vuota è il caso normale. Quando la serie cambia, il tema eredita il cambio. Ereditare da un altro tema non si può.

Il manifest usa `engine: theme-2`; l'id deve essere un singolo componente di path sicuro e `asset_namespace` deve essere esattamente `theme://<id>/`. Il tema non dichiara permessi; può dichiarare impostazioni sue (`settings`), che la shell mostra nelle Preferenze. Un engine sconosciuto, un id insicuro, un namespace diverso, un manifest malformato o una luce non dichiarata vengono rifiutati. Un tema `theme-1` resta installato ma la shell non lo monta: lo segnala con una diagnosi e ricade sul tema di serie.

## I caratteri del tema

Un tema `theme-2` porta i suoi caratteri dichiarandoli nel manifest, non nel CSS: `@font-face` resta vietato nei fogli e nella pelle, perché un `src:` scritto a mano potrebbe chiamare la rete. Ogni voce di `fonts` ha `family`, `file`, `weight` e `style`:

```json
"fonts": [
  { "family": "Carta Serif", "file": "fonts/carta.woff2", "weight": 400, "style": "normal" },
  { "family": "Carta Serif", "file": "fonts/carta-italic.woff2", "weight": 400, "style": "italic" }
]
```

- `family`: lettere e cifre ASCII, `-` e spazi singoli, al massimo 64 caratteri; non può essere una famiglia di serie né una parola chiave del CSS (`serif`, `monospace`, …).
- `file`: un asset del tema, `fonts/<nome>.woff2`, cioè `theme://<id>/fonts/<nome>.woff2`. Solo WOFF2: il file deve cominciare con la firma `wOF2`.
- `weight`: da 100 a 900. `style`: `normal` o `italic`. La stessa faccia non si dichiara due volte.

La shell scrive da sé le regole `@font-face`, coi valori del manifest e il file in un URL `data:`, e la pelle usa la famiglia per nome: `font-family: "Carta Serif", var(--font-ui);`. Cambiato tema, i caratteri del tema precedente se ne vanno.

## Limiti e pubblicazione

- `manifest.json`: massimo 64 KiB.
- Ogni foglio CSS e `skin.css`: massimo 4 MiB.
- Asset: massimo 1.024 file, 64 MiB per file e 256 MiB complessivi.
- Caratteri: massimo 8 voci in `fonts`, 2 MiB per file e 6 MiB complessivi.
- Link simbolici, traversal e file non regolari sono rifiutati.
- L'installazione copia in `<config>/themes/.tmp-…` e pubblica con rename atomico; un id già presente è una collisione e non viene sovrascritto.

## Fallback e anteprima

La shell valida ogni luce prima di mostrarla nel catalogo. Se un tema installato non è leggibile o non supera il gate client, non viene montato e la resa ricade sul tema di serie con una diagnosi. La preview delle Preferenze è temporanea: non scrive `appearance.theme` né la cache, Annulla o la chiusura del pannello rimontano la selezione precedente, e solo Applica persiste la nuova scelta.

## Ciclo autore

Da `apps/client`: eseguire `npm run theme:generate`, poi `npm run theme:verify`; per la resa usare anche `npm run bench:verify` e `npm run bench:a11y`. Non modificare a mano `contract.json`, questo README o i file del campione: sono derivati e la verifica byte-per-byte deve restare verde.
