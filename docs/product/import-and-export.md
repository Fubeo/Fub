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
(`import.cancel`).

### Archivi grandi

Un import prende al più 64 MiB e 10 000 voci per volta. Un archivio ZIP più
grande, come un export di Notion con le immagini o un vault con le foto, entra
**in parti**. La finestra legge la directory dell'archivio senza caricarlo
tutto, lo divide in parti da al più 48 MiB, 5 000 voci e 192 MiB decompressi, e
riscrive ogni parte come un archivio piccolo con le voci copiate così come
sono. Ogni parte è un import con la sua anteprima e la sua ricevuta:

- il piano le mostra insieme, con le perdite di tutte;
- «Importa» le esegue in ordine; se una parte fallisce, le seguenti restano in
  attesa e «Importa» riprende da lì;
- «Annulla l'import» toglie le parti entrate, dall'ultima alla prima.

L'importer degli archivi tratta ogni voce da sola, e il nome nel vault viene
dal suo path: dividere non cambia ciò che entra. Due voci che diventano lo
stesso nome in parti diverse seguono la scelta sui conflitti, come una nota
che c'è già. Una voce più grande di una parte (oltre 32 MiB decompressa) non
entra e compare fra le perdite del piano. Un file che non è uno ZIP oltre i
64 MiB non parte.

### Da Notion o da Airtable

Nella stessa finestra la «Sorgente» può essere Notion o Airtable invece di un
file. Si scrive il link o l'id di una pagina o di un database Notion, oppure
di una base Airtable con, se serve, le tabelle separate da virgole (vuoto vuol
dire tutte). Le tappe restano le stesse: anteprima, import, annullamento.

Il connettore ha bisogno di un token. Lo si incolla una volta nel riquadro
«Token» e si salva su questa macchina, nella cartella di configurazione,
leggibile dal solo proprietario. La finestra dice soltanto se un token c'è e
permette di sostituirlo o di toglierlo; non lo mostra mai. Il token non
viaggia con la richiesta d'import: il connettore lo legge quando il job parte.
Dalla palette gli stessi passi sono `connector.token` e `connector.tokens`.
Dettagli del file in
[Layout su disco](../reference/on-disk-layout.md).

Un trascinamento di file dal sistema nell'explorer non è un import: copia i
file così come sono (vedi [Explorer e cartelle](explorer-and-folders.md)).

## Le impostazioni di Obsidian

Un vault che viene da Obsidian ha `.obsidian/` nella radice. Fub la ignora come
parte del vault, ma «Importa le impostazioni di Obsidian» (il comando
dell'host `settings.import_obsidian`, dalla palette) ne legge i file e
scrive le scelte che Fub sa esprimere:

- da `app.json`: cartella degli allegati (anche `./` e `./sotto`), posizione
  delle note nuove (radice, accanto alla nota aperta, una cartella), stile e
  formato dei link, conferma e cestino, cartelle escluse, e gli interruttori
  dell'editor (modalità, rientro, numeri di riga, ortografia, Vim, parentesi,
  elenchi, guide di rientro, HTML incollato, destra a sinistra, piegatura,
  proprietà, interruzioni di riga rigorose);
- da `appearance.json`: la luce e la misura del testo;
- da `daily-notes.json`: cartella, formato e modello della giornaliera;
- da `hotkeys.json`: le scorciatoie dei comandi che hanno un gemello in Fub
  (palette, schede, riquadri, barre laterali, piegatura, zoom, formattazione),
  una per comando;
- da `bookmarks.json`: i segnalibri;
- da `snippets/*.css`: i frammenti CSS, accesi come lo erano;
- da `workspaces.json`: gli spazi di lavoro, come workspace di Fub.

Ogni impostazione va al suo livello, del vault o della macchina, con la stessa
porta del pannello. Una chiave che Fub non sa dire (la larghezza leggibile, un
tema di Obsidian, un filtro con un'espressione regolare, la radice come
cartella degli allegati) torna nell'esito per nome, e così una chiave di una
feature spenta e una scorciatoia che Fub non sa prendere: di un comando senza
gemello, con Ctrl distinto da Cmd, la seconda di un comando. I file di
Obsidian si leggono soltanto, dentro la radice: un collegamento che porta fuori
dal vault non si segue. Un file guasto ferma l'import prima di scrivere.

I segnalibri sono della shell, non impostazioni: l'host li consegna nell'esito
così come Obsidian li scrive, e la shell li porta nei suoi
(`state/obsidian-bookmarks.ts`). Note, heading, blocchi, cartelle, ricerche,
pagine web e gruppi hanno la loro gemella; un gruppo dentro un gruppo diventa
un gruppo suo, perché i gruppi di Fub non si annidano. Il grafo di Obsidian e
una specie che Fub non conosce si nominano nell'avviso. Una voce che c'è già
non si raddoppia, e un gruppo con lo stesso nome si riusa.

I frammenti CSS passano dallo stesso vaglio di un frammento scritto a mano
(`theme/snippets.ts`): uno che regge entra come `obsidian-<nome>` e si accende
se era acceso in Obsidian; uno che nomina agganci che Fub non ha (quasi
sempre, perché Obsidian ha le sue classi) entra spento, si nomina, e lo si
corregge dalle impostazioni. Un id che c'è già non si riscrive; oltre i
trentadue frammenti il resto si nomina.

Di uno spazio di lavoro si porta l'area principale
(`state/obsidian-workspaces.ts`): divisioni, gruppi di schede, le schede che
aprono un file, quella davanti e le appuntate. Le barre laterali di Obsidian
hanno pannelli che non sono quelli di Fub e restano fuori; una scheda che non
apre un file (il grafo, una ricerca) si nomina per tipo. Uno spazio col nome di
un workspace che c'è già non si raddoppia, e che i file esistano lo verifica
l'apertura del workspace, come per ogni altro.

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
per riga. L'export di una nota sola dal suo riquadro arriva invece al centro
attività (vedi sotto).

## Esportare una nota

Il menu del riquadro di una nota ha «Esporta come HTML» ed «Esporta come PDF
(testo statico)», e «Esporta…» li offre nel launcher. Prima si salva la coda
della nota; poi il core esegue l'export sul documento salvato e il file arriva
al centro attività, da cui lo si salva dove si vuole.

- **HTML** (`importers.html`): un file per nota, che si apre da solo in un
  browser. Il corpo è la resa di stampa della nota. Le immagini del vault
  entrano nel file come `data:` URI (fino a 16 MiB l'una, 64 MiB per file), e
  le note incorporate entrano con la loro resa, fino a quattro livelli e senza
  giri. Il file porta una Content-Security-Policy che non esegue script e non
  carica niente da fuori.
- **PDF** (`importers.pdf.single`): il testo della nota in un PDF statico, col
  nome della nota. Per diagrammi, formule e immagini c'è «Stampa», che il
  sistema salva anche in PDF.

Ciò che non entra lo dice il rapporto, con la nota a cui si riferisce: una
parte che solo Fub disegna (un diagramma, una query, una vista), che
nell'HTML resta un riquadro col suo nome; un'immagine remota, che resta un
collegamento; un riferimento che non si risolve, un'immagine oltre il tetto,
una nota incorporata troppo in profondità o in un giro.

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
