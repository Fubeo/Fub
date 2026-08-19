# 0168 — Tre voci in bundle, e un canale in più

**Stato**: accolta **Data**: 2026-08-19 **Chiude**: [§31.3](../roadmap/31-da-dove-viene-cio-che-si-vede.md)
**Commit**: *(questo commit)*

---

## La domanda

`--font-ui` era `system-ui`: su tre piattaforme, tre prodotti diversi — metriche
verticali che non coincidono, un banco visivo la cui baseline vale per la
macchina che l'ha scattata e per nessun'altra. Non c'era nessuna voce per la
**lettura**, che è l'attività per cui l'app esiste, e la scala dei corpi aveva
sei gradini a un pixel di distanza l'uno dall'altro: non una scala, un elenco.

La CSP dell'app non lascia scelta sulla forma della risposta:
`font-src 'self' asset:` ([0017](0017-chi-disegna-cio-che-il-core-non-conosce.md)).
Un carattere o è in bundle, o non esiste — e la domanda della voce è quindi
*quali* tre, non *se*.

## Le tre voci

**Inter** per l'interfaccia, **Literata** per la lettura, **JetBrains Mono**
per il codice — scelte con l'utente, non per l'utente: tre famiglie
indipendenti pensate ciascuna per il proprio compito, invece di una sola
famiglia (una `IBM Plex` completa, ad esempio) tirata a coprire tre ruoli che
non le somigliano allo stesso modo. Licenza SIL OFL-1.1 su tutte e tre.

Ciascuna arriva come **file variabile** (`@fontsource-variable/*`): un solo
file copre l'intero asse `wght`, da 100 a 900. Quattro file in tutto — Inter
normale, Literata normale, Literata corsivo, JetBrains Mono normale — non
dodici, perché il corsivo di un carattere variabile non è un asse (`ital` non
è universalmente supportato) e serve un secondo file solo dove serve davvero:
la lettura, dove un corsivo è un'enfasi che si scrive. Il sottoinsieme di
glifi è `latin` (`U+0000-00FF` e una manciata di punteggiatura): copre
l'italiano e l'inglese, le due lingue di questo repository. Un carattere fuori
da quel range rende col ripiego di sistema in coda alla pila, non con un
quadratino — la pila non è mai un carattere solo.

I quattro file pesano 195 KB in tutto: 48 KB Inter, 52+54 KB Literata (i due
stili), 40 KB JetBrains Mono. Stanno in `frontend/public/fonts/`, serviti come
asset statici — `'self'` nella CSP li copre senza bisogno di allargarla.

## Un canale, non un token

I caratteri non entrano come tre righe nel foglio (`--font-ui: "Inter
Variable", …`): quelle restano, ma le regole `@font-face` che rendono veri
quei nomi vivono in `theme/serie/caratteri.css`, un file a sé che il
caricatore monta come **terzo strato** (`data-fub="caratteri"`), accanto a
foglio e pelle.

La ragione non è che cambino con la luce — non cambiano mai, le due luci
portano gli stessi tre caratteri — ma la stessa che tiene la pelle separata
dal foglio: un tema di terzi che porti le proprie voci sostituisce questo
file intero, non un token dentro il foglio. È la stessa domanda della 29
(*chi possiede la pelle*) applicata a un pezzo che prima non esisteva.

Un canale in più rompe una premessa implicita di `loader.ts`: con due canali,
appendere in coda a `<head>` bastava, perché l'ordine di montaggio *era*
l'ordine nel documento. Con tre — e a breve quattro, con lo strato delle
preferenze della §31.6 — non è più vero, e la seconda metà della voce era
proprio questa: **dichiarare** l'ordine (`ORDINE` in `loader.ts`: caratteri,
foglio, pelle) e far sì che `monta()` inserisca ogni canale al proprio posto
nel DOM indipendentemente da quando viene chiamato. Il banco lo prova
montando la pelle *prima* dei caratteri e verificando che il DOM li ordini
comunque `caratteri, foglio, pelle`.

## Il sistema resta raggiungibile

Ogni pila ha il ripiego di piattaforma in coda
(`"Inter Variable", system-ui, -apple-system, …`), e non è ornamento: è
com'è che un motore che non carica questi quattro file — una CSP diversa, un
errore di rete impossibile ma non inconcepibile — mostra comunque del testo.
La §31.6 (*cosa è del tema e cosa della persona*) è il posto dove «uso i
caratteri del sistema» diventerà una preferenza scelta e non un ripiego
subito: da lì si arriverà scambiando il canale `caratteri`, non il token
dentro il foglio.

## La scala si allarga, e non tutta

Sei valori (`--text-xs` … `--text-xl`) restavano invariati: cambiarli è un
ridisegno di ogni componente che li spende — cinquantanove regole nella
pelle — e quello è lavoro della §31.4, non di questa voce. Toccarli ora
avrebbe voluto dire giudicare tre variabili insieme (i caratteri, la scala,
l'anatomia dei componenti) senza poter attribuire a nessuna delle tre un
effetto isolato.

Quello che la voce doveva fare — e che il vecchio elenco non faceva — era
**allargarsi con un passo dichiarato** invece di aggiungere il prossimo
numero che serve: due gradini nuovi in cima, `--text-2xl` (19px) e
`--text-3xl` (23px), un ×1,2 da `--text-xl` arrotondato al pixel. Accanto,
`--text-reading` (16px, per `--font-reading`, perché Literata non è Inter con
un altro nome), due interlinee nuove (`--leading-normal` 1,5,
`--leading-relaxed` 1,7 — prima c'era solo `--leading-tight`), e
`--content-width` (70ch, la misura di lettura: il punto in cui una riga più
lunga fa perdere il segno tornando a capo).

Sette voci nuove, e nessuna regola della pelle o della struttura le consuma
ancora — sono visibili solo nel campionario del banco
(`banco/catalogo.html?catalogo=campionario`), che questa voce ha esteso con
una terza famiglia (*Carattere di lettura*) e una sezione dedicata
(*Lettura*, che mostra `--font-reading` + `--text-reading` +
`--leading-relaxed` + `--content-width` insieme, perché nessuna riga della
scala li mostra combinati e in questo modo li userà una superficie vera).
Questo è il residuo dichiarato della voce: tocca alla §31.8 (*la stessa nota
in tre modi*) metterle sulla lettura, sull'editor e sull'anteprima insieme, e
non una alla volta — la §31.3 poteva scriverle implicite in una regola sola,
e implicite è precisamente il difetto che questa seduta cerca.

## Un `*/` dentro un commento, e il banco a pixel che non se n'è accorto da solo

Il commento di testa di `caratteri.css` citava il percorso del file di
licenza: `` `node_modules/@fontsource-variable/*/LICENSE` ``. Quell'asterisco
seguito da una barra **chiude un commento CSS**, in anticipo di undici righe:
tutto ciò che segue fino al prossimo `*/` — la spiegazione del ripiego di
sistema, la riga vuota, l'inizio della regola `@font-face` di Inter — diventa
testo fuori da un commento, e un parser tollerante lo scarta cercando di
raccapezzarsi. L'effetto: tre `@font-face` su quattro registravano
(Literata normale, Literata corsivo, JetBrains Mono), Inter no.

Il primo segnale non è stato un errore rosso da nessuna parte: è stato che
`npm run banco:aggiorna`, dopo un cambio di **tutti e tre** i caratteri
dell'app, aveva riscritto **tre** baseline su quaranta. La 0167 aveva già
misurato cosa vuol dire un banco a pixel che sottostima un cambiamento — lì
era la soglia; qui la soglia era quella giusta (0,01, misurata), e il banco ha
fatto esattamente il suo lavoro riportando *fedelmente* che la pagina non era
cambiata quasi da nessuna parte. Il difetto non stava nel banco: stava nel
fatto che il carattere di gran lunga più usato (`--font-ui`, il corpo di
tutta l'interfaccia) non si stava caricando affatto, e la pagina mostrava
ancora il ripiego di sistema — che su questa macchina rende quasi come Inter,
abbastanza da restare sotto la soglia del rumore in 37 scene su 40.

Un banco a pixel misura *differenza*, non *correttezza*: un difetto che
produce un'immagine quasi identica alla precedente è per costruzione il
genere di difetto che quel banco non vede, qualunque sia la soglia. L'ha
trovato guardare il numero — tre baseline su quaranta, quando il cambiamento
dichiarato ne toccava quaranta — e chiedersi perché, non il banco da solo.
`document.fonts` (l'API che elenca i `FontFace` registrati) ha detto in un
secondo cosa il pixel non poteva dire: `Inter Variable` non c'era.

Corretto scrivendo il percorso senza l'espressione che lo chiudeva
(`<pacchetto>` al posto di `*`), con una riga di commento accanto che dice
perché — cosicché il prossimo `/*...*/` che cita un percorso o un glob non
ripeta lo stesso errore senza saperlo.

## `catalogo.ts` non montava i caratteri

Un secondo difetto, imparentato: `banco/catalogo.ts` monta pelle e foglio a
mano (non passa da `mountTheme`, perché non ha una shell da avviare) e non
montava `caratteri` — il campionario tipografico, la scena che esiste apposta
per mostrare i tre font, li mostrava tutti col ripiego di sistema. Anche
questo il banco a pixel non l'avrebbe visto da solo per lo stesso motivo di
sopra: un ripiego che rende quasi come l'originale è un diff piccolo, non
zero, ma sotto soglia. Corretto aggiungendo `monta(caratteri, "caratteri")`
alle tre righe che già montavano pelle e foglio.

## Il confronto a pixel in CI: la condizione c'è, la prova no

La [0166](0166-il-banco-che-vede.md) aveva lasciato il confronto a pixel
cancello locale con una condizione scritta: succederà quando i caratteri
saranno in bundle, perché un browser pinnato garantisce lo stesso motore ma
non — prima di questa voce — gli stessi caratteri. La condizione è
soddisfatta.

Non è stata sufficiente per spostare la riga in questa sessione. Le baseline
di questa voce sono state scattate su una macchina che Playwright stesso non
riconosce come Ubuntu (*"your OS is not officially supported by Playwright;
downloading fallback build for ubuntu24.04-x64"*), mentre il job `frontend`
di CI gira su `ubuntu-latest` vero. Un font in bundle toglie la variabile che
la 0166 nominava — quale font — ma non garantisce da solo che il
rasterizzatore di due macchine diverse produca lo stesso bitmap fino
all'ultimo subpixel; è probabile che lo faccia (Chromium usa la propria
pipeline di font shaping per un webfont incorporato, non quella di sistema),
ma "probabile" non è la soglia con cui la 0167 ha imparato a misurare invece
di argomentare. La riga resta nella casella dichiarata ([§31.1](../roadmap/31-da-dove-viene-cio-che-si-vede.md#311-il-banco-che-vede),
in [todo.md](../todo.md#gli-allegati)) finché qualcuno non prova la parità
**da dentro** `ubuntu-latest` — un run che rigeneri le baseline lì, o un primo
tentativo che si accetta possa uscire rosso per drift ambientale.

## Le vie scartate

| Via | Forma | Scartata perché |
| --- | --- | --- |
| (a) una sola famiglia per tutti e tre i ruoli (es. IBM Plex Sans/Serif/Mono) | tre file di una famiglia sola | coerenza visiva forte, ma un font per l'interfaccia e uno per la lettura hanno bisogni diversi (x-height contro grazie per la scansione), e una famiglia unica li serve entrambi peggio di due famiglie scelte apposta |
| (b) statico per peso (dodici file, uno per peso × famiglia) | niente asse variabile | tre file bastano, e il peso lo sceglie chi consuma il token senza scaricare un secondo file |
| (c) far entrare i caratteri nel foglio, non in un canale a sé | due strati invece di tre | un tema di terzi che porti i propri caratteri dovrebbe riscrivere l'intero foglio (colori compresi) per sostituire tre righe di `font-family` |
| (d) riscrivere anche `--text-xs`…`--text-xl` per un passo uniforme su tutta la scala | una scala sola, coerente in astratto | cinquantanove regole della pelle dipendono da quei sei valori: ridisegnarli ora confonderebbe l'effetto dei caratteri con quello dei componenti, che è lavoro della §31.4 |
| (e) spostare subito il confronto a pixel in CI, visto che la condizione è soddisfatta | una riga di config | le baseline di questa sessione non sono state verificate contro `ubuntu-latest`: un primo rosso ambientale costerebbe più fiducia nel banco di quanta ne costi aspettare una prova vera |
