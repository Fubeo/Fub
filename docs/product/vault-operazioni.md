# Operazioni sul vault

> **Ambito:** il comportamento visibile di note, cartelle, cattura e
> import/export. Parte di [Vault e file](vault-and-files.md).
> **Fonti autorevoli:** il codice di `fub-kernel` e `fub-host`.

## Destinazione delle nuove note

`files.new-note-folder` è un'impostazione del vault. Il valore vuoto crea le
note nella radice; un nome semplice viene creato nella cartella configurata,
mentre un path esplicito conserva la propria cartella. La scelta del nome libero
e il controllo delle collisioni avvengono nel kernel insieme alla scrittura,
senza una verifica separata nella shell.

`files.new-note-extension` sceglie l'estensione di una nota creata senza
estensione; il valore predefinito è `md`. Un nome la riceve quando il suo
ultimo segmento non porta già un'estensione servita da un formato del vault:
`Idee` diventa `Idee.md`, `Lavagna.canvas` resta un canvas e `Report v1.2`
diventa `Report v1.2.md`. Se nessun formato installato serve l'estensione
scelta, i comandi che creano note rispondono con un errore e non scrivono un
file che il vault non saprebbe aprire.

«Nuovo disegno» (`drawing.create`, con la feature `draw`) fa nascere un disegno
vuoto e lo apre. Senza nome si chiama «Disegno», o «Disegno 1», «Disegno 2», …
nella lingua di chi lo crea, con le cifre della convenzione dei nomi liberi. Un
nome senza estensione riceve `.svg`, e uno con l'estensione di un altro formato
non è un disegno. Un nome semplice nasce nella cartella `folder`, se è data,
altrimenti nella radice; un path esplicito conserva la propria cartella. Un nome
occupato è un errore e mai una sovrascrittura, e prima di scrivere il nome passa
la regola dei nomi nuovi. Senza `template`, o con `blank`, il file lo scrive il
provider dei disegni, con il nome per titolo e «Livello 1». Con un altro
`template` è il file di quel modello, nella lingua di chi lo crea; con `from` è
la copia di un disegno del vault, e un modello e `from` insieme sono un errore.
In tutti e due i casi il `title` della radice diventa il nome. La finestra che
offre i modelli è in [Disegni, modelli e suggerimenti](drawing-new.md). La prova
a vuoto fa gli stessi controlli e non scrive; l'annullamento manda il disegno nel
cestino. Documenti e fogli: [Documenti e fogli nuovi](new-documents.md).

«Annota il PDF» (`pdf.annotate`, con la feature `draw`) apre le annotazioni di
un PDF del vault: il file `X.pdf.fubann` accanto a `X.pdf`, con il nome intero
del PDF più `.fubann`, perché è il nome a legarle al PDF. Se il file c'è, il
comando lo apre e basta, senza scrivere e senza annullamento. Se non c'è, lo
scrive il provider delle annotazioni (radice, titolo e `fub:annotates`) e lo
apre; l'annullamento lo manda nel cestino. Il nome passa la regola dei nomi
nuovi prima di scrivere, un nome preso da un altro file è un errore, e un nome
che non finisce con `.pdf` o un PDF che non c'è non si annotano. Il PDF non si
scrive mai. Impronta e numero di pagine li scrive l'editor col primo gesto,
come racconta [Annotazioni dei PDF](pdf-annotations.md).

## Explorer e cartelle

L'albero dei file, le cartelle nuove e le operazioni su una cartella intera
(rinomina, spostamento, cestino) sono descritti in
[Explorer e cartelle](explorer-and-folders.md).

## Cattura rapida

Il clipper del browser, la condivisione mobile, `fub-cli capture` e l'URI
`fub://capture` scrivono tutti con lo stesso comando dell'host,
`capture.apply`. Il parametro `payload_json` porta il payload capture v1 come
testo JSON; `template` è facoltativo e vale soltanto per una cattura che crea.
La validazione è la stessa per ogni trasporto: titolo su una riga, testo non
vuoto, `source_url` http o https senza credenziali, e `vault`, `folder` e
`note` dentro il recinto del vault. L'host nativo del clipper si installa come
in [Permessi e sicurezza](../reference/permissions-and-security.md#host-nativo-del-clipper).

- `create` crea la nota con `note.create`, o con `note.from_template` se c'è
  un template. Il nome è `note` se c'è; altrimenti il titolo diventa un
  segmento portabile, senza caratteri riservati e al più di 80 caratteri. Un
  nome occupato è un conflitto e la nota esistente resta intatta.
- `append` e `prepend` scrivono in una nota esistente; `prepend` scrive dopo il
  frontmatter.
- `daily` scrive nella nota del giorno, che `note.daily` crea se manca.

Il blocco scritto contiene il titolo come intestazione `# …`, il testo e, se
c'è, la riga della fonte nella lingua del vault. Una riga vuota separa le parti
e il blocco dal testo vicino, e il blocco usa i terminatori di riga del
documento. La destinazione deve essere un formato di testo, e le proprietà
vogliono un formato con frontmatter: un canvas o una base sono rifiutati prima
di qualunque scrittura.

L'ordine delle scritture rende sicuro un nuovo tentativo. Tutti i controlli
vengono prima; poi si scrivono le proprietà, che ripetute non cambiano niente;
per ultimo il testo, in una sola scrittura che discende dalla revisione letta.
Una nota nata dalla cattura e rimasta senza testo torna nel cestino. La prova a
vuoto dice quale documento verrebbe scritto.

`fub://new` segue le stesse regole di nome e di titolo: senza `name` il nome
viene dal titolo, e il titolo va in testa al corpo, dopo l'eventuale
frontmatter del template.

## Collegamenti `fub://` sul desktop

Il sistema consegna un `fub://` all'app desktop, anche quando l'app parte
proprio per aprirlo. L'host tiene i collegamenti in una coda della macchina,
che resta valida anche senza un vault aperto e prima che esista una finestra.
La coda ne tiene al più 32 e conta quelli che non ha preso. L'evento
`fub://pending-action` sveglia la finestra, che prende la coda con
`uri.pending` all'avvio e a ogni evento. Ogni collegamento si prende una
volta.

`uri.pending` descrive ogni collegamento: l'azione, se scrive, il vault chiesto
con la sua radice e se è quello aperto. Un vault si riconosce dalla radice o da
un nome unico fra i vault noti. Un collegamento non valido, o con una callback,
arriva con il motivo e non si esegue.

- `open` apre la nota al titolo o al blocco chiesti, nel riquadro col fuoco,
  in uno nuovo (`split`) o in una finestra (`window`). Una nota che non c'è si
  dice e non si crea.
- `search` apre la ricerca con il testo e i filtri `tag:` e `folder:`.
- `new`, `daily`, `unique` e `capture` scrivono con `uri.apply`, dopo la prova
  a vuoto (quale nota nascerà, l'inizio di una cattura) e la conferma; le
  azioni in `uri.allowed` (di macchina, vuota di default) scrivono subito.

Un collegamento per un altro vault noto apre quel vault dopo una conferma, con
lo stesso flusso del pulsante. Se il vault non si apre, il collegamento si
ferma. Un vault sconosciuto non si apre mai da un collegamento.

## Bozze

Una bozza protegge testo che non è ancora diventato una scrittura riuscita sul
documento. Le bozze appartengono al vault e non sostituiscono il file
autorevole.

Il lifecycle dell'editor deve eseguire flush, eventuale persistenza della bozza
e teardown nell'ordine previsto quando si chiude l'ultima superficie.


## Cartelle esterne

Le cartelle esterne non vengono scoperte né collegate automaticamente. Dopo aver
scelto un path assoluto, l'utente può usare i comandi generici `mount.add`
(`name`, `target`, `namespace`), `mount.list` e `mount.remove` (`name`).
L'elenco restituisce rotte tipizzate con namespace stabile e target, e le dice
anche in un messaggio, con le cartelle configurate che non si raggiungono; i
tre comandi confermano l'esito anche dalla palette. I path
relativi risolti nel namespace restano recintati, senza attraversare `..`,
separatori Windows o symlink. Alla registrazione gli antenati del path scelto
si risolvono una volta (su macOS `/var` è `/private/var`) e si salva il path
reale; da lì in poi un antenato che diventa symlink/reparse rende la rotta
inattiva. Sono rifiutati un target che è esso stesso symlink/reparse, anche
penzolante, root del vault in qualunque forma la si nomini, `.fub/`, cartelle sovrapposte, alias e filesystem che non
forniscono identità e stat senza seguire i collegamenti. Se una destinazione
registrata è scollegata o cambia identità, Fub apre comunque il vault con la
rotta inattiva e una diagnostica; `mount.remove` resta disponibile. Il registro
resta nel vault, ma il contenuto esterno resta fuori da scansione e snapshot:
scollegarlo o rimuovere la rotta non cancella né sposta alcun file esterno.

## Cartella `.fub/`

La classificazione precisa è in
[`../reference/on-disk-layout.md`](../reference/on-disk-layout.md).

La regola importante è per voce, non per cartella:

- impostazioni, organizzazione, bozze, versioni e storage di un plugin possono
  contenere dati non ricostruibili;
- anagrafe e indici possono essere ricreati dal vault;
- un file sconosciuto non va cancellato soltanto perché si trova sotto
  `.fub/data/`.

## Compatibilità con altri strumenti

Fub comprende convenzioni usate nei vault Markdown, tra cui frontmatter YAML,
wikilink, tag, heading, ancore ed embed. Il provider decide la semantica del
formato; il kernel conserva path e sorgente senza incorporare regole Markdown.

Le proprietà del frontmatter restano nel file. Un vault può dichiararne il tipo
per nome nell'impostazione versionata `properties.types`, che sceglie widget e
semantica di query senza spostare valori in un database. Gli aggiornamenti
strutturati modificano la sola chiave interessata e conservano commenti, ordine,
virgolette, terminatori e corpo; rinominare o togliere una chiave da tutto il
vault (`property.key.rename`, `property.key.delete`, `property.keys.migrate`)
si vede in anteprima e si annulla. YAML non rappresentabile resta sorgente.

## Importare ed esportare

Importare note da altri programmi ed esportare il vault, o una sua cartella,
ha una pagina propria: [Importare ed esportare](import-and-export.md).
