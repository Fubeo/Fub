# Le ricette

> **Per chi:** chi scrive una ricetta, a mano o con un'AI, e chi lavora sul
> componente che le legge.
> **Fonte autorevole:** `crates/fub-features/src/recipes.rs`.
> **Presidi:** i test di `recipes.rs` (`recipes.new` e il suo annullamento,
> l'esempio che si rilegge come YAML), `crates/fub-features/tests/componenti.rs`
> e `crates/fub-features/tests/censimento.rs` per la riga della mappa.

Una ricetta è una nota che dice a Fub quali comandi fare, in fila, sulla nota
su cui la si usa: «segna la data e sposta in Archivio», «chiudi le attività e
aggiungi il tag `fatto`». Non è un programma: niente condizioni, cicli o
valori passati da un passo all'altro. Ogni passo è un comando del registro, lo
stesso che la palette mostra, e tutto ciò che una ricetta fa si annulla.

Le ricette sono il componente **Ricette** (`fub.recipes`, gruppo «Scrivere»
della pagina dei componenti, cargo feature `recipes`): richiede le Note e i
Comandi, e spento lui le note della cartella restano note come le altre.

Questa pagina dice oggi dove vive una ricetta, com'è fatto il blocco, i suoi
campi e i limiti, e che cosa fa `recipes.new`. Il controllo delle ricette,
l'esecuzione, l'annullamento e il consenso arrivano con le parti successive
del lavoro sulle ricette, e questa pagina li descriverà quando ci saranno:
oggi una ricetta scritta in un vault **non** compare fra i comandi.

## Dove vive

Una ricetta è una nota Markdown dentro la cartella dell'impostazione
`recipes.folder`, sottocartelle comprese, con **esattamente un** blocco di
codice con il linguaggio `fub-recipe`. Il resto della nota è testo libero per
chi la legge: si scrive, si copia e si manda a un amico come ogni nota.

| Impostazione | Tipo | Di serie | Dove si salva |
|---|---|---|---|
| `recipes.folder` | testo | `Recipes` | nelle impostazioni del vault, come `daily.folder` |

Un valore che non è una cartella che si può creare (vuoto, con `..`, con
caratteri che un disco rifiuta) vale come `Recipes`. Una nota della cartella
senza nessun blocco `fub-recipe` non è una ricetta: un `LEGGIMI.md` lì dentro
è normale, e non conta per il limite.

Il nome del file non è l'identità della ricetta: la nota si rinomina e si
sposta dentro la cartella senza cambiare la ricetta. L'identità è il campo
`id`.

## Il blocco

Il blocco è YAML, in un blocco di codice che si apre con tre apici inversi
seguiti da `fub-recipe` e si chiude con tre apici inversi. Dentro, la ricetta
d'esempio, quella che scrive `recipes.new` per una nota «Archivia la nota»:

```yaml
fub-recipe: 1
id: archivia-la-nota
title: Archivia la nota
description: Segna la data e sposta la nota in Archivio.
steps:
  - run: note.property.set
    args:
      doc: '{{doc}}'
      key: archiviata
      value: '{{date}}'
  - run: note.rename
    args:
      doc: '{{doc}}'
      to: Archivio/{{title}}.md
```

Le mappe si possono scrivere anche fra graffe
(`args: { doc: "{{doc}}", key: archiviata }`): per Fub è lo stesso blocco.

## I campi

| Campo | Obbligatorio | Che cosa vuol dire |
|---|---|---|
| `fub-recipe` | sì | la versione del formato: oggi `1` |
| `id` | sì | l'identità stabile: minuscole latine, cifre e `-`, da 1 a 48 caratteri |
| `title` | sì | il nome nella palette e nel menu «/», così com'è scritto |
| `description` | sì | una frase che dice che cosa fa, così com'è scritta |
| `keybinding` | no | la scorciatoia, nella forma dei comandi (`Mod-Alt-a`) |
| `surfaces` | no | dove si offre oltre alla palette: `slash`, `slash_selection`, `toolbar` |
| `params` | no | i valori che la persona dà quando la usa (vedi sotto) |
| `steps` | sì | i passi, in ordine: ognuno ha `run` (l'id di un comando) e `args` |

Un parametro ha `name`, `title`, `kind` (`text`, `number`, `bool`,
`document` o `choice`), `required` (di serie `false`) e, solo per `choice`,
`options`. Un passo lo usa con `{{param.<name>}}`.

Negli `args` di un passo i valori possono portare i segnaposto: `{{doc}}` (il
percorso della nota su cui si usa la ricetta), `{{title}}` (il suo nome senza
estensione), `{{folder}}`, `{{selection}}`, le date e le ore dei template
(`{{date}}`, `{{time}}` e compagni) e `{{param.<name>}}`. L'elenco completo e
le regole di sostituzione arrivano con il controllo delle ricette.

## I limiti

- Esattamente un blocco `fub-recipe` per nota.
- Da 1 a 20 passi; niente condizioni, cicli o uscite di un passo usate da un
  altro.
- Un `id` per ricetta in tutto il vault: due note con lo stesso `id` non si
  accendono, nessuna delle due.
- Al massimo 200 ricette per vault, le prime in ordine di percorso.
- Un passo lancia un comando che si annulla e che non cambia le impostazioni,
  e mai un'altra ricetta.
- Un campo che il formato non conosce è un problema, non un campo ignorato;
  `fub-recipe` più grande di `1` lascia la ricetta spenta.

## `recipes.new`

Il punto di partenza per chi non usa un'AI: dalla palette, «Nuova ricetta».

| Parametro | Tipo | Che cosa fa |
|---|---|---|
| `title` | testo, facoltativo | il nome della nota e il `title` della ricetta; senza, «Nuova ricetta» (nella lingua dell'interfaccia) |

Il comando:

- crea `<recipes.folder>/<title>.md`, e la cartella se manca. La nota nasce
  `.md` qualunque sia l'estensione scelta per le note nuove: il blocco lo
  legge il formato Markdown;
- se il nome c'è già prende il primo libero («Nuova ricetta 1»), come
  `note.create`, e non sovrascrive mai;
- scrive la ricetta d'esempio, con `title` uguale al nome della nota e `id`
  ricavato dal nome (minuscole, accenti tolti, trattini al posto del resto:
  «Nuova ricetta 1» dà `nuova-ricetta-1`; senza lettere né cifre latine,
  `ricetta`). Così due ricette nuove non hanno lo stesso `id`;
- apre la nota (`Navigate`);
- rifiuta con `BadArgs` un titolo con `/`, `\`, che comincia con `.` o che un
  disco rifiuta;
- si annulla portando la nota nel cestino (`note.trash`): annullare non
  cancella per sempre.

La ricetta che nasce non fa niente da sola: è una nota con un blocco, e
diventa un comando soltanto quando la persona la accende.
