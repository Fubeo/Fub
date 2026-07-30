# 0050 — Cosa si chiede a una ricerca

|  |  |
|---|---|
| **Decisa** | 2026-07-29 |
| **Origine** | `todo.md` §21.1 + §21.2 (seduta 21) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/21-la-ricerca-predefinita.md) · [la gemella, che decide dove sta un risultato](0049-una-posizione-dentro-un-documento.md)

---

La [0025](0025-la-ricerca-predefinita.md) ha deciso che la ricerca di Fub è
built-in e di classe *omnisearch*. Da lì le voci non sono più opinioni: sono la
sottrazione fra ciò che quel comportamento richiede e ciò che il contratto sa
dire. Due delle quattro P0 toccano lo stesso record.

> `TextQuery` porta il testo, la modalità e i campi. Non sa dire *«a meno di un
> refuso»*, non sa dire *«l'ultimo termine è incompleto»*, e `TextField` non
> nomina gli heading.

## La decisione

Tutto su `TextQuery`, tutto **in fondo**, tutto additivo.

```rust
// crates/fub-abi/src/query.rs
pub struct TextQuery {
    pub text: String,
    pub mode: TextMode,
    pub fields: Vec<TextField>,
    pub tolerance: TextTolerance,   // NUOVO
    pub partial_last_term: bool,    // NUOVO
}

pub enum TextTolerance { Exact, Typos }              // NUOVO, `Exact` è il default
pub enum TextField { Name, Body, Tags, Heading }     // `Heading` in coda
```

## Le decisioni prese, da NON ridiscutere senza motivo

### La tolleranza è un campo a sé, non una terza variante di `TextMode`

La variante sarebbe stata più economica di un campo su ogni mirror, e le tratta
come **esclusive**. Non lo sono: modalità e tolleranza sono ortogonali — una
*frase* cercata a meno di un refuso ha senso, e con l'enum non si scrive. La
differenza costa un campo adesso e una **major** dopo il freeze di M4, il che
rende la scelta una sola.

### Nel contratto entra un'intenzione, mai una distanza di edit

«Due caratteri» è un parametro di un motore. In una firma vorrebbe dire che
**cambiare motore cambia il significato delle query salvate**: la stessa
collezione, lo stesso template, la stessa vista tornerebbero risultati diversi
perché sotto è cambiato l'implementatore. Ciò che il contratto porta è
*esatto* o *tollerante*; la traduzione è del provider, come già lo è la
tokenizzazione ([0019](0019-il-canale-dati.md)).

### L'altra metà è quella che conta: adesso si può chiedere **l'esattezza**

L'esattezza era implicita, e ciò che è implicito non si può pretendere. Il giorno
in cui `SearchIndex` fosse diventato tollerante, lo sarebbero diventati **tutti**
i suoi chiamanti nello stesso istante: `vault.replace` su N note, le collezioni
(§8.4), le viste salvate (§8.3), i template (§16.1), l'automazione su-modifica
(§16.2). Un motore che indovina, su un canale che poi **scrive**, è un difetto —
e la variante va aggiunta *prima* del comportamento, non insieme.

### La variante prima del comportamento, dichiarata

`Typos` è **dicibile e non ancora onorato**: il fuzzy di tantivy resta lavoro suo,
e non scade col freeze. Chi lo chiede oggi riceve una ricerca esatta — meno
risultati, non risultati sbagliati — ed è il solo verso in cui questo silenzio è
innocuo. Il `match` su `TextTolerance` in `search.rs` è esaustivo apposta: il
giorno che `Typos` diventa una `FuzzyTermQuery`, il compilatore porta chi lo
scrive esattamente lì, invece di lasciare il caso assorbito da un `_`.

### `partial_last_term` è una proprietà dell'invocazione, e chi salva normalizza

Cercare `arch` deve trovare *architettura* prima che la parola sia finita: è metà
di ciò che fa sembrare istantanea una ricerca. Ma una query messa in una
collezione o in un template non deve restare «col prefisso» per sempre —
l'utente aveva finito di scrivere, e nessuno era lì a vederlo.

Il dovere è scritto **nel doc del campo**, ed è il punto che rende la voce
contratto e non shell: senza, sarebbe un dovere di ogni chiamante, e ognuno ne
inventerebbe uno suo.

**E non lo aggiunge la casella.** Se la shell appendesse un `*` da sé, la CLI
(§27.1), l'API locale (§27.2), le automazioni (§16.2) e il centro di comando LLM
(§22.4) interrogherebbero lo stesso indice con una lingua diversa da quella
dell'utente, e la differenza non sarebbe scritta da nessuna parte. È la stessa
ragione per cui la sintassi di ricerca non è più quella di tantivy.

Solo **l'ultimo** termine è un prefisso: `arch kernel` cerca `arch` per intero,
perché lì la parola è finita.

### `TextField::Heading`, e perché pesa a parte

È il campo che distingue una nota che *parla* di una cosa da una che ci ha
dedicato una **sezione**. Il testo di un heading sta già dentro la proiezione a
testo piano, quindi il campo `headings` dell'indice è una **seconda** copia: il
termine conta due volte, e la seconda con un boost (×2, fra il ×4 del nome della
nota e il ×1 del corpo). Non è un effetto collaterale — è precisamente ciò che
si vuole pesare.

Va con la §21.1 perché è lo stesso record e la stessa scadenza.

## Cosa cambia sotto

`SearchIndex` passa a `SCHEMA_VERSION = 5` (campo `headings`), che vuol dire una
ricostruzione dell'indice alla prima apertura — il manifest di un'altra versione
si butta, come sempre. Il prefisso è una `RegexQuery` sul dizionario dei termini
(e una `PhrasePrefixQuery` quando la modalità è *frase*): è **un intervallo
aperto nella term dictionary**, cioè esattamente una delle due operazioni che la
[§21.9](../roadmap/21-la-ricerca-predefinita.md) prevede possano far salire il
costo per query. Quella voce resta aperta e adesso ha un motivo in più per essere
misurata.

## Il cliente, nello stesso giro

La casella di ricerca manda `partial_last_term: true` mentre si digita
(`frontend/src/panels/search.ts` via `testoCercato(query, true)`). È il primo
chiamante e per ora l'unico: chi salverà una query — collezioni, viste, template
— trova il dovere scritto nel campo prima di avere qualcosa da salvare, che è
l'ordine giusto.

## Cosa NON è stato deciso qui

- **Il fuzzy vero** (la `FuzzyTermQuery`, la soglia, il prefisso intatto): è
  lavoro di provider e non scade.
- **I pesi regolabili** (§21.6): il boost degli heading è un default buono e
  resta un default. Diventerà una chiave di impostazione quando quella voce si
  aprirà, e adesso ha dove atterrare ([0036](0036-le-impostazioni-e-i-tre-stati.md)).
