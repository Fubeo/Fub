# Basi (file `.base`)

Una Base è un file `.base` che mostra le note del vault come tabella, schede,
elenco, bacheca o mappa. Il calendario e la linea del tempo si leggono e si
scrivono già nel file, ma la Base non li disegna ancora: arrivano con le
prossime modifiche dell'editor (vedi sotto). Il file è testo YAML che si legge
e si scrive a mano: Fub lo cambia solo nelle righe che un comando tocca, e lascia
il resto com'è.

```mermaid
flowchart LR
    NOTE["note del vault"] --> FILTRI["filtri e colonne"]
    FILE[".base"] --> FILTRI
    FILTRI --> VISTA["vista: tabella, schede, elenco, bacheca, mappa"]
    COMANDO["comando base.view.*"] --> FILE
```

Le proprietà delle note restano nelle note. Il file `.base` dice soltanto quali
note vedere e come mostrarle.

## Che cosa contiene un file

| Chiave | A che serve |
|---|---|
| `version` | la versione del formato: esiste solo la `1`. Un numero diverso non si legge |
| `filters` | il filtro del file intero, che vale per tutte le viste |
| `formulas` | formule con nome, da usare nelle colonne e nei filtri |
| `properties` | nomi da mostrare per le proprietà (`key`, `display_name`) |
| `views` | la lista delle viste, una per voce |

Le chiavi che Fub non conosce restano nel file e non vengono interpretate.

## Le viste

Ogni voce di `views` ha una chiave `name` (obbligatoria, unica nel file) e una
chiave `type`, che è una fra `table`, `cards`, `list`, `kanban`, `map`,
`calendar` e `timeline`. Un `type` che Fub non conosce rende il file illeggibile
come Base. La Base disegna oggi le prime cinque: una vista `calendar` o
`timeline` si mostra come un tipo che la Base non disegna (un errore sulla vista,
con «Riprova»). Le altre chiavi sono facoltative:

| Chiave | A che serve |
|---|---|
| `order` | le colonne da mostrare, in ordine |
| `filters` | il filtro di questa vista, che si somma a quello del file |
| `sort` | l'ordinamento: una lista di `key` con `descending` |
| `group` | il raggruppamento, con una `key` |
| `summaries` | i riepiloghi (conteggio, somma, media, minimo, massimo…) |
| `limit` | quante righe al massimo, da 1 a 10000 |
| `search` | un testo da cercare fra i valori delle righe |
| `map` | le coordinate e il fornitore dei tasselli, per la vista mappa |
| `fub` | il blocco di Fub per il calendario e la linea del tempo (vedi sotto) |

## Calendario e linea del tempo

Il calendario mostrerà le note nel giorno di una proprietà data. La linea del
tempo mostrerà ogni nota come una barra fra la proprietà d'inizio e quella di
fine, o come un punto se manca la fine. Oggi il file le legge e le scrive, e la
valutazione dà il giorno di ogni nota, ma la superficie non le disegna: le
disegnano i task T17 (calendario) e T34 (linea del tempo) del piano dell'editor.
Tutte e due leggono le proprietà delle note, e le chiavi che dicono quali sono
stanno nel blocco `fub:` della vista:

| Chiave in `fub` | Vista | A che serve |
|---|---|---|
| `date` | calendario | la proprietà della data |
| `start` | linea del tempo | la proprietà d'inizio |
| `end` | linea del tempo | la proprietà di fine, facoltativa |

Il nome della proprietà si scrive con o senza il prefisso `prop.` (`due` e
`prop.due` sono la stessa cosa). Solo le proprietà contano: `file.*` e le
formule non sono ancora date del calendario. Una vista senza la sua chiave si
legge, e il piano dice che la chiave manca (`date_key` o `start_key` vuoti).

**La forma su disco.** Obsidian non conosce ancora `calendar` e `timeline`. Fino
alla prova con Obsidian, Fub scrive il calendario come `type: table` con un
blocco `fub:` che porta il tipo vero, e Obsidian ignora quel blocco:

```yaml
views:
  - name: Calendario
    type: table
    fub:
      view: calendar
      date: scadenza
  - name: Linea
    type: table
    fub:
      view: timeline
      start: inizio
      end: fine
```

Fub legge anche la forma nativa (`type: calendar` con lo stesso blocco `fub:`),
e passare a quella è cambiare le due righe di `disk_form`, in
`crates/fub-format-base/src/model.rs`: lì sta la scelta di come si scrive. Una vista `type: table` senza `fub:` è
una tabella, come prima. Una vecchia versione di Fub legge la forma di ripiego
come tabella, senza errori; la forma nativa la rifiuta come tipo sconosciuto.

**Come si prova con Obsidian.** Il file
`crates/fub-format-base/tests/fixtures/calendario.prova-obsidian.base` ha le
due viste nella forma nativa. Serve una cartella di prova in Obsidian (una
cartella vuota, non il vault vero) con il file rinominato in `Prova.base` e
le tre note `Riunione.md`, `Consegna.md` e `Idea.md` della cartella
`crates/fub-format-base/tests/fixtures/prova-obsidian/`. Si apre `Prova.base`
e si guarda: se si vedono le viste Calendario e Linea, con le note nei giorni
giusti, Obsidian regge la forma nativa; se Obsidian rifiuta tutto il file, o
mostra un errore al posto delle viste, resta il ripiego.

**Che cosa legge la vista.** Per ogni nota la valutazione dà il suo giorno. Il
giorno è la data come è scritta: l'ora e il fuso non lo spostano. Un valore che
non è una data non ha giorno.

- calendario: `day`, come `2026-11-14`, o vuoto;
- linea del tempo: `start` e `end`, come giorni, e `inverted` quando la fine
  viene prima dell'inizio. Senza fine, `end` è vuoto e la nota è un punto.

Il tempo è in giorni: due note nello stesso giorno non si distinguono per l'ora.

**Come si scrive.** `base.view.set` con `key` `date`, `start` o `end` scrive
la chiave nel blocco `fub:` della vista, e riscrive quel blocco per intero: i
commenti dentro `fub:` non restano. Le altre chiavi della vista restano com'erano.
Il valore è un nome di proprietà, come `"scadenza"`. La chiave si rifiuta se la
vista non è del tipo giusto (`date` solo nel calendario, `start` e `end` solo
nella linea del tempo). Cambiare il tipo di una vista di calendario o di linea
del tempo cambia il suo blocco `fub:`: passare a un altro tipo lo toglie e le
date si perdono; passare fra calendario e linea del tempo lascia solo `view`.

## Filtri

Un filtro è `all` (nessun filtro), oppure un albero con `and`, `or` o `not`,
oppure una condizione. Una condizione dice su che cosa agisce (`property`,
`file`, `formula` o `tag`), con quale operatore (`op`) e con quale valore
(`value`).

| Operatore | Vero quando |
|---|---|
| `is`, `is_not` | il valore è uguale, o non è uguale |
| `contains`, `not_contains` | il testo o la lista contengono il valore, o non lo contengono |
| `greater_than`, `less_than` (e le versioni con `_or_equal`) | il confronto fra numeri, date o testi regge |
| `is_empty`, `is_not_empty` | la proprietà è vuota, o non lo è |
| `in_folder` | la nota sta in quella cartella o in una sua sottocartella |
| `has_tag` | la nota ha quel tag |

Un filtro scritto come testo libero, che il modello non legge, rende il file
illeggibile come Base: la Base lo mostra come sorgente e non lo tocca.

## Limiti

Il modello ha dei limiti fissi. Oltre, il file non si legge come Base.

| Cosa | Limite |
|---|---|
| il file intero | 1 MiB |
| le viste | 64 |
| le colonne di una vista | 128 |
| le formule | 256 |
| il filtro del file, e quello di una vista | 64 KiB |
| una vista | 64 KiB |
| i riepiloghi di una vista | 32 |
| la lunghezza di una formula | 8 KiB |

## Come si scrive il file

I comandi cambiano una chiave di una vista, aggiungono una vista o ne tolgono
una. Sono comandi del registro dei comandi di Fub, come gli altri.

| Comando | Che cosa fa | Parametri |
|---|---|---|
| `base.view.set` | scrive una chiave di una vista; senza `value`, o con `null`, la toglie | `doc`, `view`, `key`, `value` (JSON), `base` |
| `base.view.add` | aggiunge in fondo la vista con nome e tipo; `type` è `table` se manca; `calendar` e `timeline` nascono nella forma di ripiego | `doc`, `name`, `type`, `base` |
| `base.view.remove` | toglie una vista con tutte le sue chiavi | `doc`, `view`, `base` |

Il campo `base` è facoltativo: se c'è, il comando scrive solo se il file è
ancora quello della revisione detta. Altrimenti risponde con un conflitto e
non scrive niente. Il valore di `value` è JSON: una stringa va fra virgolette
(`"\"table\""`), un numero no (`5`).

Con l'anteprima (`dry run`) il comando dice che cosa scriverebbe, e non scrive.
Ogni scrittura si annulla in un passo, e l'annulla riporta i byte di prima.

### Che cosa resta com'era

Il comando cambia solo le righe della chiave o della vista che tocca. Il resto
del file resta byte per byte:

- i commenti, anche quelli fra due viste o sulla riga di una chiave;
- l'ordine delle chiavi che non si toccano;
- le virgolette, i rientri e le righe vuote;
- le fini di riga (`\n` o `\r\n`) e l'assenza dell'a capo in fondo al file;
- le chiavi che Fub non conosce.

Una chiave nuova va al suo posto, prima della prima chiave che la segue nella
lista delle chiavi (`name`, `type`, `order`, `filters`, `sort`, `group`,
`summaries`, `limit`, `search`, `map`). Un commento scritto subito sopra quella
chiave resta sopra di lei. Il blocco `fub:` di un calendario nuovo nasce in
fondo alla vista, o subito dopo `type` quando è il tipo a cambiare.

Togliere una vista lascia i commenti che stanno fra le viste. Togliere l'ultima
vista scrive `views: []`, e il commento della riga `views` resta.

Se un file non ha ancora la chiave `views`, aggiungere una vista la crea in
fondo al file.

## Quando il file non si tocca

La scrittura si ferma, e il comando dice il motivo, quando:

- il file non si legge come Base (YAML rotto, versione diversa da `1`, una
  vista senza `name`, un file vuoto);
- una chiave o una vista è scritta in YAML di flusso, come `order: [a, b]`, e
  il comando la vuole cambiare: si cambia dal sorgente;
- il file usa ancore (`&nome`), alias (`*nome`) o etichette (`!tag`), che
  spostare potrebbe rompere;
- ci sono tabulazioni nell'indentazione, o più documenti nello stesso file;
- il nome della vista non c'è, o c'è già;
- la chiave obbligatoria (`name` o `type`) si vuole togliere;
- la chiave `date`, `start` o `end` si vuole scrivere in una vista di un altro
  tipo;
- il valore non ha la forma giusta per la chiave, o supera un limite;
- la revisione detta non è più quella del file.

In tutti questi casi il file resta com'era: la toppa controlla prima di
scrivere che il testo nuovo si rilegga come Base valida e che il suo albero sia
quello atteso, con la sola modifica chiesta.

## Dove si vede una Base

Una Base si mette in una nota con un blocco di codice ```` ```base ```` oppure con
un collegamento `![[Nome.base#Vista]]`. Con il `#` si vede la vista nominata;
senza, la prima vista del file.

## Vedi anche

- [Editor e anteprima](editor-and-preview.md): dove una Base appare nella nota.
- [Tasto destro, mini-barra e «/»](editor-menus.md): i menu della Base.
- [Modello del documento](../architecture/document-model.md): come il formato
  espone le viste di un `.base`.
