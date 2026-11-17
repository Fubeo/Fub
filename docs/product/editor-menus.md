# Tasto destro, mini-barra e «/»

> **Per chi:** chi scrive e lavora negli editor di Fub e chi aggiunge un menu
> a una superficie.
> **Risultato:** sapere cosa offre il tasto destro in ogni editor, quando
> compare la mini-barra e come si usa il «/» nelle note.

## L'anatomia del menu

Il tasto destro, il tasto Menu o Maiusc+F10 aprono in ogni editor un menu con
le stesse parti, nello stesso ordine; una parte vuota non c'è.

1. **La testata**, in una riga: che cosa sta sotto il puntatore, con l'icona
   d'accento, la specie in grassetto e il nome, per esempio «Titolo 2
   Formula», «Link alla nota Media» o «Paragrafo La mostra apre il 20 marzo
   nella…» (le prime parole del paragrafo, al più 34 caratteri; «vuoto» su una
   riga vuota).
2. **La barra degli appunti**: Taglia, Copia e Incolla alla pari, su un fondo
   tenue, se almeno due si possono fare; con uno solo, «Incolla» è una voce
   come le altre.
3. **Le voci del posto**, nei loro gruppi.
4. «Formato ▸», soltanto dove non c'è la mini-barra.
5. «Dai plugin ▸», dopo le voci di Fub.
6. In fondo, in rosso, ciò che cancella.

Ogni voce sta in una riga sola: l'icona da 16 nel suo posto da 24 (d'accento
quando la voce è accesa), il nome e a destra, in grigio e in monospazio, la
scorciatoia o la freccia del sottomenu. La scorciatoia si scrive coi tasti
separati da uno spazio e coi nomi della tastiera italiana: «Ctrl K», «Ctrl
Maiusc V», «Canc»; a chi ascolta arriva com'è (`aria-keyshortcuts`). Fuori dai
menu (suggerimenti, spazio comandi) resta la forma «Ctrl+K». Una spiegazione non va
mai a capo: sta a destra in grigio, tagliata se non ci sta. Una voce che offre
due o tre gesti col loro segno, come **Copia come**, li tiene nella riga
invece che in un sottomenu: tre tastini coi segni di Markdown, HTML e testo
senza formattazione. Accesa la riga, il nome del formato scelto compare
accanto («Copia come HTML»), ← e → cambiano formato e Invio copia; chi ascolta
sente il nome intero su ogni tastino. Con più scelte, o senza un segno
riconoscibile, resta il sottomenu.

Le parti del menu sono i pezzi della **lingua dei menu** del kit, gli stessi
che usano lo spazio comandi e il «/»:

- **la riga** (`kit/row.ts`): una linea sola da 34 px (38 nello spazio
  comandi), con la figura da 24, il nome che si taglia coi puntini, a destra
  la nota in grigio o la scorciatoia in monospazio, e la freccia di un
  sottomenu;
- **la tessera** (`kit/tile.ts`): affiancata, come le parti della barra degli
  appunti, o in pila, una figura in un quadrato da 40 px con gli angoli da 11
  e il nome sotto; senza icona, il quadrato porta un segno o la prima lettera
  del nome;
- **l'etichetta di un gruppo** (`kit/group-label.ts`): 11,5 px, quieta; per chi
  ascolta, il gruppo ha già il suo nome, o lo prende da lei.

Ogni pezzo ha gli stessi stati: acceso (la figura d'accento, sul fondo del
passaggio per la riga e sulla linguetta chiara e rialzata per la tessera
affiancata), premuto (la spunta d'accento al posto della figura, la linguetta
d'accento per la tessera affiancata, senza moto quando il movimento è ridotto)
e spento, che resta al suo posto e dice il perché. Chi fa scivolare una sua
pastiglia da un pezzo all'altro, come il menu, lo dichiara sul contenitore
(`markGlideHost`), e lì i pezzi non mettono il loro fondo. Il catalogo li
mostra nella scena `kit-lingua` del banco (`bench/kit.html?lingua`).

Le voci non scrivono i tasti per muoversi nel menu (frecce, Invio, Esc): li
mostra la riga dei suggerimenti, o il piede dei tasti del menu della maniglia.
Una scorciatoia con un modificatore, come Ctrl Invio, è un gesto e si scrive.

**La scelta è una sola**, fra la barra e l'elenco: la indica una pastiglia che
scivola da una voce all'altra, o nella barra una linguetta chiara e rialzata.
Il puntatore la sposta e quando esce dal menu resta dov'era; mai due cose
accese insieme. ↑ dalla prima voce sale alla barra, ↓ dall'ultima ci torna, ←
e → cambiano parte; senza la barra l'elenco fa il giro. Una parte della barra
o un formato premuti si fanno d'accento con la spunta, poi il menu si chiude e
il gesto si fa una volta sola.

Tutto il resto non ruba un posto: si trova **scrivendo**. Il piede, una fascia
tenue, dice «Scrivi per trovare altro»; scrivendo mostra ciò che si è scritto,
l'elenco tiene prima le voci del menu che corrispondono e poi, sotto «Altri
comandi», quelle che si trovano solo scrivendo. Backspace torna indietro, Esc
svuota la ricerca prima di chiudere il menu. Se non trova niente offre «Cerca
… fra tutti i comandi», con a destra il suo tasto.
Lì stanno Incolla senza formattazione (che ha anche Ctrl Maiusc V), i comandi
del vault dichiarati per il «/», Cerca nel documento, Cerca nel vault (sul
testo scelto), Seleziona tutto e le voci in più dell'editor. «Cerca
nel documento» c'è dove l'editor ha la sua barra di ricerca: note, documenti
di Word, codice; non su PDF, immagini, fogli e lavagne.

Ogni menu tiene al massimo nove voci e quattro gruppi al primo livello. Una
voce che adesso non si può fare non c'è; resta grigia soltanto quando dice
perché. Le parole sono quelle del lessico dei menu (`i18n/lexicon.ts`): «Togli
il link», «Apri con un'altra app», «Mostra nell'esploratore», «Incolla senza
formattazione».

Lo stesso lessico tiene le parole dei componenti, uguali nella pagina
«Componenti» delle impostazioni, nel riquadro di un file il cui editor è spento
e nella riga di comando: Componente (non «Plugin», «Estensione», «Modulo»),
Accendi e Spegni (non «Abilita», «Disabilita», «Disattiva»), Serve a, Non serve
più, Togli, Tienili, Profilo, personalizzato, più avanti e solo come file. Le
voci di un componente spento non ci sono nei menu (barra laterale, «Nuovo» e
«Apri» dell'esploratore, menu dell'app, tasto destro); tornano quando si
riaccende, senza ricaricare. Un file di un componente spento si apre lo stesso,
«solo come file»: nome, dimensione, «Accendi …» e «Apri con un'altra app».

In una nota Markdown in scrittura le voci del posto sono:

| Sotto il puntatore | Voci |
|---|---|
| Testo | Incolla; Trasforma il blocco ▸, Inserisci un blocco… (`/`); Copia il link a questo punto |
| Selezione | la barra degli appunti; Collega a una nota… (Ctrl K), Copia come (i tre formati nella riga); Estrai in una nota nuova |
| Link alla nota | Apri, Apri a lato, Copia il link, Togli il link |
| Indirizzo web | Apri nel browser, Copia l'indirizzo, Togli il link |
| Immagine | Apri nel visore, Copia l'immagine, Larghezza ▸, Sostituisci l'immagine…, Mostra nell'esploratore |
| Tag | Cerca le note con questo tag, Rinomina il tag ovunque…, Copia il tag |
| Titolo | Copia il link al titolo, Piega la sezione, Estrai la sezione in una nota, Livello ▸ |
| Elenco e attività | Segna come fatta, Aumenta o Riduci il rientro, Tipo di elenco ▸ |
| Blocco di codice | Copia il codice, Linguaggio ▸, «Togli il blocco, tieni il testo» in fondo |
| Tabella in Sorgente | Inserisci ▸, Sposta ▸, Elimina la riga e Elimina la colonna in fondo |
| Parola sbagliata | le correzioni, Aggiungi al dizionario, Ignora in questa nota |

Il tasto destro fuori dalla selezione porta lì il cursore; dentro, la lascia.
In Lettura il menu offre «Modifica qui», che porta il cursore nel punto
cliccato, «Copia il link a questo punto» e «Copia la nota come», coi tre
formati nella riga. Il tasto
destro su un link in Live lascia il cursore dov'è, così la sintassi del link
resta nascosta. Aperto col mouse, il menu tiene il fuoco su di sé e niente è
acceso: la prima freccia sceglie la prima voce, o l'ultima con la freccia su.
Dal tasto Menu o da Maiusc+F10 il fuoco va subito alla prima voce, non alla
barra.

Il menu nasce dal punto del clic, in meno di un quinto di secondo: testata,
barra e voci arrivano una dopo l'altra, il sottomenu entra da destra, e
chiuso il menu sfuma senza muoversi. I menu a tendina entrano con una
dissolvenza breve. Col moto ridotto niente si muove.

Dove Fub non ha un menu, il tasto destro non apre quello della WebView: resta
nei campi di testo, sul testo scelto, sul lettore audio e video e con
Maiusc+tasto destro, che dà sempre il menu del sistema.

## La mini-barra

La **mini-barra** è una fila compatta, scura di giorno e color foglio di
notte, con quest'ordine: «Trasforma» (lo stesso menu «Trasforma in» dello
stile nella [barra di formato](editor-toolbar.md)), Grassetto, Corsivo,
Sottolineato, Barrato, Codice in riga, Collega, Colore e «Commenta». Ogni
pulsante esegue l'azione della sua scorciatoia, con lo stesso passo
d'annullamento, e la sua didascalia dice la scorciatoia vera della persona
(Ctrl B, Ctrl K, Ctrl Alt M…). «Collega» fa ciò che fa Ctrl K: il riquadro
«Collegamento» in Live e in Blocchi, il wikilink in Sorgente. «Colore» apre
le due righe dei nove colori dei Blocchi, Testo e Sfondo; il colore già dato
alla selezione è segnato, e un clic lo toglie. «Commenta» apre il primo
messaggio della discussione sulla selezione, come Ctrl Alt M: su più blocchi
il commento va nel primo, nel codice o in una formula subito dopo il blocco.
Un pulsante che la nota non sa fare non c'è; in sola lettura sono tutti
spenti. Il puntatore non prende il fuoco, che resta al testo con la sua
selezione; da tastiera la fila è un punto di tabulazione con le frecce, ed
Escape torna al testo.

Sul testo scelto compare da sola quando la barra di formattazione è
nascosta, sopra la selezione (sotto se sopra non c'è posto) e senza uscire
dalla finestra; mentre il suo menu Trasforma o Colore è aperto resta ferma.
Se si apre il menu del tasto destro, la mini-barra ne prende la testa (E29).
L'impostazione «Mini-barra di formattazione» (`editor.minibar`) sceglie fra
`auto` (così), `always` (anche su ogni selezione con la barra accesa),
`menu` (solo col tasto destro) e `off`. Le scene `mini-barra-*` del banco la
fotografano.

## Il «/» nel testo

Il **«/»** scritto a inizio riga o dopo uno spazio apre il pannello dei blocchi
sotto la riga: una colonna sola, larga 352 px, che copre poco testo. Se sotto
non ci sta intero si accorcia, e l'elenco o il passo scorrono dentro (con la
scelta delle frecce, la rotella e il dito: il fuoco resta nell'editor), fino a
300 px (le tessere, un gruppo di tre righe e il disegno); solo se sotto non c'è
neanche quello si apre sopra la riga. Segue il cursore mentre la nota scorre,
e si chiude se il cursore esce dalla parola. Non esce mai dall'area del
documento: testata, barra degli strumenti e barra della finestra restano
scoperte (`slashPlacement` in `editors/text/profiles/markdown/slash.ts`). Sul
telefono, sotto i 600 px o col dito, è un foglio a tutta larghezza in fondo
alla finestra, sopra la tastiera, con righe da 44 px. Vale in ogni modalità di
scrittura; il «+» della maniglia mette un blocco vuoto e ci apre il «/».

- **In alto, i sei più usati**, come tessere con l'icona e una parola. In un
  vault nuovo: Attività, Titolo, Riquadro, Tabella, poi Punti e Codice (Base e
  Scheda le aggiungono i loro lavori). L'uso li riordina: prima i Preferiti,
  poi i blocchi scelti di recente, poi l'ordine scritto; una voce nascosta
  lascia il posto alla seguente, e stili e comandi del vault non diventano
  tessere (`byUse` in `panels/slash/rank.ts`). A menu appena aperto Invio mette
  la prima; ← e → scorrono le tessere.
- **Sotto, tutti i blocchi per gruppo**, una riga ciascuno: icona, nome e a
  destra, in grigio, ciò che si scrive per farne a meno (`- [ ]`, `##`), o «›»
  per le voci che aprono un passo. I gruppi sono Testo, Elenchi, Blocchi,
  Codice e formule, Collegamenti e media, Persone e date, Stile, Pagina e Dal
  vault; i loro titoli restano in cima mentre si scorre. Tab salta al gruppo
  dopo (le tessere sono una tappa), Maiusc+Tab torna.
- **In fondo, il disegno** della voce scelta: una miniatura della forma del
  blocco, che cosa fa in una frase, come scriverlo senza menu e gli argomenti
  rapidi («Scrivendo `##` · anche `/h2`»). La stella mette la voce fra i
  Preferiti; «Nascondi dal menu» la toglie dal «/», e resta un comando.
- **I tasti** non stanno nel pannello: li dice la riga dei suggerimenti della
  banda di stato (frecce, Invio, Tab per il gruppo dopo, Esc che lascia il
  testo, Ctrl+/ per tutti i comandi).
- **Trovare.** Scrivendo, l'elenco diventa uno solo, ordinato per
  pertinenza, con la parte trovata in evidenza, e in fondo «Cerca fra tutti i
  comandi». Con due lettere valgono gli inizi di parola, dei nomi in italiano
  e in inglese e dei sinonimi, e le iniziali («/ea» trova Elenco di attività);
  mai lettere sparse. Da tre lettere conta anche l'interno delle parole, da
  quattro si perdona un errore («/tabela» trova Tabella). Al massimo 12
  risultati. I comandi rapidi vanno in cima: «/tab 3x4», «/col 3», «/code
  py», «/h2», «/domani», «/venerdì», «/fra una settimana».
- **I passi.** Tabella (una griglia fino a 6 × 8), Colore (dieci testi e
  dieci fondi, col nome), Data (i giorni vicini e il mese), Riquadro (la
  galleria dei tipi), Link a una nota e Incorpora (le note, poi una sezione),
  Blocco di codice (i linguaggi) e Diagramma (i modelli Mermaid) si scelgono
  nello stesso riquadro, sotto una testata col nome del passo; ⌫ o Esc tornano
  all'elenco. I venti colori non sono voci del «/»: stanno sotto «Colore ›» e
  si trovano scrivendo («/blu»).
- **Niente trovato.** Il pannello resta aperto e lo dice («Nessun blocco per
  «qwerty».»); la sola riga, accesa, cerca fra tutti i comandi, con Invio o
  Ctrl+/. Esc lascia il testo com'è.
- **Con una selezione** il «/» apre «Trasforma»: niente tessere, solo ciò che
  cambia le righe scelte, e il disegno in fondo dice il dopo.

Scegliere una voce toglie il «/…» e applica il blocco come una sola modifica:
un Annulla fa tornare il testo scritto. «e/o», «24/09» e gli indirizzi non lo
aprono, né dentro codice, link e formule.

Le impostazioni, in Editor: «Menu «/» nel testo» (`editor.slash`) lo spegne;
`editor.slash.hidden` elenca gli id delle voci nascoste; `editor.slash.sections`
ordina i gruppi (quelli non detti seguono nel loro ordine). I blocchi sono
dichiarati da `fub.formatting`: spento il plugin, il «/» offre soltanto i
comandi del vault, senza tessere. Ogni voce resta un comando del registro, con
i suoi parametri (`markdown.table` con `rows` e `cols`).

## Gli altri editor

| Editor | Sotto il puntatore |
|---|---|
| Documenti di Word | link, revisione tracciata, tabella; la mini-barra di Word ([Documenti di Word](word-documents.md)) |
| Fogli di Excel | cella, intestazione di riga o di colonna, angolo, scheda del foglio, oggetto; la mini-barra di Excel |
| Tela (`.canvas`) | sulla carta: modifica, apri, colore, duplica, ordine, allinea e distribuisci, inquadra, elimina; sull'arco: colore, inverti, elimina; sul vuoto: aggiungi qui (testo, file, link, gruppo) nel punto cliccato, inquadra, zoom |
| Base (`.base`) | sulla riga o la scheda: apri la nota, copia il link `[[ ]]`, copia la riga; sulla cella: copia il valore, cerca questo valore, svuota la cella; sull'intestazione: raggruppa per la colonna, copia la colonna; in fondo la vista, la nota nuova e il CSV |
| Immagini | copia l'immagine, zoom, il link `![[ ]]`, apri con un'altra app, mostra nell'esploratore |
| PDF | copia e copia con la citazione `[[file.pdf#page=N]]` del testo scelto, copia il link alla pagina, annota, il link `![[ ]]`, apri esterno |
| Audio e video | sul lettore il menu del sistema; attorno, il link `![[ ]]` e apri esterno |

In Scrittura la maniglia di un blocco apre il suo menu col clic e col
tasto destro. In cima, al posto della testata, il campo «Cerca un'azione…»
col fuoco; sotto, quieto, il nome del blocco («Testo», «Riquadro», «3
blocchi»); poi Trasforma in ▸, Colore ▸ (Testo e Fondo, coi nove colori dei
Blocchi), Duplica (Ctrl D), Copia il link al blocco, ed Elimina (Canc) per
ultimo; in fondo il piede «↵ sceglie · → apre · Esc chiude». La prima voce è
accesa, e scrivendo nel campo l'elenco si filtra e si accende la prima
trovata: Invio sceglie l'accesa, ↓ va alla voce dopo, ↑ dalla prima torna al
campo, Esc svuota il campo prima di chiudere. Aperto col puntatore, il campo
ha il fuoco senza anello, come nel prototipo (lo dicono il cursore e la voce
accesa); il fuoco che ci torna dalla tastiera, o il Tab, gli dà l'anello di
casa. Per chi ascolta la superficie è un piccolo dialogo modale col nome del
blocco, che tiene il campo e, sotto, il menu delle voci: un menu ha soltanto
voci, e il campo non ci può stare dentro. Sposta su e giù (che hanno Ctrl Maiusc ↑ ↓ e il trascinamento) e
Affianca in colonne (che è anche il trascinamento accanto a un blocco) non
rubano un posto: si trovano scrivendo, sotto «Altri comandi». La griglia delle tabelle in Live ha la testata «Tabella», la barra
degli appunti, Inserisci ▸, Sposta ▸, Ordina la colonna ▸, Allinea la colonna
▸, Svuota la cella, e in fondo Elimina la riga e Elimina la colonna.

## L'albero, le schede e il riquadro

I menu dell'esploratore, della barra delle schede e del riquadro hanno la
stessa anatomia: una testata, le voci nei loro gruppi, i sottomenu dove le
voci sono parenti, «Sposta nel cestino» in rosso per ultimo.

| Dove | Voci |
|---|---|
| Nota | Apri a lato, Apri in una nuova finestra, Rinomina, Sposta in…, Duplica, Copia ▸ (il link, il percorso, il file), Appuntata, Organizza ▸ (icona, segnalibri, converti in cartella, ordine, mostra nella cartella del sistema, apri con un'altra app), Sposta nel cestino |
| Altro file | Apri, Apri a lato, Apri con un'altra app, Rinomina, Sposta in…, Copia ▸, Mostra le note che lo usano, Sposta nel cestino |
| Cartella | Nuova nota qui, Nuovo ▸ (cartella, disegno), Importa ▸, Rinomina, Sposta in…, Cerca nella cartella, Organizza ▸ (icona, usa come spazio, segnalibri, ordine, copia il percorso, esporta la cartella, mostra nella cartella del sistema), Sposta nel cestino |
| Titolo e spazio vuoto | Nuova nota, Nuova cartella, Nuovo disegno…, Ordina ▸, Comprimi tutto, Importa ▸ |
| Scelta multipla | Sposta in…, In una cartella nuova…, Copia i link, Sposta nel cestino |
| Scheda | Chiudi, Chiudi le altre, Chiudi anche ▸ (a destra, non appuntate, tutte), Appuntata, Dividi a destra, Apri in una nuova finestra, Pila ▸, Copia il percorso, Mostra nell'esploratore |
| Riquadro (⋯) | Dividi a destra, Dividi in basso, Sorgente accanto, Esporta ▸ (i formati, poi «Altro formato…»), Stampa, Presenta come slide, Registra audio, Chiudi la scheda, Chiudi il riquadro |

Si trovano scrivendo: Espandi tutto nel titolo dell'albero; Copia i file e
Deseleziona nella scelta; gli spostamenti fra riquadri e pile di una scheda;
apri e chiudi la sorgente nel riquadro. «Mostra le note che lo usano» apre il
file e la scheda dei collegamenti dell'ispettore. Il tasto destro su una nota
della scelta multipla apre il menu della scelta; fuori dalla scelta vale il
menu della nota.

### Apri con un'altra app

Senza app Craft installate «Apri con un'altra app» passa il file all'app
predefinita del sistema. Con almeno una installata (Fub lo chiede all'host
all'apertura del vault, e di nuovo quando cambia `craft.editor-paths` o si
accende o spegne il componente «File delle app Craft») la voce diventa un
sottomenu ▸: per prima «L'app predefinita del sistema», poi le app Craft che
aprono quel file, nell'ordine della
[tabella delle app](../reference/external-editors.md), chieste all'host
quando il sottomenu si apre. Un'app che apre il file ma non è installata si
vede spenta con la riga «Non installata»; una che Fub ha avviato e che non è
uscita porta la riga «Già aperta», e la scelta le passa il file. Un file che
nessuna app Craft apre (una nota, un file senza estensione) ha il sottomenu
con la sola app di sistema. Un'apertura che non riesce dice la frase
dell'host. Vale nel menu della nota (dentro Organizza ▸), in quello di un
altro file e in quello di un'immagine, di un PDF, di un audio o di un video
aperti; col dito il sottomenu si apre al posto del menu, con la voce per
tornare. Scegliere un'app Craft per un documento che ha una scheda aperta lo
presta all'app ([Il prestito](craft-files.md#il-prestito)).

Il disegno ha i suoi menu ([Disegni, selezione](drawing-selection.md)); la
griglia delle tabelle in Live ha il suo
([Tabelle](editor-tables.md#tabelle-in-live)).

## Dove si trova

- `apps/client/src/editors/core/editor-menu.ts`: le forme del menu di una
  superficie;
- `apps/client/src/panels/editor-menu.ts`: il compositore e l'apertura;
- `apps/client/src/panels/explorer.ts`, `explorer-selection.ts` e
  `document.ts`: i menu dell'albero, della scelta, delle schede e del
  riquadro;
- `apps/client/src/ui/menu.ts`: il menu, il fuoco, la tastiera e il moto;
  `apps/client/src/theme/scrittoio/skin/menus.css` il suo aspetto;
- `apps/client/src/editors/text/profiles/markdown/surface.ts` e `menu.ts`: le
  voci di una nota e ciò che sta sotto il puntatore;
- `apps/client/src/i18n/lexicon.ts`: il lessico dei menu;
- `apps/client/src/kit/row.ts`, `tile.ts` e `group-label.ts`: riga, tessera ed
  etichetta, vestite in `apps/client/src/theme/scrittoio/skin/kit.css`;
- `apps/client/src/ui/menu-budget.test.ts` coi casi di `ui/menu-cases.ts`: il
  bilancio di ogni menu (al più nove voci e quattro gruppi al primo livello,
  nessun tasto per muoversi scritto nel menu);
- `apps/client/src/editors/text/profiles/markdown/three-doors.test.ts`: le
  stesse azioni di blocco dal tasto destro, dalla barra di formato, dalla
  maniglia e da Ctrl O, e nessun pulsante sopra un blocco a riposo;
- `apps/client/src/ui/system-menu.ts`: il menu della WebView spento dove Fub
  non ne ha uno;
- `apps/client/src/panels/mini-bar.ts`: la mini-barra, e
  `apps/client/src/panels/selection-bubble.ts` che la posa sul testo scelto;
  `apps/client/src/editors/text/profiles/markdown/mini-bar.dom.test.ts`
  confronta ogni pulsante con la sua scorciatoia su una nota vera;
- `apps/client/src/panels/slash/` (voci, classifica, comandi rapidi, passi,
  pannello) e `apps/client/src/editors/text/profiles/markdown/slash.ts`
  (contesto e stato): il «/» nel testo;
- `crates/fub-features/src/formatting.rs`: le voci di blocco del «/»;
- [Superfici dell'editor](../architecture/editor-surfaces.md): le capacità
  `contextMenu` e `miniBar`.
