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
| `render` | `null`, o `{ "app": "VectorCraft", "consent": "ask" }` quando l'anteprima manca, l'app che sa farla è installata e il file non supera il peso massimo; `consent` (`ask`, `on`, `off`) è il valore di `craft.cli-previews` |

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
in sola lettura. L'host non registra ancora il comando; la forma è questa:

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
- Un RAW, un PDF o un documento non si legge: la risposta è `origin: none`
  con `missing: "absent"`.
- Altrimenti si leggono i byte: l'anteprima nel file dà `origin: file`, e
  senza `origin: none` con `missing: "absent"`, o `"unreadable"` se il file
  non si legge. Per un XMP `info.xmp` viene da `xmp::read`, la foto
  dai figli diretti della sua cartella (il nome esatto, o per il solo gambo
  il primo in ordine di id con un'altra estensione, confrontando i nomi come
  sono scritti) e `info.edits` dalla copia `-Edit.psd` della foto, se c'è.
- Un file oltre 64 MiB, col peso che dice l'anagrafe, non si legge: è
  `origin: none` con `missing: "over_limit"` e `limit_bytes`.
- Si scrive in cache solo un'anteprima con `origin` `file` o `cli`, e solo se
  la revisione è la stessa prima e dopo la lettura. La scrive chi ha il
  permesso di scrivere i dati del bundle: il comando, che è in sola lettura,
  la legge ma non la scrive, perché il kernel nega le scritture a un comando
  di sola lettura; una scrittura che non riesce non toglie l'anteprima.
- La cache è ricostruibile: cancellarla non perde niente, l'anteprima si
  rilegge dal file. Una revisione nuova è una chiave nuova, e le voci vecchie
  restano finché la cache del bundle non si pulisce.
- Il job `craft.render` risponde che nessuna app installata può fare
  l'anteprima (`unserved`).

## Contenitori

`container::read_meta` legge la versione, il titolo, il testo per la ricerca
e il documento JSON; `container::embedded_preview` l'anteprima che il file
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

- un file oltre 64 MiB non si apre;
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
- `serde_json` rifiuta un JSON annidato oltre 128 livelli, e il testo si
  raccoglie con una pila, non con la ricorsione.

## Limiti

| Che cosa | Limite |
|---|---|
| Un file da leggere (JSON, ZIP) | 64 MiB |
| Un'anteprima nel file | 8 MiB |
| Voci di uno ZIP | 10 000 |
| Testo per la ricerca | 64 KiB |
| File collegati per documento | 1000 |
| Un XMP | 8 MiB |
| Parole chiave di un XMP | 500 |

Le misure si controllano prima di leggere, ogni lettura ha un tetto, e
nessuna allocazione la decide un numero scritto nel file.
