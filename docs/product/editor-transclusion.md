# La trasclusione viva

> **Per chi:** chi riporta in una nota una sezione o un blocco di un'altra.
> **Risultato:** sapere come si scrive dentro la nota riportata, dove va il
> testo, che cosa succede quando qualcosa cambia sotto, e come si mette lo
> stesso blocco in più note.

## Che cosa si vede

Un embed di una sezione di un'altra nota (`![[Riunioni#Decisioni]]`) si vede
in Scrittura come un vassoio col filo d'accento: in testata la provenienza
(«Riunioni › Decisioni») e, al passaggio o col fuoco, **Modifica qui** e
**Apri**. Il testo resta nella nota d'origine: la trasclusione lo scrive dove
sta. L'embed di un blocco (`![[Riunioni#^decisioni]]`) è un blocco
sincronizzato, qui sotto: le regole del salvataggio sono le stesse.

- **Modifica qui**, o Invio sul blocco scelto, o «Modifica qui» nel gruppo
  «Trasclusione» della barra, apre dentro l'embed un editor sul solo tratto,
  col bordo d'accento e la fascia «Scrivi in X: si salva là, con la sua
  revisione. Esc esce.», col cursore in fondo al tratto. **Esc** (o
  **Fatto**) salva ed esce, e il fuoco torna su «Modifica qui»; un Esc che
  l'editor usa già (la chiusura in grigio, un completamento) resta suo, come
  nella sbirciata.
- L'editor del tratto è la superficie ristretta della sessione dell'origine:
  con l'origine aperta in un riquadro, anche con modifiche non salvate, si
  scrive sullo stesso testo, e ogni battuta passa all'altro riquadro;
  l'annulla è di ciascuno. Una scheda di nota della lavagna monta la stessa
  Scrittura, e la sua trasclusione fa lo stesso.
- Si scrive un livello solo: una trasclusione dentro quella riportata resta da
  leggere. Una nota che riporta sé stessa non si scrive da lì, e lo dice. La
  nota intera (`![[Riunioni]]`) si apre e basta.
- Il salvataggio è quello della nota d'origine, con la sua revisione: una
  revisione cambiata nel frattempo dà il conflitto di ogni riquadro, con le
  sue scelte, dentro la trasclusione; Esc non esce finché non si sceglie.
- Chiudere la nota che ospita salva l'origine; se non si salva, chiede come
  un riquadro che si chiude.
- Un'àncora che non c'è (un blocco senza id, un titolo cambiato) non apre
  niente e lo dice. Un tratto tolto o riscritto altrove mentre si scrive, o
  l'origine cancellata, fermano l'editor sull'ultimo testo, da leggere. Una
  nota rinominata segue il nome nuovo. Un'origine in sola lettura (chiusura in
  corso, prestata a un'app) non si apre, e dice perché.
- Una nuova resa della nota che ospita (l'origine salvata) aspetta che si esca
  dall'editor del tratto: chi scrive non perde il fuoco.

## Il blocco sincronizzato

Lo stesso blocco in più note: nel file è l'embed del blocco col suo id,
`![[Nota#^id]]`, che Obsidian legge uguale. Non c'è un formato in più.

- **Sincronizza in un'altra nota…** nel menu del blocco (un blocco solo, non
  le proprietà): si sceglie la nota, e il comando `note.block.sync` dà al
  blocco un id se non ce l'ha (`^a1b2c3`, a fine riga; su una riga sua dopo
  un recinto o una tabella) e scrive l'embed in fondo all'altra nota. Le due
  scritture sono un piano solo: tutte e due o nessuna, con un **Annulla** che
  rimette le due note com'erano. Un id già usato nell'altra nota non si
  riusa; un blocco cambiato mentre si sceglie, o una nota cambiata da fuori
  dopo la lettura, non scrivono niente e lo dicono.
- **Blocco di un'altra nota** nel «/» (dopo «Trasclusione»): si sceglie la
  nota e un suo blocco; il comando gli dà l'id, poi l'embed si scrive al
  posto del «/». Se l'id non si scrive, la nota resta com'era e lo dice.
- Nella nota che lo ospita il blocco sincronizzato sta come un blocco suo:
  niente vassoio né «Modifica qui», un filo d'accento discreto a sinistra e,
  al passaggio o col fuoco, la targhetta **Sincronizzato con …** con **Apri**.
  Un clic sul testo (Invio sul blocco scelto) apre la superficie ristretta
  sul blocco, col cursore dove si è cliccato, senza fascia; **Esc**, o il
  fuoco che va altrove, salva ed esce.
- Salvataggio, conflitto, sola lettura e nota rinominata sono quelli della
  trasclusione viva. Il blocco d'origine cancellato lascia al suo posto
  **Blocco non trovato**.
- Un blocco sincronizzato non monta niente finché non ci si scrive: dieci in
  una nota non pesano sulla battuta.

## Dove sta nel codice

- `apps/client/src/editors/text/profiles/markdown/transclusion.ts`: la
  trasclusione viva (`Transclusions`, `LiveTransclusion`), sulla superficie
  ristretta di `editors/core/range-surface.ts`; `markdown/mount.ts` la monta
  sugli embed (`transclude`) e tiene ferma la resa mentre si scrive;
  `state/document-controller.ts` le dà le sessioni e il conflitto di un
  riquadro;
- `apps/client/src/editors/text/profiles/markdown/block-groups.ts`: «Modifica
  qui» nel gruppo «Trasclusione» della barra;
- `crates/fub-features/src/commands/sync_block.rs`: il comando
  `note.block.sync` (l'id e l'embed, un piano solo);
  `apps/client/src/editors/text/profiles/markdown/blocks/sync-to.ts` le
  domande del menu del blocco e del «/», caricate al primo uso;
  `apps/client/src/state/sync-block.ts` la strada dal client;
- `apps/client/bench/scene.mjs`: le scene `trasclusione-viva-*`, sulla nota
  della Live `trasclusione` di `bench/live-fixture.ts`.
