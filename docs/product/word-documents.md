# Documenti di Word

> **Per chi:** chi scrive documenti di Word in un vault e chi modifica la loro
> superficie.
> **Risultato:** sapere cosa si modifica in un `.docx`, cosa resta nel file,
> quando un documento si apre soltanto in lettura e come si leggono `.odt`,
> `.rtf` e `.doc`.

Un `.docx` si apre in una superficie di scrittura, con la stessa carta, la
stessa barra di formattazione, le stesse scorciatoie e lo stesso correttore
delle note. Si salva nel file stesso, senza conversioni e senza copie a lato.

Si modificano:

- il testo, con a-capo, tabulazioni e salti di pagina o di colonna;
- grassetto, corsivo, barrato ed evidenziato dalla barra; sottolineato, apice
  e pedice restano dove sono e si copiano col testo;
- lo stile del paragrafo: testo, titoli da 1 a 6, citazione;
- elenchi puntati e numerati su nove livelli;
- le righe delle tabelle: aggiungere, spostare, togliere.

Il resto del documento (proprietà dei paragrafi e dei tratti, stili, sezioni,
intestazioni, immagini, forme, campi, note, formule, commenti) resta nel file
così com'è. Un oggetto si vede come una casella con il suo nome o il suo testo
alternativo; la fine di una sezione è un filo doppio che non si cancella con un
Backspace.

Un documento si apre **soltanto in lettura**, con il motivo in testa, quando
ha revisioni tracciate, registra le modifiche, è protetto, oppure quando la
superficie o il codec non saprebbero riscriverlo identico. Un documento cifrato
o più grande di 256 MiB non si apre. Un salvataggio che non si rilegge uguale a
ciò che si voleva scrivere non scrive, e il testo resta nel buffer.

Limiti attuali:

- le immagini non si disegnano, e un oggetto non si modifica dalla superficie;
- i link si conservano ma non si creano né si modificano; le colonne delle
  tabelle non si aggiungono né si tolgono;
- un elenco numerato mostra sempre numeri arabi, qualunque sia la numerazione
  del documento, che resta quella del file;
- il codec riscrive il file in forma propria: rinumera intestazioni, piè di
  pagina, note e caselle di testo, fonde le impostazioni che genera con quelle
  originali e toglie le immagini che il testo non mostra più. Il contenuto non
  cambia, ma il file salvato non è identico byte per byte.

## OpenDocument, RTF e Word 97-2003

Un `.odt`, un `.rtf`, un `.doc` o un `.dot` si aprono nella stessa superficie,
sempre **in sola lettura**: si leggono, si cercano, compaiono nell'outline e
passano dal correttore. Li legge un importatore di WordCraft, che porta testo,
titoli, enfasi, elenchi, tabelle e link e lascia indietro il resto (note,
commenti, caselle di testo, forme, gran parte degli stili). Riscrivere il file
da lì perderebbe ciò che l'importatore non ha letto, quindi la superficie lo
dice in testa e non scrive; un file nuovo di questi formati non si crea.

Un `.doc` si legge per la sua firma: un `.docx` o un RTF rinominati si aprono
come tali, sempre in sola lettura. Un `.doc` cifrato con una password non si
apre.

## Dove si trova

- `crates/fub-format-rich/`: codec e importatori, provider e proiezione
  modificabile.
- `crates/fub-host/src/rich.rs`: la composizione alle porte dei documenti.
- `apps/client/src/editors/rich/`: la superficie.
- `vendor/wordcraft/`: modello, codec e importatori di WordCraft, con
  provenienza e licenza in `UPSTREAM.md`.

Il disegno del confine è in
[Superfici dell'editor](../architecture/editor-surfaces.md#documenti-di-videoscrittura-la-superficie-ricca),
la forma alle porte nel [contratto IPC](../reference/ipc-contract.md#documenti-di-videoscrittura)
e il perché nella [decisione 0203](../decisions/0203-videoscrittura-come-proiezione.md).
