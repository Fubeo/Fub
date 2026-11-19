# Il formato dell'esportazione in PDF

> **Ambito:** i file che l'esportazione delle note in PDF tiene nel vault (i
> profili d'esportazione e la memoria d'esportazione di ogni nota), l'elenco
> delle pagine che la vista passa al core, e il comando e il lavoro che
> scrivono il PDF.
> **Fonti autorevoli:** `crates/fub-features/src/pdf_export/profile.rs`,
> `crates/fub-features/src/pdf_export/memory.rs`,
> `crates/fub-features/src/pdf_export/aperta.rs`,
> `crates/fub-features/src/pdf_export/mod.rs` (l'elenco),
> `crates/fub-features/src/pdf_export/writer.rs` (lo scrittore),
> `crates/fub-features/src/pdf_export/lavoro.rs` (comando e lavoro).

L'esportazione non scrive niente nella nota. Le regolazioni stanno in due
posti, tutti e due nello spazio dati `fub.esporta-pdf` del vault (vedi
[layout su disco](on-disk-layout.md)):

| Che cosa | Dove | Vale per |
|---|---|---|
| un profilo | `.fub/plugins/fub.esporta-pdf/profili/<id>.json` | ogni nota del vault |
| la memoria di una nota | `.fub/plugins/fub.esporta-pdf/doc/<nota codificata>/esportazione-pdf.json` | quella nota |

Tutti e due sono dati autorevoli: non si ricostruiscono da niente. Si
scrivono con la scrittura atomica dello spazio dati, quindi una scrittura che
non riesce lascia il file di prima intero. Il perché della strada (la vista
impagina, il core scrive) è nella
[ADR 0247](../decisions/0247-la-prova-del-motore-del-pdf.md); l'elenco delle
pagine e il comando sono [qui sotto](#lelenco-delle-pagine).

## I profili

Un profilo mette sotto un nome tutte le regolazioni dello spazio «Esporta in
PDF» («Relazione per il Comune», «Bozza con i commenti»). È un file JSON per
profilo nella cartella `profili/`. Il profilo «Di serie» c'è sempre e non è
un file.

L'`id` è il nome del file senza `.json`, e non cambia quando il profilo
cambia nome: il nome che la persona vede sta dentro il file. Un profilo nuovo
prende come id il suo nome, con ogni carattere ASCII che non sia una
lettera, una cifra, lo spazio o uno fra `- . _ ( ) [ ] , '` codificato come
`%XX` (anche il punto iniziale, che farebbe un file nascosto), e un numero
dopo (`Bozza 2`) se il file c'è già. Fub elenca solo i file `.json` della
cartella, non quelli delle sottocartelle né quelli nascosti.

### La forma

```json
{
  "versione": 1,
  "nome": "Relazione per il Comune",
  "tema": "relazione",
  "colori": { "accento": "#1f4f8f" },
  "inchiostro": { "bianco_e_nero": false, "risparmio": false },
  "testo": { "corpo": 10.5, "sillabazione": true },
  "pagina": {
    "formato": "A4",
    "orizzontale": false,
    "margini": { "sopra": 25.0, "destra": 22.0, "sotto": 25.0, "sinistra": 22.0 },
    "specchio": false,
    "filigrana": ""
  },
  "testata": {
    "posti": {
      "sopra-destra": { "voce": "titolo" },
      "sotto-centro": { "voce": "pagina-di-pagine" }
    },
    "filo": true,
    "prima_pagina_senza": false,
    "numeri_romani": false
  },
  "frontespizio": { "frontespizio": true, "indice": true, "profondita_indice": 2, "segnalibri": true },
  "contenuto": {
    "proprieta": "in-evidenza", "commenti": "no", "link": "colorati",
    "compiti_fatti": true, "ripiegabili": "aperti", "schede": "anteprima",
    "tabelle": "linee", "codice_numerato": false
  },
  "diagrammi": { "stile": "nota", "fondo": true },
  "interruzioni": { "ogni_titolo_2": false, "separatore": true, "ripeti_intestazione": true },
  "uscita": { "pagine": "", "immagini": "piene", "accessibile": true, "pdfa": false }
}
```

Solo `versione` e `nome` sono obbligatori: ogni sezione o campo che manca
vale quello di serie, cioè quello dell'esempio salvo `tema` (`fub`), `colori`
e `testo` (nessuna scelta tua), `frontespizio.frontespizio` e
`frontespizio.indice` (`false`) e `contenuto.proprieta` (`nessuna`). Fub scrive il file indentato e con le
chiavi sempre nello stesso ordine, una riga vuota in fondo; al più 256 KiB.

| Campo | Che cosa vale |
|---|---|
| `versione` | `1` |
| `nome` | il nome che la persona vede, da 1 a 120 caratteri |
| `tema` | il tema di stampa: `fub`, `classico`, `relazione`, `rivista`, `accademico`, `quaderno`, `essenziale`, `notte` |
| `colori` | i colori tuoi, in `#rrggbb` (vedi sotto) |
| `inchiostro` | bianco e nero, risparmio d'inchiostro: valgono sopra ogni tema |
| `testo` | i caratteri e l'impostazione tuoi (vedi sotto), e la sillabazione |
| `pagina` | `formato` (`A4`, `A5`, `A3`, `Lettera`, `proprio` con `misura_propria`: `[larghezza, altezza]` in mm), `orizzontale`, `margini` in mm, `specchio`, `filigrana` (vuota: nessuna) |
| `testata` | i sei `posti` (`sopra-` e `sotto-` con `sinistra`, `centro`, `destra`), ognuno con una `voce` (`titolo`, `sezione`, `data`, `pagina`, `pagina-di-pagine`, `autore`, `percorso`, `testo` col suo `testo`); un posto che manca è vuoto |
| `frontespizio` | frontespizio, indice fino al Titolo `profondita_indice` (2 o 3), segnalibri |
| `contenuto` | `proprieta` (`nessuna`, `in-evidenza`, `tutte`), `commenti` (`no`, `margine`, `in-fondo`), `link` (`colorati`, `sottolineati`, `come-il-testo`), `ripiegabili` (`aperti`, `chiusi`), `schede` (`anteprima`, `solo-nome`, `pagine-in-coda`), `tabelle` (`linee`, `righe-alterne`, `griglia`) |
| `diagrammi` | `stile`: `nota` (com'è nella nota), `tema` (come il tema di stampa) o il nome di uno stile del diagramma; `fondo` |
| `interruzioni` | ogni Titolo 2 una pagina, il separatore che volta pagina, l'intestazione ripetuta nelle tabelle lunghe |
| `uscita` | le `pagine` da esportare (`1-3, 5`; vuoto: tutte), `immagini` (`piene`, `alleggerite`), PDF accessibile, PDF/A |

Le interruzioni messe a mano non stanno nel profilo: stanno nella nota.

### Il tema e ciò che è «tuo»

I colori, i caratteri e l'impostazione di ogni tema li conosce la vista che
disegna le pagine. Il profilo nomina il tema e tiene soltanto ciò che la
persona ha cambiato:

- `colori` ha una chiave per ogni colore cambiato: `carta`, `testo`, `titoli`,
  `accento`, `link`, `testo-secondario`, `linee`, `evidenziato`, `riquadri`,
  `codice`, `intestazioni-tabella` e i quattro dei diagrammi,
  `diagramma-nodi`, `diagramma-decisioni`, `diagramma-inizio-fine`,
  `diagramma-linee`, che vincono sullo stile del diagramma;
- `testo` ha un campo per ogni scelta che il tema decide e la persona ha
  cambiato: `carattere_testo` e `carattere_titoli` (l'id di un carattere di
  Fub o il percorso di uno del vault), `corpo` (punti), `interlinea` (multipli
  del corpo), `paragrafi` (`spazio`, `rientro`), `giustificato`,
  `titoli_numerati`, `scala_titoli`, `allineamento_titoli` (`sinistra`,
  `centro`), `colonne`. Un campo che manca lo decide il tema.

Cambiando tema questi valori restano, ed è questo che li segna «tuoi». «Torna
al tema» toglie la chiave, una per una o tutte insieme. Fub scrive un colore
solo in `#rrggbb` minuscolo, e chi lo scrive accetta anche `#rgb` e le
maiuscole; un colore scritto male a mano nel file resta com'è, conta come
scelta tua (lo si toglie con «torna al tema») ma non vale: la pagina usa
quello del tema.

### Due profili con lo stesso nome

Copiando il file col gestore dei file nasce un secondo profilo col nome del
primo. Fub li elenca tutti e due e dice che si chiamano uguale, così la vista
mostra accanto il nome del file. Fub invece non crea né rinomina un profilo
col nome di un altro: due nomi sono uguali se differiscono solo per le
maiuscole o per gli spazi ai lati.

### Un profilo che non si legge

Un file che non è JSON, o non ha la forma di un profilo, o pesa più di
256 KiB, resta nell'elenco col motivo e non si sostituisce: salvarci sopra
risponde con l'errore e lascia il file com'era. La persona lo può togliere.

### Un profilo di una versione più nuova

Si legge per ciò che si conosce, e il resto si conserva:

- le chiavi che questa versione non conosce, a ogni livello, restano com'erano
  e si riscrivono uguali;
- un valore a elenco che questa versione non conosce (un formato `B5`, un
  tema nuovo) resta com'è; la vista usa quello di serie e può dire che il
  profilo ha regolazioni che qui non si vedono.

Il file di un profilo con `versione` più alta di 1 non si riscrive: salvare o
rinominare risponde con l'errore. Una copia invece si fa, e porta con sé
anche ciò che questa versione non capisce. Un profilo della versione 1 con un
campo aggiunto da un Fub più nuovo si salva, e il campo resta.

## La memoria di una nota

Tiene ciò che vale solo per il PDF di quella nota: lo stile dato a un
diagramma solo per l'esportazione e i blocchi lasciati fuori. Lo stile scritto
nel diagramma (`%% stile:`) resta quello della nota e non viene toccato.

Sta nello spazio per-documento dello spazio dati, quindi segue la nota senza
ascoltare eventi: la rinomina, anche fatta da un altro programma, la porta
sotto il nome nuovo; il cestino la parcheggia e il ripristino la riporta; una
nota che prende il nome di una cestinata comincia senza memoria; quando la
nota non c'è più né nel vault né nel cestino, la raccolta all'apertura del
vault la toglie (vedi [layout su disco](on-disk-layout.md#cestino)).

### La forma

```json
{
  "versione": 1,
  "fuori": [
    { "sezione": ["Metodo"], "impronta": "9f86d0…", "occorrenza": 0, "anteprima": "| a | b |" }
  ],
  "diagrammi": [
    {
      "blocco": { "sezione": ["Metodo"], "impronta": "1b4f0e…", "occorrenza": 0, "anteprima": "```mermaid" },
      "stile": "tema"
    }
  ]
}
```

Una memoria vuota non ha file. Al più 1 MiB e 10.000 voci.

### Come si riconosce un blocco

Dalla sezione e dal contenuto:

| Campo | Che cosa vale |
|---|---|
| `sezione` | i titoli sopra il blocco, dal più alto; vuota prima del primo titolo |
| `impronta` | SHA-256 in esadecimale del testo del blocco, con i capo riga in `\n`, senza spazi in fondo alle righe e senza righe vuote ai lati |
| `occorrenza` | quale, fra i blocchi uguali nella stessa sezione, contando da 0 |
| `anteprima` | la prima riga del blocco, al più 80 caratteri: serve a dire quale voce non vale più |

Una voce vale finché nella stessa sezione c'è un blocco con la stessa
impronta e la stessa occorrenza, anche se intorno la nota è cambiata. Se il
blocco cambia, si sposta in un'altra sezione o sparisce, la voce non vale più:
il blocco non è lasciato fuori e il diagramma torna allo stile del profilo, e
il pannello lo dice. La voce resta finché la persona non la toglie.

### Errori

Una memoria che non si legge resta e non si sostituisce: salvare risponde con
l'errore, e solo «ricomincia» la toglie. Una memoria di una versione più nuova
si legge per ciò che si conosce, conserva il resto e non si riscrive.

## L'elenco delle pagine

La vista impagina la nota e manda al core ciò che ha disegnato, pagina per
pagina: un JSON (`ElencoPagine`, versione 1) che il core scrive senza andare a
capo né impaginare. Le misure sono in pixel CSS, con l'origine in alto a
sinistra della pagina e la `y` verso il basso; un pixel CSS è 3/4 di punto
PDF. Un campo che il formato non conosce rende l'elenco illeggibile.

```json
{
  "versione": 1,
  "larghezza": 794, "altezza": 1123,
  "titolo": "Relazione", "autore": "Ada Lovelace", "lingua": "it",
  "facce": [
    { "famiglia": "Literata Variable", "file": "/fonts/literata-latin-wght-normal.woff2",
      "corsivo": false, "assi": [{ "tag": "wght", "valore": 400 }] }
  ],
  "pagine": [
    {
      "pezzi": [
        { "tipo": "testo", "x": 72, "y": 90, "larghezza": 30, "faccia": 0, "corpo": 16,
          "colore": [42, 40, 38, 1], "testo": "Ciao", "posizioni": [0, 9.1, 13.2, 21.5] },
        { "tipo": "riquadro", "x": 72, "y": 100, "w": 300, "h": 1, "colore": [0, 0, 0, 0.2] },
        { "tipo": "vettore", "x": 72, "y": 120, "w": 300, "h": 200, "svg": "<svg …>" },
        { "tipo": "immagine", "x": 72, "y": 340, "w": 300, "h": 200, "file": "Foto/mare.jpg" }
      ],
      "collegamenti": [
        { "x": 72, "y": 76, "w": 30, "h": 18,
          "destinazione": { "tipo": "fuori", "url": "https://example.org/" } },
        { "x": 72, "y": 400, "w": 80, "h": 18,
          "destinazione": { "tipo": "dentro", "pagina": 1, "y": 72 } }
      ]
    }
  ],
  "segnalibri": [
    { "titolo": "Introduzione", "livello": 1, "pagina": 0, "y": 72 }
  ]
}
```

| Campo | Che cosa vale |
|---|---|
| `titolo`, `autore` | i dati del PDF (`Title`, `Author`); vuoti, il PDF non li porta. Con un titolo il lettore lo mostra al posto del nome del file |
| `lingua` | un'etichetta BCP 47 (`it`, `en-GB`), nel catalogo del PDF (`Lang`); una che non lo è resta fuori con l'avviso `lingua_scartata` |
| `facce[].file` | `/fonts/<nome>` per un carattere dell'app, altrimenti il percorso di un file del vault |
| `pezzi[].posizioni` | dove comincia ogni lettera del testo, dalla `x` del pezzo: una per lettera |
| `pezzi[].file` (immagine) | il percorso di un file del vault: PNG, JPEG, GIF o WebP |
| `collegamenti[]` | un riquadro della pagina che porta fuori (`url`) o a un punto di un'altra pagina (`pagina` dalla prima, che è la 0, e `y`) |
| `segnalibri[]` | in fila, ognuno col suo `livello` da 1 a 6: un segnalibro sta sotto l'ultimo di livello più basso che lo precede |

`titolo`, `autore`, `lingua`, `collegamenti` e `segnalibri` si possono
omettere.

### Che cosa scrive il core

- **Il testo** è testo vero, che si seleziona e si cerca: ogni faccia diventa
  un carattere incorporato in sotto-insieme, con la tabella che riporta ogni
  glifo alla sua lettera. Un carattere variabile si fissa nel punto dei suoi
  assi. Un carattere che manca, non si legge o la cui licenza non lascia
  incorporarlo esce in Literata, con un avviso; una lettera che né il
  carattere né Literata hanno esce nel riquadro vuoto e resta nel testo che si
  copia (`lettere_mancanti`).
- **I vettori** restano vettori, e il testo che contengono resta testo, coi
  caratteri di serie di Fub.
- **Le immagini** sono *piene* (i byte del file: un JPEG resta il suo JPEG) o
  *alleggerite*: una più fitta di 150 punti per pollice alla misura in cui sta
  sulla pagina si riduce a quella risoluzione e si ricomprime (JPEG se è
  opaca, PNG se ha trasparenza); una GIF, una già leggera o una che ridotta non
  pesa meno resta com'è. Un'immagine che manca o non si legge lascia il suo
  posto vuoto (`immagine_mancante`), una oltre 64 MiB anche
  (`immagine_troppo_grande`).
- **I collegamenti verso fuori** si aprono solo per `http`, `https` e
  `mailto`: ogni altro schema (`file:`, `javascript:`, quello di un'app) resta
  testo che non si clicca, con l'avviso `collegamento_scartato`. I collegamenti
  dentro il documento portano alla pagina e all'altezza dette.
- **Il file** non porta date: lo stesso elenco con le stesse risorse dà gli
  stessi byte.

Gli avvisi non fermano la scrittura: tornano con l'esito, ognuno col suo nome
(`{"avviso": "immagine_mancante", "file": "Foto/mare.jpg"}`).

### I limiti

Oltre un limite l'elenco non si scrive, e l'errore dice quale:

| Limite | Valore |
|---|---|
| peso del JSON dell'elenco | 64 MiB |
| pagine | da 1 a 5.000 |
| lato della pagina | 20.000 px |
| pezzi per pagina | 50.000 |
| vettore | 8 MiB |
| collegamenti per pagina | 10.000 |
| indirizzo di un collegamento | 8 KiB |
| segnalibri | 20.000, di livello da 1 a 6 |
| titolo, autore, lingua, titolo di un segnalibro | 2.000 caratteri |
| durata della scrittura | 10 minuti |

## Il comando e il lavoro

Il comando `pdf.write_pages` del bundle `fub.draw` scrive nel vault il PDF di
un elenco. Non c'è una porta IPC sua: si chiama con `invoke_command`, e il
lavoro è un lavoro del core.

| Parametro | Che cosa vale |
|---|---|
| `pages` | il JSON dell'elenco (obbligatorio) |
| `target` | il percorso del PDF nel vault, con l'estensione `.pdf` (obbligatorio) |
| `images` | `full` (di serie) o `light`, le immagini alleggerite |
| `replace` | `true` per sostituire un PDF che c'è già; senza, un PDF che c'è è un errore |
| `note` | la nota da cui prendere titolo, autore e lingua (`title`/`titolo`, `author`/`autore`, `lang`/`lingua` del frontmatter; il titolo, se manca, è il nome del file) quando l'elenco li lascia vuoti |

Il comando controlla subito ciò che può controllare senza scrivere: l'elenco
si legge ed è nei limiti, la destinazione è un nome di PDF valido e libero (o
da sostituire). Il piano (`DryRun`) dice il PDF e le pagine e non accoda
niente. Altrimenti accoda il lavoro `pdf.write_pages` e torna con l'effetto
`fub.pdf.queued`, `{ "job_id": "<id>", "path": "<pdf>" }`: l'id è una stringa.

Il lavoro riporta l'avanzamento una pagina per passo (`done` su `total`
pagine), così il centro attività ne mostra la barra e lo sa annullare. Scrive
il PDF in memoria e lo deposita nel vault **una volta sola, alla fine**: lo
storage lo scrive in un file temporaneo e lo rinomina, quindi il file arriva
intero o non arriva. Un lavoro annullato, scaduto o fallito non lascia
nessun file; un disco pieno o una cartella in sola lettura sono l'errore
della scrittura, e un PDF che si stava sostituendo resta quello di prima. La
sostituzione confronta la revisione del PDF letta un attimo prima: una
scrittura che arriva in mezzo è un conflitto, mai una sovrascrittura cieca.

Il lavoro torna con `{ "path", "bytes", "pages", "warnings" }`.

