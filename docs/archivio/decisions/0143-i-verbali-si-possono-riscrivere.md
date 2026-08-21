# 0143 — I verbali si possono riscrivere nella forma

**In breve:** il contenuto di un verbale è immutabile, ma la forma può essere
riscritta per chiarezza.

## La decisione

Il proprietario del repo ha esplicitamente autorizzato la riscrittura formale
dei verbali storici di `docs/decisions/`. L'obiettivo è renderli più brevi, più
leggibili e più accessibili a chi arriva sul progetto per la prima volta.

Il compromesso è chiaro:
- **Il contenuto resta intoccabile:** le decisioni prese, le alternative
  scartate e i motivi per cui si è giunti a quella conclusione non cambiano.
- **La forma cambia:** si usano frasi più brevi, elenchi puntati e tabelle, per
  consentire una lettura rapida senza perdersi in paragrafi lunghi.
- **Il contenitore non cambia mai:** il numero e il nome del file
  (`0NNN-nome.md`) non cambiano, così che tutti i link sparsi per il codice e
  per la documentazione non si rompano.

## Perché la vecchia regola aveva senso

La convenzione originale stabiliva che i verbali fossero totalmente immutabili
(decisione [0014](0014-i-verbali-fuori-da-todo.md)). Aveva molto senso: un
verbale fissa un momento nel tempo e una scelta architetturale. Riscrivere il
file esponeva al rischio di "riscrivere la storia", ammorbidendo le conseguenze
di una scelta o nascondendo il fatto che all'epoca non si erano previsti certi
problemi.

Tuttavia, l'accumulo di 141 verbali ha generato un volume di documentazione
(circa il 60% della prosa dell'intero repo) così vasto e verboso da risultare
utile solo a chi lo aveva scritto. Un documento che fissa la verità storica, ma
che non viene letto per via della complessità stilistica, smette di essere un
documento utile.

## Cosa distingue una riscrittura lecita da una falsificazione

Una riscrittura formale preserva l'identità del documento originale:
1. Deve mantenere tutti i nomi di file, i numeri, gli identificatori e i
   riferimenti al codice.
2. Deve conservare ogni buco dichiarato ("cosa resta scoperto").
3. Deve descrivere le alternative che erano state prese in esame, con i motivi
   dello scarto, senza semplificarle via.
4. Se il documento originale si riferisce a codice o file che oggi non esistono
   più, la riscrittura non aggiorna il testo al presente: lo lascia declinato
   nel contesto di allora, e aggiunge semplicemente una nota in testa al file
   per chiarire che il contesto è invecchiato.

Cambiare le ragioni o rimuovere un difetto strutturale che il verbale originale
ammetteva, costituisce una falsificazione e non è ammesso. Se si cambia idea
sulla soluzione, si apre un verbale nuovo.
