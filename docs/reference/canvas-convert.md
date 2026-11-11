# Convertire le schede della lavagna

> **Ambito:** i tre comandi che cambiano che cosa una scheda di un `.canvas`
> mostra, senza toglierla: «Estrai in una nota…», «Copia il testo qui»,
> «Sostituisci il file…».
> **Fonti autorevoli:** `apps/client/src/editors/canvas/engine.ts`
> (`#extractNote`, `#copyNoteText`, `#replaceFile`, `proposedNoteName`), la
> porta `CanvasNotesPort` e il suo lato della shell in
> `apps/client/src/state/document-controller.ts`; le prove in
> `apps/client/src/editors/canvas/engine.test.ts` («convertire (T70)»).

Sono comandi del catalogo della lavagna (`canvas.extract_note`,
`canvas.copy_note_text`, `canvas.replace_file`, vedi
[i tasti e i gesti](canvas-input.md#il-menu-della-scheda)): stanno nel menu
della scheda e in `Ctrl+/`, non hanno un tasto, e in sola lettura sono
spenti col perché. Ognuno cambia la lavagna con un solo commit, che un
annulla riporta. La scheda convertita tiene il suo id, quindi tiene posto,
misura, colore, fili e inchiostro (`fub:ink` della scheda).

## Estrai in una nota…

Su una scheda di testo sola (anche dal pulsante nel corpo della scheda).
Chiede solo il nome della nota:

- il nome proposto viene dalla prima riga del testo, senza i `#` di un
  titolo, pulito come il nome di una nota nuova (`searchedName`: niente
  caratteri vietati né barre, al più 80 caratteri);
- una prima riga vuota, o fatta solo di caratteri vietati, propone
  «Senza titolo»;
- un nome che un documento della cartella usa già (senza guardare
  l'estensione né le maiuscole) diventa «nome 1», «nome 2»…; è solo una
  proposta: se il nome si occupa prima della conferma, `note.create` lo
  rifiuta e la lavagna lo dice, senza sovrascrivere niente.

Il nome confermato si pulisce allo stesso modo; un nome che non resta
niente non chiude il dialogo. La nota nasce nella cartella della lavagna
(alla radice, se la lavagna è alla radice) col testo della scheda, e la
scheda diventa una scheda di file su di lei. Un annulla riporta la scheda di
testo; la nota resta nel vault, e la notifica della shell lo dice, con
«Apri». Se la scheda cambia mentre si sceglie il nome, la nota non nasce; se
cambia mentre la nota nasce, la scheda resta com'è e la notifica dice che la
nota c'è, con «Apri».

## Copia il testo qui

Su una scheda di nota sola. Mette accanto, al primo posto libero a destra,
una scheda di testo col testo della nota (quello della sessione aperta, se
la nota è aperta, anche non ancora salvato), e la sceglie; la nota non
cambia. Di una scheda-estratto ([gli estratti](canvas-parts.md)) copia solo
le sezioni che mostra, nel suo ordine, separate da una riga vuota
(`noteSectionsText` in `excerpt.ts`). I titoli vengono dal sommario del
provider Markdown (la domanda `outline`, col byte dove comincia ognuno), e
una chiave trova il suo titolo con la regola del selettore delle sezioni
(`sectionOfKey` in `parts-picker.ts`, la stessa di «Fonti»); una sezione va
dal suo titolo al titolo dopo di livello uguale o più alto, tagliata in byte
UTF-8. Una sezione sparita dalla nota non si copia e non è un errore; se non
ne resta nessuna non nasce niente, e la lavagna dice quali mancano. Se il
sommario non arriva, o non combacia col testo (il byte non cade sulla riga
del titolo), si copia la nota intera. La scheda nuova è larga come quella della nota e alta come lei, ma
non più della vista: una nota lunga scorre dentro la scheda. Un testo oltre
il limite di una scheda (1 MiB) non nasce, e la lavagna lo dice.

## Sostituisci il file…

Su una scheda di file sola, dal menu della scheda o dall'ispettore
(«Scheda», sotto il file: [l'ispettore](canvas-inspector.md)). Apre il
selettore dei file di sempre (quello di «Aggiungi file»); la scheda punta al file scelto e perde ciò che era del
file di prima: la sezione o la pagina (`subpath`) e le parti (`fub:parts`).
Con un file di un'altra specie la scheda cambia specie; l'inchiostro resta
nel file com'era e si disegna con la regola della specie nuova
([l'inchiostro](canvas-ink.md)). Senza un selettore dei file il comando è
spento col perché.
