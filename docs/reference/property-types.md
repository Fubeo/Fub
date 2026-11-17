# I tipi delle proprietà

> **Ambito:** il registro `properties.types` del vault, i tipi che dichiara,
> le opzioni di Selezione e Stato e i comandi che lo scrivono.
> **Fonti autorevoli:** `crates/fub-abi/src/model/property.rs`,
> `crates/fub-kernel/src/properties.rs`,
> `crates/fub-features/src/properties/commands.rs`.

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

Un registro senza opzioni non scrive il campo `options`: si riscrive byte per
byte com'era prima che le opzioni esistessero.

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
testo, segnato. Nel pannello delle proprietà una Selezione o uno Stato dentro
le opzioni è una tendina; fuori dalle opzioni resta un campo di testo.

Un colore o un gruppo che questo Fub non conosce si legge lo stesso: si
mostra grigio, o Da fare, e la parola resta nel file se il registro si
riscrive. Due opzioni con lo stesso nome, scritte a mano, si leggono: vale la
prima. Un campo che questo Fub non conosce, invece, rende illeggibile tutto
il registro.

## Quando il registro non si legge

Un registro di una versione futura, con un campo sconosciuto o rotto non si
legge: Fub usa le chiavi convenzionali e **non lo riscrive mai**. I comandi
che scrivono nel registro (`property.type.set`, `property.key.rename`,
`property.option.set`, `property.types.restore`) si rifiutano e lo lasciano
com'è. Un Fub più vecchio che trova `options` nel registro fa lo stesso: per
lui il campo è sconosciuto.

## I comandi

| Comando | Che cosa fa |
|---|---|
| `property.type.set` | dichiara il tipo di una chiave; le opzioni restano |
| `property.key.rename` | rinomina la chiave nelle note; il tipo e le opzioni passano alla chiave nuova, se non ne ha già |
| `property.option.set` | aggiunge, rinomina, colora e raggruppa un'opzione |
| `property.types.restore` | rimette il registro a un testo di prima: è l'annullo delle opzioni |

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
