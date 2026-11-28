# I gesti dell'editor: Base, tabelle, fogli e diagramma

Confronto gesto per gesto del prototipo `PLAN-ui/editor.html` con l'app, per l'area Base, tabelle, fogli e diagramma. Si misura il comportamento, non i valori. Non corregge niente: le correzioni le fanno altri task, partendo da questo elenco.

> **Per chi:** chi corregge l'editor e chi decide quali differenze chiudere.
> **Risultato:** al ripasso del 2026-11-28, su 165 gesti 105 sono uguali, 44 diversi, 8 mancano nell'app e 8 non si possono provare sul banco. Nessuno è fuori dal lavoro.

**Data:** 2026-11-21.
**Prototipo:** `PLAN-ui/editor.html` sul ramo `piano/editor-completo`, ultimo commit del file `fe8548e36` (ramo a `c8b643653`).
**App:** ramo `misure/gesti-4` a `80e7c92eb` (base `integra/editor-3`).

## Ripasso del 2026-11-28

- **App:** ramo `misure/gesti-ripasso`, che parte da `ebd0e4be2` (`integra/editor-cornice-1`). Il ripasso non cambia il codice dell'app.
- **Prototipo:** `PLAN-ui/editor.html` al commit `9a4cf1e94`. Lo script è quello del 21/11 con una riga in più prima: i numeri delle righe da 1849 in su crescono di uno.
- **Misura ridotta, decisa dall'utente.** Le sonde rifanno solo le righe diverse, mancanti o non provate il 21/11, e quelle che possono far perdere testo o lasciare bloccati. Le righe uguali il 21/11 non sono rifatte e restano uguali. Le righe che dicono «dal codice» sono decise leggendo il codice dell'app, senza la sonda.
- **Prova:** le voci stanno in `apps/client/bench/gesti/voci-base-tabelle-diagramma.mjs`. Partono dalla scena della Base, da una nota con una tabella e un diagramma, dalla nota delle schede vive (PDF e foglio) e da una nota con un documento Word e una lavagna. Il comando è `node bench/gesti/sonda.mjs --pagina=base-tabelle-diagramma` dalla cartella `apps/client`.
- **Il foglio nella scheda.** Le celle del DOM hanno ancora dimensione zero, perché la griglia si disegna. La sonda punta la griglia in frazioni della sua misura e, dopo l'attivazione, usa la tastiera: così le righe 93–113 hanno ora un esito.
- **Conti:** 105 uguali, 44 diversi, 8 mancano nell'app, 8 non provabili sul banco. Il 21/11 erano 67, 29, 11 e 28, più 30 non provati.
- **Cambiati dal 21/11:** 59 esiti.
  - Le 30 righe non provate hanno ora un esito. Il pieno schermo del diagramma (159–163) si apre da «Ingrandisci»; rotella, trascinamento, sfondo e × sono decisi dal codice.
  - Il foglio nella scheda (93–113, 116): 15 uguali e 8 diversi. Il valore scritto in una cella e Invio non restano nel banco (righe 103 e 107): da verificare nell'app vera.
  - Ora uguali: il clic sulla scheda PDF la attiva (117), Esc sceglie il blocco della scheda (125), il taglia, l'ordina e l'allinea del menu della tabella (67, 71, 72), Elimina la riga (75).
  - Ora diversi: la barra di formato ha il menu «Operazioni sulla tabella» al posto dei pulsanti Riga e Ordina (85, 86); il blocco del diagramma non si sceglie con le frecce né col clic, che mette il cursore nel sorgente, e lo Spazio su un paragrafo scelto ne sostituisce il testo (164, 165). Con il blocco scelto da Esc, Invio e Spazio fanno come il prototipo.

## Come si è misurato

- Prototipo: aperto da file, finestra 1680×1000, luce giorno, moto ridotto. Ogni gesto parte dal passo del tour che porta lo stato giusto (per esempio «La tabella, coi gesti del foglio»). Prima e dopo il gesto si legge: il fuoco, i pannelli aperti, l'avviso, la cella attiva, il testo della griglia, le schede, il diagramma.
- App: banco, porta 1693, scene `base-barra`, `live-14-tabella-attiva`, `schede-vive-01-riposo`, `schede-vive-02-attiva`, `diagramma-01-riposo`. Stessa lettura prima e dopo.
- Il riferimento è il codice del prototipo: la colonna «riga dello script» dà il punto del gestore. L'esito viene dalla differenza misurata e dal codice.
- La sonda era un file temporaneo del banco, fuori dal repository, e si cancella a fine lavoro.

## Limiti

- I dati sono diversi: il prototipo ha un preventivo, il banco una tabella di prova. Per questo si confronta il comportamento, non i valori né i numeri formattati.
- Gli appunti del sistema non si leggono sul banco: Copia, Incolla e «Copia come immagine» non si possono verificare fino in fondo. L'host del banco è finto e non ha tutti i comandi (Trasforma in foglio).
- Nella scena del foglio dell'app le celle hanno dimensione zero (sonda X-6): il 21/11 i gesti del foglio, lato app, non si sono misurati. Al ripasso si puntano in frazioni della griglia.
- Il sorgente di un diagramma nell'app è il testo della nota: non c'è un riquadro da misurare come nel prototipo.
- Il 21/11 il menu del tasto destro del diagramma nel prototipo non si apriva con la sonda. Al ripasso quei gesti sono decisi dal codice del prototipo.

## Tabella

| n | gesto | elemento (prototipo → app) | prototipo (riga dello script) | app | esito | note |
|---|---|---|---|---|---|---|
| 1 | Clic sulla vista Bacheca | `.bview` «Bacheca» → `.base-tab` «Bacheca» | 4370 | passa alla Bacheca | uguale | [B-01]. Dal codice: uguale il 21/11, non rifatto |
| 2 | Clic sulla vista Calendario | `.bview` «Calendario» → nessuna linguetta | 4370 | nella barra ci sono solo Tabella, Bacheca e Schede | manca nell'app | [B-02] il calendario esiste come scena del banco (`base=calendario`), non dalla barra |
| 3 | Clic sulla vista Linea del tempo | `.bview` «Linea del tempo» → nessuna linguetta | 4370 | come la riga 2 | manca nell'app | [B-03] |
| 4 | Torna alla Tabella dalla Bacheca | `.bview` «Tabella» → `.base-tab` «Tabella» | 4370 | torna alla tabella | uguale | [B-04]. Dal codice: uguale il 21/11, non rifatto |
| 5 | Pulsante Filtro | `#b-f` → `.base-tool-filter` | 4371, 3343 | apre il pannello, con il primo campo a fuoco | uguale | [B-05] forma diversa: un pannello con tre campi nel prototipo, campi a righe nell'app. Dal codice: uguale il 21/11, non rifatto |
| 6 | Filtro: cambiare la colonna | `#bf-k` → `select.base-filter-subject` | 3350 | cambia la lista dei valori | uguale | [B-06]. Dal codice: uguale il 21/11, non rifatto |
| 7 | Filtro: Applica | `#bf-ok` → «Applica» | 3351 | aggiunge la condizione, chiude, scrive il file e avvisa; righe da 5 a 1 | uguale | [B-07] nell'app per lo Stato l'operatore predefinito è «è più di», nel prototipo «è». Dal codice: uguale il 21/11, non rifatto |
| 8 | Filtro: Annulla | `#bf-x` → «Annulla» | 3351 | chiude e riporta il fuoco sul pulsante Filtro | uguale | [B-08]. Dal codice: uguale il 21/11, non rifatto |
| 9 | Togliere un filtro (×) | `[data-unf]` → `.base-chip button` | 4372 | toglie la condizione | uguale | [B-09]. Dal codice: uguale il 21/11, non rifatto |
| 10 | Pulsante Ordina | `#b-s` → `.base-tool-sort` | 4374 | apre un pannello con «Ordina per» e «Verso» | diverso | [B-10] il prototipo apre un menu con le colonne |
| 11 | Ordina per Stato, crescente | `#b-s`, voce Stato, Crescente → pannello Ordina | 4374, 3316 | aggiunge un criterio: Stato ↑ accanto a Consegna ↑ | diverso | [B-11] il prototipo ha un solo criterio e lo sostituisce |
| 12 | Togliere l'ordinamento (×) | `[data-unsort]` → ultimo chip | 4373 | toglie il criterio Stato | uguale | [B-12]. Dal codice: uguale il 21/11, non rifatto |
| 13 | Clic sull'intestazione di colonna | `th[data-col]` → `th[data-column]` | 4380 | apre il menu di colonna | uguale | [B-13] le voci sono diverse: il prototipo ha ordina, filtra, nascondi; l'app ha ordina, raggruppa, rinomina, tipo, copia, nascondi. Dal codice: uguale il 21/11, non rifatto |
| 14 | Menu colonna: Ordina decrescente | voce del menu → `button.kit-row` | 4380 | ordina in discesa; aggiunge un criterio | uguale | [B-14] come la riga 11 per i criteri. Dal codice: uguale il 21/11, non rifatto |
| 15 | Pulsante Proprietà | `#b-p` → `.base-tool-columns` | 4375 | apre l'elenco delle colonne con le caselle | uguale | [B-15]. Dal codice: uguale il 21/11, non rifatto |
| 16 | Colonna Valore: mostrare o nascondere | voce «Valore» → casella «valore» | 4375 | l'app mostra Valore di default, il prototipo la nasconde | uguale | [B-16] il gesto è lo stesso, il punto di partenza no. Dal codice: uguale il 21/11, non rifatto |
| 17 | Pulsante Nuova vista | `#b-nv` → `.base-tool-new-view` | 4376 | apre il menu «Nuova vista» | uguale | [B-17]. Dal codice: uguale il 21/11, non rifatto |
| 18 | Pulsante Nuova (nuova opera) | `#b-n` → `.base-new-note` | 4377 | nel banco nessun effetto visibile | non provabile sul banco | [B-18] il prototipo crea «Senza titolo» e avvisa |
| 19 | Riga «Nuova opera» in fondo | `tr.addrow` → `.base-add-row-button` | 4377 | nel banco nessun effetto visibile | non provabile sul banco | [B-19] come la riga 18 |
| 20 | Nuova da un modello | `#b-nt` → `.base-new-template` | 4378 | apre il menu «Nuova da un modello» | uguale | [B-20]. Dal codice: uguale il 21/11, non rifatto |
| 21 | Lente «Cerca nella vista» | `button[aria-label]` → `.base-tool-search` | 3341 | apre un campo di ricerca | diverso | [B-21] il prototipo mostra solo un avviso, che promette un filtro |
| 22 | Clic sullo stato di una riga | `[data-cyc]` → `.base-cell[data-column=stato]` | 4379 | mette il fuoco nel campo di testo dello stato | diverso | [B-22] il prototipo apre il menu delle corsie |
| 23 | Scegliere lo stato «Da chiedere» | voce del menu → campo di testo | 4379 | il valore scritto non resta: il campo torna «Arrivata» | diverso | [B-23] Il 28/11: scritto «Da chiedere» e Invio, il campo torna «Arrivata»; da verificare sul file. In correzione (Base) |
| 24 | Clic su «Apri» di una riga | `.open-r` → titolo della riga | 4381 | apre la nota in una scheda nuova | diverso | [B-24] il prototipo avvisa «Sbircia» e non apre |
| 25 | Trascinare una scheda in un'altra corsia | `.bcard` → `.base-kanban-card` | 3354, 3357 | nel banco la scheda non cambia corsia (3, 3, 2 prima e dopo) | diverso | [B-25] Il prototipo cambia lo stato; il trascinamento del banco può non riprodurre il gesto. In correzione (Base) |
| 26 | Trascinare una consegna su un altro giorno | `.ev` → `.base-cal-event` | 3333, 3357 | non misurabile: la scena del calendario non mostra eventi nel mese del banco | non provabile sul banco | [B-26] La scena del calendario non ha eventi nel mese del banco |
| 27 | Trascinare una barra della linea del tempo | `.tl-b` → `.base-tl-bar` | 3338 | la barra si sposta e avvisa | diverso | [B-27] nel prototipo le barre sono fisse |
| 28 | Clic su «Nel file .base» | `details.byaml` → riepilogo «Nel file» | 3340 | apre il riepilogo | uguale | [B-28]. Dal codice: uguale il 21/11, non rifatto |
| 29 | Esc con il filtro aperto | tasto Esc → pannello | 2561–2579 | chiude e riporta il fuoco sul pulsante Filtro | uguale | [B-29]. Dal codice: uguale il 21/11, non rifatto |
| 30 | Clic sul titolo di una riga | `td.t` → titolo della riga | 3327 | apre la nota | diverso | [B-30] il prototipo non fa nulla sul titolo |
| 31 | Clic su una cella | `td[data-r][data-c]` → `.tb-cell` | 3639–3643 | cella attiva e barra aggiornate | uguale | [T-01]. Dal codice: uguale il 21/11, non rifatto |
| 32 | Trascinare su più celle | trascinamento → idem | 3639–3651 | selezione con Somma, Media, Conteggio | uguale | [T-02] formato dei numeri diverso. Dal codice: uguale il 21/11, non rifatto |
| 33 | Maiusc+clic su un'altra cella | `td` → `.tb-cell` | 3642 | estende la selezione | uguale | [T-03]. Dal codice: uguale il 21/11, non rifatto |
| 34 | Freccia giù | tasto → tasto | 3678–3679 | cella sotto | uguale | [T-04]. Dal codice: uguale il 21/11, non rifatto |
| 35 | Freccia destra | tasto → tasto | 3678 | cella a destra | uguale | [T-05]. Dal codice: uguale il 21/11, non rifatto |
| 36 | Maiusc+freccia giù | tasto → tasto | 3679 | estende la selezione | uguale | [T-06]. Dal codice: uguale il 21/11, non rifatto |
| 37 | Ctrl+freccia giù | tasto → tasto | 3679, 3590 | salta al bordo dei dati | uguale | [T-07] per questi dati l'app va all'ultima riga. Dal codice: uguale il 21/11, non rifatto |
| 38 | Alt+freccia giù | tasto → tasto | 3676 | sposta la riga | uguale | [T-08]. Dal codice: uguale il 21/11, non rifatto |
| 39 | Fine | tasto → tasto | 3681 | ultima colonna della riga | uguale | [T-09]. Dal codice: uguale il 21/11, non rifatto |
| 40 | Ctrl+Fine | tasto → tasto | 3681 | ultima cella | uguale | [T-10]. Dal codice: uguale il 21/11, non rifatto |
| 41 | Invio sulla cella | tasto → tasto | 3682, 3603 | apre la modifica con il valore | uguale | [T-11]. Dal codice: uguale il 21/11, non rifatto |
| 42 | F2 | tasto → tasto | 3682 | apre la modifica | uguale | [T-12]. Dal codice: uguale il 21/11, non rifatto |
| 43 | Doppio clic su una cella | `dblclick` → idem | 3652 | apre la modifica | uguale | [T-13]. Dal codice: uguale il 21/11, non rifatto |
| 44 | Scrivere una lettera | tasto → tasto | 3699 | apre la modifica con la lettera | uguale | [T-14]. Dal codice: uguale il 21/11, non rifatto |
| 45 | Scrivere «Tr» in una colonna con valori | digitare → idem | 3595–3597 | propone il completamento | uguale | [T-15] il prototipo completa «Trasporti Bassi», l'app propone «Belém». Dal codice: uguale il 21/11, non rifatto |
| 46 | «Tr» e Invio: accetta il completamento | digitare e Invio | 3599–3602 | accetta e scende | uguale | [T-16]. Dal codice: uguale il 21/11, non rifatto |
| 47 | In modifica: Tab | tasto → tasto | 3603–3604 | scrive e va a destra | uguale | [T-17]. Dal codice: uguale il 21/11, non rifatto |
| 48 | In modifica: Maiusc+Tab | tasto → tasto | 3604 | scrive e va a sinistra | uguale | [T-18]. Dal codice: uguale il 21/11, non rifatto |
| 49 | In modifica: Esc | tasto → tasto | 3605 | annulla la scrittura | uguale | [T-19]. Dal codice: uguale il 21/11, non rifatto |
| 50 | Tab fuori dalla modifica | tasto → tasto | 3683–3685 | va a destra | uguale | [T-20]. Dal codice: uguale il 21/11, non rifatto |
| 51 | Canc sulla cella | tasto → tasto | 3687 | svuota la selezione | uguale | [T-21]. Dal codice: uguale il 21/11, non rifatto |
| 52 | Ctrl+A | tasto → tasto | 3688 | seleziona tutta la tabella | uguale | [T-22]. Dal codice: uguale il 21/11, non rifatto |
| 53 | Scrivere, Invio, poi Ctrl+Z | tasti | 3689, 3544 | annulla la scrittura | uguale | [T-23]. Dal codice: uguale il 21/11, non rifatto |
| 54 | Ctrl+Y | tasti | 3690 | ripete la scrittura | uguale | [T-24]. Dal codice: uguale il 21/11, non rifatto |
| 55 | Ctrl+D (riempi in giù) | tasti | 3691, 3622 | copia la cella di sopra | uguale | [T-25]. Dal codice: uguale il 21/11, non rifatto |
| 56 | Ctrl+R (riempi a destra) | tasti | 3692, 3623 | copia la cella a sinistra | uguale | [T-26]. Dal codice: uguale il 21/11, non rifatto |
| 57 | Ctrl+; (data corrente) | tasto → tasto | 3693 | scrive la data corrente | uguale | [T-27] il prototipo ha un orologio fisso. Dal codice: uguale il 21/11, non rifatto |
| 58 | Alt+= (somma delle celle sopra) | tasto → tasto | 3694, 3624 | scrive la somma come valore | uguale | [T-28]. Dal codice: uguale il 21/11, non rifatto |
| 59 | Ctrl+Maiusc+= (inserisce una riga) | tasto → tasto | 3695, 3610 | prototipo: riga sotto la riga attiva | diverso | [T-29] l'app inserisce la riga sopra la riga attiva |
| 60 | Ctrl+- (elimina la riga) | tasto → tasto | 3696, 3612 | elimina la riga | uguale | [T-30]. Dal codice: uguale il 21/11, non rifatto |
| 61 | Maiusc+Spazio (seleziona la riga) | tasto → tasto | 3686 | seleziona la riga | uguale | [T-31]. Dal codice: uguale il 21/11, non rifatto |
| 62 | Ctrl+Spazio (seleziona la colonna) | tasto → tasto | 3686 | seleziona la colonna | uguale | [T-32]. Dal codice: uguale il 21/11, non rifatto |
| 63 | Esc con più celle selezionate | tasti | 3698 | torna a una cella | uguale | [T-33] il passo intermedio non si legge dal confronto prima e dopo. Dal codice: uguale il 21/11, non rifatto |
| 64 | Maiusc+F10 (menu della tabella) | tasto → tasto | 3697 | apre il menu | uguale | [T-34]. Dal codice: uguale il 21/11, non rifatto |
| 65 | Tasto destro su una cella | `contextmenu` → idem | 3653, 3626 | apre il menu e sposta la selezione | uguale | [T-35]. Dal codice: uguale il 21/11, non rifatto |
| 66 | Menu: Copia | voce del menu → `button.kit-row` | 3629 | copia «Latte», senza avviso | diverso | [T-36] Il prototipo copia e avvisa la prima volta |
| 67 | Menu: Taglia | voce del menu → `button.kit-row` | 3629 | taglia e avvisa «Celle tagliate: incollale…»; il testo resta fino all'incolla | uguale | [T-37] Come il taglia del prototipo |
| 68 | Menu: Incolla | voce del menu → `button.kit-row` | 3629 | incolla davvero il testo degli appunti («Uova») | diverso | [T-38] Il prototipo dà solo un avviso |
| 69 | Menu: Inserisci, Riga sotto | voci del menu | 3630 | riga sotto la riga scelta | uguale | [T-39]. Dal codice: uguale il 21/11, non rifatto |
| 70 | Menu: Sposta, Riga giù | voci del menu | 3631 | sposta la riga giù | uguale | [T-40] nel banco dalla riga 1: «Riga in giù» non c'è sull'ultima riga. Dal codice: uguale il 21/11, non rifatto |
| 71 | Menu: Ordina, Dalla A alla Z | voci del menu | 3632 | ordina la colonna: Burro, Latte, Pane | uguale | [T-41] |
| 72 | Menu: Allinea, A destra | voci del menu | 3633 | allinea a destra (`----:`) | uguale | [T-42] |
| 73 | Menu: Scrivi qui la somma | voce del menu | 3634 | nel menu non c'è | manca nell'app | [T-43] la somma si fa con Alt+= (riga 58); il menu dell'app ha «Grafico da questa tabella» |
| 74 | Menu: Trasforma in foglio | voce del menu → `button.kit-row` | 3634, 3625 | prova a crearlo: «host fake: il comando non c'è» | non provabile sul banco | [T-44] il banco finge l'host |
| 75 | Menu: Elimina la riga | voce del menu | 3635 | elimina la riga; la cella attiva resta nella stessa posizione | uguale | [T-45] Il 21/11 diverso: ora la cella attiva è quella sotto, come nel prototipo |
| 76 | Ctrl+C (copia) | tasti | 3662–3663 | copia e avvisa la prima volta | diverso | [T-46] nel banco l'app copia senza avviso |
| 77 | Ctrl+X (taglia) | tasti | 3663 | taglia e avvisa | uguale | [T-47] il segno tratteggiato non è nel confronto. Dal codice: uguale il 21/11, non rifatto |
| 78 | Incollare testo a tabulazioni | evento incolla simulato (non Ctrl+V) | 3664–3671 | incolla il blocco nelle celle | uguale | [T-48]. Dal codice: uguale il 21/11, non rifatto |
| 79 | Trascinare la maniglia per riempire | `.tg-fill` → `.tb-fill` | 3640, 3647–3651 | il trascinamento sceglie il testo, non riempie | diverso | [T-49] |
| 80 | Doppio clic sulla maniglia | `.tg-fill` → `.tb-fill` | 3652 | riempie fino in fondo | manca nell'app | [T-50] nessun effetto nel banco |
| 81 | Clic sulla lettera di colonna | `.gr-let span` → `.tb-letter` | 3654–3656 | seleziona la colonna | uguale | [T-51]. Dal codice: uguale il 21/11, non rifatto |
| 82 | Clic sul numero di riga | `.gr-num span` → `.tb-rowhead` | 3654–3657 | seleziona la riga | uguale | [T-52]. Dal codice: uguale il 21/11, non rifatto |
| 83 | Pulsante + per una riga | `.tg-add.row` → «Aggiungi una riga» | 3658 | aggiunge una riga in fondo | uguale | [T-53]. Dal codice: uguale il 21/11, non rifatto |
| 84 | Pulsante + per una colonna | `.tg-add.col` → «Aggiungi una colonna» | 3658 | aggiunge una colonna in fondo | uguale | [T-54]. Dal codice: uguale il 21/11, non rifatto |
| 85 | Barra di formato: Riga | `#tb-row` → nessun pulsante | 3723, 1564 | nella barra c'è il menu «Operazioni sulla tabella» (righe, colonne, ordina), non il pulsante | diverso | [T-55] Dal codice (`format-bar.ts`). In correzione (barra di formato) |
| 86 | Barra di formato: Ordina | `#tb-sort` → nessun pulsante | 3723 | come la riga 85 | diverso | [T-56] Dal codice (`format-bar.ts`). In correzione (barra di formato) |
| 87 | Barra di formato: In foglio | `#tb-xlsx` → nessun pulsante | 3723, 3625 | manca nella barra; la voce c'è nel menu | manca nell'app | [T-57] |
| 88 | Scrivere una formula «=1+1» | digitare e Invio | 3601 | scrive il testo e avvisa che resta testo | uguale | [T-58] l'azione «In foglio» del messaggio non è nel confronto. Dal codice: uguale il 21/11, non rifatto |
| 89 | Più numeri selezionati: la banda | trascinamento | 3584, 3707 | Somma, Media, Conteggio | uguale | [T-59]. Dal codice: uguale il 21/11, non rifatto |
| 90 | Clic fuori dalla tabella | `focusout` → `onBlur` | 3702, 3722 | la cella resta attiva; il fuoco va alla pagina | diverso | [T-60] |
| 91 | Freccia su due volte | tasto → tasto | 3678 | esce al testo sopra | uguale | [T-61]. Dal codice: uguale il 21/11, non rifatto |
| 92 | Esc sulla tabella, poi Invio | tasto Esc → blocco | 3698, 4418 | Esc e Invio aggiungono una riga vuota dopo la tabella | diverso | [T-62] Il prototipo sceglie il blocco |
| 93 | Clic su una cella del foglio | `#sh-grid td` → `.grid-cell` | 3498–3499 | sceglie la cella (1,1 «800») | uguale | [F-01] La barra di formato non è accesa in questa scena; la cella si punta in frazioni della griglia, le celle del DOM hanno dimensione zero |
| 94 | Trascinare sulle celle del foglio | trascinamento → idem | 3498–3499 | sceglie un intervallo (10 celle) | uguale | [F-02] |
| 95 | Maiusc+clic nel foglio | `td` → `.grid-cell` | 3498 | estende la selezione (8 celle) | uguale | [F-03] |
| 96 | Freccia giù nel foglio | tasto | 3505–3508 | cella sotto | uguale | [F-04] |
| 97 | Freccia destra nel foglio | tasto | 3505–3508 | cella a destra | uguale | [F-05] |
| 98 | Maiusc+freccia giù nel foglio | tasto | 3507 | estende la selezione (2 celle) | uguale | [F-06] |
| 99 | Ctrl+freccia giù nel foglio | tasto | 3505–3508 | salta al bordo dei dati (3,0 «Totale») | diverso | [F-07] Nel prototipo nessun effetto: il ramo Ctrl non c'è; l'app fa come un foglio di calcolo |
| 100 | Invio nel foglio (modifica) | tasto | 3509 | apre la modifica con il valore | uguale | [F-08] |
| 101 | F2 nel foglio (modifica) | tasto | 3509 | apre la modifica con il valore | uguale | [F-09] |
| 102 | Doppio clic nel foglio | `dblclick` | 3501 | sceglie 5 celle, non apre la modifica | diverso | [F-10] |
| 103 | Scrivere 1000 e Invio nel foglio | digitare e Invio | 3492–3496, 3726 | la battuta apre la cella e Invio scende, ma il valore torna 800, senza avviso | diverso | [F-11] Rimisurato tornando sulla cella con F2: il campo dice 800. Può essere l'host del banco che non scrive: da verificare nell'app vera, dove sarebbe un valore perso in silenzio |
| 104 | Tab nel foglio | tasto | 3510 | cella a destra | uguale | [F-12] |
| 105 | Maiusc+Tab nel foglio | tasto | 3510 | esce dalla griglia: nessuna cella scelta | diverso | [F-13] Il prototipo va a destra e ignora Maiusc: probabile difetto del prototipo |
| 106 | Esc in modifica nel foglio | tasto | 3495 | chiude la modifica; resta la cella | uguale | [F-14] |
| 107 | Canc nel foglio | tasto | 3511 | sull'intestazione nessun effetto, come il prototipo; sulla cella dei dati il valore resta (800) | diverso | [F-15] Rimisurato con F2: 800. Come la riga 103, può essere l'host del banco |
| 108 | Ctrl+A nel foglio | tasto | 3512 | sceglie tutto (44 celle) | uguale | [F-16] |
| 109 | Maiusc+giù, poi Esc nel foglio | tasti | 3513 | esce dal foglio e sceglie il blocco | diverso | [F-17] Il prototipo torna a una cella |
| 110 | Esc senza selezione nel foglio | tasto | 3513, 3725 | esce dal foglio e sceglie il blocco | uguale | [F-18] |
| 111 | Clic fuori dal foglio | `onBlur` | 3724 | scheda a riposo, cursore nel testo | uguale | [F-19] |
| 112 | Più numeri nel foglio: la banda | trascinamento | 3707 | non provabile | non provabile sul banco | [F-20] |
| 113 | Esc, poi Invio, sul blocco del foglio | tasti | 4418 | riattiva il foglio sulla cella A1 | uguale | [F-21] |
| 114 | Clic sulla scheda del foglio a riposo | `.scard-b` → `.live-card` del foglio | 3727 | il fuoco va nella griglia, sulla cella A1 | uguale | [F-22] nel prototipo si sceglie A2. Dal codice: uguale il 21/11, non rifatto |
| 115 | Maniglia del foglio | nessuna maniglia nel prototipo → segno di maniglia nell'app | 3469 | il segno di maniglia c'è nel DOM | diverso | [F-23] il prototipo non ha la maniglia; non misurato nel banco |
| 116 | Tasto destro sul foglio | `#sh-grid` → `.grid-cell` | 3469 | apre il menu del collegamento: Sbircia, Apri, Apri a lato, Copia il link | diverso | [F-24] Il prototipo apre il menu della griglia |
| 117 | Clic sulla scheda PDF a riposo | `.scard[data-kind=pdf]` → `.live-card[data-card-kind=pdf]` | 3791 | la scheda diventa attiva (Estrai, Apri, A tutta pagina) | uguale | [S-01] Il 21/11 diverso |
| 118 | «›» pagina successiva | `#pdf-next` → nessun comando a riposo | 3778, 3763 | a riposo non c'è il comando di pagina | diverso | [S-02] nel prototipo la pagina passa da 2 a 3 |
| 119 | «‹» pagina precedente | `#pdf-prev` → nessun comando a riposo | 3778 | come la riga 118 | diverso | [S-03] nel prototipo la pagina passa da 2 a 1 |
| 120 | Freccia destra sul PDF attivo | tasto | 3797 | nessun cambio di pagina | diverso | [S-04] le pagine stanno nel visualizzatore |
| 121 | PageDown sul PDF attivo | tasto | 3797 | nessun cambio di pagina | diverso | [S-05] |
| 122 | «Estrai» | `#pdf-ex` → `.live-card-extract` | 3779–3782 | compare solo con un testo selezionato | diverso | [S-06] il prototipo lo mostra sempre e crea l'estratto |
| 123 | «Apri» (linguetta) | `[data-say]` → `.live-card-open` | 3759, 3415 | apre il file nel visualizzatore | diverso | [S-07] il prototipo avvisa soltanto |
| 124 | «Fine» (chiude la scheda attiva) | `.fine` → `.live-card-done` | 3790 | col puntatore «Fine» non c'è: c'è il richiamo di Esc; «Fine» solo sugli schermi a tocco | diverso | [S-08] Dal codice (`skin/live-cards.css`, righe 137 e 233) |
| 125 | Esc con la scheda attiva | tasto | 3796 | sceglie il blocco della scheda | uguale | [S-09] Il 21/11 tornava al testo |
| 126 | Clic fuori dalla scheda attiva | `mousedown` → idem | 3793 | scheda a riposo, fuoco sul titolo | uguale | [S-10]. Dal codice: uguale il 21/11, non rifatto |
| 127 | Documento: clic sul testo | `#doc-p` → testo del documento | 3773, 3791 | diventa modificabile, con il fuoco nel testo | uguale | [S-11]. Dal codice: uguale il 21/11, non rifatto |
| 128 | Documento: scrivere | `#doc-p` → editor del documento | 3784 | fuoco nel testo; nessun avviso visibile | non provabile sul banco | [S-12] Nella scena con la lavagna il documento Word non si carica (scheda mancante) |
| 129 | Documento: Esc | tasto | 3785, 3796 | esce al testo sopra | diverso | [S-13] il prototipo seleziona il blocco |
| 130 | Lavagna: clic sulla scheda | `.scard[data-kind=canvas]` → `.live-card` della lavagna | 3791 | la scheda diventa attiva | uguale | [S-14] |
| 131 | Lavagna: trascinare una scheda | `.cvn` → nodi della lavagna | 3787–3789 | nodo non mappato nel banco | non provabile sul banco | [S-15] La sonda non trova i nodi della lavagna nella scheda; dal codice (`cards/kinds/canvas.ts`) la lavagna attiva sposta le schede |
| 132 | Lavagna: «A tutta pagina» | `[data-say]` → `.live-card-full` | 3761 | allarga la lavagna a tutta pagina; il pulsante diventa «Torna alla nota» | diverso | [S-16] Il prototipo avvisa soltanto |
| 133 | Tasto destro sulla scheda PDF | `contextmenu` → `.live-card` | 4245–4255 | apre un menu con «Link alla nota» | diverso | [S-17] il prototipo non apre menu sulla scheda a riposo |
| 134 | Passare il mouse sul diagramma | stile → `.mermaid-diagram` | 3800 | solo il disegno, nessuna barra | uguale | [D-01]. Dal codice: uguale il 21/11, non rifatto |
| 135 | Tasto destro sul disegno | `#dg-view` → `.mermaid-diagram img` | 3906, 3880 | apre il menu: Stile, Vale per, Orientamento, Modifica il sorgente, Ingrandisci… | uguale | [D-02] |
| 136 | Passare su uno stile del menu | `[data-st]` → `.diagram-menu-style` | 3889 | anteprima sul disegno al passaggio | uguale | [D-03] Dal codice (`ui/diagram-menu.ts`, `pointerenter`) |
| 137 | Uscire dagli stili senza sceglierne uno | `mouseleave` → idem | 3890 | torna lo stile di prima; il menu resta aperto | uguale | [D-04] |
| 138 | Stile «Questo» | `[data-sc=this]` e `[data-st]` → idem | 3894, 3896–3899 | scrive «%% stile: aurora» nel diagramma e avvisa | uguale | [D-05] Con «Questo» scelto. Senza uno stile suo l'ambito parte da «Tutti», come nel prototipo (`scope`, riga 3881) |
| 139 | Stile «Tutti» | `[data-sc=all]` e `[data-st]` → idem | 3898 | preferenza e avviso | uguale | [D-06] |
| 140 | Orientamento «Da sinistra» | `[data-dir=LR]` → `.diagram-menu-segment` | 3895 | scrive «flowchart LR» | uguale | [D-07] |
| 141 | Ambito Tutti | `[data-sc=all]` → segmento | 3894 | cambia solo il segmento; il menu resta aperto | uguale | [D-08] |
| 142 | Menu: Modifica il sorgente | `[data-do=edit]` → «Modifica il sorgente» | 3900, 3861 | apre il sorgente in un riquadro | diverso | [D-09] nell'app il cursore va al testo della nota |
| 143 | Menu: Ingrandisci | `[data-do=full]` → «Ingrandisci» | 3900, 3866 | apre il riquadro grande, con lo zoom | uguale | [D-10] |
| 144 | Menu: Copia come immagine | `[data-do=copy]` → «Copia come immagine» | 3900 | avviso «Copiato in tre forme» | non provabile sul banco | [D-11] l'app: «Impossibile copiare il diagramma» (appunti) |
| 145 | Menu: Esporta | `[data-do=svg]` → «Esporta…» | 3900 | apre un sottomenu: Copia come SVG, Salva come SVG…, Salva come PNG… | diverso | [D-12] Il prototipo avvisa soltanto |
| 146 | Esc sul menu | tasto | 3902 | chiude; lo stile torna | uguale | [D-13] |
| 147 | Clic fuori dal menu | `mousedown` | 3902 | chiude; lo stile torna | uguale | [D-14] |
| 148 | Doppio clic sul disegno | `#dg-view` dblclick | 3907, 3861 | apre il sorgente in un riquadro | diverso | [D-15] nell'app il cursore va al testo della nota |
| 149 | Scrivere nel sorgente | `#dg-src` input | 3909, 3850 | il sorgente è il testo della nota: si scrive lì; il disegno torna all'uscita | diverso | [D-16] Il prototipo rifà il disegno dopo una pausa |
| 150 | Sorgente con una riga sbagliata | `#dg-src` → testo della nota | 3857 | nessun messaggio mentre si scrive; «Riga N: …» quando il disegno si rifà (`ui/mermaid.ts`) | diverso | [D-17] Il prototipo lo dice subito e tiene il disegno di prima |
| 151 | Tab nel sorgente | `#dg-src` keydown | 3910 | rientra di due spazi la riga del cursore (qui la chiusura del recinto) e la sceglie | diverso | [D-18] Il prototipo inserisce due spazi nel punto del cursore |
| 152 | Esc nel sorgente | `#dg-src` keydown | 3910 | torna al disegno e sceglie il blocco | uguale | [D-19] |
| 153 | «Fatto» | `#dg-done` → «Fatto» nella barra | 3911 | chiude il sorgente e sceglie il blocco | uguale | [D-20] «Fatto» sta nella testata del blocco di codice (`code-block.ts`) |
| 154 | Barra: Stile | `#dg-b-style` → nessun pulsante | 3914 | manca nella barra | manca nell'app | [D-21] la barra del diagramma ha Mermaid, A capo, Copia, Fatto |
| 155 | Barra: Modifica | `#dg-b-edit` → nessun pulsante | 3914 | manca nella barra | manca nell'app | [D-22] |
| 156 | Barra: Ingrandisci | `#dg-b-full` → nessun pulsante | 3914 | manca nella barra | manca nell'app | [D-23] |
| 157 | Didascalia: scrivere | `#dg-cap` → didascalia | 3912 | cambia il testo sul posto | uguale | [D-24] nel prototipo il titolo va nel sorgente. Dal codice: uguale il 21/11, non rifatto |
| 158 | Didascalia: Invio | `#dg-cap` keydown | 3913 | esce dalla didascalia | uguale | [D-25]. Dal codice: uguale il 21/11, non rifatto |
| 159 | Pieno schermo: rotella | `wheel` → idem | 3872 | la rotella ingrandisce | uguale | [D-26] Dal codice (`editors/media/zoom-view.ts`) |
| 160 | Pieno schermo: trascinare | `pointer` → idem | 3873–3874 | trascinare sposta il disegno | uguale | [D-27] Dal codice (`editors/media/zoom-view.ts`) |
| 161 | Pieno schermo: clic sullo sfondo | `pointerup` → idem | 3875 | un clic sullo sfondo senza trascinare chiude | uguale | [D-28] Dal codice (`ui/lightbox.ts`) |
| 162 | Pieno schermo: Esc | tasto | 3876 | chiude | uguale | [D-29] |
| 163 | Pieno schermo: × | `.dg-full-x` → idem | 3877 | chiude | uguale | [D-30] Dal codice (`ui/lightbox.ts`) |
| 164 | Blocco del diagramma selezionato, Invio | tasto | 4417 | con il blocco scelto (Esc dal sorgente) Invio apre il sorgente; ma il blocco non si sceglie con le frecce, e un clic sul disegno mette il cursore nel sorgente | diverso | [D-31] Dal codice (`diagram-live.ts`, `diagramBlockKeys`) e dalla sonda. Il prototipo sceglie il blocco col clic sul disegno (riga 3908); nell'app, dopo il clic, Invio spezza «flowchart TD» in due righe e il diagramma non si disegna più |
| 165 | Blocco del diagramma selezionato, Spazio | tasto | 4417 | con il blocco scelto (Esc dal sorgente) lo Spazio ingrandisce; dopo un clic sul disegno lo Spazio scrive nel sorgente; su un paragrafo scelto ne sostituisce il testo | diverso | [D-32] Il prototipo ingrandisce e non cancella un blocco di testo scelto. Sonde: dopo il clic «flowchart TD» diventa «flowchart T D»; con «Dopo la tabella.» scelto resta solo uno spazio. Che Ctrl+Z li riporti non è provato |

## Riepilogo

| Esito | 21/11 | 28/11 |
|---|---|---|
| uguali | 67 | 105 |
| diversi | 29 | 44 |
| manca nell'app | 11 | 8 |
| non provabili sul banco | 28 | 8 |
| non provati | 30 | 0 |
| fuori dal lavoro | 0 | 0 |
| totale | 165 | 165 |

Per area, al 28/11 (uguali, diversi, mancanti, non provabili): Base 30 gesti (16, 9, 2, 3); tabella 62 (49, 9, 3, 1); foglio 24 (15, 8, 0, 1); schede 17 (5, 10, 0, 2); diagramma 32 (20, 8, 3, 1).

## I 5 più visibili per l'utente

Al ripasso del 2026-11-28:

1. **Clic sul diagramma, poi un tasto.** Nel prototipo il clic sul disegno sceglie il blocco, e Invio o Spazio aprono il sorgente o ingrandiscono. Nell'app il clic mette il cursore nel sorgente: Invio spezza «flowchart TD» in due righe e il diagramma non si disegna più. Con le frecce il blocco non si sceglie, e lo Spazio su un paragrafo scelto ne sostituisce tutto il testo (righe 164 e 165).
2. **Scrivere nel foglio della scheda.** La battuta apre la cella e Invio scende, ma tornando sulla cella il valore è quello di prima, senza avviso; lo stesso con Canc (righe 103 e 107). Può essere l'host del banco: se vale anche nell'app vera, il valore si perde in silenzio.
3. **Base, stato e bacheca.** Lo stato scritto in una riga torna quello di prima, e trascinare una scheda in un'altra corsia non la sposta (righe 23 e 25). Mancano le viste Calendario e Linea del tempo (righe 2 e 3).
4. **Tabella, riempire.** La maniglia di riempimento sceglie il testo invece di riempire, e il doppio clic non riempie fino in fondo (righe 79 e 80). La barra di formato ha un menu al posto dei pulsanti Riga, Ordina e In foglio (righe 85–87).
5. **Diagramma, barra e sorgente.** La barra non ha Stile, Modifica né Ingrandisci (righe 154–156). Il sorgente si scrive nel testo della nota: il messaggio «Riga N» arriva solo quando il disegno si rifà, e Tab rientra la riga invece di scrivere due spazi (righe 149–151).

## Cosa resta

- Le 8 righe «non provabili sul banco» hanno bisogno di un banco dedicato o dell'app vera: i pulsanti «Nuova» della Base (18, 19), il calendario con eventi (26), la «Trasforma in foglio» con l'host vero (74), la banda del foglio (112), il documento Word e i nodi della lavagna nella scheda (128, 131), «Copia come immagine» con gli appunti veri (144).
- Le righe 103 e 107 vanno rifatte nell'app vera, su una copia di un vault: se il valore non resta neanche lì, è una perdita di dati.
- Maiusc+Tab nel foglio del prototipo va a destra (riga 3510): probabile difetto del prototipo.
- Le differenze di operatore (riga 7) e di ordinamento multiplo (righe 11 e 14) sono scelte da decidere con l'utente.
