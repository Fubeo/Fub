# Disegni, tasti del motore

> **Per chi:** chi disegna nello spazio Completo e usa i comandi del motore
> con la tastiera.
> **Risultato:** sapere quale tasto fa partire un comando, chi vince quando due
> tasti coincidono, e quando un tasto non parte.

Col Completo aperto, ogni comando del motore che ha un tasto lo fa partire con
quel tasto. Vale questo ordine:

- **Di Fub restano solo i tasti della finestra**: salva (`Ctrl+S`), chiudi
  (`Ctrl+W`, `Ctrl+Maiusc+W`), le schede (`Ctrl+Tab`, `Ctrl+Pag Su/Giù`), la
  tavolozza (`Ctrl+P`, `Ctrl+Maiusc+P`, `Ctrl+K`), apri (`Ctrl+O`), nuova nota
  (`Ctrl+N`), le impostazioni (`Ctrl+,`) e le zone (`F6`). Restano all'editor,
  come in VectorCraft, annulla e ripeti (`Ctrl+Z`, `Ctrl+Maiusc+Z`), copia,
  taglia e incolla (`Ctrl+C`, `Ctrl+X`, `Ctrl+V`, `Ctrl+Maiusc+V` incolla sul
  posto: il browser li manda agli appunti del Completo) e la vista: `Ctrl+Y`
  contorni, `Ctrl+'` griglia, `Ctrl+Maiusc+'` aggancio alla griglia, `Ctrl+0` e
  `Ctrl+Alt+0` adatta, `Ctrl+1` 100%, `Ctrl+=` e `Ctrl+-` zoom,
  `Ctrl+Maiusc+/` cerca i comandi. Ogni altro tasto con `Ctrl` o `Alt` è del
  motore, anche dove lo Standard o la shell ne fanno altro: per esempio `Ctrl+G`
  raggruppa, `Ctrl+2` blocca, `Ctrl+3` nasconde, `Ctrl+D` ripete la
  trasformazione, `Ctrl+F` incolla davanti, `Ctrl+B` incolla dietro, `Ctrl+/`
  aggiunge un riempimento. I tasti dell'editor di Fub senza un pari in
  VectorCraft (immagine, collegamento, isola, allinea con `Alt`) non valgono.
  Senza motore (non ancora caricato) i tasti sono quelli dello Standard.
- **Due comandi del motore con lo stesso tasto**: vince l'ultimo assegnato, e
  l'altro resta senza tasto.
- **Un comando con parametri** apre la sua finestra; **gli altri girano
  subito**. Se la parte del disegno che li fa non è ancora arrivata, il comando
  aspetta e lo dice, e parte appena è pronta.

## Gli strumenti del motore

Gli strumenti del motore pronti nel Completo prendono la lettera di VectorCraft,
anche dove nello Standard la stessa lettera sceglie uno strumento di Fub:
Selezione (`V`), Selezione diretta (`A`), Lazo (`Q`), Penna (`P`), Aggiungi e
Togli punto (`+` e `-`), Punto di ancoraggio (`Maiusc+C`), Testo (`T`), Segmento
(`\`), Rettangolo (`M`), Ellisse (`L`), Pennello a macchia (`Maiusc+B`), Matita
(`N`), Gomma (`Maiusc+E`), Forbici (`C`), Ruota (`R`), Rifletti (`O`), Scala
(`S`), Costruzione forme (`Maiusc+M`), Sfumatura (`G`), Contagocce (`I`), Mano
(`H`), Ruota vista (`Maiusc+H` senza selezione) e Zoom (`Z`). Col motore
presente nessuna lettera sceglie uno strumento di Fub: una lettera di uno
strumento non ancora pronto (per esempio `E`, Trasformazione libera) non fa
niente, e `Maiusc+H`/`Maiusc+V` non capovolgono. La lettera da sola e quella con
`Maiusc` sono due tasti. Il Completo si apre sempre sulla Selezione di
VectorCraft, qualunque strumento fosse acceso prima, e ci torna dopo `Esc` su un
tracciato e all'uscita dal testo, come VectorCraft. Senza motore (non ancora
caricato) restano i tasti di Fub.

Un tasto **non parte** mentre si scrive: in un campo di testo, mentre un IME
compone, e con una lettera, una cifra o un segno quando lo strumento vuole il
testo. Un tasto con `Ctrl`, `⌘` o `Alt` parte anche allora.

Un tasto con `Maiusc` su un segno o una cifra non si assegna, perché su
un'altra tastiera è un altro tasto. Su macOS `Ctrl` e `⌘` restano quelli di
sempre: `⌘` è il tasto di Fub, `Ctrl` è Control.

Il menu ≡ e la ricerca dei comandi mostrano il tasto che fa partire il comando, cioè lo
stesso di questa regola: un comando il cui tasto è di Fub, o che ha perso un
conflitto, non ne mostra nessuno. Finché l'indice dei comandi non è arrivato,
nessun tasto è mostrato.

## I tasti senza Ctrl col motore

Col motore presente i tasti senza `Ctrl` o `Alt` sono quelli di VectorCraft:

- le frecce spostano la selezione (`Maiusc` per il passo grande, `Alt` per
  spostare una copia), col comando Sposta leggermente del motore;
- `Canc` e `Backspace` cancellano la selezione (o i punti scelti con la
  Selezione diretta);
- `D` riempimento e contorno predefiniti, `X` scambia il lato attivo,
  `Maiusc+X` scambia i colori, `/` nessun colore, `,` l'ultimo colore, `.`
  l'ultima sfumatura, `Maiusc+D` la modalità di disegno;
- `Esc` e `Invio` vanno prima allo strumento; senza niente da chiudere `Esc`
  toglie la selezione;
- la lettera di uno strumento lo sceglie (sopra).

Mentre lo strumento Testo scrive, le lettere, le frecce, `Invio` e `Canc` sono
del testo. I tasti che aveva solo lo Standard (`Tab` fra gli oggetti,
`Pag Su/Giù`, `Home` e `Fine`, `Spazio` per afferrare, `F2`, `?`, le cifre,
`Maiusc+1` e `Maiusc+2`, `[` e `]` per ruotare, `#` e `%` per la griglia) non
valgono.

## Cambiare i tasti

In **Impostazioni › Scorciatoie**, la sezione **«Disegno completo»** elenca i
comandi del motore che hanno un tasto da scegliere. Il riquadro «Comandi e
tasti del Disegno completo» si apre a richiesta: solo allora arriva la parte
del disegno che conosce i comandi, e un'Impostazioni aperta senza aprirlo
non la carica.

- **Ogni riga** mostra il nome del comando, dove sta nel menu, e il tasto
  che vale, scritto come le altre scorciatoie (`Mod-Shift-K`). Sotto dice se un
  tasto di Fub lo copre (vince Fub, il comando resta senza) o se un altro
  comando lo ha preso dopo (vince l'ultimo assegnato). La diagnosi cambia
  mentre si scrive, prima di salvare.
- **Cambiare un tasto** lo salva quando si esce dal campo; un campo vuoto vuol
  dire «nessun tasto». Un tasto che non si sa premere (una lettera senza
  modificatori, `Maiusc` su un segno) lo dice e non salva niente. «Azzera»
  torna al tasto del motore.
- **L'insieme di tasti** sceglie fra quelli del motore: «Di serie» e
  «Classico». Con dei tasti cambiati la scelta mostra «Personalizzato», e
  sceglierne un altro chiede conferma, perché toglie i tasti cambiati.
- **«Importa un insieme…»** legge un file d'insieme del motore
  (`vectorcraft-shortcuts`, versione 1) scelto con la finestra dei file. I
  tasti dei comandi che questo Fub non ha restano fuori, e lo dice. Un file
  rotto, di una versione più nuova o con un tasto che non si sa premere dice
  perché e **non cambia niente**. Con dei tasti cambiati, chiede conferma.
- **«Esporta l'insieme…»** salva lo stesso formato con la finestra di
  salvataggio, per un altro computer o per il motore.

I tasti cambiati valgono **subito** nel disegno aperto, senza riaprirlo, e sono
di questa macchina: l'impostazione `draw.keys` (feature `draw`), un JSON con la
sua versione, `{"v":1,"insieme":null,"tasti":{"<comando>":"Mod-j"}}`, dove
`null` è «nessun tasto». Un valore che non si legge vale come i tasti del
motore; uno scritto da un Fub più nuovo vale per i tasti che si capiscono. In
tutti e due i casi la sezione lo dice, spegne i controlli e offre solo
«Azzera i tasti del Disegno completo», per non riscriverlo perdendo ciò che
non capisce.
