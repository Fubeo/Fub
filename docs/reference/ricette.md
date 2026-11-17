# Le ricette

> **Per chi:** chi scrive una ricetta, a mano o con un'AI, e chi lavora sul
> componente che le legge.
> **Fonte autorevole:** `crates/fub-features/src/recipes.rs` e, per la
> lettura e i controlli, `crates/fub-features/src/recipes/format.rs`, per
> l'esecuzione, l'annullamento e la prova `crates/fub-features/src/recipes/run.rs`;
> le date dei segnaposto in `crates/fub-features/src/vocabulary.rs`.
> **Presidi:** i test di `recipes.rs` (l'esempio di questa pagina è quello che
> scrive `recipes.new`, e si rilegge come YAML) e di `recipes/run.rs` (l'ordine
> dell'annullamento, il passo senza annullamento, la fusione dei piani),
> `tests/recipes_format.rs` (un caso per codice, le righe, l'impronta, la spec,
> i controlli contro le spec vere; ogni codice di questa pagina ha la sua frase
> nei cataloghi), `tests/recipes_e2e.rs` (`recipes.new` e una ricetta adottata
> attraverso il kernel e il `Guard`: i passi, l'annullamento, l'esito a metà,
> la prova), `tests/command_conformance.rs` (il comando di una ricetta passa la
> conformità dei comandi), `tests/componenti.rs` e `tests/censimento.rs` per
> la riga della mappa, tutti in `crates/fub-features`.

Una ricetta è una nota che dice a Fub quali comandi fare, in fila, sulla nota
su cui la si usa: «segna la data e sposta in Archivio», «chiudi le attività e
aggiungi il tag `fatto`». Non è un programma: niente condizioni, cicli o
valori passati da un passo all'altro. Ogni passo è un comando del registro, lo
stesso che la palette mostra, e tutto ciò che una ricetta fa si annulla.

Le ricette sono il componente **Ricette** (`fub.recipes`, gruppo «Scrivere»
della pagina dei componenti, cargo feature `recipes`): richiede le Note e i
Comandi, e spento lui le note della cartella restano note come le altre.

Questa pagina dice dove vive una ricetta, com'è fatto il blocco, i suoi campi
e i limiti, i segnaposto, i controlli con i loro codici, come gira, si annulla
e si prova, e che cosa fa `recipes.new`. Il componente sa leggere, controllare,
eseguire e provare una ricetta, ma l'host
non le cerca ancora nel vault: una ricetta scritta in un vault **non** compare
fra i comandi.

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
      doc: "{{doc}}"
      key: archiviata
      value: "{{date}}"
  - run: note.rename
    args:
      doc: "{{doc}}"
      to: "Archivio/{{title}}.md"
```

Le mappe si possono scrivere anche fra graffe
(`args: { doc: "{{doc}}", key: archiviata }`): per Fub è lo stesso blocco.

## I campi

| Campo | Obbligatorio | Che cosa vuol dire |
|---|---|---|
| `fub-recipe` | sì | la versione del formato: `1` |
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

Un `name` è fatto di minuscole latine, cifre e `_`, comincia con una lettera
e ha al massimo 48 caratteri; `doc` e `selection` sono dei parametri che Fub dà
da sé (vedi «Il comando che nasce») e non si dichiarano. Un passo senza
argomenti può non avere `args`.

## I segnaposto

Negli `args` di un passo un valore di testo può citare, fra doppie graffe:

| Segnaposto | Vale |
|---|---|
| `{{doc}}` | il percorso della nota su cui si usa la ricetta (`Progetti/Piano.md`) |
| `{{title}}` | il nome di quella nota senza estensione (`Piano`) |
| `{{folder}}` | la sua cartella (`Progetti`), vuota per una nota alla radice |
| `{{selection}}` | il testo selezionato |
| `{{date}}`, `{{time}}`, `{{datetime}}` | la data `AAAA-MM-GG`, l'ora nel formato dell'utente, le due insieme |
| `{{year}}`, `{{month}}`, `{{day}}`, `{{hour}}`, `{{minute}}` | i pezzi, a due cifre (l'anno a quattro) |
| `{{param.<name>}}` | il valore che la persona ha dato al parametro `<name>` |

Le date e le ore sono quelle dei template, nel fuso di chi usa Fub, e le
calcola lo stesso codice. Il resto è delle ricette: `{{random}}` no (la prova
deve mostrare ciò che succederà), e `{{name}}` e `{{filename}}` dei template
nemmeno. Un segnaposto che non sta nella tabella è un problema, anche scritto
con gli spazi (`{{ title }}`): nei template resterebbe testo, qui non c'è un
testo da lasciare com'era.

Un valore che è **esattamente** un segnaposto prende il valore col suo tipo:
`value: "{{param.quanti}}"` con un parametro `number` passa al comando un
numero. Dentro un testo più lungo il valore entra come testo
(`"n. {{param.quanti}}"`). Un parametro facoltativo che la persona non ha dato
vale nullo da solo (il comando lo riceve come assente) e testo vuoto dentro un
testo. La sostituzione è una passata sola: una selezione che contiene
`{{date}}` arriva al comando così com'è.

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

## I controlli

Prima di diventare un comando una ricetta passa due controlli, e ogni
problema che trovano dice tre cose: il **codice**, il **campo** (il percorso
nel blocco, con gli indici da zero: `steps[1].args.to`) e la **riga** della
nota. La lettura non si ferma al primo problema: li dice tutti, così una
ricetta si corregge in un giro. Unica eccezione, `versione-futura`, che arriva
da sola: un blocco più nuovo di questo Fub può avere campi che Fub non conosce.

1. **La forma**, sulla nota sola: il blocco, lo YAML, i campi, i limiti, i
   parametri e i segnaposto.
2. **Il registro**, contro i comandi accesi in quel momento: ogni `run`
   esiste e non è un'altra ricetta (`recipe.…`), si annulla e non cambia le
   impostazioni; e i suoi `args`, con valori d'esempio del tipo giusto al
   posto dei segnaposto, sono quelli che il comando accetta.

La riga è quella del campo quando il blocco è scritto a righe, come
nell'esempio; per un campo dentro una mappa fra graffe è la riga della chiave
che la apre, e per un problema del blocco intero la riga della recinzione.

## I codici

Stabili come gli id dei comandi: li legge la persona e li legge l'AI che
corregge la ricetta. Un codice nuovo si aggiunge; uno vecchio non cambia
significato.

| Codice | Quando |
|---|---|
| `blocco-assente` | la nota non ha un blocco `fub-recipe`: non è una ricetta, e l'elenco la salta |
| `blocchi-doppi` | più di un blocco `fub-recipe`; uno per blocco, con la sua riga |
| `yaml` | il blocco non si legge come YAML (con la riga dello sbaglio), non è un elenco di campi, ha una chiave ripetuta o apre troppe `[` e `{` |
| `campo-sconosciuto` | un campo che il formato non conosce, in cima, in un parametro o in un passo |
| `campo-mancante` | manca `fub-recipe`, `id`, `title`, `description`, `steps`, o il `name`, il `title` o il `kind` di un parametro, o il `run` di un passo |
| `valore-non-valido` | un tipo o un limite sbagliato: un `id` fuori forma, zero o più di 20 passi, un `kind` sconosciuto, una `choice` senza opzioni, opzioni su un parametro che non è una `choice`, due parametri con lo stesso nome, una scorciatoia o una superficie che non esistono, un testo vuoto |
| `versione-futura` | `fub-recipe` più grande di 1 |
| `segnaposto-sconosciuto` | un segnaposto fuori dalla tabella, `{{param.x}}` senza il parametro `x`, `{{random}}` |
| `comando-sconosciuto` | `run` nomina un comando che non c'è (o il cui componente è spento) |
| `comando-ricetta` | un passo che lancia un'altra ricetta |
| `non-si-annulla` | il comando di un passo non si annulla |
| `impostazioni` | il comando di un passo cambia le impostazioni |
| `argomenti` | il comando rifiuta gli `args` del passo (uno che non conosce, uno che manca, un tipo sbagliato) |
| `id-ripetuto` | due ricette del vault con lo stesso `id`: su tutte e due, e nessuna si accende |
| `id-occupato` | l'`id` è già di un comando che non è questa ricetta |
| `troppe` | il vault ha più di 200 ricette: uno per vault, senza campo né riga |

## L'impronta

L'impronta di una ricetta è lo SHA-256, in esadecimale, del JSON canonico
della ricetta letta (chiavi in ordine alfabetico, nessuno spazio), non del
testo della nota: un commento cambiato fuori dal blocco, un commento YAML o
l'ordine dei campi non la toccano; un passo diverso sì. È ciò su cui la
persona dà il consenso.

## Il comando che nasce

Una ricetta diventa il comando `recipe.<id>:run`, con il titolo e la
descrizione così come sono scritti, la scorciatoia e le superfici del blocco,
sempre reversibile. Scrive se un suo passo scrive, e la sua portata è la più
larga dei passi. I parametri, in quest'ordine:

1. `selection` (testo, obbligatorio) se un passo usa `{{selection}}`: allora
   la ricetta si offre anche nel menu «/» quando c'è una selezione;
2. `doc` (una nota, obbligatorio) se un passo usa `{{doc}}`, `{{title}}` o
   `{{folder}}`;
3. i parametri dichiarati, con il loro titolo letterale.

## Come gira e come si annulla

Il comando fa i passi in ordine, ognuno come lo farebbe la palette, con gli
argomenti del blocco e i segnaposto già sostituiti. Ogni passo scrive col
recinto del comando che lancia; la ricetta di suo non scrive niente, e lancia
soltanto i comandi che il suo consenso (`fub:run-command`) nomina: un altro
viene rifiutato.

| Che cosa succede | Che cosa vede chi la usa |
|---|---|
| tutti i passi riescono | «fatto», e un «Annulla» toglie la ricetta intera |
| il primo passo non riesce | l'errore di quel passo, e niente è cambiato |
| un passo dopo il primo non riesce | i passi prima restano fatti, un avviso nomina il passo (numero e comando) e il perché, l'esito è «a metà» e «Annulla» toglie i passi fatti; i passi dopo non si provano |
| un passo che scrive torna senza annullamento | la ricetta resta fatta ma non si annulla, e l'avviso lo dice |

L'annullamento è uno solo, col titolo della ricetta: gli annullamenti dei passi,
dall'ultimo passo al primo. Un passo che si dichiara di sola lettura non ha
niente da annullare. Un passo che scrive e torna senza annullamento (anche un
passo che non ha trovato niente da cambiare, come togliere una proprietà che
non c'è) lascia tutta la ricetta senza: togliere metà dei passi e lasciare
l'altra metà sarebbe un annullamento che mente. Ciò che la shell fa dopo (aprire
una nota) è quello dell'ultimo passo riuscito.

I passi non si passano niente, nemmeno il percorso: dopo un passo che sposta la
nota, `{{doc}}` è ancora il percorso di prima. «Rinomina, poi segna una
proprietà su `{{doc}}`» non trova la nota al secondo passo e si ferma a metà;
segna prima, poi sposta, come fa la ricetta d'esempio.

## La prova

Invocata in prova (`DryRun`), la ricetta fa ogni passo in
simulazione e fonde ciò che ognuno farebbe: i riassunti dei passi in fila, le
note toccate senza doppioni, le modifiche da mostrare in fila. Niente si
scrive. Se il primo passo non si può provare, la prova risponde col suo errore;
se non si può provare un passo dopo, la prova mostra i passi prima e dice quale
passo si è fermato e perché.

La prova è **approssimata** quando un passo dipende da un altro: in simulazione
niente si sposta, quindi un passo dopo una rinomina vede la nota dov'era. La
prova è `recipes::plan`, generica su chi esegue i passi in simulazione: la usa
il comando, ed è quella che serve anche all'host prima di adottare e alla CLI.

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
  ricavato dal nome come l'ancora di un titolo di sezione, poi senza accenti e
  con le sole lettere e cifre latine: «Nuova ricetta 1» dà `nuova-ricetta-1`,
  «Città: più bella!» dà `citta-piu-bella`, un nome senza lettere né cifre
  latine dà `ricetta`. Così due ricette nuove non hanno lo stesso `id`;
- apre la nota (`Navigate`);
- rifiuta con `BadArgs` un titolo con `/`, `\`, che comincia con `.` o che un
  disco rifiuta;
- si annulla portando la nota nel cestino (`note.trash`): annullare non
  cancella per sempre.

La ricetta che nasce non fa niente da sola: è una nota con un blocco, e
diventa un comando soltanto quando la persona la accende.
