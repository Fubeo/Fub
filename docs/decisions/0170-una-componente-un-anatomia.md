# 0170 — Una componente, un'anatomia, e un vocabolario degli hook

**Stato**: accolta
**Data**: 2026-08-22
**Chiude**: [§31.4](../roadmap/31-da-dove-viene-cio-che-si-vede.md#314-un-componente-unanatomia-e-il-vocabolario-degli-hook)
**Commit**: *(questo commit)*
---

## La domanda che non si può più rimandare

La pelle di serie aveva pezzi ordinati ma non un inventario che dicesse quali
componenti vestiva, in quali stati e con quali manici. La risposta ora è una
sorgente unica in `frontend/src/theme/serie/anatomia.ts`: il catalogo legge la
tabella, e il test legge i selettori dei pezzi. Un componente scoperto dopo
questa chiusura è una voce nuova, non una riga aggiunta in silenzio.

## Anatomia: componenti, stati, hook

L'inventario chiuso conta **34 componenti** (`grep -c '^  { name:' frontend/src/theme/serie/anatomia.ts`), **188 hook** (`sed -n '52,85p' frontend/src/theme/serie/anatomia.ts | grep -o '"[a-z][a-z0-9_-]*"' | wc -l`) e **7 stati** (`sed -n '9,17p' frontend/src/theme/serie/anatomia.ts | grep -c '"'`): `rest`, `hover`, `pressed`, `selected`, `focused`, `disabled`, `dragging`.

La tabella assegna ogni componente ai pezzi della pelle e porta gli stati
necessari: trascinamento solo per i bersagli dell'albero, selezione per righe,
tab e controlli esclusivi, fuoco e disabilitazione dove sono stati del
controllo. Il banco costruisce una cella per ogni coppia componente/stato
leggendo `COMPONENTS`, non duplicando un secondo elenco in
`frontend/bench/catalog.ts`.

Il presidio bidirezionale in `anatomia.test.ts` confronta il set delle classi
nei selettori CSS con `HOOKS` e verifica che ogni hook sia assegnato a un
componente; il presidio gira con
`npm test -- --run src/theme/serie/anatomia.test.ts` (3 test verdi). La pelle
montata resta derivata: `npm run theme:generate`, poi
`npm test -- --run src/theme/skin.test.ts` (4 test verdi).

## I due gradini che ora hanno una superficie

`--bg-panel` veste il fondo del segmented, delle righe/list item e dei badge e
il banner delle impostazioni. `--bg-active` veste l'opzione attiva del
segmented e la riga selezionata dei nodi. Prima quei posti consumavano
`--bg-input` o `--bg-hover`, cioè due nomi che descrivevano un campo e un
passaggio del puntatore invece della loro funzione. Le regole restano nei
pezzi competenti (`segmented.css`, `nodes.css`, `preview.css`, `settings.css`)
e `order.ts` non viene toccato.

## Tooltip: la shell possiede anche il suggerimento

Il tooltip è un componente della shell in `ui/tooltip.ts`, con ritardo,
fuoco/blur, chiusura, `role=tooltip`, `aria-describedby`, posizionamento e
rispetto del moto ridotto. La pelle ha il pezzo `tooltip.css`, registrato
nell'ordine dichiarato; i `title` nativi sono stati sostituiti con `setTooltip`.
Il conto misurato è **0 title nativi** (`npx vitest run src/ui/native-title.test.ts`)
e **4 indicatori di tasto** (i quattro casi esercitati dal presidio tooltip:
`command-search`, `open-palette`, `mode-live`, `mode-reading`;
`npx vitest run src/ui/tooltip.test.ts src/ui/native-title.test.ts src/i18n/strings.test.ts src/theme/skin.test.ts`).
Il test mirato ha dato 28 test verdi.

## Icone: una griglia, un tratto

Il registro chiuso delle icone conta **21 icone** (presidio e misura:
`npm test -- --run src/ui/icons.test.ts src/graph/physics-panel.test.ts`, 14
test verdi). Il modulo dichiara griglia 24, dimensione 16, tratto 1.6,
`currentColor`, riempimento vuoto e cap/join tondi; il renderer usa quei
parametri e il gear del pannello grafo passa dallo stesso modulo.

## La prova che resta ripetibile

La sorgente dell'anatomia, il banco e i pezzi CSS sono stati verificati insieme
con `npm test -- --run src/theme/skin.test.ts src/theme/serie/anatomia.test.ts`
(7 test verdi). La build del catalogo è stata esercitata con
`npx vite build --config vite.bench.config.ts`; non sono state rigenerate
baseline o scene. Il test del baseline segnala solo le due foto mancanti della
scena modificata da un'altra voce (`npm test -- --run bench/scene.test.ts`),
non un difetto dell'inventario.

## Le vie scartate

| Via | Forma | Scartata perché |
| --- | --- | --- |
| Copiare la tabella in `catalog.ts` | Elenco parallelo | Divergerebbe dalla sorgente appena nasce un componente o uno stato. |
| Conservare gli id come hook | Selettori `#id` | Un id è un manico privato del pannello, non un contratto shell→pelle. |
| Dichiarare hook senza presidio inverso | Lista documentale | Lascia passare sia classi CSS senza contratto sia hook morti. |
| Fotografare solo nodi `UiNode` | Catalogo dei provider | Non mostrerebbe titlebar, rail, pannelli, tooltip e stati della shell. |
| Riutilizzare `--bg-input` e `--bg-hover` | Ripiego semantico | Confonderebbe campo/hover con pannello/attivo e terrebbe morti i due gradini della ricetta. |
