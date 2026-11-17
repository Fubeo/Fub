# Formati dei file Craft

> **Ambito:** gli id dei formati dei file delle app Craft, le estensioni che
> reclamano, la forma `CraftPreview` dell'anteprima e i limiti di lettura.
> **Fonti autorevoli:** `crates/fub-format-craft/src/apps.rs`,
> `crates/fub-format-craft/src/contract.rs` e
> `apps/client/src/host/craft.ts`, con la fixture
> `apps/client/src/__fixtures__/craft-preview.json`.

`fub-format-craft` legge i file che VectorCraft, PhotoCraft, FigCraft e
LightCraft lasciano nel vault, senza il motore delle app e senza mai
scriverli: i metadati, il testo per la ricerca, i file collegati e
l'anteprima che il file porta. Le [app esterne](external-editors.md) li
aprono e li modificano; gli XMP hanno la [loro pagina](xmp-sidecars.md).
Con la feature `craft`, `fub-host` monta il crate e ci mette accanto il
comando `craft.preview` e il job `craft.render`.

## Id ed estensioni

| Famiglia (`info.app`) | Id del formato | Estensione | Editor esterno |
|---|---|---|---|
| `vectorcraft` | `craft-vectorcraft` | `.vectorcraft` | `vectorcraft` |
| `photocraft` | `craft-photocraft` | `.pcraft` | `photocraft` |
| `figcraft` | `craft-figcraft` | `.figcraft` | `figcraft` |
| `xmp` | `craft-xmp` | `.xmp` | `lightcraft` |

I quattro provider sono a byte (`SourceKind::Bytes`) e reclamano soltanto
queste estensioni: le altre che le app aprono (`psd`, `pdf`, `xlsx`…)
restano dei loro formati. Gli id si confrontano così come sono scritti.
`serialize` risponde `FormatError::Unsupported` e la riscrittura dei link è
quella di serie, che non cambia niente.

Un file che non si legge, o che supera un limite, dà un modello vuoto con il
suo id, non un errore: resta nel vault e si trova per nome. La resa HTML è
una figura che la shell riempie:

```html
<figure class="fub-craft" data-embed-kind="craft" data-embed-doc="Disegni/logo.vectorcraft"
        data-craft-app="vectorcraft"><figcaption>logo.vectorcraft</figcaption></figure>
```

Per un XMP `data-embed-kind` vale `craft-xmp`.

## Il contratto `CraftPreview`

```json
{
  "version": 2,
  "doc": "Foto/IMG_0001.CR3",
  "revision": null,
  "size": "large",
  "origin": "file",
  "queued": false,
  "image": {
    "media_type": "image/jpeg", "data": "<base64>",
    "width": 1620, "height": 1080, "orientation": 6
  },
  "missing": null,
  "limit_bytes": null,
  "info": {
    "app": "raw",
    "editor": "LightCraft",
    "format_version": null,
    "bytes": 31457280,
    "photo": null,
    "edits": [],
    "xmp": null
  },
  "render": null
}
```

| Campo | Valori |
|---|---|
| `version` | sempre `2`; una forma di un'altra versione non si legge |
| `revision` | la revisione dei byte da cui l'anteprima è nata, o `null` quando Fub ne ha letto solo dei pezzi: una risposta senza revisione non va in cache e per la shell vale come appena letta |
| `size` | `small` (la figura nella nota, l'anteprima al passaggio, l'albero) o `large` (la scheda) |
| `origin` | `file` (era nel file), `cli` (l'ha fatta l'app), `none` (non c'è) |
| `queued` | `true` solo nella risposta che ha messo in coda il job `craft.render`; `craft.preview` non mette mai in coda niente |
| `image` | `null` o l'immagine in base64: `media_type` `image/png` o `image/jpeg`; `width` e `height` dall'immagine (l'`IHDR` del PNG, il segmento `SOF` del JPEG); `orientation` l'orientamento EXIF da 1 a 8 che la shell applica, 1 per «così com'è» |
| `missing` | `null` quando `image` c'è; altrimenti `absent` (il file non ne ha una), `over_limit` (andrebbe letto intero e supera il peso massimo), `unreadable` (il file è rotto o non è del formato che dice), `failed` (l'app ha provato per questa revisione e non ci è riuscita) |
| `limit_bytes` | `null`, o il peso massimo in byte, solo con `missing: "over_limit"` |
| `info.app` | il soggetto (`PreviewSubject`): `vectorcraft`, `photocraft`, `figcraft`, `xmp`, `raw`, `pdf` o `document` |
| `info.editor` | il nome da mostrare dell'app che apre il soggetto |
| `info.format_version` | la versione scritta nel file, come stringa, o `null` |
| `info.bytes` | il peso del file |
| `info.photo` | per un XMP, la foto a cui appartiene, o `null` |
| `info.edits` | le copie `-Edit.psd` della foto che esistono |
| `info.xmp` | `null` o `{ "rating", "label", "flag", "keywords" }`, con `flag` `pick` o `reject` |
| `render` | `null`, o `{ "app": "VectorCraft", "consent": "ask" }` quando l'anteprima manca, la CLI dell'app che sa farla è installata, il file non supera il peso massimo e la stessa revisione non è già fallita; `consent` (`ask`, `on`, `off`) è il valore di `craft.cli-previews` |

`PreviewSubject` è separato da `CraftApp`, che resta la famiglia dei quattro
provider. Un file con un formato Craft ha il soggetto del suo formato; gli
altri lo prendono dall'estensione, confrontata senza badare alle maiuscole
(`IMG_0001.CR3`): `raw` per `cr3`, `cr2`, `nef`, `arw`, `raf`, `dng`, `orf`
e `rw2` (LightCraft), `pdf` per `pdf` (PdfCraft), `document` per `docx`,
`odt`, `rtf` e `doc` (WordCraft). Un `.pdf` col suo provider resta di quel
provider per la ricerca, e il soggetto `pdf` vale per l'anteprima. Un file
senza estensione, o con un'estensione che nessun soggetto ha, è un
`bad_args`.

Il contratto ha anche `PhotoSidecar`, la risposta del comando
`craft.photo { doc }`: per una foto, l'XMP che le sta accanto e i suoi dati,
in sola lettura (come si trova l'XMP è in
[XMP accanto alle foto](xmp-sidecars.md)). La forma è questa:

```json
{
  "version": 2, "doc": "Foto/IMG_0001.CR3", "xmp": "Foto/IMG_0001.CR3.xmp",
  "meta": { "rating": 4, "label": "Rosso", "flag": "pick", "keywords": ["mare"] },
  "edits": ["Foto/IMG_0001-Edit.psd"]
}
```

`xmp` e `meta` sono `null` per una foto senza XMP.

I nomi del contratto sono costanti del crate: i comandi `craft.preview`
(`PREVIEW_COMMAND`) e `craft.photo` (`PHOTO_COMMAND`), il job
`craft.render` (`RENDER_JOB`) e lo spazio dei nomi `fub.craft`
(`BUNDLE_NS`). La chiave della cache di un'anteprima è
`previews/{:016x}.json`, con l'FNV-1a a 64 bit di `"{revision}\0{size}"`
(`cache_key`). `jpeg::size` legge le misure di un JPEG: `FF D8`, poi i
segmenti fino al primo `SOF` (da `C0` a `CF`, tranne `C4`, `C8` e `CC`),
ogni lunghezza controllata contro i byte, al più 1000 segmenti; misure a
zero o oltre 65 535 non valgono.

`readCraftPreview` e `readPhotoSidecar` in `apps/client/src/host/craft.ts`
controllano ogni campo: un campo mancante o di un altro tipo, un
`orientation` fuori da 1–8, un `limit_bytes` senza `over_limit` danno
`null`, un campo in più si ignora.
`UPDATE_MIRROR=1 cargo test -p fub-format-craft --test ts_preview` riscrive
la fixture che tiene uguali i due lati, con un esempio per ogni soggetto,
ogni `missing` e ogni `consent`.

## Anteprima e cache

Il bundle `fub.craft` (`crates/fub-host/src/craft/`, feature `craft`)
risponde al comando `craft.preview` (`{ "doc", "size" }`, in sola lettura)
con un `CraftPreview` nell'effetto `Custom` con `ns` `fub.craft`. `size`
assente vale `small`; un documento senza soggetto è un `bad_args`. Il
comando non avvia mai niente: un `render` nella domanda (la forma della
versione 1) è ancora dichiarato, e si ignora. I formati non dipendono dal bundle: col componente spento il
comando non c'è, e ricerca, backlink e tag restano.

- La cache sta in `.fub/data/plugins/fub.craft/previews/*.json`, alla chiave
  `cache_key(revision, size)`. Una voce vale se si legge, è della versione 2 e
  ripete `doc`, `revision` e `size`; una rotta, di un'altra versione o di un
  altro documento vale assente, e l'anteprima si rifà.
- Una foto RAW, con la lease, dà il JPEG che porta dentro (vedi «I RAW»):
  si leggono a pezzi solo le strutture del file e il JPEG scelto per la
  misura, e la risposta è `origin: file` con `revision: null`; senza JPEG è
  `missing: "absent"`, con un file rotto `"unreadable"`. Senza lease un RAW
  non si legge, ed è `"absent"`.
- Di un `.docx` o di un `.odt`, con la lease, si leggono a pezzi la coda
  dello ZIP, le relazioni e la miniatura (vedi «PDF e documenti»): con la
  miniatura `origin: file`, senza `missing: "absent"`, con un file che non è
  uno ZIP `"unreadable"`, sempre con `revision: null`. Un PDF, un `.rtf` o
  un `.doc`, e un documento senza lease, non si leggono: la risposta è
  `origin: none` con `missing: "absent"`, e `revision: null` quando il peso
  viene dalla lease (vedi «Letture a pezzi»).
- Altrimenti si leggono i byte: l'anteprima nel file dà `origin: file`, e
  senza `origin: none` con `missing: "absent"`, o `"unreadable"` se il file
  non si legge. Per un XMP `info.xmp` viene da `xmp::read`, la foto
  dai figli diretti della sua cartella (il nome esatto, o per il solo gambo
  il primo in ordine di id con un'altra estensione, confrontando i nomi come
  sono scritti) e `info.edits` dalla copia `-Edit.psd` della foto, se c'è.
- Un file da leggere intero oltre il suo limite (vedi «Letture a pezzi»),
  col peso della lease (o, senza lease, quello che dice l'anagrafe), non si
  legge: è `origin: none` con `missing: "over_limit"`, `limit_bytes` e, dalla
  lease, `revision: null`.
- Si scrive in cache solo un'anteprima con `origin` `file` o `cli` e con una
  revisione dei byte letti. La scrive chi ha il
  permesso di scrivere i dati del bundle: il comando, che è in sola lettura,
  la legge ma non la scrive, perché il kernel nega le scritture a un comando
  di sola lettura; una scrittura che non riesce non toglie l'anteprima.
- La cache è ricostruibile: cancellarla non perde niente, l'anteprima si
  rilegge dal file. Una revisione nuova è una chiave nuova, e le voci vecchie
  restano finché la cache del bundle non si pulisce.
- Un'anteprima fatta dalla CLI (vedi «Anteprime con la CLI») sta in cache
  come le altre, con `origin: cli`, e la risposta dopo viene da lì.

## Anteprime con la CLI

Quando un file non ha un'anteprima, l'app che lo apre può farla dalla sua
riga di comando (`craft::render::cli_args`):

| Soggetto | App | Argomenti `small` | Per `large` |
|---|---|---|---|
| `vectorcraft` | VectorCraft | `convert {in} {out} --scale 0.25` | senza `--scale` |
| `photocraft` | PhotoCraft | `convert {in} {out}` | gli stessi |
| `figcraft` | FigCraft | `render {in} -o {out}` | gli stessi |
| `raw` | LightCraft | `render {in} -o {out} --size 512` | `--size 2048` |
| `pdf` | PdfCraft | `render {in} --page 1 --dpi 36 --out {out}` | `--dpi 144` |
| `document` | WordCraft | `render {in} {out} --page 1 --scale 0.5` | `--scale 1` |

Un XMP non ha una CLI. LightCraft serve solo a un RAW senza un JPEG dentro
(mai a un `.jpg`, che non è un soggetto: la WebView lo mostra), PdfCraft a
ogni PDF (solo la prima pagina, anche di un libro di 500), WordCraft a un
documento senza miniatura (un `.docx` o un `.odt` che non la porta, un
`.rtf`, un `.doc`): l'offerta c'è solo con `missing: "absent"`. Il programma
si trova come in «Apri con», con le righe `<id>-cli=…` di
`craft.editor-paths` (`lightcraft-cli=…`, `pdfcraft-cli=…`…); un'app senza
il suo programma non dà né offerta né domanda.

- **Quando parte.** Soltanto dopo un gesto dell'utente nella shell
  principale, che chiama `Host::craft_render(vault, doc, size)`, e soltanto
  con `craft.cli-previews` a `on`. L'ordine dei controlli: con la feature o
  il componente `fub.craft` spenti `host.craft_render.off`; senza il
  consenso `host.craft_render.no_consent` (`permission_denied`); con
  un'anteprima che c'è già, o con `missing` `unreadable` o `failed`, la
  risposta di `craft.preview`; senza il programma `host.craft_render.no_cli`
  (`not_found`); oltre il peso massimo `host.craft_render.over_limit`.
  Altrimenti un biglietto e il job `craft.render { doc, size, ticket }` in
  coda per quel vault, e la risposta col `CraftPreview` e `queued: true`; un
  biglietto che non nasce è `host.craft_render.ticket` (`io`), col dettaglio
  soltanto nel log.
  Due gesti per lo stesso documento e la stessa misura mentre uno lavora
  avviano una CLI sola: il secondo risponde `queued: true` senza un biglietto
  nuovo.
- **Il biglietto.** Un valore casuale di 32 byte, legato a vault, documento
  e misura, buono una volta sola e per 60 s, in una tabella del processo (al
  più 256). Il job lo consuma prima di ogni altra cosa; uno che manca, è
  inventato, già usato, di un altro documento o di un'altra misura, scaduto
  o di un vault chiuso è `unserved` con `render.no_ticket`, e non parte
  niente. Il biglietto non va nel log né nell'esito del job. Per questo
  `craft.preview`, un altro componente, l'MCP e il canale di controllo, che
  arrivano al job soltanto per nome, non avviano mai una CLI.
- **Che cosa vede l'app.** Il job guarda di nuovo il consenso e il peso, poi
  copia il documento a pezzi dalla lease (al più il peso massimo, mai il
  file intero in memoria) in una cartella privata nuova
  (`fub-craft-render-*` nella cartella temporanea, 0700 su unix), sempre
  come `in.` più l'estensione: `in.vectorcraft`, `in.pcraft` o
  `in.figcraft` per i formati Craft, e per un RAW, un PDF o un documento
  l'estensione del nome così come è scritta (`in.CR3`, `in.pdf`), perché
  l'app riconosce il formato dal nome; Fub non piega il caso, e un nome che
  comincia con `-` non arriva mai alla CLI. La CLI riceve i percorsi
  assoluti della copia e di `out.png` nella stessa cartella, come argomenti
  separati, e non vede mai il file del vault. Gira coi limiti di
  `craft::launch` (20 s, 64 KiB di uscita, il gruppo di processi chiuso alla
  fine, prima di raccogliere l'uscita, così il segnale non arriva a un id
  passato a un altro processo; su Linux la CLI muore anche con Fub, con
  `PR_SET_PDEATHSIG`) e si ferma quando il job si annulla o il consenso si
  spegne. La cartella si cancella sempre, anche dopo un errore o un
  annullamento; quelle lasciate da un Fub uscito di colpo si tolgono al
  montaggio del bundle, soltanto se sono cartelle vere (mai un link) col
  prefisso `fub-craft-render-`, di chi usa Fub, 0700 e ferme da più di
  un'ora (`LEFT_AFTER`).
- **L'immagine.** `out.png` vale se è un file regolare (non un link, non una
  cartella), di al più 16 MiB, e un PNG o un JPEG, riconosciuto dalla firma
  e non dal nome, con misure lecite (`PreviewImage::from_png` o
  `from_jpeg`, un JPEG con orientamento 1). Allora l'esito è
  un `CraftPreview` con `origin: cli`, scritto in cache per la revisione
  presa all'inizio; se il file è cambiato nel frattempo l'esito c'è ma la
  cache no. Dopo la copia il job guarda la cache e l'insieme «già provato»
  per la revisione della copia: un'anteprima che c'è già risponde da lì, una
  revisione già fallita risponde `failed`, e in tutti e due i casi la CLI
  non parte. Un errore (programma che non parte, tempo scaduto, uscita non
  zero, un PDF cifrato che la CLI rifiuta, un'immagine cattiva) è un
  `CraftPreview` con `origin: none`, `missing: "failed"` e `render: null`,
  con la chiave `render.*` del catalogo del bundle nel log del job; la coppia (revisione, misura) resta «già provata»
  e `craft.preview` risponde `failed` finché il file non cambia o Fub non
  riparte. Un errore della cartella temporanea non segna il file.
- **Dove va.** L'esito del job arriva alla shell con `Event::JobDone`; la
  cache è quella di «Anteprima e cache».

### Letture a pezzi

Il bundle legge i file con le lease del kernel, le stesse del protocollo
`fub-asset:`, senza una porta nell'ABI: quando si registra prende il
`ResourceReader` del vault (`Registrar::craft_reader`, una superficie del
solo `fub.craft`), e dentro un comando non prende mai il lucchetto del
workspace (`crates/fub-host/src/craft/ranged.rs`). Chiuso il vault, il lettore
non legge più e non tiene aperta la cartella: un lettore rimasto nella cache
dei biglietti non impedisce di rinominare, spostare o cancellare il vault.

- Che cosa si legge a pezzi: tutto ciò che il bundle legge di un file. Il
  peso viene dalla lease (`stat.size`), non dall'elenco della cartella.
  `RangedFile` dà `Read + Seek` sopra una lease, a pezzi di 256 KiB, con gli
  offset `u64` (un file oltre 4 GiB si legge dove serve) e i byte letti
  contati. Per formato:

  | Formato | Che cosa si legge | Limite |
  |---|---|---|
  | `.pcraft`, `.figcraft` | la coda (al più 65 557 byte), la directory centrale e le sole voci che servono: l'anteprima e il JSON della versione (`manifest.json` o `document.json`) | nessun peso massimo del file; directory centrale 4 MiB, 10 000 voci, anteprima 8 MiB, JSON della versione 1 MiB |
  | `.vectorcraft` | il file intero con `read_all`, poi il JSON fino al separatore dei blob | `craft.preview-max-mib` (di partenza 64 MiB) |
  | XMP | il file intero con `read_all`, anche per `craft.photo` | 8 MiB (`MAX_XMP_BYTES`) |
  | `.docx`, `.odt` | la coda, la directory centrale, le relazioni del pacchetto e la miniatura | nessun peso massimo del file; directory e voci come un `.pcraft`, relazioni 64 KiB, miniatura 8 MiB |

- Uno ZIP letto a pezzi (`container::embedded_preview_from`) ha
  `revision: null` e non entra in cache: senza tutti i byte non se ne sa
  l'impronta. La coda si guarda prima di darla a `zip`: ogni fine della
  directory centrale che `zip` potrebbe scegliere, anche una finta dentro un
  commento, e la sua fine ZIP64, al più 32 (`MAX_EOCD_CANDIDATES`, oltre è
  `TooLarge`); una directory oltre 4 MiB o 10 000 voci è
  `TooLarge`, una che esce dal file `NotZip`. Ogni voce si misura prima di
  leggerla, e i byte che `zip` legge hanno un tetto riarmato prima di
  aprire l'archivio e prima di ogni voce. Uno ZIP rotto è `unreadable`.
- Un file letto intero (un `.vectorcraft`, un XMP) oltre il suo limite è
  `over_limit` con `limit_bytes`, senza leggere un byte; sotto, la revisione
  si calcola sugli stessi pezzi con `RevisionHasher` (è quella di
  `document_revision`) e l'anteprima entra in cache. Di un `.vectorcraft`
  si scompatta al più il limite più il separatore: un JSON più lungo prima
  dei blob è `over_limit`.
- Come Fub si accorge di un file cambiato: il kernel ricontrolla peso,
  data, identità del file e timbro di cambiamento prima e dopo ogni pezzo.
  Un file riscritto, sostituito da uno dello stesso peso e della stessa data
  o cancellato fra due pezzi è `Stale`, mai byte di due versioni; il comando
  riprova con una lease nuova, al più tre volte, poi è un `conflict` con la
  chiave `changing`. Chiuso il vault, ogni lettore si spegne e il pezzo dopo
  è un errore.
- La revisione senza i byte (`ranged::revision`) si legge a pezzi fino a
  `craft.preview-max-mib` (di partenza 64 MiB). Dentro `craft.preview`, che
  tiene il turno del vault, si legge soltanto per un file sotto la soglia di
  `MAX_FILE_BYTES` (64 MiB); oltre vale solo quella già ricordata, e senza
  quella l'offerta c'è con `revision: null`: la calcola il job
  `craft.render` sulla sua copia, fuori dal turno, e la ricorda. Si ricorda
  per `(radice, documento)`, al più 4096 voci (piena, la
  memoria si svuota), finché una lease nuova ha la stessa identità, lo stesso
  peso e data e lo stesso timbro di cambiamento: riscrivere un file con lo
  stesso peso e rimettergli la data cambia il timbro, e la revisione si
  rifà.
- Che cosa si legge ancora intero, e dall'host: quando la lease non si apre
  (un supporto senza identità o timbro di cambiamento) il comando torna a
  `document_revision`, al peso dell'anagrafe e a `read_document_bytes` fino a
  64 MiB, con la revisione riletta dopo i byte. Il JSON di un `.vectorcraft`
  e la voce di uno ZIP si leggono allora dai byte interi del file, e uno ZIP
  dall'host resta entro 64 MiB.

## Contenitori

`container::read_meta` legge la versione, il titolo, il testo per la ricerca
e i file collegati, senza costruire il documento JSON; `container::embedded_preview` l'anteprima che il file
porta, per la misura `small` o `large`.

| Formato | Contenitore | Metadati | Anteprima |
|---|---|---|---|
| `.pcraft` | ZIP (STORE o Deflate) | `manifest.json`: versione da `format_version`, titolo da `title` o `name`; nessun testo | `thumb.png` per `small`, `composite/preview.png` per `large`, ciascuna con l'altra come riserva |
| `.figcraft` | ZIP | `document.json`: versione da `format_version` o `version`, titolo da `title` o `name`, testo | `thumbnail.png` per le due misure |
| `.vectorcraft` | JSON, gzip se comincia con `1f 8b`; dalla versione 4 i blob dopo `\n\0VCBLOBS\0` | come FigCraft | `/preview/data` in base64, con o senza il prefisso `data:…;base64,` |

- La versione, numero o stringa, diventa una stringa; titolo e versione si
  leggono solo da un oggetto in cima, e una stringa vuota non conta.
- Il testo viene da ogni campo stringa `text`, `content` o `characters`, a
  ogni profondità, uno per riga, tagliato a 64 KiB su un confine di
  carattere.
- Un JSON di VectorCraft finisce al primo separatore dei blob; un separatore
  all'inizio lascia un JSON vuoto, che non si legge.
- Le voci si cercano col nome esatto: `../manifest.json` o
  `x/../thumb.png` non sono le voci del formato, e una cartella neanche.
- Uno ZIP senza il suo JSON dà contenuti vuoti, non un errore. Un'anteprima
  che manca, vuota, che non si decodifica o che non è un PNG (un JPEG, un
  `IHDR` corto) è assente; se la voce che manca o non va ha una riserva, si
  usa quella.
- Un `.pcraft` che è una cartella non arriva come byte e non si legge.

Gli errori sono `ContainerError`, senza testi: `TooLarge` (un limite),
`NotZip` (uno ZIP rotto, troncato, o una voce che non si scompatta come
dichiara), `NotJson`, `BadGzip` (gzip rotto o troncato) e `Missing`. Il
provider li trasforma nel modello vuoto.

I limiti dei contenitori si guardano prima di leggere:

- un file oltre 64 MiB non si apre, tranne uno ZIP letto a pezzi da
  `embedded_preview_from`, che ha i limiti di «Letture a pezzi»;
- uno ZIP che dichiara, o ha, più di 10 000 voci non si legge: il conto
  dichiarato dalla fine della directory centrale (anche ZIP64) si guarda
  prima di aprirlo;
- una voce si misura con la misura dichiarata prima di leggerla, e la
  lettura ha comunque il tetto: 64 MiB per un JSON, 8 MiB per un'anteprima;
  una voce dichiarata piccola che si scompatta grande si ferma alla misura
  dichiarata, e il CRC che non torna la rende illeggibile;
- uno gzip si scompatta al massimo fino a 64 MiB e un byte: oltre è
  `TooLarge`;
- una stringa `/preview/data` più lunga di quanto 8 MiB diventano in base64
  si rifiuta senza decodificarla, e così un'anteprima decodificata oltre
  8 MiB;
- `read_meta` legge al più i primi 16 MiB del JSON (`MAX_META_JSON_BYTES`)
  e ne tiene soltanto i campi che indicizza, saltando il resto senza
  costruirlo: un JSON più lungo che fin lì è valido dà ciò che si è trovato
  prima del taglio. Di un `.vectorcraft` in gzip si scompatta solo fino al
  separatore dei blob;
- `serde_json` rifiuta un JSON annidato oltre 128 livelli, e il testo si
  raccoglie con una pila, non con la ricorsione.

## I RAW

`raw::embedded_jpegs` (`crates/fub-format-craft/src/raw.rs`) trova i JPEG
che la fotocamera mette dentro una foto RAW, leggendo da un `Read + Seek`
solo le strutture del file; `raw::read_jpeg` legge poi il JPEG scelto. Il
file non si legge mai intero, e i dati del sensore restano dove sono.

| Forma | Firma | Dove sono i JPEG | Orientamento |
|---|---|---|---|
| TIFF (CR2, NEF, ARW, DNG) | `II*\0` o `MM\0*` | IFD0, la catena degli IFD seguenti e i SubIFD (tag `0x014A`): `JPEGInterchangeFormat` (`0x0201`/`0x0202`), o un'unica striscia (`0x0111`/`0x0117`) con compressione 6 o 7 | tag `0x0112` di IFD0 |
| ORF | `IIRO` o `MMOR` | come un TIFF | come un TIFF |
| RW2 | `IIU\0` | come un TIFF, più il tag `0x002E` | come un TIFF |
| CR3 | `ftyp` con la marca `crx ` | `THMB` nella `uuid` di Canon dentro `moov`, `PRVW` nella `uuid` `eaf42b5e-…` in cima | `0x0112` dell'IFD0 in `CMT1` |
| RAF | `FUJIFILMCCD-RAW ` | offset e lunghezza big endian ai byte 84 e 88 | l'EXIF (`APP1`) del JPEG |

- Un candidato vale se comincia con `FF D8`, sta dentro il file (e, nel
  CR3, dentro la sua scatola), è lungo fra 1 byte e 8 MiB e un `SOF` con
  lati non nulli si trova scorrendo i segmenti. Un `SOF` senza perdita
  (`C3`, `C7`, `CB`, `CF`) sono i dati del sensore e non vale; un JPEG
  progressivo sì. Un candidato che non vale si salta, e due uguali sono uno.
- `large` prende il più grande per area, poi per byte; `small` il più
  piccolo largo almeno 256 pixel, e se nessuno lo è il più grande.
- Le anteprime di un ORF stanno nella MakerNote, che non si legge: un ORF
  non ne ha. Un orientamento fuori da 1–8, o che manca, vale 1.
- Gli errori sono `RawError`, senza testi: `NotRaw` (nessuna firma nota,
  anche un file vuoto o un MP4), `Malformed` (un IFD visitato due volte, un
  IFD o una scatola fuori dal file, una scatola di misura 0 o più grande di
  chi la contiene), `TooLarge` (un limite) e `Io`, l'errore del lettore, che
  torna intero a chi chiama.

I limiti si guardano prima di leggere, e ciascuno ha la sua costante:

- al più 16 IFD visitati, compresi i SubIFD (`MAX_IFDS`), e una voce che
  dichiara più di 16 SubIFD è `TooLarge`;
- al più 1000 voci per IFD (`MAX_IFD_ENTRIES`), contate prima di leggerle;
- al più 8 livelli di scatole (`MAX_BOX_DEPTH`) e 10 000 scatole
  (`MAX_BOXES`) in un CR3;
- al più 64 candidati diversi (`MAX_CANDIDATES`), ciascuno guardato una
  volta sola: oltre è `TooLarge`;
- tutto il cammino legge al più 2 MiB (`MAX_STRUCTURE_BYTES`), contati IFD,
  scatole e intestazioni dei JPEG fino al loro `SOF`; oltre è `TooLarge`, e
  i byte del JPEG scelto non contano;
- un JPEG oltre 8 MiB (`MAX_JPEG_BYTES`) non si prende, e `read_jpeg` non lo
  legge.

## PDF e documenti

`office::embedded_thumbnail` (`crates/fub-format-craft/src/office.rs`) dà
la miniatura che un `.docx` o un `.odt` porta dentro di sé, leggendo da un
`Read + Seek` come uno ZIP di un file Craft: la coda e la directory
centrale con gli stessi tetti, poi al più tre voci.

| Pacchetto | Dove sta la miniatura |
|---|---|
| OOXML | `_rels/.rels` (al più 64 KiB scompattate), la prima `Relationship` di tipo `http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail`, poi la voce del suo `Target` |
| ODF | `Thumbnails/thumbnail.png` |

- Il tipo di pacchetto lo dicono le voci che ci sono, non l'estensione né il
  `mimetype`: un `.odt` con un `mimetype` sbagliato si legge lo stesso.
  Prima OOXML, poi ODF.
- Il `Target` è solo il nome di una voce dello ZIP: si toglie una `/` in
  testa (`/docProps/thumbnail.jpeg`), e un nome vuoto, con una `\` o con un
  segmento vuoto, `.` o `..` (`../../x`) si rifiuta. Una relazione con
  `TargetMode="External"` non vale. Conta solo la prima relazione del tipo.
- La miniatura vale se è un PNG o un JPEG (orientamento 1), di al più
  8 MiB, con le misure prese dall'intestazione. Un EMF o un WMF si scarta:
  la WebView non li mostra.
- Una miniatura che manca, dichiarata e assente, vuota, di un altro formato,
  oltre 8 MiB, che non si legge o con un bersaglio rifiutato dà `Ok(None)`,
  cioè `missing: "absent"`. Gli errori sono `OfficeError`, senza testi:
  `NotZip` (un documento cifrato, che è un contenitore CFB, un `.doc` o un
  `.rtf` rinominati), `TooLarge` (la directory o le relazioni oltre il loro
  tetto, anche 10 000 relazioni) e `BadRelationships` (un XML rotto); tutti
  danno `missing: "unreadable"`.
- `craft.preview` legge così un `.docx` o un `.odt` solo con la lease, a
  pezzi, e con `revision: null`: niente cache. Un errore del lettore torna a
  chi chiama, e un file cambiato fra due pezzi si rilegge. `info.app` è
  `document` con `info.editor` `WordCraft`, e un `.pdf` è `pdf` con
  `PdfCraft`.
- Un PDF, un `.rtf` e un `.doc` non portano una miniatura che Fub sappia
  leggere: sono `missing: "absent"`, senza leggere un byte, e l'anteprima la
  fa l'app esterna.

## Limiti

| Che cosa | Limite |
|---|---|
| Un file da leggere (JSON, ZIP) | 64 MiB |
| Un'anteprima nel file | 8 MiB |
| Voci di uno ZIP | 10 000 |
| Testo per la ricerca | 64 KiB |
| File collegati per documento | 1000 |
| JSON letto per l'indice | 16 MiB |
| Un XMP | 8 MiB |
| Parole chiave di un XMP | 500 |
| Un JPEG dentro un RAW | 8 MiB |
| IFD visitati in un RAW TIFF | 16 |
| Voci di un IFD | 1000 |
| Livelli e scatole di un CR3 | 8 e 10 000 |
| JPEG candidati in un RAW | 64 |
| Strutture lette di un RAW | 2 MiB |
| Fini della directory centrale guardate | 32 |
| Relazioni di un `.docx` | 64 KiB |
| Miniatura di un documento | 8 MiB |

Le misure si controllano prima di leggere, ogni lettura ha un tetto, e
nessuna allocazione la decide un numero scritto nel file.
