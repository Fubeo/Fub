# Importare ed esportare

> **Per chi:** chi porta note in Fub da un altro programma, o le porta fuori.
> **Risultato:** sapere da dove si importa e si esporta, che cosa si vede prima
> di scrivere e come si torna indietro.

## Importare note

«Importa note…» sta nel menu File, nel menu di una cartella dell'explorer
(«Importa note qui…») e nella palette, dove il comando `import.prepare` apre la
stessa finestra. L'import ha tre tappe, e solo la seconda scrive nel vault.

1. **Anteprima.** Si sceglie un file, la cartella del vault dove atterra e che
   cosa fare se una nota c'è già: lasciarla com'è (di serie), entrare accanto
   con un nome libero, o sostituirla. La finestra deposita la sorgente nello
   spazio privato del plugin degli import e mostra il piano: quante note
   entrerebbero, dove, quali restano com'erano e ciò che non passa (una
   relazione che resta testo, un allegato che non c'è). Nel vault non cambia
   niente.
2. **Import.** «Importa N note» esegue il piano. Prima di scrivere il comando
   ricontrolla che la sorgente depositata sia quella dell'anteprima e che i file
   di destinazione non siano cambiati intanto.
3. **Annullamento.** Dopo l'import la finestra offre «Annulla l'import», che
   rimette i file come erano. Se un file importato è stato modificato dopo, il
   rollback non lo tocca e lo dice.

Chiudere la finestra dopo l'anteprima toglie la sorgente depositata
(`import.cancel`). Un file che supera il tetto di una sorgente intera, 64 MiB,
non parte.

Un trascinamento di file dal sistema nell'explorer non è un import: copia i
file così come sono (vedi [Explorer e cartelle](explorer-and-folders.md)).

## Esportare una cartella o il vault

«Esporta il vault…» nel menu File ed «Esporta la cartella…» nel menu di una
cartella aprono la finestra del comando dell'host `vault.export`. Si sceglie
il formato fra quelli che i provider registrano, la cartella del vault (vuoto
vuol dire tutto il vault), le opzioni del formato e una cartella di
destinazione **nuova**, fuori dal vault, col dialogo di sistema.

- Gli artefatti si scrivono direttamente nella cartella scelta, senza il tetto
  di memoria dell'export di una nota sola. Un formato che produce un file solo
  (il documento unico Markdown, un PDF unico) lo mette dentro quella cartella.
- Una cartella che esiste già non si sovrascrive mai, e una destinazione dentro
  il vault si rifiuta.
- Una cartella del vault che non c'è, o che non contiene niente che il formato
  sappia scrivere, è un errore e non un export vuoto riuscito. Se l'export
  fallisce a metà, la cartella creata per lui si toglie.
- Prima di partire si salvano i documenti in coda: l'host esporta ciò che è sul
  disco.

L'esito resta nella finestra: quanti file, dove, e gli avvisi dell'exporter uno
per riga. L'export di una nota sola dal suo riquadro resta quello di sempre: il
file arriva al centro attività, da cui lo si salva.

## Il formato Markdown

Il provider Markdown offre due destinazioni: `markdown.files`, un file per
nota al suo path, e `markdown.single`, la selezione concatenata in un documento.
L'opzione `frontmatter` (predefinita `true`) tiene o toglie i metadati.

- Nella cartella esportata gli allegati viaggiano con le note, al loro path,
  così i link relativi puntano ancora al file. Una cartella o il vault intero
  portano ogni file che contengono; delle note scelte una per una, o da una
  query, si portano gli allegati che citano. Con `attachments: false` restano
  fuori, e il rapporto ne nomina ciascuno.
- Un documento che non è Markdown (canvas, base, foglio) si copia nella
  cartella byte per byte. Nel documento unico resta fuori, invece di diventare
  JSON o YAML fra le note.
- Il documento unico non può contenere allegati: ogni allegato citato è un
  avviso nel rapporto, col documento che lo cita.

