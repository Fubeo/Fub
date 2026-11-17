# I tipi delle proprietà

> **Ambito:** il registro `properties.types` del vault, i tipi che dichiara,
> le opzioni di Selezione e Stato, il bersaglio delle Relazioni, la relazione
> inversa, il riepilogo di una Relazione nelle Basi e i comandi che scrivono
> il registro.
> **Fonti autorevoli:** `crates/fub-abi/src/model/property.rs`,
> `crates/fub-kernel/src/properties.rs`,
> `crates/fub-features/src/properties/commands.rs`,
> `crates/fub-features/src/properties/relation.rs`,
> `crates/fub-format-base/src/formula.rs`, `crates/fub-features/src/base.rs`.

Il valore di una proprietà resta nel frontmatter della nota. Il registro dei
tipi dice soltanto come leggerlo: quale editor mostrare, come filtrarlo, come
ordinarlo. Sta in `.fub/settings.json` sotto la chiave `properties.types`
(vedi [layout su disco](on-disk-layout.md)), è un'impostazione del vault e il
programma la può scrivere.

## La forma

```json
{
  "version": 1,
  "types": { "voto": "number", "fase": "status", "sito": "url" },
  "options": {
    "fase": [
      { "name": "Da fare", "color": "gray", "group": "todo" },
      { "name": "In corso", "color": "blue", "group": "doing" },
      { "name": "Fatto", "color": "green", "group": "done" }
    ]
  }
}
```

| Campo | Che cosa vale |
|---|---|
| `version` | `1`. Un'altra versione non si legge |
| `types` | per ogni chiave, il suo tipo |
| `options` | facoltativo: per ogni chiave, le opzioni di Selezione e Stato, nell'ordine in cui si mostrano |
| `targets` | facoltativo: per ogni chiave, il bersaglio di una Relazione (vedi [Le Relazioni](#le-relazioni)) |

Un registro senza opzioni né bersagli non scrive i campi `options` e
`targets`: si riscrive byte per byte com'era prima che esistessero.

## I tipi

| Tipo | Il valore nel frontmatter | Che cosa diventa |
|---|---|---|
| `text` | un testo | testo |
| `list` | una lista, o un testo solo | lista |
| `number` | un numero, o un testo che è un numero | numero |
| `checkbox` | `true`/`false`, anche scritti come testo | vero o falso |
| `date` | una data ISO, o nel formato che il vault dichiara | data senza ora |
| `date_time` | una data con l'ora | data con l'ora |
| `tags` | una lista di testi, o un testo solo | lista di tag |
| `select` | un testo | il testo dell'opzione |
| `status` | un testo | il testo dell'opzione, col suo gruppo |
| `url` | un testo | testo, così com'è scritto |
| `relation` | una lista di `[[link]]`, o un link solo | lista di link a note |

Un valore che non ha la forma del suo tipo resta com'è nel file e si mostra
come sorgente: niente si converte. Un valore YAML che non è un testo (`3`,
una lista, un oggetto) in un `select`, `status`, `url` o `text` non è un
testo. Scritti dal pannello, `3` o `true` in uno di questi tipi si salvano
come testo.

Senza dichiarazione valgono le chiavi convenzionali: `tags` è `tags`;
`aliases`, `alias`, `cssclasses` e `cssclass` sono `list`.

## Le opzioni

Un'opzione ha tre campi:

| Campo | Che cosa vale |
|---|---|
| `name` | il testo che il frontmatter porta quando il valore è quest'opzione |
| `color` | facoltativo: uno dei nove colori, `gray`, `brown`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `red`. Sono i colori dei Blocchi; assente vale `gray` |
| `group` | facoltativo, solo per lo Stato: `todo` (Da fare), `doing` (In corso) o `done` (Fatto); assente vale `todo` |

Un valore di Selezione o di Stato è il testo dell'opzione, e la proiezione
(`PropertyTypes::option_match`) dice se il testo è il nome di un'opzione o
se è **fuori dalle opzioni**. Il confronto è esatto, carattere per carattere:
`Fatto ` con lo spazio in fondo è fuori. Un valore fuori dalle opzioni resta
testo, segnato. Nel pannello laterale delle proprietà una Selezione o uno Stato dentro
le opzioni è una tendina; fuori dalle opzioni resta un campo di testo.

Un colore o un gruppo che questo Fub non conosce si legge lo stesso: si
mostra grigio, o Da fare, e la parola resta nel file se il registro si
riscrive. Due opzioni con lo stesso nome, scritte a mano, si leggono: vale la
prima. Un campo che questo Fub non conosce, invece, rende illeggibile tutto
il registro.

### Nella testata della nota

Nelle proprietà in testa a una nota una Selezione o uno Stato si mostra come
pastiglia del colore della sua opzione (lo Stato col pallino). Il clic, o
Invio, apre l'elenco delle opzioni con una ricerca: lo Stato le divide in Da
fare, In corso e Fatto. Scrivere un nome che non c'è offre «Crea «nome»»:
l'opzione nasce nel registro con `property.option.set`, col primo colore
che le opzioni della chiave non hanno già (lo Stato in Da fare), e poi il
valore si scrive nella nota. Se il registro rifiuta (illeggibile, di una
versione futura), l'elenco lo dice e la nota resta com'è. Un valore fuori
dalle opzioni, anche dopo un'opzione rinominata nel registro, resta testo,
sottolineato e segnato «Fuori dalle opzioni».

Un Url che comincia con `http://` o `https://` è un link: il clic lo apre,
la matita accanto (o F2) lo modifica. Ogni altro testo resta un campo.

### Nella Bacheca di una Base

Una Bacheca raggruppata per una Selezione o uno Stato ha una corsia per ogni
opzione, anche vuota, nell'ordine del registro; lo Stato le mette nei tre
gruppi, Da fare, In corso, Fatto. Dopo vengono i valori fuori dalle opzioni,
come corsie di testo: solo queste si rinominano dalla Bacheca. Trascinare
una scheda in un'altra corsia, o Alt ← e Alt → sulla scheda, scrive il
valore nella nota con `note.property.set` e il valore letto come confronto:
se la nota è cambiata nel frattempo non si scrive niente. Una corsia
aggiunta dalla Bacheca è un'opzione nuova del registro. Il registro si
rilegge quando cambia (`setting_changed` di `properties.types`).

## Le Relazioni

Una Relazione lega una nota ad altre: il valore è una lista di link,
`libri: ["[[Dune]]", "[[Fondazione]]"]`, e un link solo (`"[[Dune]]"`) è una
lista di uno. Una voce che non è un `[[link]]` resta testo (un link rotto a
parole) e non diventa una data; una voce che non è un testo resta com'è nel
file.

### Il bersaglio

Il registro può dire fra quali note si sceglie il valore, con una parola per
chiave in `targets`:

```json
{
  "version": 1,
  "types": { "autori": "relation", "libri": "relation" },
  "targets": { "autori": "[[Tipi/Persona]]", "libri": "Libri" }
}
```

| Parola | Bersaglio |
|---|---|
| `[[Tipi/Persona]]` | le note di un tipo: la pagina del tipo è quella del link |
| `Libri`, `Libri/` | le note della cartella e delle sue sottocartelle |

Senza bersaglio vale ogni nota. Il bersaglio restringe la scelta
nell'editor, non il valore: un link già scritto a una nota fuori dal
bersaglio resta un link. Una parola che non si legge (vuota, `[[]]`, una
cartella con `..`) vale ogni nota e resta nel file com'è; un bersaglio che
non è una parola (un oggetto) rende illeggibile il registro.

### Collegata da

La relazione inversa di una nota sono le note che la legano con una
Relazione (`fub_features::properties::linked_from`). Si legge dai link
delle Relazioni delle altre note, risolti con le regole dei link del vault
(nome, path, alias), e non scrive niente in nessuna nota. I link nel
frontmatter non sono archi del grafo dei link, quindi i backlink non
bastano. Contano solo le chiavi dichiarate `relation`; un link rotto non
lega; una nota che lega sé stessa compare fra chi la lega.

### Il riepilogo in una Base

Una formula della Base riepiloga una proprietà delle note legate:

```yaml
formulas:
  - {name: pagine, expression: 'rollup(prop.libri, "sum", "pagine")'}
  - {name: quanti, expression: 'rollup(libri, "count")'}
```

| Argomento | Che cosa vale |
|---|---|
| primo | la Relazione, scritta come proprietà (`prop.libri` o `libri`) |
| secondo | `count`, `sum`, `average`, `min` o `max`, scritto come testo |
| terzo | la proprietà delle note legate, scritta come testo; non serve per `count` |

`count` conta le note legate trovate: un link rotto e una voce che non è un
link non contano, due link alla stessa nota sono una nota, una nota che
lega sé stessa conta come le altre. `sum` e `average` vogliono numeri,
`min` e `max` numeri o date: un valore pieno di un'altra specie è
`#VALUE!`. Senza valori pieni il risultato è vuoto, il conteggio zero. Il
riepilogo legge le proprietà delle note legate come sono scritte, mai le
loro formule o i loro riepiloghi: un giro di relazioni si ferma al primo
livello.

Il calcolo è nel core (`fub.base`). Il `plan` dice in `relations` le
Relazioni da risolvere e in `linked_props` le proprietà delle note legate da
chiedere; il `derive` riceve le note legate in `linked`, una per pagina di
link risolta, `{target, doc, props}`. Una pagina che non risolve non si
manda ed è un link rotto. Una formula che non dice per scritto la Relazione,
il riepilogo o la proprietà non si legge (`#PARSE!`).

## Quando il registro non si legge

Un registro di una versione futura, con un campo sconosciuto o rotto non si
legge: Fub usa le chiavi convenzionali e **non lo riscrive mai**. I comandi
che scrivono nel registro (`property.type.set`, `property.key.rename`,
`property.option.set`, `property.target.set`, `property.types.restore`) si
rifiutano e lo lasciano com'è. Un Fub più vecchio che trova `options`,
`targets` o il tipo `relation` nel registro fa lo stesso: per lui il campo o
il tipo è sconosciuto.

## I comandi

| Comando | Che cosa fa |
|---|---|
| `property.type.set` | dichiara il tipo di una chiave; le opzioni restano |
| `property.key.rename` | rinomina la chiave nelle note; il tipo, le opzioni e il bersaglio passano alla chiave nuova, se non ne ha già |
| `property.option.set` | aggiunge, rinomina, colora e raggruppa un'opzione |
| `property.target.set` | dice o toglie il bersaglio di una Relazione |
| `property.types.restore` | rimette il registro a un testo di prima: è l'annullo delle opzioni e del bersaglio |

`property.option.set` prende:

| Parametro | Che cosa vale |
|---|---|
| `key` | la chiave, dichiarata `select` o `status` |
| `option` | il nome dell'opzione; se non c'è, si aggiunge in fondo |
| `name` | facoltativo: il nome nuovo dell'opzione |
| `color` | facoltativo: uno dei nove colori |
| `group` | facoltativo, solo per lo Stato: `todo`, `doing`, `done` |
| `expected` | facoltativo: il testo del registro che si è letto |

Rinominare un'opzione non cambia le note: i valori scritti col nome vecchio
restano fuori dalle opzioni. Gli errori hanno un tipo:

| Caso | Errore |
|---|---|
| la chiave non è `select` né `status`; il gruppo su una Selezione; un nome vuoto; un colore o un gruppo sconosciuto; un registro illeggibile | `bad_args` |
| `expected` diverso dal registro di adesso; un nome nuovo che un'altra opzione ha già | `conflict` |
| `name` su un'opzione che non c'è | `not_found` |

Lo stesso gesto due volte non scrive la seconda volta e non ha annullo. Ogni
scrittura ha un annullo: `property.types.restore` col testo di prima e il
testo che la scrittura ha lasciato. Rimette il testo di prima byte per byte,
e solo se il registro vale ancora il testo lasciato: un registro cambiato nel
frattempo non si sovrascrive (`conflict`). Un testo illeggibile non entra nel
registro da qui.

## Il mirror

`PropertyType`, `PropertyColor` e `StatusGroup` attraversano l'IPC come
stringhe `snake_case`, nel mirror generato
`apps/client/src/host/enums.generated.ts`
(`UPDATE_MIRROR=1 cargo test -p fub-abi --test ts_enums`). Il registro non
passa dalla WIT.
