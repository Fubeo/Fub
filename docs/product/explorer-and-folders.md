# Explorer e cartelle

> **Per chi:** chi organizza le note e i file di un vault dall'explorer.
> **Risultato:** sapere che cosa mostra l'albero e come si crea, si rinomina,
> si sposta e si cestina una cartella senza perdere link né organizzazione.

## Albero dei file

L'explorer chiede un livello per volta all'anagrafe del kernel, che contiene
ogni voce del disco e non solo i documenti. Dopo sottocartelle e note mostra
quindi anche allegati e file che nessun provider riconosce. Immagini, audio,
video e PDF si aprono nel visualizzatore in sola lettura. Un SVG si apre invece
come testo modificabile con l'anteprima accanto, e si salva a byte (vedi
[Editor e anteprima](editor-and-preview.md)). Per gli altri file la shell
avvisa che non c'è un visualizzatore e non tenta di leggerli come testo.

Il visualizzatore delle immagini ingrandisce al cursore con la rotella o il
pizzico, si trascina, ruota di 90°, adatta l'immagine alla finestra o la mostra
alle dimensioni reali. Sotto la trasparenza alterna una scacchiera, un fondo
chiaro e uno scuro; la barra dice formato, misure in pixel e peso del file. Un
SVG, anche con prologo XML, commenti o `<!DOCTYPE>` prima di `<svg>`, si mostra
come immagine inerte. HEIC e TIFF, che la webview non decodifica, mostrano un
messaggio al posto dell'immagine e lasciano il file intatto.
La finestra di duecento voci per livello vale per note e file insieme.
Dal menu contestuale un allegato si rinomina, conservando l'estensione, e si
cestina come una nota: il kernel lo toglie dall'anagrafe con `EntryRemoved` e
il ripristino lo rimette dov'era, byte per byte.

## Cartelle nuove

Il comando `folder.create` (`path` obbligatorio) crea una cartella vuota,
insieme alle cartelle mancanti sopra di lei. L'explorer lo invoca dal menu
contestuale di una cartella o del titolo del pannello; la palette lo raggiunge
come ogni altro comando. Il nome segue le regole di un documento che nasce:
recinto del vault, `.fub/`, nomi nascosti e caratteri riservati sono
rifiutati, e una cartella esclusa dalle impostazioni non viene creata. Se il
path è già occupato da una cartella o da un file, l'esito è un conflitto e il
disco resta invariato. La prova a vuoto esegue lo stesso controllo senza
scrivere. La creazione non è annullabile dal registro dei comandi.

## Rinominare, spostare e cestinare una cartella

`folder.rename` (`folder` e `to` obbligatori) porta una cartella intera a un
path nuovo: rinominarla e spostarla sono lo stesso comando. Ogni voce che
contiene, note e allegati, si sposta con la rinomina del kernel, che riscrive i
link entranti come per una nota sola. Icona, ordine manuale, voci fissate e
spazi scritti per la cartella o per ciò che contiene seguono il path nuovo.

- Una destinazione che ha già voci, o un file con quel nome, è un conflitto e
  il disco resta invariato. Una cartella non va dentro sé stessa.
- Un cambio soltanto di maiuscole passa da una cartella di transito, così regge
  anche su un disco che non distingue le maiuscole.
- L'operazione è tutto o niente: se una voce non si sposta, quelle già spostate
  tornano indietro insieme all'organizzazione. Un link entrante che non si
  riscrive dopo che il file si è spostato è un avviso, non un rollback.
- La prova a vuoto unisce i piani di rinomina di ogni voce senza scrivere.
- L'annullamento è la rinomina inversa, con un passo solo.

`folder.trash` (`folder` obbligatorio) mette nel cestino del vault ogni voce
della cartella e poi toglie le cartelle rimaste vuote. Se una voce non entra
nel cestino, le altre vengono ripristinate. L'annullamento ripristina ogni voce
al suo path; le sottocartelle vuote non tornano.

Nell'explorer il menu contestuale di una cartella offre «Rinomina» (F2), «Sposta
in…» ed «Elimina» (Canc), che chiede sempre conferma. Una cartella trascinata su
un'altra, o sul fondo del pannello, ci entra con `folder.rename`, mai dentro sé
stessa. Prima del comando la shell salva i buffer aperti; le cartelle espanse e
lo spazio attivo seguono il path nuovo, e l'esito offre «Annulla».

## Approfondimenti

- [Vault e file](vault-and-files.md)
- [Ricerca, link e grafo](search-links-and-graph.md)
