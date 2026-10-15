# Disegni, raccolte di forme

> **Per chi:** chi disegna schemi, diagrammi di flusso, fumetti o esercizi di
> scuola, e vuole una forma pronta invece di costruirla.
> **Risultato:** sapere che cosa offre il pannello «Forme», come si cerca una
> forma, come entra nel disegno col clic, con la tastiera o trascinandola, e
> come la scrive il file.

Dal [livello Standard](drawing.md#il-livello-standard) la barra di un
[disegno](drawing.md) ha il pulsante **«Forme»**, nel gruppo «Vista» dopo
«Tavole»: apre accanto al foglio, con gli altri pannelli aperti, le
**raccolte di forme**, e gli porta il fuoco; di nuovo, lo chiude. Una forma
del pannello è un oggetto come uno disegnato a mano: entra al centro di ciò
che si vede, o dove la si lascia, ed è subito scelta, pronta per essere
spostata, ridimensionata o colorata. Le raccolte sono in
`apps/client/src/editors/spatial/tools/shape-library.ts`, il pannello in
`library-panel.ts` e la scrittura nel disegno in `library-insert.ts`, accanto.

## Le raccolte

Sono cinquantuno forme, in cinque raccolte che restano sempre nello stesso
ordine, ognuna col suo titolo e la sua griglia di riquadri con l'anteprima:

| Raccolta | Forme |
| --- | --- |
| Forme di base | rettangolo, rettangolo arrotondato, ellisse, cerchio, triangolo, triangolo rettangolo, rombo, parallelogramma, trapezio, pentagono, esagono, ottagono, stella, croce, cuore |
| Diagrammi di flusso | processo, processo alternativo, decisione, dati, processo predefinito, memoria interna, documento, più documenti, inizio o fine, preparazione, input manuale, operazione manuale, riferimento nella pagina, riferimento a un'altra pagina, ritardo, database |
| Fumetti e richiami | fumetto rettangolare, arrotondato e ovale, nuvoletta del pensiero, nuvola, esplosione |
| Frecce piene | destra, sinistra, su, giù, sinistra e destra, su e giù, a quattro direzioni, gallone, pentagono a freccia, inversione a U |
| Scuola | assi cartesiani, retta dei numeri, foglio a quadretti, foglio a righe |

Ogni forma ha la sua **misura naturale**, quella con cui entra: un rettangolo
di 160 × 100, un cerchio di 100 × 100, gli assi cartesiani di 400 × 400. La
misura è quella della scena, qualunque sia lo zoom: inserita con la vista al
200%, la forma misura 160 × 100 e sullo schermo ne occupa 320 × 200. Se il
livello che la riceve ha una scala, la forma ne è divisa, e sul foglio
arriva alla stessa misura.

- **Il contorno** ha il colore e lo spessore della barra, senza riempimento,
  come le forme degli strumenti; i segni di servizio, come le tacche e le
  punte di un asse, hanno lo stesso colore a metà spessore. Il pentagono,
  l'esagono, l'ottagono e la stella sono quelli dello strumento Poligono: se ne
  cambiano i lati o le punte anche dopo ([Disegni, poligoni e
  stelle](drawing-shapes.md)).
- **Le forme di scuola** hanno anche testi, le lettere degli assi e i numeri
  della retta, nel colore scelto e col carattere di un testo nuovo. Le righe e
  i quadretti dei fogli sono d'un azzurro chiaro fisso e sottile: sono uno
  sfondo, non un contorno, e non seguono il colore della barra.
- **Ogni altra forma è un oggetto solo,** anche quando porta dei tratti
  dentro, come le righe del processo predefinito o il margine dei documenti
  dietro. Quelle di scuola sono un [gruppo](drawing-selection.md) col suo
  nome, e si scelgono intere.
- **Ogni forma che non è di scuola è chiusa,** e due tocchi ci scrivono un
  testo che resta al centro ([Disegni, etichette nelle
  forme](drawing-labels.md)): un processo, una decisione o un fumetto si
  riempiono di parole senza un testo a parte.
- **Il nome** è il primo `title` dell'oggetto, nella lingua del momento in cui
  si inserisce: «Rettangolo», o «Rectangle» se l'interfaccia è in inglese. È
  ciò che mostra l'albero degli oggetti, ciò che legge un lettore dello schermo
  e ciò che trova chi apre il file in un altro programma. Cambiare la lingua
  dopo non lo riscrive. Quando la forma ha un'etichetta, l'albero e la Lettura
  la chiamano con le parole dell'etichetta, e il nome prende il posto del
  tipo: «Decisione «Controlla l'ordine»».

## Cercare

Il campo **«Cerca una forma»**, in cima al pannello, tiene soltanto le forme
che rispondono.

- **Si cerca per pezzi di parola**, nel nome e nelle altre parole che la forma
  porta: «rett» trova i rettangoli, «quadrato» il rettangolo, «condizione» la
  decisione, «connettore» i due riferimenti del diagramma, «quaderno» i due fogli
  di scuola. Più pezzi vanno insieme: ogni pezzo deve trovarsi.
- **Maiuscole e accenti non contano**: «piu» trova «Più», «cuore» e «CUORE» sono
  lo stesso.
- **La lingua è quella dell'interfaccia**: in inglese si cerca nelle parole
  inglesi.
- **Le raccolte restano nel loro ordine**; una raccolta senza risultati sparisce,
  e se non ne resta nessuna una riga dice «Nessuna forma per «xyz».». In cima
  il pannello dice quante forme restano, «51 forme», «3 forme», «1 forma».

## Inserire

Un **clic** su un riquadro, o **`Invio`** o **`Spazio`** con il fuoco su
di lui, inseriscono la forma **al centro della vista**, alla sua misura
naturale.

- **Dove va** lo decide ciò che decide per le altre forme: il gruppo isolato,
  se c'è, il livello corrente, o il livello più alto che si vede e non è
  bloccato. Se non c'è dove disegnare, il disegno lo dice come gli altri
  strumenti, per esempio «Ogni livello è bloccato o nascosto: non c’è dove
  disegnare.», e non scrive niente.
- **La griglia.** Con l'aggancio acceso, l'angolo in alto a sinistra della
  forma va sull'incrocio più vicino; la forma resta intera, quindi il suo centro
  non è più quello della vista.
- **Lo stile** è quello delle forme che si disegnano: il colore e lo spessore
  scelti nella barra.
- **È un passo di annulla**, col nome della forma, «Rettangolo», nella
  [cronologia](drawing-history.md): annullare la toglie tutta, anche se ha più
  pezzi, e ripetere la rimette.
- **Resta scelta**, e lo strumento torna la Selezione, qualunque fosse: la
  forma si sposta e si ridimensiona subito. Se ne esce dalla pagina, la pagina
  si allarga quanto serve, come per gli altri strumenti.
- **Il fuoco resta nel pannello**: chi inserisce con la tastiera può inserirne
  un'altra, o cercarne un'altra, senza tornare al foglio. `Esc` lo riporta lì.

Inserita una forma, il disegno dice a parole che cosa è successo: «Forma
inserita: Rettangolo. Il disegno ha 3 oggetti.».

## Trascinare

Chi preferisce decidere il posto prende un riquadro e lo trascina fuori dal
pannello, sul foglio. Vale per il mouse, per la penna e per il dito: il gesto
comincia quando il puntatore si è mosso oltre la soglia degli altri gesti
dell'editor, e fino ad allora è un clic. Non è il trascinamento del browser, che
nell'app porta i file.

- **La forma si vede sul foglio** com'è, alla sua misura, con lo zoom e la
  rotazione della vista di adesso, un po' trasparente e col centro sotto il
  puntatore; il cursore diventa quello della copia.
- **Si aggancia come un oggetto spostato:** alla griglia con l'aggancio, alle
  guide dei [righelli](drawing-rulers.md) e, con le [guide
  intelligenti](drawing-guides.md), agli oggetti che si vedono, alla pagina e a
  distanze uguali, con le linee e le misure che le mostrano. `Ctrl` o `⌘` la
  lascia libera.
- **Rilasciata sul foglio** entra lì, nello stesso passo di annulla di un clic,
  ed è scelta; il fuoco va al foglio.
- **Rilasciata fuori dal foglio**, per esempio sul pannello stesso, o con **`Esc`**
  mentre la si tiene, non entra niente e non resta traccia: fuori dal foglio il
  cursore è quello del divieto, e il disegno risponde «Inserimento annullato.».
  Lo stesso succede se il sistema annulla il puntatore.
- **Sul dito**, tenendolo fermo un momento sul riquadro, questo si solleva
  (cresce un poco, con l'ombra e il bordo della scelta) e si porta sul foglio
  in ogni direzione, anche in su quando il pannello sta sotto il foglio:
  finché il dito non si alza, l'elenco non scorre. Un riquadro sollevato e
  lasciato senza muoverlo non inserisce niente e non apre nessun menu. Un
  movimento verticale subito fa scorrere l'elenco; tirare di lato trascina
  come prima.

## Da tastiera e con i lettori di schermo

Il pannello ha un solo punto di tabulazione nella griglia: `Tab` entra e
`Tab` esce.

- **Il campo di ricerca.** `↓` porta alla prima forma che c'è. `Esc` lo
  svuota; a campo vuoto riporta al foglio.
- **La griglia.** Le frecce passano da una forma all'altra, anche da una
  raccolta alla successiva, come le si vede: `←` e `→` lungo la riga, `↑` e `↓`
  da una riga all'altra. `↑` sulla prima riga riporta al campo. `Home` e `Fine`
  vanno alla prima e all'ultima forma. `Invio` e `Spazio` inseriscono. `Esc`
  torna al foglio.
- **I nomi.** Ogni riquadro è un pulsante col nome della forma, e la raccolta
  è un gruppo col suo titolo; l'anteprima è per gli occhi. Il campo dice che
  cosa fanno i tasti. Cercando, una riga viva del pannello dice quante forme
  restano; inserendo, è il disegno a dire che cosa è entrato.
- **In un disegno che non si modifica** il pannello si apre e le forme si
  guardano, ma non entrano: i riquadri sono `aria-disabled` e dicono perché,
  «Modifica non applicata: il disegno è in sola lettura.».

Le anteprime sono nel colore del testo: seguono il tema chiaro e scuro e, coi
colori forzati, quelli del sistema. Con il movimento ridotto le transizioni dei
riquadri sono spente, come nel resto dell'editor.

## Livelli e parti

Il pannello c'è dal livello Standard; l'Essenziale non lo ha, e nemmeno il
pulsante. Nel [Personalizzato](drawing-custom.md) è la parte «Forme»:
tornati a un livello che non la ha, o tolta la parte, il pannello si chiude e
il suo pulsante sparisce; il disegno non cambia, e le forme già inserite
restano com'erano. Nelle annotazioni di un PDF il pannello non c'è.

## Il file

Una forma è scritta come una disegnata a mano, con i numeri nelle coordinate del
livello che la riceve e nessuna `transform`; chi apre il file in un altro
programma vede forme come le altre.

```xml
<rect id="od4k1p8wq" x="120" y="150" width="160" height="100" fill="none" stroke="#000000" stroke-width="4">
  <title>Rettangolo</title>
</rect>
```

Una forma di scuola è un `g` col suo `title` e poi i pezzi, ognuno col suo
`id`. I testi delle forme di scuola sono `text` con una riga in un `tspan`, come
quelli dello strumento Testo; i poligoni e le stelle portano i loro
parametri ([formato della scena, poligoni e
stelle](../reference/scene-format-shapes.md)).

Il banco di fedeltà (`apps/client/bench/fidelity.mjs`) confronta il foglio, la
Lettura e il PNG anche su una scena per raccolta, con le forme scritte da chi
le inserisce, e per la scuola le lettere degli assi e i numeri della retta a
tre misure.
