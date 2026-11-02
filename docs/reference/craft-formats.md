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
L'host non monta ancora il crate: i provider e il contratto ci sono, il
comando e il job no.

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
  "version": 1,
  "doc": "Disegni/logo.vectorcraft",
  "revision": "sha256:…",
  "size": "small",
  "origin": "file",
  "queued": false,
  "image": { "media_type": "image/png", "data": "<base64>", "width": 256, "height": 180 },
  "info": {
    "app": "vectorcraft",
    "editor": "VectorCraft",
    "format_version": "4",
    "bytes": 182344,
    "photo": null,
    "edits": [],
    "xmp": null
  },
  "render": null
}
```

| Campo | Valori |
|---|---|
| `version` | sempre `1`; una forma di un'altra versione non si legge |
| `size` | `small` (la figura nella nota, l'anteprima al passaggio) o `large` (la scheda) |
| `origin` | `file` (era nel file), `cli` (l'ha fatta l'app), `none` (non c'è) |
| `queued` | `true` se la risposta ha messo in coda il job `craft.render` |
| `image` | `null` o il PNG in base64; `width` e `height` vengono dall'intestazione `IHDR` del PNG |
| `info.app` | `vectorcraft`, `photocraft`, `figcraft` o `xmp` |
| `info.editor` | il nome da mostrare dell'editor esterno |
| `info.format_version` | la versione scritta nel file, come stringa, o `null` |
| `info.bytes` | il peso del file |
| `info.photo` | per un XMP, la foto a cui appartiene, o `null` |
| `info.edits` | le copie `-Edit.psd` della foto che esistono |
| `info.xmp` | `null` o `{ "rating", "label", "flag", "keywords" }`, con `flag` `pick` o `reject` |
| `render` | `null`, o `{ "app": "VectorCraft" }` quando l'app che può fare l'anteprima che manca è installata |

I nomi del contratto sono costanti del crate: il comando `craft.preview`
(`PREVIEW_COMMAND`), il job `craft.render` (`RENDER_JOB`) e lo spazio dei
nomi `fub.craft` (`BUNDLE_NS`). La chiave della cache di un'anteprima è
`previews/{:016x}.json`, con l'FNV-1a a 64 bit di `"{revision}\0{size}"`
(`cache_key`).

`readCraftPreview` in `apps/client/src/host/craft.ts` controlla ogni campo:
un campo mancante o di un altro tipo dà `null`, un campo in più si ignora.
`UPDATE_MIRROR=1 cargo test -p fub-format-craft --test ts_preview` riscrive
la fixture che tiene uguali i due lati.

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
