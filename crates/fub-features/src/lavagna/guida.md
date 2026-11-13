# Guida alla lavagna

Una lavagna (un file `.canvas`) si cambia con una lista di operazioni. La lista
si applica per intero o per niente, in una modifica sola che si annulla in un
passo. Le operazioni, i loro campi, lo schema e gli esempi li dà
`canvas.guide`: questo testo dice come si usano insieme.

## Il ciclo

1. **Leggi.** `canvas.read` dà la lavagna come testo: una riga per scheda e
   per arco, con il suo id. La prima riga dice i conti e il riquadro. Con
   `ids` leggi solo alcune schede; con `form` `code` hai la lista che ricrea la
   lavagna, con `json` il modello intero.
2. **Controlla.** `canvas.check` dice che cosa cambierebbe, senza scrivere: i
   problemi che impediscono la scrittura, gli avvisi, il riassunto e la lettura
   di dopo. Passagli la revisione letta come `base`.
3. **Guarda.** Prima di scrivere, leggi la lettura di dopo e gli avvisi: una
   scheda coperta, una scheda a metà dentro un gruppo, un testo che non ci sta.
4. **Scrivi.** `canvas.apply` con la stessa lista e la stessa `base`.

## La revisione e la base

La revisione è l'impronta del file come l'ha letto chi lo legge. Passala come
`base` a `canvas.check` e a `canvas.apply`. Se il file è cambiato nel
frattempo, il controllo dà il problema `stale_base` e la scrittura non parte:
rileggi, controlla di nuovo, riprova.

## Gli id

- Ogni scheda e ogni arco ha un `id`. Una scheda o un arco senza `id` ne riceve
  uno dal seme. Il seme di serie è la revisione: il controllo e la scrittura
  sulla stessa revisione danno gli stessi id, e `canvas.check` dice quali.
- Un id nuovo non dev'essere già preso, né ripetuto nella stessa lista.

## Tutte o nessuna

Se un'operazione della lista non va, nessuna scrive e il file resta com'è.
Il controllo dà un problema per ogni errore di forma; la compilazione si ferma
al primo errore di contenuto. Correggi quello che c'è, poi controlla di nuovo.

## I problemi

Ogni problema ha:

- `code`: il tipo di errore (la tabella sotto);
- `index`: la posizione dell'operazione nella lista, da zero; `null` se riguarda
  tutta la lista;
- `path`: il puntatore JSON al campo che non va, per esempio `/0/ids/0`;
- `message`: una frase fissa in inglese, per chi legge il codice;
- `text`: la frase dello stesso problema per chi legge, nella sua lingua;
- `suggestion`, se c'è: il nome più vicino, un id o il nome di un campo;
- `fix`, se c'è: l'operazione corretta. C'è solo quando la correzione è una
  sola: un nome vicino da solo non basta.

| Codice | Vuol dire |
|---|---|
| `unknown_op` | il nome dell'operazione non c'è |
| `unknown_field` | l'operazione non ha questo campo |
| `missing_field` | manca un campo obbligatorio |
| `wrong_type` | un valore ha il tipo sbagliato, per esempio una stringa dove serve una lista |
| `bad_value` | un valore non è fra quelli ammessi |
| `unknown_node` | non c'è una scheda con questo id |
| `unknown_edge` | non c'è né una scheda né un arco con questo id |
| `duplicate_id` | l'id è già preso, o è ripetuto |
| `too_many` | la lavagna avrebbe troppe schede o troppi archi |
| `invalid` | la lista è vuota, o un'operazione è rifiutata dal formato: il motivo è in `message` |
| `stale_base` | la lavagna è cambiata dalla revisione data |

## Gli avvisi

Gli avvisi riguardano solo le schede che la lista tocca: una coppia che nessuna
operazione tocca non compare. `overlap`: due schede che non sono gruppi si
coprono, e `ids` ha le due. `half_in_group`: una scheda è in parte dentro un
gruppo e in parte fuori, e `ids` ha la scheda e il gruppo. `text_overflow`: il
testo di una scheda non ci sta nell'altezza che ha; `estimated_height` è quella
che serve. Un avviso non impedisce di scrivere: dice dove guardare.

## I colori

Un colore è un numero da «1» a «6» (rosso, arancio, giallo, verde, ciano,
viola), come nel file, oppure un esadecimale come «#ff8800». Il colore cambia
solo l'aspetto: non tocca le misure né i posti.

## Il riassunto

Il riassunto dice che cosa cambia, scheda per scheda: `cards_added`,
`cards_removed` e `cards_changed` (con lo spostamento e il ridimensionamento
quando ci sono), poi gli archi e l'ordine. Se la lista non cambia un byte,
il riassunto è vuoto e non c'è niente da annullare.

## Le letture

- `outline` (di serie): una riga per scheda e per arco. Si taglia a 20 000
  caratteri, con l'ultima riga `…+N` che dice quante righe restano; `max_chars`
  cambia il limite, e vale solo per questa forma.
- `code`: le operazioni che ricreano la lavagna. Non si tagliano: una lista
  tagliata non si può ricompilare.
- `json`: il modello intero, com'è nel file. Chiedilo quando serve davvero.

## Le operazioni

`canvas.guide` dà i nomi delle operazioni, i loro campi, lo schema JSON e gli
esempi. Con `topic` (il nome di un'operazione) dà solo la sua voce, il suo
schema e i suoi esempi. Una scheda o un arco nuovo si scrive come nel file: il
campo `id` è facoltativo, e gli altri campi sono quelli che lo schema elenca.

I campi che Fub non conosce restano: una lavagna scritta da un'altra app si
cambia senza perdere i suoi dati, e cambiano solo i byte delle parti toccate.
