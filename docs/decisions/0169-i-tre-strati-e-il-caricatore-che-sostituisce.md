# 0169 — I tre strati, e il caricatore che sostituisce

**Stato**: accolta  **Data**: 2026-08-22  **Chiude**: [§29.1](../roadmap/29-chi-possiede-la-pelle.md#291-i-tre-strati-e-il-caricatore-che-sostituisce)
**Commit**: *(questo commit)*

---

## La domanda

§29.1 chiedeva di verificare lo split fra struttura, foglio e pelle, e che il
caricatore potesse cambiare tema senza lasciare due fogli in gara. La domanda
rimasta aperta era il confine fra foglio e struttura: la scala di spazi e raggi
va al foglio con un pavimento minimo; le metriche della scocca restano alla
struttura.

## Cosa c'era già, dalle 0166, 0167 e 0168

La [0166](0166-il-banco-che-vede.md) aveva reso il banco capace di osservare
la superficie reale e di contare il DOM; la [0167](0167-un-colore-ha-una-ricetta.md)
aveva portato i colori nella ricetta deterministica OKLCH, togliendo ai
presidi la scorciatoia di riconoscere un foglio dal colore di fondo; la
[0168](0168-tre-voci-in-bundle-un-canale-in-piu.md) aveva completato i caratteri
in bundle e il terzo canale, dichiarando l'ordine `caratteri, foglio, pelle`.
Il caricatore, `theme/loader.ts`, aveva già la sostituzione per canale,
`ORDER` e `count`; `theme/theme.ts` risolveva la luce e montava solo il foglio
corrispondente. Questa chiusura non riapre quei contratti e non decide §29.2,
§29.3 o §29.4.

## Le tre voci, verificate

La struttura è `theme/structure.css`, importata da `main.ts`: contiene la
geometria della shell, i piani e le garanzie invarianti. Il foglio generato è
`theme/serie/sheet-{dark,light}.css`: ruoli, tipografia e moto. La pelle è
`theme/serie/skin.css`, composta dai suoi pezzi e priva di dichiarazioni di
custom property. Questo è lo split semantico in tre padri della §29.1; nel
tema, il caricatore espone i tre canali `caratteri`, `foglio`, `pelle`, con
`fonts.css` come fascio separato per rendere reali le famiglie tipografiche
dichiarate dal foglio. Ogni canale porta `data-fub`, rimuove prima l'elemento
precedente e reinserisce il nuovo secondo `ORDER`, quindi non c'è cascata fra
temi.

`theme/theme.ts` risolve `light` o `dark` (la scelta vuota segue il sistema),
poi monta un solo foglio concreto nello stesso caricatore. Nessun foglio
contiene `@media (prefers-color-scheme)` né selettori `[data-theme]`: il
`data-theme` della radice resta un segnale per chi dipinge fuori dal CSS, non
un secondo selettore di tema.

Il banco in `theme/loader.test.ts` prova sia la sostituzione diretta sia il
caso richiesto: `mountTheme` con `light`, poi con `dark`, lascia
`count("foglio") === 1` e contiene il secondo foglio; conta inoltre un solo
`pelle` e un solo `caratteri`, e verifica l'ordine dei tre canali anche quando
le chiamate arrivano in ordine inverso.

## Il confine: scala al foglio, pavimento alla carta, scocca alla struttura

La decisione proposta dalla roadmap è ora effettiva. `recipe.ts` dichiara e
genera per entrambe le luci `--space-1`…`--space-10` e
`--radius-xs`…`--radius-pill`, con valori non-colore identici nei due gemelli.
Il pavimento della scala è `--doc-bg`: zero passi, nero al buio e bianco in
luce; il foglio genera da quel fondo il resto della scala. La struttura non
ridichiara la scala e non ne dipende per la geometria: mantiene solo
`--titlebar-h` e `--rail-w` fra le metriche della scocca, oltre ai sei piani.
Le regole della struttura che vestono l'anello continuano a consumare i token
del foglio già garantiti dal caricatore; la pelle consuma la scala senza
possederla.

Il conto è misurato con
`sed -n '/^[[:space:]]*--[[:alnum:]-]*[[:space:]]*:/p' FILE | wc -l`:
`structure.css` dichiara **8** token (2 metriche + 6 piani), ciascun foglio
**101**, `skin.css` **0** e `fonts.css` **0**. Il gemello della luce non è un
override: la ricetta emette due file completi con lo stesso vocabolario, e
`structure.test.ts` verifica i nomi e i non-colori.

## Generazione e presidi

`npm run theme:verify` passa: `sheet-dark.css` e `sheet-light.css` sono uguali
alla ricetta, e `skin.css` è uguale ai suoi pezzi. I presidi mirati passano:
`npx vitest run src/theme/loader.test.ts src/theme/structure.test.ts
src/theme/recipe.test.ts src/theme/theme.test.ts` → **4 file, 37 test**.
La chiusura quindi aggiunge la decisione documentata del confine e il
consuntivo verificabile; non aggiunge API pubbliche, bundle o cancelli delle
voci successive.

## Le vie scartate

| Via | Forma | Scartata perché |
| --- | --- | --- |
| lasciare spazi e raggi nella struttura | custom property invarianti in `structure.css` | la densità è proprietà del foglio; un tema compatto/rilassato deve poter sostituire la scala senza muovere la geometria della finestra |
| duplicare la scala nei due fogli a mano | due elenchi CSS mantenuti separatamente | la ricetta è la sorgente unica e `theme:verify` impedisce che i byte derivati divergano |
| lasciare i due temi impilati con `data-theme` o cascata | foglio scuro e chiaro simultaneamente | crea una gara di specificità e rende il vincitore dipendente dall'ordine; la sostituzione garantisce un foglio attivo |
| decidere qui il manifest dei temi o i cancelli | contratto §29.2/§29.3 e bundle §29.4 | sono voci successive, non prerequisiti da inventare nella chiusura dello split |
