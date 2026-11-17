# Sposta in…

«Sposta in…» manda il blocco (o i blocchi selezionati) **in un'altra nota**:
dal menu della maniglia, dallo spazio comandi (Ctrl O, «Sposta
in…») e trascinandolo su una nota del cassetto. Dal menu le domande sono
due: prima la nota, in un elenco per nome che si filtra scrivendo («Cerca
una nota…»; la nota stessa è l'ultima e dice «questa nota»); poi una finestra «Sposta in
«Progetto»» con **Dove** («In fondo alla nota», o «In fondo a «Titolo»» per
ogni titolo, rientrato per livello) e **Al suo posto** («Un link alla nota»,
«Niente», «Una trasclusione del blocco», quest'ultima per un blocco solo).
Le scelte di serie sono in fondo e col link: Invio sposta subito. Il blocco
è quello del momento del menu: se la nota cambia mentre si sceglie, non si
sposta niente e lo dice («La nota è cambiata mentre sceglievi»).

Lo fa il comando del nucleo `note.block.move`
(`crates/fub-features/src/commands/move_block.rs`), con i byte del blocco e
il testo letto lì: se la nota è cambiata e fra quei byte c'è altro, non si
muove niente. Il blocco arriva con gli a capo della nota d'arrivo e senza il
rientro che aveva in un elenco; una voce entra nell'elenco che chiude la nota.
Al posto del blocco il link è `[[Progetto]]`, o `[[Progetto#^id]]` se il
blocco ha un id; una voce d'elenco tiene il suo segno (`- [[Progetto]]`), non
la casella. La trasclusione è `![[Progetto#^id]]`: un blocco senza id ne
riceve uno nuovo, scritto dove lo scrive «Copia il link al blocco».

**Due scritture, un annulla.** La nota d'arrivo, quella di partenza e le note
i cui link seguono il blocco si scrivono insieme o per niente (il piano su più
documenti del kernel): una nota cambiata da fuori, una nota in sola lettura o
un disco pieno lasciano tutte le note com'erano, e il messaggio lo dice. La
notifica «Spostato in fondo a «Progetto». Qui resta il link.» ha «Annulla»,
che rimette tutte le note in un passo, oppure non tocca niente se una è
cambiata dopo.

**I link seguono il blocco.** Un id (`^abc123`) e un titolo restano col
blocco, e i link wiki che li nominano nella nota di partenza, in quella
d'arrivo e nelle note che linkano la partenza (`[[Riunione#^abc123]]`,
`[[#^abc123]]`, `[[Riunione#Titolo]]`) puntano alla nota nuova: cambia solo
il nome della pagina, alias e frammento restano. Un link Markdown
(testo fra quadre e il percorso `Riunione.md#^abc123` fra tonde) resta com'è.

**Nella stessa nota** il blocco va in fondo alla nota o alla sezione scelta
e non lascia niente; un titolo dentro ciò che si sposta non è una
destinazione.

## Sul cassetto

Col blocco fuori dalla colonna ([Blocchi](editor-blocks.md)) sono bersagli
anche **le note del cassetto** (le note Markdown dell'albero e delle
appuntate, del vault della nota): la riga si accende col bordo d'accento e
l'etichetta dice «Sposta in «Progetto»». Lasciato lì, il blocco va in fondo a
quella nota col link al suo posto, come «Sposta in…» con le scelte di serie;
il cartellino si posa e il blocco sparisce dalla nota quando le due scritture
sono fatte. Il cassetto offre le sue righe con la porta dei bersagli
(`offerDropTargets`, `kind: "note"`).

## Dove si trova

- `crates/fub-features/src/commands/move_block.rs`: il comando
  `note.block.move`, coi suoi casi in `move_block_tests.rs`;
- `apps/client/src/editors/text/profiles/markdown/blocks/move-to.ts`: le due
  domande e i byte del blocco; la voce del menu e il rilascio sul cassetto in
  `handles.ts`, i bersagli in `drop-targets.ts`
  ([Blocchi](editor-blocks.md));
- `apps/client/src/state/move-block.ts`: la strada dal client al comando, con
  l'annulla;
- `apps/client/src/panels/explorer.ts`: le note del cassetto come bersagli.
