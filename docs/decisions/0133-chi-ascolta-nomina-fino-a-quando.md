# 0133 — Chi ascolta nomina fino a quando

**Stato**: accolta
**Data**: 2026-08-06
**Chiude**: i difetti misurati **0016**, **0024** e **0083**, che sono la stessa
frase; e la seconda zona cieca lasciata scritta dalla
[0125](0125-un-albero-riusato-riceve-una-porta-non-un-handler.md) — *«nessun
attore vede un `addEventListener` scritto a mano»*
**Commit**: *(questo commit)*

---

## La frase, che era una sola scritta quattro volte

Tre righe della tabella dei difetti misurati dicevano cose diverse:

- **0016** — `onLingua` non torna una funzione di disiscrizione;
- **0024** — il listener `click` di `showContextMenu` resta appeso se il menu si
  chiude con Escape;
- **0083** — `pickIcon` rimuove il nodo senza chiamare `chiudi()`: listener e
  trappola del fuoco restano appesi.

Sono tre sintomi di una domanda che il codice non obbligava nessuno a farsi:
**fino a quando vive questo ascoltatore?** Chiuderli uno per uno voleva dire
scrivere tre volte la stessa promessa — *ricordati il gemello* — e lasciarla da
riscrivere al quarto posto. Questo repo la specie l'aveva già chiusa due volte,
su due lati: la [0125](0125-un-albero-riusato-riceve-una-porta-non-un-handler.md)
sul lato azioni (una `Porta` invece di un handler) e la
[0079](0079-il-grafo-esce-dall-overlay.md) sul lato DOM. Il terzo lato — gli
ascoltatori globali e i registri di modulo — non l'aveva chiuso nessuno.

## Il conto vero: erano sei, più due che tornavano già come si smette

Non quattro. Cercando chi registra su un bersaglio che vive quanto la pagina, i
siti misurati in `frontend/src/` sono **sei**:

| dove | cosa | mordeva? |
|---|---|---|
| `ui/menu.ts` · `showContextMenu` | `document` · `click` (dentro un `setTimeout`) | **sì** (0024) |
| `ui/menu.ts` · `pickIcon` | `document` · `mousedown`, in cattura | **sì** (0083) |
| `ui/a11y.ts` · `intrappolaFuoco` | `document` · `keydown`, in cattura | no: tornava già lo scioglimento |
| `ui/keyboard.ts` · `mountKeyboard` | `document` · `keydown` | no: montato una volta |
| `state/locale.ts` · `mountLocale` | `window` · `focus` | no: montato una volta |
| `theme/theme.ts` · `mountTheme` | `matchMedia` · `change` | no: montato una volta |

E i registri di modulo — chi espone `onQualcosa(cb)` e tiene una lista — sono
**quattro**: `onLingua` (0016), `onEvent` e `onAnyEvent` in `state/kernel.ts`,
`on` in `state/store.ts`. Più uno che il difetto non ce l'ha e serve da
precedente: `onKernelEvent` in `host/ipc.ts` **torna già** come smettere.

Dieci posti, di cui la tabella ne nominava tre. Il conto è la parte che ha
deciso la forma: con tre, riparare tre volte era difendibile; con dieci, no.

## La decisione: non si registra senza nominare un padrone

`frontend/src/ui/vita.ts` — una `Vita`, che è chi possiede un insieme di
ascolti. Si apre con `apriVita()`, si chiude una volta sola, e ha tre cose:
`ascolta(bersaglio, tipo, ascoltatore, opzioni)`, `aggiungi(smontaggio)` per
ciò che qualcun altro ha prodotto (la trappola del fuoco, un `onLingua`, la
rimozione di un nodo), e `chiudi()`.

Il punto non è che `ascolta` faccia qualcosa di speciale — fa
`addEventListener` e si ricorda il gemello. Il punto è che **è un metodo**:
non lo si chiama senza avere in mano l'oggetto che sa anche smettere. È la
stessa mossa della `Porta`, un piano più in là: là ciò che circolava nel
riconciliatore non era un handler ma un rinvio, qui ciò che si passa a chi
ascolta non è un bersaglio ma una vita.

La forma alternativa, e il motivo per cui è stata scartata: **far tornare a ogni
`onQualcosa` una funzione di disiscrizione** e fermarsi lì. È ciò che la riga
0016 chiedeva alla lettera, funziona, ed è il modo in cui `onKernelEvent` è già
scritto. Non basta per due ragioni. La prima è che TypeScript non ha un
*must-use*: un valore di ritorno ignorato non è un errore, quindi la promessa
resta da ricordarsi — spostata dal `removeEventListener` al `const smonta =`.
La seconda è che non copre il caso peggiore dei tre, il 0024, dove **non c'è
nessun chiamante da istruire**: chi registra e chi dovrebbe disiscriversi sono
la stessa funzione, un istante dopo.

Le due si compongono, e così sono state prese: `onLingua` torna uno
`Smontaggio` (il tipo di `vita.ts`), e chi ha una `Vita` scrive
`vita.aggiungi(onLingua(ridisegna))`. Chi non ce l'ha lo ignora, ed è corretto —
vedi sotto.

### Le tre conseguenze

1. **`Vita` è una classe con un metodo, non un tipo marchiato.** Nella 0125
   `Porta` è un `unique symbol` mai costruito perché lì esisteva un sostituto
   nudo credibile — un `ActionHandler` normale — che andava reso inesprimibile.
   Qui il sostituto nudo è `document.addEventListener`, che non è nostro e non
   si può marchiare: un simbolo su `Vita` non avrebbe fermato niente che il
   parametro obbligatorio non fermi già. **Un marchio che non toglie una strada
   è decorazione**, e questa è la stessa misura per cui nella 0125 il marchio
   invece serviva.
2. **Una vita chiusa è inerte.** `ascolta` su una vita chiusa non registra, e
   `aggiungi` esegue subito ciò che riceve. Non è una comodità: **è la
   riparazione del 0024**. Là il `document.addEventListener` arrivava da un
   `setTimeout(…, 0)` — il ritardo esiste perché il click che *apre* il menu non
   lo chiuda — e se il menu si chiudeva prima che il timer scattasse (Escape,
   o una voce scelta col ritorno a capo) l'ascoltatore si attaccava un istante
   dopo a un menu che non c'era più. Il `once: true` non serviva a niente:
   restava lì fino al primo click qualunque, e se nel frattempo se n'era aperto
   un altro chiudeva quello. Con la vita, quel ramo non è un caso da gestire:
   non esiste.
3. **`chiudi()` disfa in ordine inverso, e uno sbaglio non ferma gli altri.**
   L'inverso è l'ordine di costruzione letto a ritroso, l'unico in cui uno
   smontaggio non gira in un mondo che un altro ha già smontato a metà: in
   `a11y.ts` è ciò che fa tornare il fuoco **dopo** che la trappola è stata
   staccata. Che uno sbaglio non fermi gli altri è la regola del §20.3 già viva
   in `state/store.ts` e `state/kernel.ts` — metà pulizia saltata sarebbe
   esattamente il difetto che questa classe esiste per non avere, e sarebbe
   invisibile.

## Le premesse che erano false

**«0024 e 0083 sono due difetti»: falso, ed è per questo che si chiudono con una
riparazione sola.** Stanno a un centinaio di righe di distanza nello stesso file
e hanno la stessa causa: tre cose da disfare — il nodo, l'ascoltatore su
`document`, la trappola del fuoco — scritte in tre posti diversi, ognuna con la
sua occasione di essere dimenticata. `showContextMenu` ne dimenticava una,
`pickIcon` ne dimenticava due, e nessuno dei due sbagliava per distrazione:
sbagliavano perché non c'era un posto in cui l'elenco fosse uno. Adesso il posto
è la `Vita`, e chiudere una finestrella è chiuderla.

**«`onLingua` non torna una funzione di disiscrizione»: vero, e non morde.** I
quattro chiamanti — il centro attività, il titolo dello spazio nell'esplora, la
riga di salvataggio del pannello documento, il pulsante degli avvisi — sono
superfici montate una volta che vivono quanto la finestra, e nessuna finisce.
Il difetto è del **secondo chiamante**, che sarà un pannello: ogni montaggio
lascerebbe la sua iscrizione nella lista, e alla terza apertura un cambio di
lingua ridisegnerebbe tre volte, due delle quali su superfici che non ci sono
più. La riga si toglie lo stesso, e la riparazione è la stessa: cambia solo che
i quattro chiamanti di oggi restano identici.

**«sei ascoltatori globali, tutti da riparare»: falso per quattro.**
`intrappolaFuoco` tornava già lo scioglimento; i tre `mount*` del tema, del
locale e della tastiera sono chiamati una volta da `main.ts` e vivono quanto la
pagina — è la stessa cosa che `state/store.ts` dichiara di sé da tempo (*«i
moduli della shell vivono quanto la finestra, e un `off()` che nessuno chiama è
solo una firma in più da spiegare»*). Sono passati per la porta lo stesso, e
non per uniformità: perché il conto qui sotto non ha eccezioni, e un'eccezione
per quattro casi «tanto vanno bene» è la prima riga del prossimo difetto. La
loro `Vita` è `vitaFinestra` in `main.ts`, che nessuno chiude, e la riga che lo
dice sta lì.

**Ciò che è restato fuori, e la ragione.** I quattro registri di modulo
(`onEvent`, `onAnyEvent`, `store.on`, `onLingua`) potevano prendere una `Vita`
come parametro obbligatorio: sarebbe stato «impossibile» invece di
«possibile». Sono ventotto chiamanti, tutti app-lifetime, che avrebbero scritto
tutti la stessa vita globale — cioè la regola scritta **nei chiamanti**, che è
il contrario del criterio. E contraddirebbe una decisione già scritta e datata
in `store.ts`, che nomina il §9.4 come il momento in cui quella riga cambia.
Quando arriveranno i pannelli smontabili, il posto è uno e la `Vita` esiste già.

## Il rosso

**Il conto** — `.github/scripts/check-ascoltatori.mjs` — cerca
`document`/`window`/`globalThis`/`document.body` seguiti da `addEventListener`,
e `matchMedia(…).addEventListener`, in tutto `frontend/src/` tranne i banchi e
tranne la porta. Provato rosso **sei volte, una per sito**, rimettendo ogni riga
com'era e guardando l'uscita: sei violazioni distinte, sei uscite a 1. Le zone
cieche sono dichiarate nel commento in testa allo script — l'alias (`const d =
document`), un `EventTarget` passato da fuori, gli elementi (voluto: quell'
ascoltatore muore col nodo, ed è il lato che la 0079 ha già chiuso), i banchi.
Ciò che il conto **non** dice, e non deve: che ogni `addEventListener` abbia un
`removeEventListener` gemello. Quella è la promessa ripetuta, cioè la cosa da
cui si sta scappando — contarne le occorrenze farebbe passare per verde chi ne
scrive due e ne chiama uno.

**I banchi** — `ui/vita.test.ts`, `ui/menu.test.ts`, `i18n/onlingua.test.ts`,
quindici casi. Ognuno provato rosso rompendo apposta ciò che difende: `chiudi`
che non stacca, `ascolta` che registra anche da chiusa, `aggiungi` che non
esegue su una vita chiusa, l'ordine diretto invece che inverso, uno smontaggio
che sbaglia e ferma gli altri; le tre righe del menu rimesse com'erano prima
(il `document.addEventListener` nel `setTimeout`, il
`getElementById("icon-picker")?.remove()`, la trappola non affidata alla vita);
`onLingua` che torna uno smontaggio che non smonta, uno `splice` sull'indice
sbagliato, `rileggi` che itera la lista viva. Nessuna prova aspetta: si emette
l'evento e si guarda chi risponde.

La spia per «la trappola del fuoco non c'è più» è `defaultPrevented` su un Tab —
la trappola *mangia* il tasto, quindi un Tab che passa è un Tab che nessuno ha
intercettato. È la forma scrivibile in `happy-dom`, dove il layout non esiste
(buco n. 5 della [0112](0112-un-e2e-contro-un-host-finto-prova-il-cablaggio.md)) e quindi non si può guardare dove
il fuoco sia finito.

### Due presidi che NON sono diventati rossi, ed è l'informazione migliore

**Il primo è stato cancellato.** *«Le opzioni tornano identiche allo
smontaggio»* era scritto, passava, e sarebbe passato **anche togliendo
`opzioni` dal `removeEventListener`**: `happy-dom` stacca un ascoltatore in
cattura anche se glielo si chiede senza la fase. In un browser vero sarebbe
stato rosso — e la proprietà non è teorica, la trappola del fuoco e il selettore
di icona ascoltano tutti e due in cattura, e un `removeEventListener` che perde
il `capture` non toglie niente e non lo dice. La prova è stata tolta e al suo
posto c'è la riga che dice perché: la proprietà la tiene **la forma** di
`ascolta`, una variabile letta due volte, che è il verso che il compilatore ha
già. È la mossa della 0125, dove un presidio è stato scritto e poi cancellato
per la stessa ragione — e la regola sotto è che *un presidio che passerebbe
comunque è peggio di nessun presidio*, perché occupa il posto di quello vero.

**Il secondo ha cambiato il codice invece del banco.** *«Chiudere due volte
disfa una volta sola»* non diventava rosso togliendo il
`if (this.#chiusa) return` in testa a `chiudi()`, **né** togliendo lo svuotamento
della lista: ce n'erano due, di difese, e ognuna copriva l'altra. Una proprietà
vera due volte non è presidiata da niente — nessun banco può diventare rosso
togliendone una. La guardia in testa è stata tolta: lo svuotamento serve
comunque (una vita chiusa che tenesse i suoi smontaggi terrebbe in vita ciò che
hanno catturato), è l'unico meccanismo rimasto, e adesso togliendolo il caso
diventa rosso.

## Cosa resta scoperto

**Il 0029** — il wrapper dell'editor non espone `EditorView.destroy` — è la
stessa famiglia e si chiude nel commit accanto: è un ciclo di vita, ma il pezzo
che perde non è un ascoltatore su `document`, è un `EditorView` intero, e la
riparazione è un metodo sul suo tipo e non una `Vita`.

**I quattro registri di modulo** restano senza disiscrizione tranne `onLingua`,
per la ragione scritta sopra, e il posto in cui cambieranno è uno.

**Il conto non guarda `setTimeout`/`setInterval`/`ResizeObserver`.** Sono la
stessa specie — una cosa che continua senza che nessuno la possieda — e una
`Vita` li terrebbe con lo stesso `aggiungi`. Non è stato fatto perché non è
stato *misurato*: nessuno dei difetti aperti li nomina, e un presidio scritto su
un difetto che non si è visto è un presidio che si taglia su misura del primo
falso positivo.
