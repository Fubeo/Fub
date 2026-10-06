# Disegni, cronologia

> **Per chi:** chi disegna e vuole tornare a com'era il disegno qualche passo
> fa, o confrontare due momenti, senza premere `Ctrl+Z` venti volte.
> **Risultato:** sapere che cosa mostra la cronologia, come si torna a un
> passo e si riparte da lì, che cosa sono i segni e quanto durano, e come la si
> usa da tastiera e con un lettore di schermo.

Dal [livello Standard](drawing.md#il-livello-standard) **«Cronologia»**,
nella barra dopo «Oggetti», apre accanto al foglio, sotto gli altri pannelli
aperti, i passi del disegno: un clic su uno qualsiasi riporta il disegno lì,
in un colpo. La cronologia è la stessa di annulla e ripeti, vista tutta
insieme, e non cambia il file: lo cambiano i passi che si annullano o si
ripetono.

## I passi

- Ogni gesto è un passo, col nome che dicono annulla e ripeti:
  «Rettangolo», «Spostamento», «Riempimento». Piccoli spostamenti di fila,
  a meno di mezzo secondo l'uno dall'altro, o tre colori provati uno dopo
  l'altro, sono un passo solo.
- In cima c'è **«Disegno aperto»**, il disegno com'era quando si è aperto;
  sotto, i passi dal più vecchio. La riga di adesso ha il triangolo, il
  grassetto e la parola «adesso». I passi annullati restano sotto, in grigio
  e in corsivo, da ripetere, finché un gesto nuovo non li toglie.
- La cronologia ricorda gli ultimi 1000 passi. Oltre, i più vecchi si
  dimenticano: la prima riga diventa «Inizio della cronologia», e una nota
  in cima al pannello lo dice.
- È della sessione e del riquadro: non si scrive nel file, ogni riquadro ha
  la sua, e un altro disegno, o lo stesso riaperto, ricomincia da capo. Un
  testo arrivato da fuori, da un altro riquadro o dal disco, non vi entra e
  non la svuota ([Disegni](drawing.md#più-riquadri-sullo-stesso-disegno)).

## Tornare a un passo

- **Un clic** su una riga porta il disegno lì: i passi in mezzo si annullano,
  o si ripetono, tutti insieme, e il file cambia una volta sola, anche per
  mille passi. Il salto si dice: «Indietro fino a «Spostamento»: 3 passi
  annullati.», «Avanti fino al segno «Bozza»: 2 passi ripetuti.».
- **Col mouse o con la penna**, tenendo premuto e scorrendo sull'elenco, il
  disegno segue la riga sotto il puntatore, avanti e indietro nel tempo; oltre
  il bordo l'elenco scorre col puntatore. Col dito l'elenco scorre, e un tocco
  porta alla riga.
- Da lì si continua: `Ctrl+Z` e `Ctrl+Y` vanno di un passo, e un gesto nuovo
  toglie i passi da ripetere, come dopo un annulla.
- La selezione segue l'ultimo passo annullato o ripetuto, come dopo un
  annulla. Un testo che si sta scrivendo, o un tracciato di Bézier a metà, si
  conclude prima del salto, come cambiando strumento.
- Se un passo non si annulla più, perché altrove è cambiato ciò che toccava,
  il salto si ferma lì: i passi prima di lui sono fatti, lui esce dalla
  cronologia, e lo si dice: «Impossibile annullare «Spostamento»: il disegno
  è cambiato nel frattempo.». Lo stesso per un passo che non si ripete.

## I segni

- **«Segna questo punto»**, in cima al pannello, mette un segno dove si è
  adesso, con la bandierina, e apre il suo nome: di partenza «Segno 1»,
  «Segno 2» e così via. `Invio` lo scrive, `Esc` lo lascia com'è, e uscire
  dal campo lo scrive anche lui.
- Il segno sta sotto il passo dopo cui è stato messo, e un clic porta lì come
  sul passo. `F2`, o un doppio clic sul nome, lo cambia; `Canc`, o la croce in
  fondo alla riga, lo toglie.
- Un segno vale quanto il suo punto: se ne va quando il punto non si
  raggiunge più, perché un gesto nuovo ha tolto i passi da ripetere dove
  stava o perché la cronologia ha dimenticato i passi più vecchi. Il segno di
  un passo che non si annulla più passa al punto prima.
- Un gesto fatto dopo un segno resta un passo a sé: non si fonde col passo
  prima del segno.
- I segni, come la cronologia, non vanno nel file.

## Da tastiera e coi lettori di schermo

Aperta, la cronologia prende il fuoco, sulla riga di adesso. Le frecce,
`PagSu`, `PagGiù`, `Home` e `Fine` scelgono la riga senza andarci; `Invio` o
`Spazio` ci vanno; `F2` e `Canc` valgono sui segni, e sui passi non fanno
niente; `Esc` torna al foglio. `Ctrl+Z` e `Ctrl+Y` funzionano anche da qui, e
quando ci si muove così, o con un gesto, la riga scelta torna su quella di
adesso.

Per un lettore di schermo la cronologia è un elenco: ogni riga dice il suo
nome, se è un segno e se è da ripetere, e quella di adesso è il passo
corrente. Il triangolo, la bandierina e la parola «adesso» sono per gli
occhi, e nessuno stato si legge dal solo colore. Le righe hanno tutte la
stessa altezza, 44 pixel, e se ne disegnano quelle che si vedono: mille passi
scorrono come dieci.

In sola lettura la cronologia si guarda soltanto: le frecce scelgono la riga,
e nient'altro.

## Quando se ne va

Tornati all'Essenziale, o tolta la parte nel
[Personalizzato](drawing-custom.md), il pannello si chiude e il pulsante
sparisce. La cronologia resta, coi suoi segni: annulla e ripeti continuano, e
riaperta la si ritrova com'era.
