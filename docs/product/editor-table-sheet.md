# Tabella in foglio, foglio in tabella

> **Per chi:** chi tiene numeri in una tabella Markdown e vuole il foglio, o
> il contrario.
> **Risultato:** sapere come una tabella diventa un foglio di Excel accanto
> alla nota, come una parte di foglio torna tabella e che cosa succede alle
> celle incollate.

Il foglio, una volta nella nota, è una [scheda viva](live-cards.md#il-foglio-nella-nota).

**Trasforma in foglio.** Nel menu di una tabella Markdown, accanto al grafico,
e nel menu del blocco della tabella, **Trasforma in foglio** scrive la
tabella in una cartella di Excel accanto alla nota e mette al suo posto la
scheda dell'intervallo, `![[Conti.xlsx#Foglio1!A1:C3]]`.

- Il file prende il nome della nota (`Conti.md` → `Conti.xlsx`); se c'è già,
  il primo libero (`Conti 1.xlsx`). Un nome che le regole del vault non
  accettano diventa «Tabella». Il foglio si chiama «Foglio1» (in inglese
  «Sheet1»).
- I valori si leggono nella lingua della nota come la somma della banda: «1.240,50 €»
  diventa il numero 1240,5 col suo formato (due decimali, migliaia, euro
  dopo), «12,5%» un percento,
  `(1.234)` un negativo fra parentesi. L'intestazione resta testo, e un
  testo resta testo (un `\|` è una barra, un `<br>` un a capo nella cella).
- È un comando del nucleo, `note.table.sheet`: scrive il foglio e la nota
  tutti e due o nessuno, e la nota solo se fra quei byte c'è ancora la
  tabella. **Annulla** toglie il foglio (nel cestino) e rimette la tabella;
  se il foglio è cambiato nel frattempo non tocca niente e lo dice, e se la
  nota è cambiata altrove ritrova la scheda dove è adesso.
- Una tabella di più di 200 righe o 30 colonne lo propone da sola, una volta
  per nota aperta, con la voce nell'avviso.

**Stacca come tabella.** Nel menu del blocco di una scheda che nomina un
intervallo di foglio (non una cella sola, non un foglio intero),
**Stacca come tabella** la sostituisce con una tabella Markdown dei valori
che mostra adesso, coi separatori della lingua della nota. Le formule restano
nel foglio, che non cambia: l'avviso lo dice. Un passo d'annullamento della
nota; al più 1000 righe e 60 colonne.

**Incollare celle.** Le celle copiate da un foglio (testo a tabulazioni)
entrano come tabella Markdown, staccata dal testo intorno. Se vengono da un
foglio del vault aperto in Fub, sotto la tabella c'è la scelta **Tabella** /
**Incolla come scheda**: la scheda scrive l'embed di quella parte del foglio,
e la tabella ha i numeri coi separatori della nota.
Il foglio dice da dove vengono le celle con il tipo degli appunti
`application/x-fub-cells`; le celle di un altro programma con il loro HTML
passano dalla conversione dell'HTML, come prima.

Il comando sta in `crates/fub-features/src/commands/table_sheet.rs` (dietro
la funzione `xlsx` del crate) e scrive con `fub_format_xlsx::values`; il
client in `table-sheet.ts` (le letture e la tabella dei valori),
`cells-clipboard.ts`, `state/table-sheet.ts` e `paste.ts`.
