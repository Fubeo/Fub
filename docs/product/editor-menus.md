# Tasto destro, mini-barra e «/»

> **Per chi:** chi scrive e lavora negli editor di Fub e chi aggiunge un menu
> a una superficie.
> **Risultato:** sapere cosa offre il tasto destro in ogni editor, quando
> compare la mini-barra e come si usa il «/» nelle note.

## L'anatomia del menu

Il tasto destro, il tasto Menu o Maiusc+F10 aprono in ogni editor un menu con
le stesse parti, nello stesso ordine; una parte vuota non c'è.

1. **La testata**: che cosa sta sotto il puntatore, con la sua icona e il suo
   nome, per esempio «Titolo 2 · Formula» o «Link alla nota · Media».
2. **La riga degli appunti**: Taglia, Copia e Incolla come tre pulsanti, se
   almeno due si possono fare; con uno solo, «Incolla» è una voce come le
   altre.
3. **Le voci del posto**, nei loro gruppi.
4. «Formato ▸», soltanto dove non c'è la mini-barra.
5. «Dai plugin ▸», dopo le voci di Fub.
6. In fondo, in rosso, ciò che cancella.

Tutto il resto non ruba un posto: si trova **scrivendo** nel piede del menu.
Lì stanno Incolla senza formattazione, i comandi del vault dichiarati per il
«/», Cerca nel documento, Seleziona tutto e le voci in più dell'editor. «Cerca
nel documento» c'è dove l'editor ha la sua barra di ricerca: note, documenti
di Word, codice; non su PDF, immagini, fogli e lavagne.

Ogni menu tiene al massimo nove voci e quattro gruppi al primo livello. Una
voce che adesso non si può fare non c'è; resta grigia soltanto quando dice
perché. Le parole sono quelle del lessico dei menu (`i18n/lexicon.ts`): «Togli
il link», «Apri con un'altra app», «Mostra nell'esploratore», «Incolla senza
formattazione».

In una nota Markdown in scrittura le voci del posto sono:

| Sotto il puntatore | Voci |
|---|---|
| Testo | Incolla, Trasforma il blocco ▸, Inserisci un blocco…, Copia il link a questo punto |
| Selezione | la riga degli appunti, Copia come ▸, Collega a una nota…, Estrai in una nota nuova |
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
cliccato, «Copia il link a questo punto» e «Copia la nota come ▸». Il tasto
destro su un link in Live lascia il cursore dov'è, così la sintassi del link
resta nascosta. Aperto col mouse, il menu tiene il fuoco su di sé e nessuna
voce ha l'anello: la prima freccia sceglie la prima voce, o l'ultima con la
freccia su. Dal tasto Menu o da Maiusc+F10 il fuoco va subito alla prima voce.

Dove Fub non ha un menu, il tasto destro non apre quello della WebView: resta
nei campi di testo, sul testo scelto, sul lettore audio e video e con
Maiusc+tasto destro, che dà sempre il menu del sistema.

## La mini-barra

Sopra il menu c'è la **mini-barra**: lo stile del paragrafo, le formattazioni
in riga e i link. Sulla selezione compare da sola quando la barra di
formattazione è spenta. L'impostazione «Mini-barra di formattazione»
(`editor.minibar`) sceglie fra `auto` (così), `always` (anche su ogni
selezione con la barra accesa), `menu` (solo col tasto destro) e `off`.

## Il «/» nel testo

Il **«/»** scritto a inizio riga o dopo uno spazio apre il pannello dei blocchi
sotto la riga, o sopra se sotto non c'è posto. In Live e in Blocchi è lo
stesso; il «+» della maniglia mette un blocco vuoto e ci apre il «/».

- **La testata** mostra ciò che si è scritto, il contesto («riga vuota:
  diventa il blocco scelto», «dopo il testo: un blocco nuovo sotto») e il
  conto dei risultati, letto dal lettore di schermo.
- **Le sezioni** sono linguette: Suggeriti (guardano il blocco sopra),
  Preferiti, Recenti, Testo, Elenchi, Blocchi, Codice e formule, Collegamenti
  e media, Persone e date, Stile, Pagina, Dal vault. Tab salta di sezione.
- **Le righe** hanno un'icona, il nome e a destra la sintassi Markdown come
  un tasto, oppure «›» per le voci che aprono un passo. Una pillola d'accento
  segue la scelta.
- **L'anteprima** a destra mostra il blocco coi caratteri della nota, che
  cosa fa e come scriverlo senza menu. La stella mette la voce fra i
  Preferiti; «Nascondi dal menu» la toglie dal «/», e resta un comando.
- **Trovare.** Con due lettere valgono gli inizi di parola, dei nomi in
  italiano e in inglese, e le iniziali («/ea» trova Elenco di attività); mai
  lettere sparse. Da tre lettere conta anche l'interno delle parole, da
  quattro si perdona un errore («/tabela» trova Tabella). Al massimo 12
  risultati. I comandi rapidi vanno in cima: «/tab 3x4», «/col 3», «/code
  py», «/h2», «/domani», «/venerdì», «/fra una settimana».
- **I passi.** Tabella (una griglia fino a 6 × 8), Colore (dieci testi e
  dieci fondi, col nome), Data (i giorni vicini e il mese), Riquadro (la
  galleria dei tipi), Link a una nota e Incorpora (le note, poi una sezione),
  Blocco di codice (i linguaggi) e Diagramma (i modelli Mermaid) si scelgono
  nello stesso riquadro; ⌫ o Esc tornano all'elenco. I venti colori non sono
  più voci del «/»: stanno sotto «Colore ›» e si trovano scrivendo («/blu»).
- **Niente trovato.** Il pannello resta aperto e lo dice; Invio o Ctrl+/
  cercano fra tutti i comandi, Esc lascia il testo com'è.
- **Con una selezione** il «/» apre «Trasforma»: solo ciò che cambia le righe
  scelte, con il prima e il dopo.

Scegliere una voce toglie il «/…» e applica il blocco come una sola modifica:
un Annulla fa tornare il testo scritto. «e/o», «24/09» e gli indirizzi non lo
aprono, né dentro codice, link e formule. Sotto i 760 px di finestra resta
solo l'elenco; sotto i 600 px, o col dito, il pannello è un foglio dal basso
con righe da 44 px.

Le impostazioni, in Editor: «Menu «/» nel testo» (`editor.slash`) lo spegne;
`editor.slash.hidden` elenca gli id delle voci nascoste; `editor.slash.sections`
ordina le sezioni dopo Suggeriti, Preferiti e Recenti. I blocchi sono
dichiarati da `fub.formatting`: spento il plugin, il «/» offre soltanto i
comandi del vault. Ogni voce resta un comando del registro, con i suoi
parametri (`markdown.table` con `rows` e `cols`).

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

In modalità Blocchi la maniglia di un blocco apre il suo menu col clic e col
tasto destro, con la testata «Blocco» e l'inizio del testo: Trasforma in ▸,
Colore ▸ (Testo e Fondo, coi nove colori dei Blocchi), Duplica, Copia il link
al blocco, Sposta su e giù, Affianca in colonne, e «Elimina il blocco» per
ultimo. La griglia delle tabelle in Live ha la testata «Tabella», la riga
degli appunti, Inserisci ▸, Sposta ▸, Ordina la colonna ▸, Allinea la colonna
▸, Svuota la cella, e in fondo Elimina la riga e Elimina la colonna.

Nell'albero, il tasto destro su una nota della scelta multipla apre il menu
della scelta: Copia, Sposta in…, In una cartella nuova, Deseleziona e «Sposta
nel cestino» per ultimo. Fuori dalla scelta vale il menu della nota.

Il disegno ha i suoi menu ([Disegni, selezione](drawing-selection.md)); la
griglia delle tabelle in Live ha il suo
([Editor e anteprima](editor-and-preview.md#tabelle-in-live)).

## Dove si trova

- `apps/client/src/editors/core/editor-menu.ts`: le forme del menu di una
  superficie;
- `apps/client/src/panels/editor-menu.ts`: il compositore e l'apertura;
- `apps/client/src/ui/menu.ts`: il menu, il fuoco e la tastiera;
- `apps/client/src/editors/text/profiles/markdown/surface.ts` e `menu.ts`: le
  voci di una nota e ciò che sta sotto il puntatore;
- `apps/client/src/i18n/lexicon.ts`: il lessico dei menu;
- `apps/client/src/ui/menu-budget.test.ts` coi casi di `ui/menu-cases.ts`: il
  bilancio di ogni menu;
- `apps/client/src/ui/system-menu.ts`: il menu della WebView spento dove Fub
  non ne ha uno;
- `apps/client/src/panels/mini-bar.ts`: la mini-barra;
- `apps/client/src/panels/slash/` (voci, classifica, comandi rapidi, passi,
  pannello) e `apps/client/src/editors/text/profiles/markdown/slash.ts`
  (contesto e stato): il «/» nel testo;
- `crates/fub-features/src/formatting.rs`: le voci di blocco del «/»;
- [Superfici dell'editor](../architecture/editor-surfaces.md): le capacità
  `contextMenu` e `miniBar`.
