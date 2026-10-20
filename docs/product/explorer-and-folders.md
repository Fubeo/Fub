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
«Mostra la cartella degli allegati», dalla palette, apre nell'albero la
cartella di `files.attachment-folder`, dove finiscono gli allegati incollati o
trascinati. Se la cartella non c'è ancora lo dice e non la crea: la crea il
primo allegato. Una cartella che comincia con `./` segue la nota, come in
Obsidian: con `./` l'allegato va accanto alla nota, con `./allegati` in una sua
sottocartella, e un `![[foto.png]]` nudo si cerca prima lì. Il comando apre
allora quella della nota aperta. Lo stesso vale per `files.new-note-folder`:
con `./` una nota nuova nasce accanto a quella aperta, e vince sullo spazio
attivo; una cartella scelta da chi crea (il menu di una cartella) vince su
tutto, e senza una nota aperta si parte dalla radice. La regola è
`fub_abi::rules::folders::for_note`, con la gemella `folderForNote` nella shell.
«Filtra l'esplora per percorso» (`shell.explorer.filter`, dalla palette) apre
un campo sopra l'albero. Con del testo l'albero cede il posto a un elenco
piatto delle voci e cartelle dello spazio il cui percorso intero contiene ogni
parola, senza badare alle maiuscole. `-parola` toglie ogni voce con un pezzo di
percorso che la contiene, quindi una cartella sparisce con tutto il contenuto;
fra virgolette una frase vale una parola. Invio apre la prima voce, una
cartella scelta chiude il filtro e si apre nell'albero, Esc chiude il filtro.
L'elenco disegna duecento voci alla volta e dice quante ne restano.
Il campo del pannello dei segnalibri segue la stessa regola, sul nome e sul
percorso del segnalibro.
Nella testata del foglio ogni cartella del percorso della nota si preme col
puntatore: l'albero la apre e la porta in vista. Il nome resta il titolo che
si rinomina col doppio clic o con F2.

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
in…» ed «Elimina» (Canc), che chiede conferma finché l'impostazione del vault
`files.confirm-trash` non è spenta; l'esito offre «Annulla». Una cartella trascinata su
un'altra, o sul fondo del pannello, ci entra con `folder.rename`, mai dentro sé
stessa. Prima del comando la shell salva i buffer aperti; le cartelle espanse e
lo spazio attivo seguono il path nuovo, e l'esito offre «Annulla».

## Trascinare

Dentro l'albero una nota, un file o una cartella lasciati su una cartella ci
entrano: è la stessa rinomina del menu «Sposta in…», con i link riscritti e
l'annullamento. Lasciati fra due fratelli dello stesso tipo cambiano l'ordine
manuale. Una cartella non entra in sé stessa né in una sua figlia. Le voci
della scelta multipla (Ctrl-clic, Maiusc-clic) si trascinano insieme. Una
cartella chiusa sotto il cursore si apre dopo una breve sosta.

Ctrl-C (Cmd-C sul Mac) su una nota o un file, o «Copia» nel suo menu, ne
ricorda la copia, con le altre voci scelte se è fra loro; Ctrl-V su una cartella
o su una sua voce, o «Incolla» nel menu della cartella, la scrive lì. Niente si
scrive prima di incollare. La copia porta gli stessi byte (`note.duplicate` con
`folder`): in un'altra cartella tiene il nome dell'originale se è libero, nella
stessa diventa «Nota copia», e un nome preso non si sovrascrive. Le cartelle non
si copiano.

Una nota lasciata in un documento diventa un collegamento, un file un rimando
relativo al documento; più voci entrano nell'ordine dell'albero. Un
collegamento web del sistema (`.webloc`, `.url`) lasciato in una nota diventa
un link alla pagina col nome del file come testo; uno che non si legge, o con
uno schema diverso da `http`, `https`, `mailto` e `ftp`, entra come allegato.

Da e verso gli altri programmi:

- file e cartelle del sistema lasciati su una cartella dell'albero, o sul
  titolo del pannello per la radice, entrano nel vault con la loro struttura.
  Su una nota o su un file entrano nella sua cartella. La scrittura è «solo
  creazione»: un nome preso, anche soltanto per maiuscole, diventa il primo
  libero (`foto 1.png`, `Viaggio 1/`) e niente si sovrascrive. Un file oltre
  64 MiB, un nome inservibile o una scrittura rifiutata restano fuori e
  l'esito li elenca uno per uno col perché;
- «Importa file…» e «Importa una cartella…», nel menu di una cartella e del
  titolo, fanno lo stesso con il selettore del sistema, senza trascinare;
- una voce trascinata fuori offre il file vero sul disco: `text/uri-list` con
  l'URL `file://`, il path in `text/plain` e, per una voce sola, `DownloadURL`.
  Un file manager o un altro programma lo riceve da lì; Fub non ne fa una
  copia.

Perché la webview riceva i file rilasciati, la finestra Tauri ha
`dragDropEnabled: false`: con il valore predefinito il rilascio lo
intercetterebbe Tauri, e su Windows la pagina non lo vedrebbe.

## All'avvio

La finestra riapre le schede e la disposizione della volta precedente.
L'impostazione di vault `files.startup` può aprirci sopra la nota del giorno
(`daily`, col comando `note.daily`), una nota nuova (`new`) o una nota precisa
(`note`, il percorso in `files.startup-note`, con `.md` se manca l'estensione).
Una nota precisa che non c'è più si dice con un avviso e non apre una scheda
vuota. Cambiare vault riprende soltanto le sue schede.

Un avvio che con l'ultimo vault supera gli otto secondi si dice con un avviso:
quanto è durato e quale tratto è stato il più lungo (il caricamento della
pagina, l'avvio della shell o l'apertura del vault). «Copia i tempi» mette negli
appunti la durata di ogni tratto.

## Approfondimenti

- [Vault e file](vault-and-files.md)
- [Ricerca, link e grafo](search-links-and-graph.md)
