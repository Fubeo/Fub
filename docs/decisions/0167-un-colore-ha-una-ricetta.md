# 0167 — Un colore ha una ricetta, e il presidio che non la vedeva

**Stato**: accolta **Data**: 2026-08-19 **Chiude**: [§31.2](../roadmap/31-da-dove-viene-cio-che-si-vede.md)
**Commit**: *(questo commit)*

---

## La domanda

I due fogli di serie portavano novanta valori di colore, quarantacinque per
luce, e **nessuno di essi era derivabile**: erano stati scelti, poi verificati, e
quando la verifica diceva no erano stati spostati a mano finché diceva sì. Il
presidio del contrasto è nato così, e ha fatto il suo lavoro: ferma il rosso. Non
produce il bello, e soprattutto non produce il **secondo** tema — l'alto
contrasto della §31.7 e l'accento della persona della §31.6 sono due tavolozze in
più, e con novanta valori scelti a mano sono novanta scelte in più, ciascuna da
difendere di nuovo.

La domanda della voce era quindi: **da dove viene un colore?** E la forma della
risposta è quella della
[0072](0072-un-numero-si-scrive-accanto-a-come-si-ricava.md) presa alla lettera —
*il numero si scrive accanto a come si ricava* —, dove qui il «come» è una
funzione.

## Cosa si dichiara, e cosa si trova

**La ricetta dichiara di ogni inchiostro tre cose e non la sua chiarezza**: la
tinta, il croma, e la coppia «sopra cosa sta / quanto deve reggere». La chiarezza
la **cerca** la generazione, con una bisezione, ed è precisamente il valore che
prima si spostava a mano.

Il rovescio della medaglia è la parte che vale: `sopra` è un elenco, quindi un
inchiostro non regge «sul fondo» ma su **tutti** i fondi su cui finisce davvero,
e la generazione prende la chiarezza che serve al più difficile. Le tre
riparazioni che la [0166](0166-il-banco-che-vede.md) aveva trovato misurando la
pagina resa sono cadute da questa riga sola, e sono cadute *prima* che qualcuno
andasse a ripararle.

Le altre forme di voce sono cinque, e ciascuna esiste perché una domanda diversa:

- il **gradino**, che dichiara quanti passi sta sopra la carta e nient'altro;
- il **controcolore**, che non si sceglie — è il nero o il bianco, quello dei due
  che regge di più sul pieno che deve portare;
- il **velo**, che è un altro ruolo in trasparenza e non si può ridurre a un
  pieno perché sta sopra fondi diversi;
- l'**eco**, lo stesso valore detto due volte perché sono due domande diverse
  (`--syn-heading` e `--doc-heading` sono «di che colore è il titolo che il
  parser ha marcato» e «di che colore è un `<h1>` reso»): non è un alias in CSS,
  il foglio scrive il valore due volte, così chi ridefinisce l'uno non muove
  l'altro senza accorgersene;
- il **letterale**, per ciò che non si ricava da niente — uno spazio, una durata,
  un'ombra.

## OKLCH, e la sola decisione dell'aritmetica

La sorgente è OKLCH e non HSL, e non è una preferenza: in HSL `hsl(60 100% 50%)`
e `hsl(240 100% 50%)` hanno la stessa `L`, e uno dei due è quasi bianco e l'altro
quasi nero. Costruire una scala di superfici muovendo `L` in HSL dà gradini che
si vedono in una tinta e spariscono in un'altra. OKLab è percettivamente
uniforme, ed è la sola proprietà che rende **scrivibile** la frase «una distanza
minima fra due gradini adiacenti».

La conversione sta in `frontend/src/theme/oklch.ts` e non in una dipendenza
perché ha due clienti che non possono divergere: la generazione dei fogli, che
gira una volta e produce testo committato, e la shell, che con la §31.6 deriverà
l'accento della persona **a runtime**. Due implementazioni vorrebbero dire un
accento scelto dall'utente che non è più lo stesso colore che la stessa ricetta
produce nel foglio.

L'unica decisione dentro quel file è il **gamut**: OKLCH descrive più colori di
quanti sRGB ne mostri, e chi converte deve scegliere. Tagliare i canali a [0,1] è
una riga ed è sbagliato — taglia i tre canali indipendentemente, quindi sposta la
tinta *e* la chiarezza insieme, e la chiarezza è esattamente ciò su cui si stanno
costruendo i gradini. Si abbassa il croma con una bisezione, tenendo `l` e `h`
fermi: è la scelta della CSS Color 4, meno il ritocco finale in ΔE che qui non
serve.

Tutte e due le bisezioni — quella del croma e quella della chiarezza — fanno un
numero **fisso** di giri, venti e trentadue, e non «finché converge». Un derivato
che cambia da solo al variare dell'ordine delle operazioni in virgola mobile non
è un derivato: è un file che qualcuno deve ricommittare ogni tanto.

## Due misure per luce, e il difetto che l'ha insegnato

La prima corsa della generazione ha prodotto i primi tre gradini della luce scura
tutti `#000000`.

Non era un errore di conto: sotto la carta nera **lo spazio a otto bit
finisce**. Per un grigio in OKLab vale `L = Y^(1/3)`, quindi a `L` 0,034 la
luminanza è quattro centomillesimi, e in sRGB quel valore è il codice zero.
Vicino al bianco succede l'opposto — un codice solo copre una frazione di gradino
percettivo — e infatti in luce si cammina benissimo. Non è un difetto di OKLab: è
la densità della codifica, e la ricetta la deve **sapere**.

Quindi una luce dichiara due misure e non una: lo **stacco**, che è il primo
gradino — quello con cui si esce dalla carta —, e il **passo**, che è ogni
gradino dopo. Al buio lo stacco è quattro volte il passo perché deve attraversare
la zona in cui i codici non ci sono; in luce sono lo stesso numero, e dirlo due
volte è il modo di dire che lì la differenza non serve.

C'è un corollario sul presidio. La distanza fra due gradini si misura in
**chiarezza percettiva** e non in rapporto di contrasto: il rapporto della WCAG
ha un `+0,05` al denominatore che vicino al nero domina tutto, e due superfici
scure ben distinte danno 1,03:1. È il righello con cui era stato scritto, nel
conto della seduta, che le superfici stavano «a 1,06:1 dal fondo» — vero e
inutile. In OKLab un gradino è un gradino.

## La famiglia, che è la forma che mancava

Le dieci specie di sintassi erano il debito dichiarato del tema: sette sotto la
soglia del testo in luce chiara, con una ragione scritta e buona — sono One Dark
e One Light presi **interi**, e ritoccarne i colori uno alla volta per portarli a
4,5:1 lascia una tavolozza che non è più nessuna delle due, scelta un colore per
volta da chi passava di lì.

La ricetta scioglie il nodo togliendo la premessa invece di aggirarla, e la cosa
che le serviva è la **famiglia**: più specie condividono **una** chiarezza, e la
chiarezza è quella che serve alla specie più difficile. Costa qualche punto di
contrasto a chi ne avrebbe avuto bisogno di meno, e in cambio la tavolozza si
vede *come una tavolozza* — che è esattamente il difetto per cui dieci colori
scelti uno per volta non lo sono, e la ragione per cui prenderli in coppia da
qualcun altro sembrava l'unica strada.

Le tinte non sono inventate: sono misurate su quelle di One Dark, con `daEsa()`,
che è il verso opposto della conversione e serve a dire *dove stava* un colore
scelto a mano. Il che vale anche per i neutri — 285°, che è dove stavano già
tutti e sei i grigi scelti uno per uno, fra 285,4° e 286,4°. **Chi li ha scelti
ha scelto ogni volta la stessa direzione senza avere un posto in cui dirlo.**

`--doc-heading` entra nella famiglia della sintassi, e non è una comodità: è il
parser a marcare i titoli, e `--syn-heading` li ripete. Tenerlo fuori vorrebbe
dire un titolo che, dentro un blocco di codice, si vede più chiaro o più scuro
delle parole intorno.

## Due pretese che si escludevano, e una era immaginaria

Il foglio scritto a mano diceva dell'anello del fuoco: «deve reggere sopra
l'accento stesso — un pulsante primario che prende il fuoco lo mostra su fondo
accento». Chiesto quel conto alla generazione, **non esiste nessuna chiarezza che
lo soddisfi**: al buio allontanarsi dal fondo avvicina all'accento, che è la cosa
più chiara dello schermo.

La frase era falsa, e la tabella delle coppie non l'aveva mai verificata:
l'anello si disegna con `outline-offset`, cioè un pixel **fuori** dall'elemento,
quindi il suo fondo è la superficie intorno e mai il pieno che circonda. È
l'offset a rendere vera la frase — ed è il motivo per cui le due misure viaggiano
col colore invece di stare nella scocca: senza offset, l'anello di un bottone
primario sarebbe lime su lime.

Una ricetta rende impossibile portarsi dietro una pretesa contraddittoria senza
accorgersene: la generazione si ferma e dice quale.

## La generazione passa da Vite

`node tema/genera.mjs` apre un server Vite in `middlewareMode` e carica la
ricetta con `ssrLoadModule`. Il motivo è che la ricetta è codice della shell, e
il codice della shell importa come importa la shell — `../contrasto`, senza
estensione, come tutti gli altri duecento import di `src/`. Node quel nome non lo
risolve, e farglielo risolvere vorrebbe dire scrivere `../contrasto.ts` in un
file di produzione per far contento uno script: la coda che muove il cane, e la
stessa mossa che il banco visivo della 0166 ha già rifiutato una volta. **Si
carica la cosa vera attraverso lo strumento che la sa caricare.**

Il prezzo è un secondo di avvio. Il ricavo è che la ricetta resta un modulo che
la §31.6 potrà importare nella webview senza toccarne un carattere.

## I presidi, e cosa hanno dovuto smettere di dire

Il presidio che conta è uno: **rigenerare dà gli stessi byte**. È ciò che rende
la ricetta la sorgente e i due fogli un derivato; senza, sono tre file che si
somigliano, e il giorno in cui qualcuno ritocca un esadecimale a mano — con
ragione, magari — la ricetta racconta un tema che non esiste. Sta in
`ricetta.test.ts` e non solo in `tema/genera.mjs --verifica` perché quello gira
dentro `npm test`, cioè nel cancello che tutti attraversano.

Gli altri tre guardano proprietà e non valori: la scala sale sempre nello stesso
verso, ogni pieno ha un controcolore che regge la soglia del testo, e il
vocabolario cresce **solo per aggiunta** — un ruolo nuovo passa, un ruolo sparito
o rinominato è rosso, perché è la sola operazione che rompe ogni tema di terzi
già scritto.

E tre presidi che c'erano hanno dovuto smettere di dire una cosa: `--bg` non è
più un sentinella. `contrast.test.ts`, `loader.test.ts` e `struttura.test.ts`
riconoscevano il foglio montato da `--bg: #000000` e `--bg: #f7f7f9`, che adesso
sono valori **ricavati**: pinnarli avrebbe fatto diventare rosso il presidio del
caricatore il giorno in cui cambia il passo della scala, cioè per una ragione che
col montare un foglio non c'entra niente. Al loro posto ci sono le due cose che i
fogli **dichiarano**: `color-scheme`, e la carta, che nella ricetta è l'estremo
(0 al buio, 1 in luce) e non un gradino.

`SOTTO_AA` non è andato a zero: è **sparito**. Un elenco di esenzioni vuoto non
presidia niente, e al suo posto c'è la soglia chiesta a tutte e dieci le specie
su tutti e tre i fondi della carta — che è più di quello che l'elenco proteggeva.

## Il difetto peggiore stava fuori dalla voce, per la quarta volta

Il debito dichiarato di `banco/a11y.mjs` — le cinque coppie che il contrasto
**reso** aveva trovato sotto la soglia — è diventato rosso su tutte e cinque:
riparate. Due le ha pagate la famiglia della sintassi, tre il fatto che `sopra`
sia un elenco (i tre fondi della carta), che una mira sia un numero (i titoli
dal terzo livello in giù), e che un velo si possa **comporre** sul fondo prima di
misurarlo (`doc-bg+doc-fill`). Il lucchetto a due versi della 0166 ha funzionato
nel verso che di solito non serve: *questo difetto non c'è più, toglilo dal
muro*.

Il confronto a pixel, invece, non ha visto niente. Alla tavolozza nuova — a
**tutti** i colori del tema cambiati — ha detto verde su **venti scene su
quaranta**, `catalogo-tavolozza` compresa, che è la scena che i colori li mostra
uno per uno.

La causa è la forma della soglia di `pixelmatch`, che non è quella che il nome
suggerisce: internamente il confronto è `delta > 35215 · soglia²` con `delta` la
distanza YIQ **al quadrato**. A `soglia` 0,1 — il default della libreria, preso
per tale — la tolleranza è 352 su 35215, cioè una differenza di luminanza di
circa 26 livelli su 255. Sotto quel muro ci sta un intero cambio di tavolozza.

Misurato, venti scene in due luci:

| | soglia 0,01 | soglia 0,1 |
|---|---|---|
| rumore (due corse della stessa tavolozza, scena peggiore) | 0,003% dei pixel | 0,001% |
| segnale (tavolozza vecchia contro nuova, scena peggiore) | 99,3% | **0,4%** |

Il cancello è a un millesimo dei pixel. A 0,1 il segnale gli passa sotto; a 0,01
ci sta quattromila volte sopra, e il rumore trenta volte sotto. La soglia adesso
è 0,01, e in `banco/foto.mjs` accanto ai due numeri c'è la misura invece del
ragionamento che c'era — «un colore cambiato muove decine di migliaia di pixel»,
che era plausibile e falso.

Vale la pena dire quale dei due presidi ha trovato il difetto dell'altro: **il
debito dichiarato**. Un presidio che elenca per nome i difetti che si aspetta si
accorge di essere migliorato; uno che confronta immagini con una soglia troppo
larga, no. È la stessa lezione della 0166 vista dall'altra parte, ed è la quarta
volta in questa milestone che il difetto peggiore di una voce sta **fuori** dalla
voce.

## Le vie scartate

| Via | Forma | Scartata perché |
| --- | --- | --- |
| (a) hex a mano, difesi dal presidio | è com'era | il presidio ferma il rosso e non produce il bello; e ogni tavolozza nuova ripaga lo stesso prezzo |
| (b) `oklch()` vivo nel CSS | nessuna generazione | i tre presidi parsano esadecimali, e il valore reso dipenderebbe dal motore: si perde il conto del contrasto proprio dove serve |
| (c) tagliare i canali fuori gamut | una riga invece di una bisezione | sposta tinta *e* chiarezza insieme, e la chiarezza è ciò su cui si costruiscono i gradini |
| (d) una dipendenza per la conversione | niente aritmetica in casa | due clienti che non possono divergere — il foglio e l'accento della persona (§31.6) |
| (e) bisezione «finché converge» | qualche giro in meno | rigenerare non darebbe più gli stessi byte, e il derivato smetterebbe di essere un derivato |
| (f) `SOTTO_AA` a zero invece che tolto | il presidio resta com'era | un elenco di esenzioni vuoto è una macchina che gira a vuoto: la soglia chiesta a tutti dice di più |
| (g) ritoccare le dieci specie di sintassi una alla volta | nessuna famiglia | è l'operazione che prenderle in coppia serviva a evitare, e lascia una tavolozza che non è nessuna delle due |
| (h) abbassare il cancello del banco a pixel invece della soglia del colore | un numero solo da toccare | il cancello contava i pixel giusti; era il *confronto* a non vedere. Abbassare l'uno per compensare l'altra è indebolire un presidio che funziona |
