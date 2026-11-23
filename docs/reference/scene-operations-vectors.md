# Vettori delle operazioni

> **Ambito:** l'elenco dei vettori di prova delle [operazioni sulla
> scena](scene-operations.md): numero, nome e che cosa verifica ciascuno.
> La loro forma e come si leggono sono nel §9 di quella pagina.
> **Fonti autorevoli:** i file in `apps/client/src/__fixtures__/scene-ops/`,
> letti da `apps/client/src/editors/spatial/scene/vectors.test.ts` e da
> `crates/fub-scene/tests/ops_vectors.rs`.

Ogni riga è un file `NN-nome.json`; un vettore nuovo prende il numero dopo
l'ultimo e una riga qui.

| # | Nome | Verifica |
|---|---|---|
| 1 | `add-first-stroke` | primo tratto in un livello vuoto |
| 2 | `add-last-in-layer` | aggiunta in cima all'ordine visivo |
| 3 | `add-after-anchor` | inserimento dopo un fratello |
| 4 | `add-to-self-closing-group` | genitore `<g/>` riscritto in forma aperta |
| 5 | `remove-middle` | nessuna riga vuota residua |
| 6 | `remove-last-line` | rimozione dell'ultimo figlio |
| 7 | `remove-with-foreign-neighbors` | i byte estranei vicini restano identici |
| 8 | `set-transform` | solo `transform` cambia, l'inchiostro resta |
| 9 | `set-null-removes-attr` | `null` toglie l'attributo |
| 10 | `set-on-foreign` | rifiuto `foreign` |
| 11 | `text-lines-emoji` | offset UTF-16 con coppie surrogate |
| 12 | `move-z-order` | ordine nello stesso genitore |
| 13 | `move-to-other-layer` | cambio di livello |
| 14 | `move-into-descendant` | rifiuto `cycle` |
| 15 | `batch-group` | raggruppamento: `add` del gruppo e `move` dei figli |
| 16 | `batch-partial-failure` | rifiuto con l'indice dell'operazione fallita |
| 17 | `duplicate-id-identical` | `applied` senza modifiche |
| 18 | `duplicate-id-different` | rifiuto `duplicate-id` |
| 19 | `locked-layer` | rifiuto `locked` |
| 20 | `crlf-input` | operazione calcolata sul testo a LF; `text` consegnato con i CRLF originali |
| 21 | `bom-input` | BOM conservato |
| 22 | `paper-is-locked` | la carta non si modifica |
| 23 | `unknown-fub-attr-preserved` | attributo `fub:*` sconosciuto conservato dopo un `set` |
| 24 | `inkscape-attr-preserved` | attributo `inkscape:*` conservato |
| 25 | `network-stroke-d-recomputed` | `d` arrivato dalla rete scartato e ricalcolato |
| 26 | `mixed-eol` | file con CRLF e LF misti: i terminatori non toccati restano identici |
| 27 | `page-grow` | `page` allarga insieme `viewBox` e carta |
| 28 | `meta-title` | `meta` crea il `<title>` mancante |
| 29 | `adopt-foreign` | «Modifica» su un SVG estraneo |
| 30 | `ident-then-set` | `ident` e `set` nello stesso `batch` su un elemento senza id |
| 31 | `remove-foreign-by-path` | `remove` di un elemento estraneo senza id, indirizzato con il percorso |
| 32 | `set-self-closing-group` | `set` su un `<g/>` autochiuso, riscritto per intero |
| 33 | `first-under-root` | `first` sotto la radice va dopo titolo e carta |
| 34 | `text-inherited-size` | interlinea di una riga nuova dal corpo ereditato |
| 35 | `root-units-guides` | `set` su `#root` scrive unità e guide nell'ordine della radice; la geometria resta |
| 36 | `root-guides-remove` | `null` toglie le guide, l'unità resta |
| 37 | `root-guides-invalid` | guide fuori grammatica: rifiuto `invalid-elem` |
| 38 | `root-units-other-prefix` | l'unità col prefisso che il documento lega al namespace di FubDraw |
| 39 | `root-other-attr` | sulla radice un attributo che cambia con `page`: rifiuto `invalid-elem` |
| 40 | `locked-group` | un oggetto dentro un gruppo bloccato non cambia: rifiuto `locked` |
| 41 | `locked-group-add` | dentro un gruppo bloccato non si aggiunge niente: rifiuto `locked` |
| 42 | `locked-object-unlock` | una forma bloccata si cambia ancora: un `set` la sblocca |
| 43 | `add-raw-foreign` | `add` con `raw` scrive l'elemento estraneo così com'è, e l'inversa lo toglie col percorso |
| 44 | `add-raw-sequence` | un `raw` con un elemento del formato e uno estraneo; l'inversa è un `batch` che li toglie dall'ultimo al primo |
| 45 | `add-raw-duplicate-id` | un `raw` con dentro un id già presente: rifiuto `duplicate-id` |
| 46 | `text-runs` | una riga coi pezzi, sulla stessa riga del file e con gli attributi in ordine canonico |
| 47 | `text-runs-canonical` | i pezzi in forma canonica; l'inversa riporta i pezzi di prima |
| 48 | `text-runs-foreign-piece` | un pezzo con un attributo della riga: rifiuto `invalid-elem` |
| 49 | `add-text-runs` | `add` di un testo coi pezzi e la tipografia nuova, come lo scrive un duplicato |
| 50 | `add-defs-first` | la `fub-defs` va dopo il titolo e prima della carta |
| 51 | `add-gradient-use` | un `batch` aggiunge una sfumatura e la dà a un rettangolo, col ripiego |
| 52 | `remove-resource-in-use` | togliere una sfumatura usata: rifiuto `in-use` |
| 53 | `collect-private` | un `set` che toglie l'ultimo riferimento toglie la sfumatura privata e la `fub-defs` vuota; l'inversa le rimette |
| 54 | `collect-keeps-unowned` | una sfumatura senza `fub:role` resta |
| 55 | `collect-cascade` | togliere l'oggetto toglie il motivo privato e la sfumatura privata del suo contenuto |
| 56 | `add-resource-dangling` | una risorsa con un id a cui un elemento estraneo rimanda già: rifiuto `duplicate-id` |
| 57 | `set-missing-resource` | un `fill` verso una risorsa che non c'è: rifiuto `invalid-elem` |
| 58 | `add-raw-resources` | un `raw` con una sfumatura e un motivo che la usa, nella stessa `defs` |
| 59 | `filter-closed-list` | un filtro con `feTurbulence`: rifiuto `invalid-elem` |
| 60 | `text-path-runs` | `text` su un testo su tracciato sostituisce il contenuto del `textPath` coi pezzi e ne tiene gli attributi; l'inversa rimette la riga di prima |
| 61 | `text-joins` | `text` con `joins` su un testo in area: ogni riga ha il suo `fub:join`, la prima nessuno; l'inversa rimette righe e `joins` di prima |
| 62 | `text-path-one-line` | un testo su tracciato ha una riga sola: `text` con due righe, rifiuto `invalid-elem` |
| 63 | `add-text-path` | un `batch` aggiunge la `defs` col tracciato e il testo che lo segue con `xlink:href` e i pezzi; l'inversa toglie l'uno e l'altro |
| 64 | `remove-text-collects-path` | togliere un testo su tracciato toglie il suo tracciato privato e la `fub-defs` rimasta vuota; l'inversa li rimette |
| 65 | `board-first` | la prima tavola nasce dalla pagina: un `batch` aggiunge il `view` con `first`, dopo la carta, e dà `fub:board` alla carta |
| 66 | `board-add` | una tavola nuova con la sua carta, dopo l'ultima carta e dopo l'ultima tavola |
| 67 | `board-paper-mismatch` | una tavola e la sua carta con geometrie diverse: rifiuto `invalid-elem` |
| 68 | `board-move` | un `batch` cambia insieme il `viewBox` della tavola e la geometria della carta |
| 69 | `board-set-alone` | il `viewBox` di una tavola senza la sua carta: rifiuto `invalid-elem` |
| 70 | `board-remove-alone` | togliere una tavola e lasciare la sua carta: rifiuto `invalid-elem` |
| 71 | `board-remove-last` | togliere l'ultima tavola: la carta perde `fub:board` e `page` la riporta sulla pagina |
| 72 | `page-skips-board-papers` | `page` in un disegno con le tavole cambia soltanto la radice |
| 73 | `board-free-paper` | una tavola nuova accanto alla carta della pagina: rifiuto `invalid-elem` |
| 74 | `anchor-pdf` | impronta e pagine in coda alla radice di annotazioni che non le avevano; l'inversa le toglie |
| 75 | `add-page-group` | la prima annotazione di una pagina nasce in un `batch` col suo gruppo `p0003`, dopo `p0001` e prima di `p0005` |
| 76 | `set-swatch-stop` | un `batch` cambia col `part` il punto di un campione e il ripiego di chi lo usa; chi sta in un livello bloccato tiene il suo |
| 77 | `set-part-not-resource` | `set` con `part` su un oggetto: rifiuto `invalid-elem` |
| 78 | `add-connector` | un connettore a gomito agganciato a due rettangoli: `fub:shape`, `fub:geom`, `fub:from` e `fub:to` vanno subito dopo l'id, prima di `d`, in quest'ordine; l'inversa lo toglie |
| 79 | `set-connector-free` | un `batch` stacca un capo: `set` cambia `fub:geom` e `d` e toglie `fub:from` con `null`; l'inversa lo rimette al suo posto e il testo torna a quello di prima byte per byte, anche su un motore aperto dal testo di dopo |
| 80 | `add-label` | l'etichetta di un rettangolo nel suo gruppo, dopo di lui: `fub:inside` e `fub:wrap` vanno subito dopo l'id, prima di `x` e `y`, in quest'ordine; l'inversa la toglie |
| 81 | `remove-style-in-use` | togliere uno [stile](scene-format-styles.md) che un oggetto segue: rifiuto `in-use` |
| 82 | `collect-keeps-style` | togliere l'ultimo oggetto che segue uno stile lascia lo stile e la sua sfumatura privata |
| 83 | `remove-style-collects-private` | un `batch` toglie `fub:style` da chi segue e poi lo stile: la raccolta toglie anche la sua sfumatura privata e la `fub-defs` rimasta vuota |
| 84 | `add-symbol-instance` | un `batch` aggiunge la `defs` con un [simbolo](scene-format-symbols.md) e una sua istanza: il simbolo ha l'id di una risorsa, il suo contenuto quello di un oggetto, e `use` scrive `transform` prima di `href`; l'inversa toglie l'una e l'altra |
| 85 | `remove-symbol-in-use` | togliere un simbolo che un'istanza usa: rifiuto `in-use` |
| 86 | `symbol-cycle` | un'istanza di un simbolo dentro il simbolo stesso: rifiuto `cycle` |
| 87 | `remove-instance-keeps-symbol` | togliere l'ultima istanza lascia il simbolo, che non si raccoglie mai |
| 88 | `move-into-symbol` | un rettangolo del livello in fondo a un simbolo: resta un oggetto col suo id, rientrato come il contenuto del simbolo |
| 89 | `add-repeat` | un `batch` fa una [ripetizione](scene-format-repeats.md) di un rettangolo: il gruppo con `fub:repeat` subito dopo l'id, l'originale spostato dentro e due copie; l'inversa toglie le copie, rimette l'originale e toglie il gruppo |
| 90 | `remove-original-in-use` | togliere l'originale di una ripetizione che ha copie: rifiuto `in-use` |
| 91 | `unset-repeat-in-use` | togliere `fub:repeat` a un gruppo che ha copie: rifiuto `in-use` |
| 92 | `set-repeat-rewrites-copies` | un `batch` cambia la ripetizione da griglia a radiale e riscrive le trasformazioni delle copie, che restano copie |
| 93 | `repeat-over-foreign-use` | `fub:repeat` su un gruppo con un `use` estraneo verso un fratello: rifiuto `duplicate-id` |
| 94 | `set-tag-rect-to-path` | un rettangolo con un titolo diventa un tracciato al suo posto: stesso id e attributi, la sua geometria tolta, riscritto in forma canonica; l'inversa lo riporta rettangolo |
