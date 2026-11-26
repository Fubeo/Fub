# I gesti dell'editor: Base, tabelle, fogli e diagramma

Confronto gesto per gesto del prototipo `PLAN-ui/editor.html` con l'app, per l'area Base, tabelle, fogli e diagramma. Si misura il comportamento, non i valori. Non corregge niente: le correzioni le fanno altri task, partendo da questo elenco.

> **Per chi:** chi corregge l'editor e chi decide quali differenze chiudere.
> **Risultato:** 165 gesti: 67 uguali, 29 diversi, 11 mancanti nell'app, 28 non provabili sul banco, 30 non provati.

**Data:** 2026-11-21.
**Prototipo:** `PLAN-ui/editor.html` sul ramo `piano/editor-completo`, ultimo commit del file `fe8548e36` (ramo a `c8b643653`).
**App:** ramo `misure/gesti-4` a `80e7c92eb` (base `integra/editor-3`).

## Come si è misurato

- Prototipo: aperto da file, finestra 1680×1000, luce giorno, moto ridotto. Ogni gesto parte dal passo del tour che porta lo stato giusto (per esempio «La tabella, coi gesti del foglio»). Prima e dopo il gesto si legge: il fuoco, i pannelli aperti, l'avviso, la cella attiva, il testo della griglia, le schede, il diagramma.
- App: banco, porta 1693, scene `base-barra`, `live-14-tabella-attiva`, `schede-vive-01-riposo`, `schede-vive-02-attiva`, `diagramma-01-riposo`. Stessa lettura prima e dopo.
- Il riferimento è il codice del prototipo: la colonna «riga dello script» dà il punto del gestore. L'esito viene dalla differenza misurata e dal codice.
- La sonda era un file temporaneo del banco, fuori dal repository, e si cancella a fine lavoro.

## Limiti

- I dati sono diversi: il prototipo ha un preventivo, il banco una tabella di prova. Per questo si confronta il comportamento, non i valori né i numeri formattati.
- Gli appunti del sistema non si leggono sul banco: Copia, Incolla e «Copia come immagine» non si possono verificare fino in fondo. L'host del banco è finto e non ha tutti i comandi (Trasforma in foglio).
- Nella scena del foglio dell'app le celle hanno dimensione zero (sonda X-6): i gesti del foglio, lato app, non si misurano qui.
- Il sorgente di un diagramma nell'app è il testo della nota: non c'è un riquadro da misurare come nel prototipo.
- Nel banco il menu del tasto destro del diagramma nel prototipo non si apre con questa sonda. La causa non è chiara: quei gesti restano «non provati».

## Tabella

| n | gesto | elemento (prototipo → app) | prototipo (riga dello script) | app | esito | note |
|---|---|---|---|---|---|---|
| 1 | Clic sulla vista Bacheca | `.bview` «Bacheca» → `.base-tab` «Bacheca» | 4369 | passa alla Bacheca | uguale | [B-01] |
| 2 | Clic sulla vista Calendario | `.bview` «Calendario» → nessuna linguetta | 4369 | nella barra ci sono solo Tabella, Bacheca e Schede | manca nell'app | [B-02] il calendario esiste come scena del banco (`base=calendario`), non dalla barra |
| 3 | Clic sulla vista Linea del tempo | `.bview` «Linea del tempo» → nessuna linguetta | 4369 | come la riga 2 | manca nell'app | [B-03] |
| 4 | Torna alla Tabella dalla Bacheca | `.bview` «Tabella» → `.base-tab` «Tabella» | 4369 | torna alla tabella | uguale | [B-04] |
| 5 | Pulsante Filtro | `#b-f` → `.base-tool-filter` | 4370, 3342 | apre il pannello, con il primo campo a fuoco | uguale | [B-05] forma diversa: un pannello con tre campi nel prototipo, campi a righe nell'app |
| 6 | Filtro: cambiare la colonna | `#bf-k` → `select.base-filter-subject` | 3349 | cambia la lista dei valori | uguale | [B-06] |
| 7 | Filtro: Applica | `#bf-ok` → «Applica» | 3350 | aggiunge la condizione, chiude, scrive il file e avvisa; righe da 5 a 1 | uguale | [B-07] nell'app per lo Stato l'operatore predefinito è «è più di», nel prototipo «è» |
| 8 | Filtro: Annulla | `#bf-x` → «Annulla» | 3350 | chiude e riporta il fuoco sul pulsante Filtro | uguale | [B-08] |
| 9 | Togliere un filtro (×) | `[data-unf]` → `.base-chip button` | 4371 | toglie la condizione | uguale | [B-09] |
| 10 | Pulsante Ordina | `#b-s` → `.base-tool-sort` | 4373 | apre un pannello con «Ordina per» e «Verso» | diverso | [B-10] il prototipo apre un menu con le colonne |
| 11 | Ordina per Stato, crescente | `#b-s`, voce Stato, Crescente → pannello Ordina | 4373, 3315 | aggiunge un criterio: Stato ↑ accanto a Consegna ↑ | diverso | [B-11] il prototipo ha un solo criterio e lo sostituisce |
| 12 | Togliere l'ordinamento (×) | `[data-unsort]` → ultimo chip | 4372 | toglie il criterio Stato | uguale | [B-12] |
| 13 | Clic sull'intestazione di colonna | `th[data-col]` → `th[data-column]` | 4379 | apre il menu di colonna | uguale | [B-13] le voci sono diverse: il prototipo ha ordina, filtra, nascondi; l'app ha ordina, raggruppa, rinomina, tipo, copia, nascondi |
| 14 | Menu colonna: Ordina decrescente | voce del menu → `button.kit-row` | 4379 | ordina in discesa; aggiunge un criterio | uguale | [B-14] come la riga 11 per i criteri |
| 15 | Pulsante Proprietà | `#b-p` → `.base-tool-columns` | 4374 | apre l'elenco delle colonne con le caselle | uguale | [B-15] |
| 16 | Colonna Valore: mostrare o nascondere | voce «Valore» → casella «valore» | 4374 | l'app mostra Valore di default, il prototipo la nasconde | uguale | [B-16] il gesto è lo stesso, il punto di partenza no |
| 17 | Pulsante Nuova vista | `#b-nv` → `.base-tool-new-view` | 4375 | apre il menu «Nuova vista» | uguale | [B-17] |
| 18 | Pulsante Nuova (nuova opera) | `#b-n` → `.base-new-note` | 4376 | nel banco nessun effetto visibile | non provabile sul banco | [B-18] il prototipo crea «Senza titolo» e avvisa |
| 19 | Riga «Nuova opera» in fondo | `tr.addrow` → `.base-add-row-button` | 4376 | nel banco nessun effetto visibile | non provabile sul banco | [B-19] come la riga 18 |
| 20 | Nuova da un modello | `#b-nt` → `.base-new-template` | 4377 | apre il menu «Nuova da un modello» | uguale | [B-20] |
| 21 | Lente «Cerca nella vista» | `button[aria-label]` → `.base-tool-search` | 3340 | apre un campo di ricerca | diverso | [B-21] il prototipo mostra solo un avviso, che promette un filtro |
| 22 | Clic sullo stato di una riga | `[data-cyc]` → `.base-cell[data-column=stato]` | 4378 | mette il fuoco nel campo di testo dello stato | diverso | [B-22] il prototipo apre il menu delle corsie |
| 23 | Scegliere lo stato «Da chiedere» | voce del menu → campo di testo | 4378 | digitare nel campo: nel banco nessun cambio visibile | diverso | [B-23] da verificare sul file; il prototipo scrive e avvisa |
| 24 | Clic su «Apri» di una riga | `.open-r` → titolo della riga | 4380 | apre la nota in una scheda nuova | diverso | [B-24] il prototipo avvisa «Sbircia» e non apre |
| 25 | Trascinare una scheda in un'altra corsia | `.bcard` → `.base-kanban-card` | 3353, 3356 | nel banco la scheda non cambia corsia | non provato | [B-25] il prototipo cambia lo stato e avvisa; il trascinamento del banco non riproduce il gesto |
| 26 | Trascinare una consegna su un altro giorno | `.ev` → `.base-cal-event` | 3332, 3356 | non misurabile: la scena del calendario non mostra eventi nel mese del banco | non provato | [B-26] il prototipo cambia la data e avvisa |
| 27 | Trascinare una barra della linea del tempo | `.tl-b` → `.base-tl-bar` | 3337 | la barra si sposta e avvisa | diverso | [B-27] nel prototipo le barre sono fisse |
| 28 | Clic su «Nel file .base» | `details.byaml` → riepilogo «Nel file» | 3339 | apre il riepilogo | uguale | [B-28] |
| 29 | Esc con il filtro aperto | tasto Esc → pannello | 2560–2578 | chiude e riporta il fuoco sul pulsante Filtro | uguale | [B-29] |
| 30 | Clic sul titolo di una riga | `td.t` → titolo della riga | 3326 | apre la nota | diverso | [B-30] il prototipo non fa nulla sul titolo |
| 31 | Clic su una cella | `td[data-r][data-c]` → `.tb-cell` | 3638–3642 | cella attiva e barra aggiornate | uguale | [T-01] |
| 32 | Trascinare su più celle | trascinamento → idem | 3638–3650 | selezione con Somma, Media, Conteggio | uguale | [T-02] formato dei numeri diverso |
| 33 | Maiusc+clic su un'altra cella | `td` → `.tb-cell` | 3641 | estende la selezione | uguale | [T-03] |
| 34 | Freccia giù | tasto → tasto | 3677–3678 | cella sotto | uguale | [T-04] |
| 35 | Freccia destra | tasto → tasto | 3677 | cella a destra | uguale | [T-05] |
| 36 | Maiusc+freccia giù | tasto → tasto | 3678 | estende la selezione | uguale | [T-06] |
| 37 | Ctrl+freccia giù | tasto → tasto | 3678, 3589 | salta al bordo dei dati | uguale | [T-07] per questi dati l'app va all'ultima riga |
| 38 | Alt+freccia giù | tasto → tasto | 3675 | sposta la riga | uguale | [T-08] |
| 39 | Fine | tasto → tasto | 3680 | ultima colonna della riga | uguale | [T-09] |
| 40 | Ctrl+Fine | tasto → tasto | 3680 | ultima cella | uguale | [T-10] |
| 41 | Invio sulla cella | tasto → tasto | 3681, 3602 | apre la modifica con il valore | uguale | [T-11] |
| 42 | F2 | tasto → tasto | 3681 | apre la modifica | uguale | [T-12] |
| 43 | Doppio clic su una cella | `dblclick` → idem | 3651 | apre la modifica | uguale | [T-13] |
| 44 | Scrivere una lettera | tasto → tasto | 3698 | apre la modifica con la lettera | uguale | [T-14] |
| 45 | Scrivere «Tr» in una colonna con valori | digitare → idem | 3594–3596 | propone il completamento | uguale | [T-15] il prototipo completa «Trasporti Bassi», l'app propone «Belém» |
| 46 | «Tr» e Invio: accetta il completamento | digitare e Invio | 3598–3601 | accetta e scende | uguale | [T-16] |
| 47 | In modifica: Tab | tasto → tasto | 3602–3603 | scrive e va a destra | uguale | [T-17] |
| 48 | In modifica: Maiusc+Tab | tasto → tasto | 3603 | scrive e va a sinistra | uguale | [T-18] |
| 49 | In modifica: Esc | tasto → tasto | 3604 | annulla la scrittura | uguale | [T-19] |
| 50 | Tab fuori dalla modifica | tasto → tasto | 3682–3684 | va a destra | uguale | [T-20] |
| 51 | Canc sulla cella | tasto → tasto | 3686 | svuota la selezione | uguale | [T-21] |
| 52 | Ctrl+A | tasto → tasto | 3687 | seleziona tutta la tabella | uguale | [T-22] |
| 53 | Scrivere, Invio, poi Ctrl+Z | tasti | 3688, 3543 | annulla la scrittura | uguale | [T-23] |
| 54 | Ctrl+Y | tasti | 3689 | ripete la scrittura | uguale | [T-24] |
| 55 | Ctrl+D (riempi in giù) | tasti | 3690, 3621 | copia la cella di sopra | uguale | [T-25] |
| 56 | Ctrl+R (riempi a destra) | tasti | 3691, 3622 | copia la cella a sinistra | uguale | [T-26] |
| 57 | Ctrl+; (data corrente) | tasto → tasto | 3692 | scrive la data corrente | uguale | [T-27] il prototipo ha un orologio fisso |
| 58 | Alt+= (somma delle celle sopra) | tasto → tasto | 3693, 3623 | scrive la somma come valore | uguale | [T-28] |
| 59 | Ctrl+Maiusc+= (inserisce una riga) | tasto → tasto | 3694, 3609 | prototipo: riga sotto la riga attiva | diverso | [T-29] l'app inserisce la riga sopra la riga attiva |
| 60 | Ctrl+- (elimina la riga) | tasto → tasto | 3695, 3611 | elimina la riga | uguale | [T-30] |
| 61 | Maiusc+Spazio (seleziona la riga) | tasto → tasto | 3685 | seleziona la riga | uguale | [T-31] |
| 62 | Ctrl+Spazio (seleziona la colonna) | tasto → tasto | 3685 | seleziona la colonna | uguale | [T-32] |
| 63 | Esc con più celle selezionate | tasti | 3697 | torna a una cella | uguale | [T-33] il passo intermedio non si legge dal confronto prima e dopo |
| 64 | Maiusc+F10 (menu della tabella) | tasto → tasto | 3696 | apre il menu | uguale | [T-34] |
| 65 | Tasto destro su una cella | `contextmenu` → idem | 3652, 3625 | apre il menu e sposta la selezione | uguale | [T-35] |
| 66 | Menu: Copia | voce del menu → `button.kit-row` | 3628 | nel banco nessun avviso visibile | non provabile sul banco | [T-36] gli appunti del sistema non si leggono |
| 67 | Menu: Taglia | voce del menu → `button.kit-row` | 3628 | nel banco nessun avviso visibile | non provabile sul banco | [T-37] come la riga 66 |
| 68 | Menu: Incolla | voce del menu → `button.kit-row` | 3628 | prova a leggere gli appunti e dice «Non riesco a leggere gli appunti» | diverso | [T-38] il prototipo mostra solo un suggerimento (usa Ctrl+V) |
| 69 | Menu: Inserisci, Riga sotto | voci del menu | 3629 | riga sotto la riga scelta | uguale | [T-39] |
| 70 | Menu: Sposta, Riga giù | voci del menu | 3630 | sposta la riga giù | uguale | [T-40] nel banco dalla riga 1: «Riga in giù» non c'è sull'ultima riga |
| 71 | Menu: Ordina, Dalla A alla Z | voci del menu | 3631 | ordina la colonna | non provato | [T-41] i dati dell'app sono già in ordine: nessun effetto leggibile |
| 72 | Menu: Allinea, A destra | voci del menu | 3632 | la voce c'è | non provato | [T-42] l'allineamento è stile, non testo: serve una foto |
| 73 | Menu: Scrivi qui la somma | voce del menu | 3633 | nel menu non c'è | manca nell'app | [T-43] la somma si fa con Alt+= (riga 58); il menu dell'app ha «Grafico da questa tabella» |
| 74 | Menu: Trasforma in foglio | voce del menu → `button.kit-row` | 3633, 3624 | prova a crearlo: «host fake: il comando non c'è» | non provabile sul banco | [T-44] il banco finge l'host |
| 75 | Menu: Elimina la riga | voce del menu | 3634 | elimina la riga; il cursore resta nella stessa posizione | diverso | [T-45] l'app va alla riga sopra |
| 76 | Ctrl+C (copia) | tasti | 3661–3662 | copia e avvisa la prima volta | diverso | [T-46] nel banco l'app copia senza avviso |
| 77 | Ctrl+X (taglia) | tasti | 3662 | taglia e avvisa | uguale | [T-47] il segno tratteggiato non è nel confronto |
| 78 | Incollare testo a tabulazioni | evento incolla simulato (non Ctrl+V) | 3663–3670 | incolla il blocco nelle celle | uguale | [T-48] |
| 79 | Trascinare la maniglia per riempire | `.tg-fill` → `.tb-fill` | 3639, 3646–3650 | copia la cella sotto | diverso | [T-49] nel banco l'app estende la selezione e non riempie |
| 80 | Doppio clic sulla maniglia | `.tg-fill` → `.tb-fill` | 3651 | riempie fino in fondo | manca nell'app | [T-50] nessun effetto nel banco |
| 81 | Clic sulla lettera di colonna | `.gr-let span` → `.tb-letter` | 3653–3655 | seleziona la colonna | uguale | [T-51] |
| 82 | Clic sul numero di riga | `.gr-num span` → `.tb-rowhead` | 3653–3656 | seleziona la riga | uguale | [T-52] |
| 83 | Pulsante + per una riga | `.tg-add.row` → «Aggiungi una riga» | 3657 | aggiunge una riga in fondo | uguale | [T-53] |
| 84 | Pulsante + per una colonna | `.tg-add.col` → «Aggiungi una colonna» | 3657 | aggiunge una colonna in fondo | uguale | [T-54] |
| 85 | Barra di formato: Riga | `#tb-row` → nessun pulsante | 3722, 1564 | manca nella barra | manca nell'app | [T-55] le azioni stanno nel menu |
| 86 | Barra di formato: Ordina | `#tb-sort` → nessun pulsante | 3722 | manca nella barra | manca nell'app | [T-56] |
| 87 | Barra di formato: In foglio | `#tb-xlsx` → nessun pulsante | 3722, 3624 | manca nella barra; la voce c'è nel menu | manca nell'app | [T-57] |
| 88 | Scrivere una formula «=1+1» | digitare e Invio | 3600 | scrive il testo e avvisa che resta testo | uguale | [T-58] l'azione «In foglio» del messaggio non è nel confronto |
| 89 | Più numeri selezionati: la banda | trascinamento | 3583, 3706 | Somma, Media, Conteggio | uguale | [T-59] |
| 90 | Clic fuori dalla tabella | `focusout` → `onBlur` | 3701, 3721 | la cella resta evidenziata | diverso | [T-60] il prototipo toglie la selezione |
| 91 | Freccia su due volte | tasto → tasto | 3677 | esce al testo sopra | uguale | [T-61] |
| 92 | Esc sulla tabella, poi Invio | tasto Esc → blocco | 3697, 4417 | torna al testo, senza blocco | diverso | [T-62] il prototipo seleziona il blocco della tabella |
| 93 | Clic su una cella del foglio | `#sh-grid td` → `.grid-cell` | 3497–3498 | non provabile: celle a dimensione zero | non provabile sul banco | [F-01] nel prototipo seleziona e aggiorna la barra |
| 94 | Trascinare sulle celle del foglio | trascinamento → idem | 3497–3498 | non provabile | non provabile sul banco | [F-02] |
| 95 | Maiusc+clic nel foglio | `td` → `.grid-cell` | 3497 | non provabile | non provabile sul banco | [F-03] |
| 96 | Freccia giù nel foglio | tasto | 3504–3507 | non provabile | non provabile sul banco | [F-04] |
| 97 | Freccia destra nel foglio | tasto | 3504–3507 | non provabile | non provabile sul banco | [F-05] |
| 98 | Maiusc+freccia giù nel foglio | tasto | 3506 | non provabile | non provabile sul banco | [F-06] |
| 99 | Ctrl+freccia giù nel foglio | tasto | 3504–3507 | non provabile | non provabile sul banco | [F-07] nel prototipo nessun effetto: il ramo Ctrl non c'è |
| 100 | Invio nel foglio (modifica) | tasto | 3508 | non provabile | non provabile sul banco | [F-08] |
| 101 | F2 nel foglio (modifica) | tasto | 3508 | non provabile | non provabile sul banco | [F-09] |
| 102 | Doppio clic nel foglio | `dblclick` | 3500 | non provabile | non provabile sul banco | [F-10] |
| 103 | Scrivere 1000 e Invio nel foglio | digitare e Invio | 3491–3495, 3725 | scrive, avvisa e scende | non provabile sul banco | [F-11] |
| 104 | Tab nel foglio | tasto | 3509 | non provabile | non provabile sul banco | [F-12] |
| 105 | Maiusc+Tab nel foglio | tasto | 3509 | prototipo: va a destra, ignora Maiusc | non provabile sul banco | [F-13] da decidere: probabile difetto del prototipo |
| 106 | Esc in modifica nel foglio | tasto | 3494 | non provabile | non provabile sul banco | [F-14] |
| 107 | Canc nel foglio | tasto | 3510 | non provabile | non provabile sul banco | [F-15] |
| 108 | Ctrl+A nel foglio | tasto | 3511 | non provabile | non provabile sul banco | [F-16] |
| 109 | Maiusc+giù, poi Esc nel foglio | tasti | 3512 | non provabile | non provabile sul banco | [F-17] |
| 110 | Esc senza selezione nel foglio | tasto | 3512, 3724 | non provabile | non provabile sul banco | [F-18] il prototipo esce dal foglio e seleziona il blocco |
| 111 | Clic fuori dal foglio | `onBlur` | 3723 | non provabile | non provabile sul banco | [F-19] |
| 112 | Più numeri nel foglio: la banda | trascinamento | 3706 | non provabile | non provabile sul banco | [F-20] |
| 113 | Esc, poi Invio, sul blocco del foglio | tasti | 4417 | non provabile | non provabile sul banco | [F-21] |
| 114 | Clic sulla scheda del foglio a riposo | `.scard-b` → `.live-card` del foglio | 3726 | il fuoco va nella griglia, sulla cella A1 | uguale | [F-22] nel prototipo si sceglie A2 |
| 115 | Maniglia del foglio | nessuna maniglia nel prototipo → segno di maniglia nell'app | 3468 | il segno di maniglia c'è nel DOM | diverso | [F-23] il prototipo non ha la maniglia; non misurato nel banco |
| 116 | Tasto destro sul foglio | `#sh-grid` → `.grid-cell` | 3468 | non provabile | non provabile sul banco | [F-24] il prototipo apre un menu |
| 117 | Clic sulla scheda PDF a riposo | `.scard[data-kind=pdf]` → `.live-card[data-card-kind=pdf]` | 3790 | il fuoco va sulla scheda, senza attivarla | diverso | [S-01] nel prototipo la scheda diventa attiva |
| 118 | «›» pagina successiva | `#pdf-next` → nessun comando a riposo | 3777, 3762 | a riposo non c'è il comando di pagina | diverso | [S-02] nel prototipo la pagina passa da 2 a 3 |
| 119 | «‹» pagina precedente | `#pdf-prev` → nessun comando a riposo | 3777 | come la riga 118 | diverso | [S-03] nel prototipo la pagina passa da 2 a 1 |
| 120 | Freccia destra sul PDF attivo | tasto | 3796 | nessun cambio di pagina | diverso | [S-04] le pagine stanno nel visualizzatore |
| 121 | PageDown sul PDF attivo | tasto | 3796 | nessun cambio di pagina | diverso | [S-05] |
| 122 | «Estrai» | `#pdf-ex` → `.live-card-extract` | 3778–3781 | compare solo con un testo selezionato | diverso | [S-06] il prototipo lo mostra sempre e crea l'estratto |
| 123 | «Apri» (linguetta) | `[data-say]` → `.live-card-open` | 3758, 3414 | apre il file nel visualizzatore | diverso | [S-07] il prototipo avvisa soltanto |
| 124 | «Fine» (chiude la scheda attiva) | `.fine` → `.live-card-done` | 3789 | non provato: il pulsante non si clicca in nessuno dei due lati | non provato | [S-08] |
| 125 | Esc con la scheda attiva | tasto | 3795 | torna al testo | diverso | [S-09] il prototipo seleziona il blocco della scheda |
| 126 | Clic fuori dalla scheda attiva | `mousedown` → idem | 3792 | scheda a riposo, fuoco sul titolo | uguale | [S-10] |
| 127 | Documento: clic sul testo | `#doc-p` → testo del documento | 3772, 3790 | diventa modificabile, con il fuoco nel testo | uguale | [S-11] |
| 128 | Documento: scrivere | `#doc-p` → editor del documento | 3783 | fuoco nel testo; nessun avviso visibile | non provato | [S-12] il prototipo avvisa «Scritto in…»; il testo non si legge nel confronto |
| 129 | Documento: Esc | tasto | 3784, 3795 | esce al testo sopra | diverso | [S-13] il prototipo seleziona il blocco |
| 130 | Lavagna: clic sulla scheda | `.scard[data-kind=canvas]` → `.live-card` della lavagna | 3790 | fuoco sulla lavagna; l'attivazione non si legge | non provato | [S-14] |
| 131 | Lavagna: trascinare una scheda | `.cvn` → nodi della lavagna | 3786–3788 | nodo non mappato nel banco | non provato | [S-15] il prototipo sposta e avvisa |
| 132 | Lavagna: «A tutta pagina» | `[data-say]` → `.live-card-full` | 3760 | pulsante presente, nessun effetto leggibile | non provato | [S-16] il prototipo avvisa |
| 133 | Tasto destro sulla scheda PDF | `contextmenu` → `.live-card` | 4244–4254 | apre un menu con «Link alla nota» | diverso | [S-17] il prototipo non apre menu sulla scheda a riposo |
| 134 | Passare il mouse sul diagramma | stile → `.mermaid-diagram` | 3799 | solo il disegno, nessuna barra | uguale | [D-01] |
| 135 | Tasto destro sul disegno | `#dg-view` → `.mermaid-diagram img` | 3905, 3879 | apre il menu dello stile | non provato | [D-02] nel banco il menu del prototipo non si apre con questa sonda; l'app apre il suo menu |
| 136 | Passare su uno stile del menu | `[data-st]` → `.diagram-menu-style` | 3888 | anteprima sul disegno | non provato | [D-03] |
| 137 | Uscire dagli stili senza sceglierne uno | `mouseleave` → idem | 3889 | torna lo stile di prima | non provato | [D-04] |
| 138 | Stile «Questo» | `[data-sc=this]` e `[data-st]` → idem | 3893, 3895–3898 | scrive «%% stile:» nel diagramma e avvisa | non provato | [D-05] nell'app scrive «%% stile: aurora» e avvisa |
| 139 | Stile «Tutti» | `[data-sc=all]` e `[data-st]` → idem | 3897 | preferenza e avviso | non provato | [D-06] nell'app avvisa che lo stile vale per tutti i diagrammi senza uno stile loro |
| 140 | Orientamento «Da sinistra» | `[data-dir=LR]` → `.diagram-menu-segment` | 3894 | disegno da sinistra | non provato | [D-07] nel banco nessun cambio leggibile |
| 141 | Ambito Tutti | `[data-sc=all]` → segmento | 3893 | cambia solo il segmento | non provato | [D-08] nell'app il menu resta aperto |
| 142 | Menu: Modifica il sorgente | `[data-do=edit]` → «Modifica il sorgente» | 3899, 3860 | apre il sorgente in un riquadro | diverso | [D-09] nell'app il cursore va al testo della nota |
| 143 | Menu: Ingrandisci | `[data-do=full]` → «Ingrandisci» | 3899, 3865 | pieno schermo | non provato | [D-10] nell'app compare uno schermo di zoom, non misurato a fondo |
| 144 | Menu: Copia come immagine | `[data-do=copy]` → «Copia come immagine» | 3899 | avviso «Copiato in tre forme» | non provabile sul banco | [D-11] l'app: «Impossibile copiare il diagramma» (appunti) |
| 145 | Menu: Esporta | `[data-do=svg]` → «Esporta…» | 3899 | avviso «Esporta: SVG…» | non provato | [D-12] nell'app si apre una voce del menu |
| 146 | Esc sul menu | tasto | 3901 | chiude e ripristina lo stile | non provato | [D-13] |
| 147 | Clic fuori dal menu | `mousedown` | 3901 | chiude e ripristina lo stile | non provato | [D-14] |
| 148 | Doppio clic sul disegno | `#dg-view` dblclick | 3906, 3860 | apre il sorgente in un riquadro | diverso | [D-15] nell'app il cursore va al testo della nota |
| 149 | Scrivere nel sorgente | `#dg-src` input | 3908, 3849 | il disegno si rifà dopo una pausa | non provato | [D-16] il sorgente nell'app è il testo della nota |
| 150 | Sorgente con una riga sbagliata | `#dg-src` → testo della nota | 3856 | prototipo: «Riga N…, resta il disegno di prima» | non provato | [D-17] |
| 151 | Tab nel sorgente | `#dg-src` keydown | 3909 | inserisce due spazi | non provato | [D-18] |
| 152 | Esc nel sorgente | `#dg-src` keydown | 3909 | torna al disegno | non provato | [D-19] |
| 153 | «Fatto» | `#dg-done` → «Fatto» nella barra | 3910 | chiude il sorgente | non provato | [D-20] l'app ha «Fatto» nella barra; effetto non misurato |
| 154 | Barra: Stile | `#dg-b-style` → nessun pulsante | 3913 | manca nella barra | manca nell'app | [D-21] la barra del diagramma ha Mermaid, A capo, Copia, Fatto |
| 155 | Barra: Modifica | `#dg-b-edit` → nessun pulsante | 3913 | manca nella barra | manca nell'app | [D-22] |
| 156 | Barra: Ingrandisci | `#dg-b-full` → nessun pulsante | 3913 | manca nella barra | manca nell'app | [D-23] |
| 157 | Didascalia: scrivere | `#dg-cap` → didascalia | 3911 | cambia il testo sul posto | uguale | [D-24] nel prototipo il titolo va nel sorgente |
| 158 | Didascalia: Invio | `#dg-cap` keydown | 3912 | esce dalla didascalia | uguale | [D-25] |
| 159 | Pieno schermo: rotella | `wheel` → idem | 3871 | ingrandisce | non provato | [D-26] con questa sonda il pieno schermo del prototipo non si apre |
| 160 | Pieno schermo: trascinare | `pointer` → idem | 3872–3873 | sposta il disegno | non provato | [D-27] |
| 161 | Pieno schermo: clic sullo sfondo | `pointerup` → idem | 3874 | chiude | non provato | [D-28] |
| 162 | Pieno schermo: Esc | tasto | 3875 | chiude | non provato | [D-29] |
| 163 | Pieno schermo: × | `.dg-full-x` → idem | 3876 | chiude | non provato | [D-30] |
| 164 | Blocco del diagramma selezionato, Invio | tasto | 4416 | apre il sorgente | diverso | [D-31] nell'app compare «Il diagramma non si disegna»: messaggio poco chiaro |
| 165 | Blocco del diagramma selezionato, Spazio | tasto | 4416 | ingrandisce | manca nell'app | [D-32] nel banco lo Spazio non ha effetto |

## Riepilogo

| Esito | Gesti |
|---|---|
| uguali | 67 |
| diversi | 29 |
| manca nell'app | 11 |
| non provabili sul banco | 28 |
| non provati | 30 |
| totale | 165 |

Per area: Base 30 gesti (16 uguali, 8 diversi, 2 mancanti, 2 non provabili, 2 non provati); tabella 62 (45, 7, 5, 3, 2); foglio 24 (1, 1, 0, 22, 0); schede 17 (2, 10, 0, 0, 5); diagramma 32 (3, 3, 4, 1, 21).

## I 5 più visibili per l'utente

1. **Base, barra delle viste.** L'app non ha le linguette Calendario e Linea del tempo: nella barra ci sono solo Tabella, Bacheca e Schede (righe 2 e 3).
2. **Diagramma, barra e Spazio.** La barra dell'app non ha Stile, Modifica né Ingrandisci, e lo Spazio con il blocco selezionato non ingrandisce (righe 154–156 e 165). Con Invio l'app mostra «Il diagramma non si disegna», un messaggio poco chiaro (riga 164).
3. **Tabella, barra e menu.** La barra di formato dell'app non ha Riga, Ordina né In foglio, e il menu non ha «Scrivi qui la somma» (righe 85–87 e 73).
4. **Schede nella nota.** Nell'app il PDF a riposo non si sfoglia, e «Estrai» compare solo con un testo selezionato. Il prototipo lo mostra sempre (righe 118–122).
5. **Tabella, maniglia.** Nell'app la maniglia di riempimento non riempie: estende la selezione. Il doppio clic sulla maniglia non riempie fino in fondo (righe 79 e 80).

## Cosa resta

- I 30 gesti «non provati» e i 28 «non provabili sul banco» hanno bisogno di un banco dedicato: il foglio della scheda dell'app con le celle a dimensione reale, la lavagna con i suoi nodi, il pieno schermo del diagramma e il menu del diagramma nel prototipo.
- Maiusc+Tab nel foglio del prototipo va a destra (riga 3509): da decidere se è un difetto del prototipo.
- Le differenze di operatore (riga 7) e di ordinamento multiplo (righe 11 e 14) sono scelte da decidere con l'utente.
