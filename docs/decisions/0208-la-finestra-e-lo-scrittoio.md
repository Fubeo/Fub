# 0208 — La finestra è lo Scrittoio, e la serie di serie è `theme-2`

- **Stato:** accolta
- **Data:** 2026-10-14
- **Ambito:** frontend
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

Lo Scrittoio è cresciuto accanto alla shell di prima, sulla stessa
infrastruttura: sessioni, layout, registri, editor e porte. Aveva pagine,
ingressi, scene e gemelli dei test suoi. La shell di prima restava vestita
dalla serie `theme-1` (`src/theme/serie/` e `src/theme/structure.css`).

Due shell sulla stessa infrastruttura raddoppiano scene, baseline e test legati
alle pagine. Ogni funzione nuova va scritta due volte, oppure dietro giunture
che tengono ferma la shell vecchia.

I predefiniti dell'aspetto (accento, carattere, corpo, interlinea, giustezza)
li dichiarava l'host, sui valori della serie vecchia. La serie nuova ne
dichiarava di diversi e li faceva valere lei. Chi non aveva mai scelto vedeva un
aspetto, mentre il pannello delle impostazioni e il ripristino ne dichiaravano
un altro.

## Decisione

`index.html`, `mobile.html` e `document.html` portano il markup dello
Scrittoio, e `main.ts` avvia lo Scrittoio. Non esiste un interruttore fra due
shell. La resa della shell di prima, la sua serie e il suo foglio di struttura
non fanno più parte del client.

La serie di serie è quella dello Scrittoio (`src/theme/scrittoio/`), con motore
`theme-2`. Il generatore produce da lì i derivati, la guida dell'autore e il
campione (`theme/author/`).

Un tema `theme-1` installato resta installato, e l'host lo elenca e lo
distribuisce come prima. Il client non lo monta: il catalogo dei temi lo
segnala con una diagnosi che nomina il motore, e la finestra resta vestita
dalla serie. Non c'è conversione: vale la 0206.

I predefiniti dell'aspetto dell'host sono quelli della serie: accento 265,
carattere `newsreader`, corpo 17, interlinea 1,65, giustezza 68. La serie non
li sovrascrive più.

Il banco visivo ha un solo elenco di scene. Le foto di una scena tolta se ne
vanno con lei, e le baseline arrivano solo dall'artefatto del runner.

I divisori fra cassetti e fogli sono il divisore del kit. Il cassetto sinistro
va da 208 a 400 px e l'ispettore da 248 a 440 px.

## Conseguenze

### Positive

- Le funzioni nuove si scrivono una volta, nel codice comune.
- Pannello, ripristino e finestra dichiarano lo stesso aspetto.
- Le scene e i test legati alle pagine descrivono la finestra che si avvia.

### Negative

- Chi non ha mai scelto l'aspetto vede quello nuovo. Le scelte esplicite
  restano valide.
- Un tema `theme-1` installato non veste più la finestra.
- Il banco visivo riparte senza baseline, finché il runner non le produce.

## Alternative scartate

### Due shell con un interruttore

Avrebbe lasciato a chi usa Fub la shell di prima. È stata scartata perché ogni
pagina, scena, baseline e test di confine sarebbe rimasto doppio, e ogni
funzione nuova avrebbe dovuto rispettare l'anatomia di entrambe.

### La serie fa valere i propri predefiniti

Avrebbe evitato di toccare l'host. È stata scartata perché il pannello e il
ripristino leggono i predefiniti dall'host: la finestra mostrerebbe un valore
che le impostazioni non dichiarano.

### Convertire i temi `theme-1`

Scartata per la ragione scritta nella 0206: una pelle nomina hook che nell'altra
anatomia non esistono.

## Verifica

- `apps/client/src/shells/scrittoio/mobile/mobile-html.test.ts` e
  `document/document-html.test.ts` provano le pagine; `src/shell.e2e.test.ts`
  monta `index.html` e la shell intera.
- `apps/client/src/theme/runtime.test.ts` prova che un tema `theme-1`
  installato non si monta e che la diagnosi nomina il motore.
- `crates/fub-host/src/legacy_tests/switches.rs` confronta i predefiniti
  dell'host con quelli dichiarati dalla serie.
- `apps/client/bench/scene.test.ts` prova l'elenco unico delle scene e che
  nessuna baseline resti senza la sua scena.
- `apps/client/src/kit/splitter.test.ts` prova il divisore, i limiti e il
  ritorno al predefinito.
