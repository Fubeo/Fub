# La trasclusione viva

> **Per chi:** chi riporta in una nota una sezione o un blocco di un'altra.
> **Risultato:** sapere come si scrive dentro la nota riportata, dove va il
> testo e che cosa succede quando qualcosa cambia sotto.

## Che cosa si vede

Un embed di una sezione o di un blocco di un'altra nota (`![[Riunioni#Decisioni]]`,
`![[Riunioni#^decisioni]]`) si vede in Scrittura come un vassoio col filo
d'accento: in testata la provenienza («Riunioni › Decisioni») e, al passaggio
o col fuoco, **Modifica qui** e **Apri**. Il testo resta nella nota d'origine:
la trasclusione lo scrive dove sta.

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

## Dove sta nel codice

- `apps/client/src/editors/text/profiles/markdown/transclusion.ts`: la
  trasclusione viva (`Transclusions`, `LiveTransclusion`), sulla superficie
  ristretta di `editors/core/range-surface.ts`; `markdown/mount.ts` la monta
  sugli embed (`transclude`) e tiene ferma la resa mentre si scrive;
  `state/document-controller.ts` le dà le sessioni e il conflitto di un
  riquadro;
- `apps/client/src/editors/text/profiles/markdown/block-groups.ts`: «Modifica
  qui» nel gruppo «Trasclusione» della barra;
- `apps/client/bench/scene.mjs`: le scene `trasclusione-viva-*`, sulla nota
  della Live `trasclusione` di `bench/live-fixture.ts`.
