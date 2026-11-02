# Piano: N7 · I file Craft nel vault

Branch: piano/n7-file-craft
Obiettivo: i file delle app Craft (`.vectorcraft`, `.pcraft`, `.figcraft`) e
gli XMP che LightCraft scrive accanto alle foto hanno la loro specie
nell'albero, si aprono in una scheda che mostra l'anteprima e i dati, si
cercano, si incorporano nelle note e diventano link e backlink; le parole
chiave degli XMP diventano tag, voto, etichetta e scelta diventano proprietà.
«Apri con un'altra app» diventa un sottomenu con le app Craft installate, e un
documento aperto in un'app Craft resta in Fub in sola lettura finché non lo
riprendi. Fub non scrive mai un file Craft né un XMP.
Perché: oggi un file Craft nel vault è un allegato muto: niente anteprima,
niente ricerca, niente backlink, e «Apri con un'altra app» conosce solo l'app
predefinita del sistema (`crates/fub-app/src/reveal.rs`). Il passo 12c chiede
che i file Craft siano cittadini del vault anche senza le modalità di Fub che
li apriranno dentro (K5–K9).
Fuori scope: le modalità che aprono e modificano i file Craft dentro Fub
(K5–K9: qui la scheda è una vista in sola lettura che quelle modalità
prenderanno); ogni scrittura in un file Craft o in un XMP; le impostazioni di
sviluppo (`crs:`, `lc:settings`); le anteprime con la CLI di LightCraft (RAW),
PdfCraft, WordCraft e GridCraft, e le anteprime DOCX e XLSX coi motori di Fub;
il `.pcraft` a cartella; `library.import` di LightCraft; le miniature
nell'albero; i canali di controllo senza autenticazione; sapere se un'app è
aperta quando non l'ha avviata Fub; le prove su Windows e macOS (il codice
c'è, le prove girano su Linux); la CI (i coder non la toccano: CLAUDE.md); il
vault vero.
Assunzioni: A1–A12 qui sotto, decise dal pianificatore il 2026-11-02 di notte
(l'utente non poteva rispondere). Le domande D-1…D-9 non bloccano: il piano
segue la prima opzione di ognuna. T7–T17 seguono D-1 e D-2 (avviare programmi
esterni, parlare con una porta locale: sicurezza e permessi, «Chiede sempre»),
che sono costose da disfare: per questo stanno dall'ondata 4 in poi, e T1–T6
non ne dipendono.
Ondate: T1 | T2 T3 T4 | T5 T6 | T7 T8 T9 | T10 T11 | T12 T13 | T14 | T15 T16 | T17
Prototipo: nessuno stanotte. Le parti visibili (sezione «Che cosa vede chi usa
Fub») riusano pezzi che esistono; le scelte d'aspetto dell'utente sono D-5,
D-6 e D-7; i task grafici sono le ultime ondate (T14–T17).

## Modifiche

nessuna

## Dal prototipo

Nessun prototipo stanotte. Ogni parte visibile riusa un pezzo che c'è già;
la tabella dice dove finisce e chi la fa.

| Pezzo | Destinazione | Task |
|---|---|---|
| L'icona e la sigla nell'albero (VECTORCRAFT, PHOTOCRAFT, FIGCRAFT, XMP) | `apps/client/src/ui/format-kind.ts`, `apps/client/src/ui/icons.ts` | T14 |
| La scheda di un file Craft: anteprima con lo zoom delle immagini, riga dei dati, «Crea l'anteprima» | `apps/client/src/editors/craft/surface.ts` (nuovo), con `mountImageView` di `editors/media/image-view.ts` | T14 |
| La scheda di un XMP: voto, etichetta, scelta, parole chiave, la foto, la copia `-Edit.psd`, la nota su LightCraft | `apps/client/src/editors/craft/xmp-view.ts` (nuovo) | T14 |
| L'aspetto delle due schede | `apps/client/src/theme/scrittoio/skin/media.css`, hook in `theme/scrittoio/anatomia/media.ts` | T14 |
| La figura nella nota (`![[logo.vectorcraft]]`) | `apps/client/src/editors/craft/figure.ts` (nuovo), agganciata in `editors/text/profiles/markdown/mount.ts` | T15 |
| L'anteprima al passaggio su un link a un file Craft | `apps/client/src/state/preview.ts` | T15 |
| Il sottomenu «Apri con un'altra app» | `apps/client/src/panels/open-with.ts` (nuovo), `panels/explorer.ts`, `editors/media/media-surface.ts` | T16 |
| La riga «Aperto in GridCraft · Riprendi qui» | `apps/client/src/panels/document.ts` (`noticeLinesOf`) | T17 |
| Le impostazioni «App esterne» | `crates/fub-host/src/settings.rs` | T7 |
| I testi della shell | `apps/client/src/i18n/catalog.ts` | T14, T16, T17 |

## Che cosa vede chi usa Fub

Nessun pezzo nuovo del kit: tutto è fatto con ciò che la shell ha già.

- **Nell'albero.** Un `.vectorcraft` e un `.figcraft` hanno l'icona dei
  disegni e la sigla VECTORCRAFT o FIGCRAFT, come un `.svg` ha la sua; un
  `.pcraft` e un `.xmp` hanno un'icona nuova, una fotografia, con la sigla
  PHOTOCRAFT o XMP. Niente miniature nell'albero (D-7).
- **La scheda.** Un clic su un file Craft apre una scheda in sola lettura.
  In alto l'anteprima, con lo zoom e la barra delle immagini (la stessa vista
  di una foto). Sotto, una riga di dati: l'app («Disegno di VectorCraft»), la
  versione del formato se il file la dice, il peso. Se il file non ha
  un'anteprima dentro (VectorCraft di solito non la salva), al suo posto c'è
  un riquadro col nome del file e, se l'app è installata, il pulsante «Crea
  l'anteprima con VectorCraft»; aprendo la scheda Fub la chiede da solo una
  volta (D-1). Mentre l'app lavora il riquadro dice «Preparo l'anteprima…».
  Un file troppo grande (oltre 64 MiB) dice «File troppo grande per
  l'anteprima» e «Apri con» resta (D-8).
- **La scheda di un XMP.** Il voto in stelle, l'etichetta col suo colore, la
  scelta («Scelta», «Scartata»), le parole chiave come i tag della nota (un
  clic cerca il tag), il nome della foto a cui l'XMP appartiene (un clic la
  apre) e, se c'è, la copia `-Edit.psd` fatta con PhotoCraft. In fondo una
  riga fissa: «LightCraft scrive questi dati quando salvi con ⌘S, o sempre se
  accendi la scrittura automatica degli XMP nelle sue preferenze» (D-5).
- **Nelle note.** `![[logo.vectorcraft]]` mostra l'anteprima come
  un'immagine incorporata, con la didascalia del nome; senza anteprima, un
  riquadro col nome e l'app. Passando col puntatore su un link a un file
  Craft, la finestrella dell'anteprima mostra la stessa figura. Le note non
  avviano mai l'app: mostrano solo ciò che c'è nel file o già pronto.
- **Cercare e collegare.** I file Craft compaiono nella ricerca col loro
  titolo e il loro testo; una foto piazzata in un disegno di VectorCraft ha,
  nei suoi backlink, il disegno; le parole chiave di LightCraft sono tag, nel
  pannello dei tag e nella ricerca `tag:`.
- **«Apri con un'altra app».** Nel menu del tasto destro di un file (e nella
  barra di una foto o di un PDF), se c'è almeno un'app Craft installata, la
  voce diventa un sottomenu: per prima «L'app predefinita del sistema», poi le
  app Craft che aprono quell'estensione. Quelle non installate restano
  visibili ma spente, con «Non installata»; quella che Fub ha già avviato dice
  «Già aperta». Senza app Craft installate la voce fa quello che fa oggi.
- **Il prestito.** Aprendo in un'app Craft un documento che Fub sa
  modificare (un `.xlsx` in GridCraft, un `.docx` in WordCraft), Fub salva
  prima ciò che è in coda; la scheda passa in sola lettura e mostra la riga
  «Aperto in GridCraft» con l'azione «Riprendi qui». Quando l'app salva, la
  scheda si aggiorna da sola. «Riprendi qui» o la chiusura della scheda
  finiscono il prestito.
- **Le impostazioni.** Nel gruppo nuovo «App esterne»: «Dove sono le app
  Craft» (una lista di righe `vectorcraft=/percorso/del/programma`, per chi le
  ha messe in un posto suo) e «Anteprime con le app Craft» (acceso). Nei
  componenti, «File delle app Craft» nel gruppo dei disegni, acceso:
  spegnerlo toglie anteprime, schede e app Craft da «Apri con» (D-7).

## Fonti

- Il passo 12c (N7) dei «Piani di Fub», con l'indice, le regole
  (`01-regole-e-decisioni.md`), il contesto e i rischi. I coder non li
  leggono: qui c'è ciò che serve, e dove il codice dice altro vince il codice
  (sezione «Differenze dal passo 12c»).
- Ciò che il passo dice delle app Craft (formati, CLI, canali, istanza
  singola) è preso come scritto: il codice delle app non è nel repo. La
  sezione «Con file finti, con un'app vera» separa ciò che i test provano da
  ciò che solo un'app installata può dire.
- Il codice letto: `crates/fub-abi` (`FormatProvider`, `DocumentSource`,
  `IndexQuery`, `HostApi`), `crates/fub-format-svg` (il modello del crate e
  dei link), `crates/fub-format-xlsx` (sola lettura, conformità, specchio
  TypeScript), `crates/fub-kernel/src/workspace.rs` (la rinomina),
  `crates/fub-host` (`mount.rs`, `link_card.rs`, `settings.rs`,
  `control.rs`, `session.rs`), `crates/fub-features/src/componenti.rs`,
  `crates/fub-app/src/reveal.rs` e `lib.rs`, `crates/fub-cli/src/mcp/`,
  `apps/client/src/` (`editors/core/bootstrap.ts`, `editors/media/`,
  `editors/text/profiles/markdown/`, `state/link-cards.ts`,
  `state/preview.ts`, `panels/explorer.ts`, `panels/document.ts`,
  `ui/format-kind.ts`), i presidi in `.github/scripts/`.
- Scritto su `origin/main` @ `620f0acd`.

## Chi aspetta chi

| Task | Parte dopo | Aspetta una risposta |
|---|---|---|
| T1 · il crate e il contratto | subito | nessuna |
| T2 · i contenitori | T1 | nessuna |
| T3 · gli XMP | T1 | D-5 (nomi delle proprietà, una riga) |
| T4 · i file collegati | T1 | nessuna |
| T5 · la rinomina coi file a byte | T4 (pagina) | D-3 |
| T6 · il bundle `fub.craft` | T1, T2, T3, T4 | D-7, D-8 |
| T7 · il registro degli editor | T6 | D-1 |
| T8 · l'avvio dei programmi | T6 | D-1 |
| T9 · il canale di controllo | T6 | D-2 |
| T10 · «Apri con» nell'host | T7, T8, T9 | D-1, D-2 |
| T11 · le anteprime con la CLI | T6, T7, T8 | D-1 |
| T12 · l'IPC | T10 | D-1 |
| T13 · gli strumenti MCP | T6, T10 | D-4 |
| T14 · la scheda Craft e XMP | T1, T6 | D-5, D-7 |
| T15 · le figure e l'anteprima al passaggio | T14 | nessuna |
| T16 · il sottomenu «Apri con» | T12, T14 | D-6 |
| T17 · il prestito | T16 | D-6 |

T5 non usa niente di T1–T4: aspetta T4 solo perché scrive nella stessa
pagina nuova (`docs/product/craft-files.md`), che T1 crea.

## Domande per l'utente (raccolte, non bloccano)

Il piano procede con la prima opzione di ognuna.

- D-1 · Chi può avviare programmi esterni, e quando (T7, T8, T10, T11).
  (a) Consigliata: solo il core di Fub (`fub-host`), mai un bundle o un
  plugin, e nessun permesso nuovo nell'ABI. «Apri con» parte solo da un clic
  o da uno strumento MCP con `apply`; la CLI di un'app parte all'apertura
  della scheda o dal pulsante «Crea l'anteprima», mai da sola in sottofondo
  né dalle note. Un interruttore di macchina, «Anteprime con le app Craft»,
  acceso. (b) Come (a), ma l'interruttore spento finché non lo accendi. (c)
  Un permesso nuovo dell'ABI, «avviare programmi», che un plugin può
  chiedere. Conseguenza: con (c) cambiano l'ABI, i permessi e la loro pagina,
  e un plugin di terzi può avviare programmi; tornare indietro dopo T12 vuol
  dire rifare T8, T10, T11.
- D-2 · Parlare con un'app aperta attraverso una porta locale (T9, T10).
  (a) Consigliata: mai attraverso un canale senza autenticazione
  (VectorCraft, FigCraft, LightCraft: qualsiasi programma della macchina
  potrebbe usarlo); un canale con token solo con le app che Fub ha avviato lui,
  scegliendo token e porta. Nessuna app, per quanto dice il passo, permette
  oggi di scegliere tutti e due (GridCraft prende il token da
  `GRIDCRAFT_CONTROL_TOKEN`, la porta non si sa): quindi «Apri con» usa
  l'istanza singola (PhotoCraft e PdfCraft su Linux e Windows) o un processo
  nuovo, e il canale resta pronto e provato con un'app finta. (b) Rinviare
  T9 finché un'app non documenta la porta. (c) Usare anche i canali senza
  autenticazione, dietro un'impostazione. Conseguenza: (c) apre una porta che
  chiunque sulla macchina può pilotare; (b) toglie un task e il canale.
- D-3 · Rinominare un file a cui punta un file Craft (T5). (a) Consigliata:
  la rinomina si fa, le note si aggiornano come oggi, e Fub dice «il disegno
  X punta ancora al vecchio nome» (Fub non riscrive i file Craft). (b) La
  rinomina si ferma finché il link c'è (com'è oggi per ogni file a byte con
  link). Conseguenza: con (b) una foto piazzata in un disegno non si può più
  rinominare da Fub.
- D-4 · Gli strumenti MCP (T13). (a) Consigliata: `fub_open_with` vuole
  `apply: true` e il documento fra le radici di scrittura dell'agente (avvia
  un programma: è un'azione, non una lettura); senza `apply` dice che cosa
  farebbe. `fub_preview` dà l'anteprima che c'è (nel file o pronta) e non
  avvia mai la CLI. (b) `fub_open_with` anche con le sole radici di lettura.
  (c) `fub_preview` che avvia la CLI. Conseguenza: con (b) o (c) un agente
  può avviare programmi su un file che può solo leggere.
- D-5 · Gli XMP di LightCraft (T3, T14). (a) Consigliata: proprietà `rating`,
  `label`, `flag` e `tags`; una parola chiave con spazi diventa un tag col
  trattino («New York» → `#New-York`); i `.xmp` restano visibili nell'albero
  come file loro; nella scheda XMP la riga fissa su ⌘S e sulla scrittura
  automatica. (b) Gli spazi spezzano la parola in due tag. (c) Gli `.xmp`
  nascosti dall'albero, i dati mostrati solo sulla foto. Conseguenza: (c)
  vuole una scheda della foto che legge l'XMP accanto, cioè lavoro in più
  nella vista delle immagini.
- D-6 · Il menu e il prestito (T16, T17). (a) Consigliata: il sottomenu
  prende il posto della voce «Apri con un'altra app», con le app non
  installate visibili ma spente, e compare solo se c'è almeno un'app Craft
  installata; la voce della barra dei media («Apri con l'applicazione esterna») si
  allinea al nome «Apri con un'altra app»; il prestito vale per le app Craft e
  finisce con «Riprendi qui» o chiudendo la scheda. (b) Le app non installate
  nascoste. (c) Due voci: «Apri con un'altra app» com'è oggi e «Apri con…»
  per le app Craft. Conseguenza: (c) aggiunge una voce al menu delle note, che
  ne ha già nove, il massimo che la shell si dà.
- D-7 · Dove si vede e come si spegne (T6, T14). (a) Consigliata: niente
  miniature nell'albero; il componente «File delle app Craft» nel gruppo dei
  disegni, acceso; spegnerlo toglie anteprime, schede e le app Craft da «Apri
  con», mentre la ricerca e i backlink dei file Craft restano (sono del
  formato, non del componente). (b) Miniature nell'albero. (c) Spegnere il
  componente toglie anche i formati. Conseguenza: (b) vuole un'anteprima per
  ogni riga dell'albero, cioè molte letture di file quando si apre una
  cartella; (c) vuole una cargo feature per i formati e una per il resto.
- D-8 · File molto grandi (T2, T6). (a) Consigliata: oltre 64 MiB niente
  anteprima né metadati (il file c'è, si cerca per nome, «Apri con» va).
  (b) Il limite più alto. Conseguenza: il kernel legge i file a byte in
  memoria; un limite più alto vuol dire più memoria a ogni indicizzazione.
- D-9 · Che cosa resta fuori da N7. (a) Consigliata: LightCraft entra con
  gli XMP e «Apri con» (senza `library.import`); la copia `-Edit.psd` si vede
  nella scheda dell'XMP; restano fuori le anteprime dei RAW, la CLI di PdfCraft
  e WordCraft, il `.pcraft` a cartella e le anteprime DOCX e XLSX. (b)
  Dentro anche le anteprime dei PDF con PdfCraft. Conseguenza: (b) aggiunge
  una CLI e un formato già di Fub (i PDF hanno la loro vista) a T11.

## Assunzioni

- A1 · Valgono le prime opzioni di D-1…D-9.
- A2 · Formati presi dal passo: `.vectorcraft` è JSON, a volte gzip (inizia
  con `1f 8b`), e dalla versione 4 i blob stanno dopo `\n\0VCBLOBS\0`;
  l'anteprima è `/preview/data` in base64 (con o senza il prefisso
  `data:image/png;base64,`). `.pcraft` è uno ZIP (STORE o Deflate) con
  `manifest.json` (`format_version`), `thumb.png` e `composite/preview.png`.
  `.figcraft` è uno ZIP con `document.json` e `thumbnail.png`.
- A3 · I nomi dei campi che il passo non dice (il titolo, il testo, i file
  collegati) si leggono da più nomi possibili e la loro assenza non è un
  errore: `title` o `name` per il titolo; i testi da ogni campo `text`,
  `content` o `characters` di tipo stringa; i file collegati da ogni campo
  stringa `href`, `src`, `path`, `file`, `uri` o `link` che non è assoluto.
  Sono da confermare con file veri (sezione «Con file finti, con un'app
  vera»).
- A4 · Nessuna dipendenza esterna nuova: `zip` 9.0.5 (con `deflate`), `flate2`
  1.1.9, `quick-xml` 0.41.0, `base64` 0.22.1, `serde_json` e `tempfile` sono
  già nel workspace (prova 1).
- A5 · Fub non scrive mai un file Craft né un XMP: `serialize` risponde
  `FormatError::Unsupported`, `rewrite_links` resta quello di serie
  (`Ok(None)`), e la CLI lavora su una copia dei byte.
- A6 · I `FormatProvider` nuovi reclamano solo `vectorcraft`, `pcraft`,
  `figcraft` e `xmp`; le altre estensioni che le app aprono (`psd`, `pdf`,
  `xlsx`, `docx`…) restano di chi le ha, e servono solo a «Apri con».
- A7 · La scheda di N7 è una vista in sola lettura del bundle `fub.craft`;
  quando K5–K9 porteranno le modalità che modificano i file Craft, quelle
  prenderanno l'estensione e la vista resterà per i file senza modalità.
- A8 · I programmi esterni si avviano con argomenti separati, mai attraverso
  una shell, mai con argomenti costruiti come una stringa; solo dal core
  (`fub-host`); ogni avvio passa dall'interruttore del componente.
- A9 · Le anteprime pronte stanno nella cache del bundle (`host.cache_write`,
  sotto `.fub/`): cancellarla non perde niente, si rifà.
- A10 · «Già aperta» vuol dire «avviata da Fub in questa sessione e non
  ancora uscita». Un'app aperta da sola, o passata a un'istanza singola, Fub
  non la vede: il prestito non finisce quando l'app si chiude.
- A11 · Le impostazioni delle app Craft sono di macchina (i percorsi dei
  programmi non viaggiano col vault), nel core di `fub-host`, accanto alle
  altre di macchina.
- A12 · I test che avviano processi sono solo per unix (`#[cfg(unix)]`, script
  `/bin/sh` scritti dal test); i percorsi di Windows e macOS sono scritti ma
  non provati.

## Il contratto `CraftPreview`

Una forma sola, scritta in Rust in `crates/fub-format-craft/src/contract.rs`,
specchiata in TypeScript in `apps/client/src/host/craft.ts`, e letta dal
bundle (T6), dalla shell (T14–T15) e dall'MCP (T13).

```json
{
  "version": 1,
  "doc": "Disegni/logo.vectorcraft",
  "revision": "…",
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

- `size`: `"small"` (la figura nella nota, l'anteprima al passaggio) o
  `"large"` (la scheda).
- `origin`: `"file"` (l'anteprima era nel file), `"cli"` (l'ha fatta l'app),
  `"none"` (non c'è).
- `queued`: `true` se la risposta ha messo in coda il job `craft.render`.
- `image`: `null` o il PNG; `width` e `height` vengono dall'intestazione
  `IHDR` del PNG, non dal file Craft.
- `info.app`: `vectorcraft`, `photocraft`, `figcraft` o `xmp`; `info.editor`
  il nome da mostrare; `info.format_version` stringa o `null`; `info.bytes` il
  peso del file.
- `info.photo`: per un XMP, la foto a cui appartiene se c'è nel vault
  (`"Foto/IMG_0001.CR3"`), altrimenti `null`. `info.edits`: le copie
  `-Edit.psd` che esistono. `info.xmp`: `null` o
  `{ "rating", "label", "flag", "keywords" }` come li legge T3.
- `render`: `null`, o `{ "app": "VectorCraft" }` quando l'app che può fare
  l'anteprima è installata e l'anteprima manca: è ciò che fa comparire il
  pulsante «Crea l'anteprima con VectorCraft».
- La cache: `previews/{:016x}.json`, con la chiave FNV-1a a 64 bit di
  `"{revision}\0{size}"`, come `link_card::cache_path`; si scrive solo per
  `origin` `file` e `cli`. Una revisione nuova è una chiave nuova: la cache
  vecchia resta finché la cache del bundle non si pulisce.
- Il comando: `craft.preview` con `{ "doc", "size", "render" }`, in sola
  lettura, effetto `CommandEffect::Custom { ns: "fub.craft", payload }` col
  `CraftPreview`. `render: true` mette in coda il job `craft.render` quando
  l'anteprima manca, la CLI c'è e l'interruttore è acceso; la risposta arriva
  come `job_done` del job, col `CraftPreview` nuovo.

## I limiti

| Che cosa | Limite | Dove |
|---|---|---|
| Un file da leggere (JSON, ZIP) | 64 MiB | T2 |
| Un'anteprima nel file | 8 MiB | T2 |
| Voci di uno ZIP | 10 000 | T2 |
| Testo per la ricerca | 64 KiB | T2 |
| File collegati per documento | 1000 | T4 |
| Parole chiave di un XMP | 500 | T3 |
| Una CLI: tempo | 20 s | T8, T11 |
| Una CLI: PNG scritto | 16 MiB | T8, T11 |
| Una CLI: stdout e stderr tenuti | 64 KiB ciascuno | T8 |
| Il job che aspetta la CLI guarda l'annullamento | ogni ~100 ms | T8, T11 |

## Le app che Fub conosce

La tabella in Rust di T7 (`crates/fub-host/src/craft/editors.rs`), dal passo.
Il programma con l'interfaccia è `<id>`, quello senza `<id>-cli`.

| id | Nome | Apre | Anteprima con la CLI (T11) | Istanza singola | Canale |
|---|---|---|---|---|---|
| `vectorcraft` | VectorCraft | `vectorcraft`, `drawcraft`, `svg`, `ai`, `eps`, `pdf` | `convert {in} {out} --scale 0.25` | no | `app.open`, senza autenticazione: mai |
| `photocraft` | PhotoCraft | `pcraft`, `psd`, `psb`, `tif`, `tiff`, `png`, `jpg`, `jpeg`, `kra`, `xcf`, `ora` | `convert {in} {out}` | Linux, Windows | `app.open`, token |
| `lightcraft` | LightCraft | `cr3`, `cr2`, `nef`, `arw`, `raf`, `dng`, `orf`, `rw2`, `heic`, `jpg`, `jpeg` | fuori da N7 | no | senza autenticazione: mai |
| `pdfcraft` | PdfCraft | `pdf` | fuori da N7 | Linux, Windows | `ui.open` JSON-RPC 2.0, token |
| `figcraft` | FigCraft | `figcraft`, `fig` | `render {in} -o {out}` | no | senza autenticazione: mai |
| `gridcraft` | GridCraft | `xlsx`, `csv`, `tsv` | fuori da N7 | no | `app.open`, token da `GRIDCRAFT_CONTROL_TOKEN`, porta non nota |
| `wordcraft` | WordCraft | `docx`, `odt`, `rtf`, `doc` | fuori da N7 | no | `engine.execute`, «chiave»: formato non noto, mai |

`{in}` e `{out}` sono percorsi assoluti in una cartella privata (T11), passati
come argomenti separati.

## Prove fatte

1. **Le dipendenze del repo bastano** (prova usa e getta in
   `/home/fubeo/.cache/fub-k1/tmp/n7`, cancellata). Con `zip` 9.0.5 (feature
   `deflate`), `flate2` 1.1.9, `quick-xml` 0.41.0, `base64` 0.22.1 e
   `serde_json`, tutti già nel workspace: si legge uno ZIP con voci in STORE
   e in Deflate (`by_name`, `size()` prima di leggere, `take`); si scompatta un
   JSON gzip e lo si taglia a `\n\0VCBLOBS\0`; si decodifica il base64 di
   `/preview/data` e si leggono le misure dall'`IHDR`; si legge un XMP con
   voto ed etichetta come attributi e le parole chiave in `rdf:Bag/rdf:li`.
   In quick-xml 0.41 le entità arrivano come evento a parte
   (`Event::GeneralRef`), non dentro `Event::Text`: un `&amp;` in una parola
   chiave va ricomposto (T3).
2. **La rinomina oggi.** `invoke_prepared_link_rewrites`
   (`crates/fub-kernel/src/workspace.rs`, riga 1129) restituisce un errore
   `FormatError::Parse("il formato di … non offre la riscrittura dei link")`
   quando la sorgente da riscrivere non ha un provider o non sa riscrivere:
   un file a byte con un link verso il file rinominato ferma la rinomina
   (T5).
3. **I presidi che mordono** (letti, non lanciati): `check-doc-size.mjs`
   (riferimento 550 righe, il resto 450; `docs/reference/on-disk-layout.md` è
   a 549, `docs/product/vault-and-files.md`, `editor-and-preview.md` e
   `search-links-and-graph.md` a 449: non ci si aggiunge niente);
   `check-error-literals.mjs` è un cricchetto esatto (`fub-host` 377,
   `fub-kernel` 165, `fub-app` 88, `fub-features` 80): il codice nuovo non
   scrive `PluginError::X("…")` né `PluginError::X(format!(…))`;
   `check-cargo-feature-default.mjs` vuole ogni cargo feature raggiungibile
   dal `default`.

## Con file finti, con un'app vera

| Che cosa | Con file finti nei test | Serve un'app vera |
|---|---|---|
| Leggere i tre contenitori, l'anteprima, i limiti | sì, costruiti dal test con `zip`, `flate2`, `base64` (T2) | i nomi veri dei campi (A3) |
| Gli XMP | sì, scritti a mano come li descrive il passo (T3) | un XMP vero di LightCraft, coi suoi namespace |
| I file collegati e i backlink | sì (T4, T6) | il campo vero che VectorCraft usa per una foto piazzata |
| Rilevare le app | sì, con cartelle finte e un ambiente iniettato (T7) | `installed.json` vero del launcher, Flatpak, AppImage |
| Avviare un programma, la CLI, i limiti | sì, con script `/bin/sh` che fanno da app (T8, T10, T11) | gli argomenti veri delle CLI |
| Il canale di controllo | sì, con un `TcpListener` finto (T9) | il formato vero dell'autenticazione, la porta |
| L'istanza singola | no (lo fa l'app) | PhotoCraft o PdfCraft aperte |
| Il prestito senza perdite | sì, nella shell con l'host finto (T17) | GridCraft che salva un `.xlsx` aperto in Fub |
| Windows e macOS | no | una macchina con quel sistema |

## Differenze dal passo 12c

- `DocumentSource::bytes()` non è un `Option` e non esiste
  `FormatError::unsupported(..)`: l'errore è
  `FormatError::Unsupported { format, got: SourceKind::Text }`.
- Niente `editors.toml`: il registro è una tabella Rust (il workspace non ha
  un lettore TOML fra le dipendenze, e una tabella si controlla col
  compilatore).
- Lo schizzo degli XMP usa `Event::Text` per le entità: in quick-xml 0.41
  arrivano come `Event::GeneralRef` (prova 1).
- `xmp.rs` sta nel crate dei formati (`fub-format-craft`), non in
  `fub-features/src/photos/` (che non esiste): l'XMP è un formato.
- Oggi una sorgente a byte con un link verso il file rinominato ferma la
  rinomina (prova 2): T5 la fa procedere con un avviso.
- Non esiste un permesso per avviare programmi, e nessun bundle li avvia:
  `fub-host` non avvia processi, `fub-app` sì (`reveal.rs`, «Apri con
  un'altra app»). «Apri con» passa per l'IPC e per il canale MCP (`Call`),
  non per un comando `fub.open_with` di un bundle (D-1).
- La voce della barra dei media si chiama «Apri con l'applicazione esterna»
  (`media.open_external`), contro il nome «Apri con un'altra app» del menu:
  T16 le allinea.
- La mappa dei componenti vuole per un bundle nuovo una riga, una cargo
  feature e i test che le confrontano (T6).
- Le impostazioni di macchina stanno nel core di `fub-host`; le frasi di un
  bundle stanno nel suo catalogo, non nella shell.
- Il menu delle note ha già nove voci, il massimo: «Apri con» non può essere
  una voce in più (D-6).
- «Il prestito finisce quando l'app si chiude» non si può fare: un'app a
  istanza singola passa il file e il processo avviato esce subito, e un'app
  aperta da sola Fub non la vede (A10).
- Per PhotoCraft il passo dice che `app.open` vuole un percorso «relativo
  alla radice di lettura»: non è chiaro quale. Non serve: PhotoCraft ha
  l'istanza singola, e Fub usa quella.
- Il quarto punto del cancello («con l'app già aperta, il file va in quella
  finestra») vale solo per le app a istanza singola (PhotoCraft e PdfCraft su
  Linux e Windows); per le altre Fub apre un processo nuovo (D-2).
- I presidi su nomi, FNV, entità HTML, errori letterali e pagine piene
  impongono vincoli che il passo non vede: sono nelle regole qui sotto.

## Cancello di N7

| Fatto quando | Prova | Task |
|---|---|---|
| un file di ogni formato Craft ha anteprima, metadati e «Apri con»; Fub non lo scrive (byte uguali prima e dopo) | `crates/fub-host/tests/craft.rs`, `craft_open_with.rs`; la foto dal banco della scheda | T6, T10, T14 |
| un file collegato dentro un documento Craft mostra il backlink | `crates/fub-format-craft/tests/linked.rs`, il backlink in `crates/fub-host/tests/craft.rs` | T4, T6 |
| le parole chiave scritte da LightCraft sono tag e si cercano | `crates/fub-format-craft/tests/xmp.rs`, la domanda `IndexQuery::Tags` in `crates/fub-host/tests/craft.rs` | T3, T6 |
| con l'app già aperta, «Apri con» porta il file in quella finestra | `craft_open_with.rs` prova che l'istanza singola dà `forwarded`; il resto lo prova l'utente con PhotoCraft o PdfCraft | T10 e l'utente |
| aprire un `.xlsx` in GridCraft mentre è aperto in Fub non perde modifiche | `apps/client/src/state/lend.test.ts`; con GridCraft vera lo prova l'utente | T17 e l'utente |

## Regole che valgono per ogni task

- Vince il codice: se un percorso, una funzione o un numero di riga non è come
  scritto qui, il coder lo dice nel suo rapporto e segue il codice. I numeri
  di riga sono quelli di `620f0acd`.
- Nessuna dipendenza esterna nuova, né in Rust né in npm.
- Niente `unwrap`, `expect` o `panic!` nei sorgenti Rust fuori dai test; ogni
  errore è un `Result`. Gli errori dei moduli nuovi sono enum senza testi;
  il testo per chi guarda passa da una chiave del catalogo (`Text::key`,
  `Text::message`). Mai `PluginError::X("…")` né
  `PluginError::X(format!(…))`: `check-error-literals.mjs` è un cricchetto
  esatto.
- Ogni file è input ostile: misure controllate prima di leggere, letture con
  un tetto (`take`), nessuna allocazione decisa da un numero scritto nel
  file.
- Ogni funzione di produzione che piega il caso (`to_lowercase`,
  `eq_ignore_ascii_case`…) vuole una riga in `rules()` di
  `crates/fub-abi/tests/a_named_rule_is_declared.rs`, con la famiglia e la
  ragione. Il piano ne chiede una sola, in T7 (le estensioni di «Apri con»);
  altrove i nomi si confrontano così come sono.
- L'HTML si scrive con `fub_abi::html::{escape, attr}`, mai a mano.
- Testi della shell in `apps/client/src/i18n/catalog.ts`, con la chiave in
  tutte le lingue; testi del bundle nel catalogo del bundle; testi del core in
  `core_catalog` di `crates/fub-host/src/settings.rs` (italiano e inglese).
- Ascoltatori e timer della shell passano da una `Lifetime`
  (`ui/lifetime.ts`); il TypeScript non scrive `var(--ruolo)`
  (`check-inline-theme.mjs`).
- Le pagine di `docs/` sono in italiano, restano nei limiti di
  `check-doc-size.mjs` (riferimento 550 righe, il resto 450,
  `docs/README.md` 150) e non dicono «oggi», «al momento», «questo commit».
  Una pagina nuova è linkata da `docs/README.md`.
- Quando cambia `Cargo.toml` o `Cargo.lock` della radice (T1, T6),
  `scripts/check.sh --rapido` controlla tutto il workspace: è lento, è giusto.
- La macchina è condivisa: niente build in `/tmp`; `TMPDIR` sotto
  `~/.cache/fub-k1/tmp/`.
- Mai il vault vero (`~/.cache/fub-live/`), mai `~/Progetti/Fub`.

## T1 · Il crate e il contratto

Perché: gli id dei formati, la tabella delle app e la forma dell'anteprima li
leggono il kernel, l'host, la shell e l'MCP: vengono prima di chi li usa, e
con loro il crate in cui stanno.
Tocca: `crates/fub-format-craft/` (nuovo): `Cargo.toml`, `src/lib.rs`,
`src/apps.rs`, `src/contract.rs`, `src/provider.rs`, e gli scheletri
`src/container.rs`, `src/xmp.rs`, `src/linked.rs` (solo le firme, che T2, T3 e
T4 riempiono); `crates/fub-format-craft/tests/provider.rs` (nuovo),
`crates/fub-format-craft/tests/ts_preview.rs` (nuovo);
`apps/client/src/__fixtures__/craft-preview.json` (nuovo, generato);
`apps/client/src/host/craft.ts` (nuovo), `apps/client/src/host/craft.test.ts`
(nuovo); `Cargo.toml` della radice (il membro e la dipendenza del workspace),
`Cargo.lock`; `docs/architecture/overview.md` (il nodo del crate),
`docs/map/repo.md` (riga 51, l'elenco dei formati),
`docs/architecture/components-and-boundaries.md`,
`docs/getting-started/repository-tour.md`, `docs/README.md` (i link alle
quattro pagine nuove); `docs/reference/craft-formats.md` (nuovo),
`docs/reference/xmp-sidecars.md` (nuovo), `docs/reference/external-editors.md`
(nuovo), `docs/product/craft-files.md` (nuovo).
Non toccare: `crates/fub-host` (il provider non si monta ancora: lo monta T6);
`apps/client/src/ui/format-kind.ts` e il resto della shell (T14);
`crates/fub-abi` (nessun tipo nuovo nell'ABI: il contratto è del crate dei
formati); le pagine piene (`docs/product/vault-and-files.md`,
`editor-and-preview.md`, `search-links-and-graph.md`,
`docs/reference/on-disk-layout.md`).
Dipende da: nessuno
Cosa fare:
- `Cargo.toml` del crate come quello di `crates/fub-format-svg`
  (`version`, `edition`, `license`, `rust-version` dal workspace, una
  `description` in italiano). Dipendenze, tutte `{ workspace = true }`:
  `fub-abi`, `serde`, `serde_json`, `zip`, `flate2`, `quick-xml`, `base64`;
  fra le `dev-dependencies` `fub-sdk`. Nella radice: il membro
  `"crates/fub-format-craft"` dopo `"crates/fub-format-xlsx"` (riga 22) e
  `fub-format-craft = { path = "crates/fub-format-craft", version = "0.1.0" }`
  accanto a `fub-format-svg` (riga 164). `Cargo.lock` lo aggiorna cargo: non
  entra nessun pacchetto esterno nuovo.
- `src/apps.rs`: `pub enum CraftApp { VectorCraft, PhotoCraft, FigCraft, Xmp }`
  con `ALL`, `format_id()`, `name()`, `extensions()`, `editor()` (l'id
  dell'editor esterno: `vectorcraft`, `photocraft`, `figcraft`; `lightcraft`
  per gli XMP) e `pub fn of_format(id: &str) -> Option<CraftApp>`. Le costanti:
  `VECTORCRAFT_FORMAT_ID = "craft-vectorcraft"` (estensione `vectorcraft`),
  `PHOTOCRAFT_FORMAT_ID = "craft-photocraft"` (`pcraft`),
  `FIGCRAFT_FORMAT_ID = "craft-figcraft"` (`figcraft`),
  `XMP_FORMAT_ID = "craft-xmp"` (`xmp`).
- `src/contract.rs`: la forma della sezione «Il contratto `CraftPreview`»,
  con `serde` (`rename_all = "snake_case"` dove serve perché i nomi JSON siano
  quelli scritti): `CraftPreview`, `PreviewSize { Small, Large }`,
  `PreviewOrigin { File, Cli, None }`, `PreviewImage`, `PreviewInfo`,
  `XmpInfo`, `RenderOffer`. `pub const PREVIEW_VERSION: u32 = 1`, le costanti
  `PREVIEW_COMMAND = "craft.preview"`, `RENDER_JOB = "craft.render"`,
  `BUNDLE_NS = "fub.craft"`. `PreviewImage::from_png(bytes: &[u8]) ->
  Option<PreviewImage>`: controlla la firma PNG, prende le misure da
  `container::png_size` e codifica in base64. `pub fn cache_key(revision: &str,
  size: PreviewSize) -> String` dà `previews/{:016x}.json`, con FNV-1a a 64
  bit scritto come in `crates/fub-host/src/link_card.rs` (`cache_path`).
- `src/provider.rs`: `pub struct CraftProvider { app }`,
  `CraftProvider::boxed(app)` e `pub fn providers() -> Vec<Box<dyn
  FormatProvider>>` (i quattro). `descriptor`: id, nome, estensione,
  `SourceKind::Bytes`. `capabilities`: `FormatCapabilities::of(&[])`.
  `parse`: per `Xmp` `xmp::document_model(ctx, bytes)`; per gli altri
  `container::read_meta(app, bytes)` e il modello: titolo come metadato nel
  frontmatter (`title`, se il file lo dice), `text` dal contenitore, i link
  da `linked::collect(&json)` come `Link { target: LinkTarget::Path(p),
  embed: true, span: Span::EMPTY, context: None }`. Un file rotto o troppo
  grande dà un modello vuoto con il suo id, non un errore: il file resta nel
  vault e si trova per nome. `render_html`: `<figure class="fub-craft"
  data-embed-kind="craft" data-embed-doc="…" data-craft-app="…"><figcaption>
  nome del file</figcaption></figure>` (per un XMP `data-embed-kind="craft-xmp"`),
  scritto con `fub_abi::html::{escape, attr}`. `serialize`:
  `Err(FormatError::Unsupported { format, got: SourceKind::Text })`, come
  `crates/fub-format-xlsx/src/lib.rs` (riga 210). `rewrite_links` e
  `format_link` restano quelli di serie.
- Gli scheletri: `container::{Contents, read_meta, embedded_preview}`,
  `xmp::{PhotoMeta, read, document_model, photo_candidates, edit_copy_of}`,
  `linked::collect`, con le firme di T2, T3 e T4 e un corpo che dà il valore
  vuoto (`Contents::default()`, `None`, `Vec::new()`). In `container.rs`
  invece `pub struct Png { pub bytes: Vec<u8>, pub width: u32, pub height:
  u32 }` e `pub fn png_size(bytes: &[u8]) -> Option<(u32, u32)>` sono già
  veri, perché li usa `PreviewImage::from_png`: la firma di 8 byte, poi il
  primo chunk lungo 13 e di tipo `IHDR`, larghezza e altezza big endian, non
  zero.
- `src/lib.rs`: il `//!` del crate (sola lettura: metadati, link,
  anteprima; mai il motore dell'app, mai una scrittura), i `pub mod` e le
  riesportazioni.
- `tests/provider.rs`: `fub_sdk::testing::conformance::a_format_respects_the_contract`
  sui quattro provider, come `crates/fub-format-xlsx/tests/provider.rs`; i
  descrittori (id, estensioni, `SourceKind::Bytes`); `serialize` rifiuta;
  `render_html` dà la figura con gli attributi e l'escape di un nome con `"`
  e `<`; byte a caso, vuoti o troncati danno un modello vuoto.
- `tests/ts_preview.rs`: come `crates/fub-format-xlsx/tests/ts_grid.rs`:
  scrive alcuni `CraftPreview` d'esempio (con immagine, senza, con `xmp`, con
  `render`, `queued`) in `apps/client/src/__fixtures__/craft-preview.json`, li
  confronta col committato, li rigenera con `UPDATE_MIRROR=1`.
- `apps/client/src/host/craft.ts`: le interfacce TypeScript del contratto e
  `readCraftPreview(value: unknown): CraftPreview | null`, che controlla ogni
  campo e rifiuta una `version` diversa da 1. `craft.test.ts` legge la
  fixture: ogni esempio passa e torna uguale; un campo mancante o di tipo
  sbagliato dà `null`.
- Docs: `craft-formats.md` (gli id, le estensioni, il contratto, i limiti),
  `xmp-sidecars.md`, `external-editors.md` e `craft-files.md` con il titolo e
  un paragrafo d'apertura che dice a che cosa servono (i task dopo aggiungono
  le loro sezioni); `docs/README.md` le linka. Nella mappa
  (`overview.md`: `craft["fub-format-craft"]` e `craft --> abi`;
  `docs/map/repo.md` riga 51; `components-and-boundaries.md`;
  `repository-tour.md`) il crate nuovo accanto agli altri formati.
Casi limite: un nome di file con `"`, `<`, `&` nella figura; un file di zero
byte; `of_format` con un id sconosciuto; un `CraftPreview` con `image: null`
e `render: null`; un JSON con un campo in più (il lettore TypeScript lo
ignora); `width` o `height` zero (`from_png` rifiuta); la fixture scritta su
una macchina con un'altra fine riga (si scrive con `\n`).
Fatto quando: `cargo test -p fub-format-craft --test provider --test
ts_preview` passa e la fixture è committata; `cd apps/client && npx vitest
run src/host/craft.test.ts` passa; `cargo test -p fub-abi --test
dependency_invariant` passa col crate nuovo; `cargo tree -p fub-format-craft
-e normal` non mostra pacchetti che `Cargo.lock` non avesse già.
Prova: scripts/check.sh --rapido; cargo test -p fub-format-craft; cd
apps/client && npx vitest run src/host/craft.test.ts
Stato: [x] fatto

## T2 · I contenitori

Perché: i metadati e l'anteprima stanno dentro il file, in tre contenitori
diversi; leggerli senza il motore dell'app, con un tetto a ogni lettura, è
il cuore del formato.
Tocca: `crates/fub-format-craft/src/container.rs`,
`crates/fub-format-craft/tests/containers.rs` (nuovo),
`docs/reference/craft-formats.md` (sezione «Contenitori»).
Non toccare: `src/provider.rs` (usa già le firme di T1); `src/xmp.rs`,
`src/linked.rs` (T3, T4, in parallelo); `Cargo.toml` (le dipendenze ci
sono).
Dipende da: T1
Cosa fare:
- `pub struct Contents { pub format_version: Option<String>, pub title:
  Option<String>, pub text: String, pub json: Option<serde_json::Value> }`
  (`json` è il documento, che T4 attraversa per i file collegati).
- `pub fn read_meta(app: CraftApp, bytes: &[u8]) -> Result<Contents,
  ContainerError>`:
  - PhotoCraft: ZIP, `manifest.json`; `format_version` numero o stringa
    (diventa stringa); titolo da `title` o `name`.
  - FigCraft: ZIP, `document.json`; `format_version` da `format_version` o
    `version`; titolo da `title` o `name`; testo da ogni campo stringa
    `text`, `content` o `characters`.
  - VectorCraft: se comincia con `1f 8b` lo scompatta con
    `flate2::read::GzDecoder` e `take(MAX_JSON + 1)` (oltre: troppo grande);
    taglia al primo `\n\0VCBLOBS\0`; `serde_json::from_slice`; versione,
    titolo e testo come FigCraft.
  - Il testo si unisce con `\n` e si taglia a 64 KiB su un confine di
    carattere.
- `pub fn embedded_preview(app, bytes, size: PreviewSize) ->
  Result<Option<Png>, ContainerError>`: PhotoCraft `thumb.png` per `Small` e
  `composite/preview.png` per `Large`, ciascuna con l'altra come riserva;
  FigCraft `thumbnail.png` per le due misure; VectorCraft `/preview/data`
  (toglie un prefisso `data:…;base64,`, decodifica con `base64`, rifiuta una
  stringa più lunga di quanto 8 MiB diventano in base64).
- `Png` e `png_size` li ha scritti T1: `embedded_preview` li usa, e
  un'anteprima che non è un PNG è `None`.
- I limiti (sezione «I limiti»): sopra 64 MiB `ContainerError::TooLarge`
  senza aprire; più di 10 000 voci nello ZIP `TooLarge`; una voce si guarda
  con `size()` prima di leggerla e si legge con `take`; un JSON di una voce
  ZIP sopra 64 MiB `TooLarge`.
- `pub enum ContainerError { TooLarge, NotZip, NotJson, BadGzip, Missing }`,
  senza testi (`Debug`, `PartialEq`).
- `tests/containers.rs`: i file finti costruiti dal test con
  `zip::ZipWriter` (voci in STORE e in Deflate), `flate2::write::GzEncoder`,
  `base64` e un PNG minimo scritto a mano (firma, `IHDR`, `IEND`).
- «Contenitori» in `craft-formats.md`: che cosa si legge da ogni formato, le
  riserve, i limiti.
Casi limite: ZIP senza `manifest.json` (contenuti vuoti, non un errore);
voce dichiarata piccola che si scompatta grande (il `take` la ferma); gzip
troncato; `VCBLOBS` assente o all'inizio; JSON valido ma non un oggetto;
`/preview/data` vuoto, non base64, o un JPEG; PNG con `IHDR` corto; un
`.pcraft` che è una cartella (il kernel non lo dà come byte: fuori da N7); un
nome di voce con `../`; 10 001 voci; un file di 64 MiB e un byte.
Fatto quando: `cargo test -p fub-format-craft --test containers` copre ogni
caso limite qui sopra, e `--test provider` dà per un `.pcraft` finto il
titolo e la versione del manifesto.
Prova: scripts/check.sh --rapido; cargo test -p fub-format-craft
Stato: [x] fatto

## T3 · Gli XMP

Perché: LightCraft scrive voto, etichetta, scelta e parole chiave in un XMP
accanto alla foto; letti, diventano proprietà e tag di Fub.
Tocca: `crates/fub-format-craft/src/xmp.rs`,
`crates/fub-format-craft/tests/xmp.rs` (nuovo),
`docs/reference/xmp-sidecars.md`.
Non toccare: `src/container.rs`, `src/linked.rs` (T2, T4, in parallelo);
`src/provider.rs`; `crates/fub-abi/src/rules/tag.rs` (la regola dei tag si
usa, non si cambia).
Dipende da: T1
Cosa fare:
- `pub struct PhotoMeta { pub rating: Option<i8>, pub label: Option<String>,
  pub flag: Option<Flag>, pub keywords: Vec<String> }`,
  `pub enum Flag { Pick, Reject }` (`lc:flag="none"` è `None`).
- `pub fn read(bytes: &[u8]) -> Result<PhotoMeta, XmpError>` con
  `quick_xml::Reader`, come lo schizzo del passo ma con quick-xml 0.41:
  voto, etichetta e scelta sia come attributi di `rdf:Description`
  (`xmp:Rating`, `xmp:Label`, `lc:flag`) sia come elementi
  (`<xmp:Rating>3</xmp:Rating>`); le parole chiave dai `rdf:li` dentro
  `dc:subject`, ricomponendo il testo dagli `Event::Text` e dagli
  `Event::GeneralRef` (le cinque entità predefinite e i riferimenti
  numerici; un'entità sconosciuta si salta). Il voto vale da -1 a 5,
  altrimenti `None`; l'etichetta si tiene se non è vuota e ha al massimo 64
  caratteri; al massimo 500 parole chiave, senza doppioni, nell'ordine del
  file.
- Mai leggere né riportare `crs:*` o `lc:settings`: non entrano nel modello.
- `pub fn document_model(ctx: &ParseContext, bytes: &[u8]) -> DocumentModel`:
  frontmatter con le sole chiavi presenti fra `rating`, `label`, `flag`
  (`"pick"`, `"reject"`) e `tags`; un tag è la parola chiave con i `#`
  iniziali tolti e ogni serie di spazi diventata `-` («New York» →
  `New-York`); i tag del modello sono `fub_abi::rules::tag::frontmatter_tags`
  di quel frontmatter, con `Span::EMPTY`, così la regola dei tag è una sola
  e una parola che non può essere un tag (con `&`, tutta cifre) resta solo
  nel testo; `text` sono le parole chiave e l'etichetta, una per riga. Un XMP
  rotto dà il modello vuoto.
- `pub fn photo_candidates(xmp_name: &str) -> PhotoMatch`: per
  `IMG_0001.CR3.xmp` (due estensioni) la foto è esattamente `IMG_0001.CR3`;
  per `IMG_0001.xmp` è un qualsiasi file accanto che si chiama `IMG_0001.<ext>`
  con `<ext>` diversa dall'estensione dell'XMP. Si toglie l'ultima estensione
  così com'è scritta, senza piegare il caso. `pub enum PhotoMatch {
  Exact(String), Stem(String) }`; chi guarda il vault (T6) sceglie.
- `pub fn edit_copy_of(photo: &str) -> String`: `IMG_0001.CR3` →
  `IMG_0001-Edit.psd`, il nome che PhotoCraft dà con «Modifica in
  PhotoCraft».
- `pub enum XmpError { NotXml, TooLarge }` senza testi; un XMP sopra 8 MiB
  non si legge.
- `tests/xmp.rs`: XMP scritti a mano come quelli di LightCraft (attributi,
  elementi, `rdf:Bag`), più i casi limite.
- `xmp-sidecars.md`: che cosa si legge, come diventa proprietà e tag, i due
  nomi, la copia `-Edit.psd`, che cosa Fub non tocca mai, e che LightCraft
  scrive l'XMP solo con ⌘S o con `autoWrite` acceso.
Casi limite: `&amp;` dentro una parola chiave; `<!DOCTYPE>` con un'entità
dichiarata (non si espande); un `rdf:li` fuori da `dc:subject` (si ignora);
voto `"5.0"`, `"6"`, `"-2"`; `lc:flag="none"`; 501 parole chiave; la stessa
parola due volte; parola chiave di soli spazi; `IMG.xmp` senza foto accanto;
`archivio.tar.xmp`; un XMP con il BOM; un XMP di zero byte.
Fatto quando: `cargo test -p fub-format-craft --test xmp` passa con tutti i
casi limite, e un XMP con `dc:subject` «New York», «mare» dà i tag
`New-York` e `mare` e il frontmatter `{ rating, label, flag, tags }`.
Prova: scripts/check.sh --rapido; cargo test -p fub-format-craft
Stato: [x] fatto

## T4 · I file collegati

Perché: una foto piazzata in un disegno è un link del disegno; il kernel lo
risolve e la foto ha il backlink.
Tocca: `crates/fub-format-craft/src/linked.rs`,
`crates/fub-format-craft/tests/linked.rs` (nuovo),
`docs/product/craft-files.md` (sezione «File collegati»).
Non toccare: `src/container.rs`, `src/xmp.rs` (T2, T3, in parallelo);
`src/provider.rs` (mappa già i percorsi in `Link`); il kernel (risolve già un
`LinkTarget::Path` relativo con `resolve_against`,
`crates/fub-kernel/src/graph.rs` riga 817).
Dipende da: T1
Cosa fare:
- `pub fn collect(doc: &serde_json::Value) -> Vec<String>`: attraversa il
  JSON (oggetti e array, al massimo 64 livelli) e prende ogni valore stringa
  dei campi `href`, `src`, `path`, `file`, `uri` o `link` (A3).
- Tiene il percorso relativo così com'è scritto (il kernel lo risolve contro
  la cartella del documento) e scarta quelli assoluti o non di file: che
  cominciano con `/` o `\`, con una lettera e `:` (`C:`), con `file:`,
  `data:`, `http:`, `https:` o un altro schema `nome:`. Il modello da seguire
  è `crates/fub-format-svg/src/links.rs`.
- Al massimo 1000 percorsi, senza doppioni, nell'ordine in cui si trovano.
- `tests/linked.rs`: un JSON finto come un disegno con una foto piazzata
  (`{"layers":[{"type":"image","href":"../Foto/mare.jpg"}]}`), uno ZIP di
  FigCraft con `document.json`, e il provider che dà i `Link` con
  `embed: true`.
- «File collegati» in `craft-files.md`: un file piazzato diventa un link del
  documento e un backlink del file; Fub non cambia il file Craft quando il
  collegato si sposta (lo dice T5).
Casi limite: `href` vuoto; `href` con `#frammento` o `?query` (si toglie
la parte dopo `#` o `?`); un percorso con `%20`; `data:image/png;base64,…`;
un URL `https://`; `C:\Foto\a.jpg`; 1001 collegati; un JSON con 65 livelli;
un campo `src` che è un numero.
Fatto quando: `cargo test -p fub-format-craft --test linked` passa con i
casi limite; il modello di un disegno finto ha il `Link` verso
`../Foto/mare.jpg`.
Prova: scripts/check.sh --rapido; cargo test -p fub-format-craft
Stato: [x] fatto

## T5 · La rinomina con i file a byte

Perché: oggi un file a byte che punta al file rinominato ferma la rinomina
(prova 2); con i file Craft che hanno link sarebbe la regola, non
l'eccezione (D-3).
Tocca: `crates/fub-kernel/src/workspace.rs`,
`crates/fub-kernel/tests/rename_and_events.rs`,
`docs/product/craft-files.md` (sezione «Rinominare»).
Non toccare: `crates/fub-format-craft` (il provider non riscrive niente);
`crates/fub-abi` (il default di `rewrite_links` resta `Ok(None)`); il
comportamento delle sorgenti di testo; `.github/scripts/check-error-literals.mjs`
(la soglia di `fub-kernel` non cambia: niente `PluginError` nuovi).
Dipende da: T4 (la stessa pagina)
Cosa fare:
- In `invoke_prepared_link_rewrites` (`workspace.rs`, riga 1129), per una
  sorgente con `prepared.source_kind == SourceKind::Bytes`: se il provider
  manca o `rewrite_links` dà `Ok(None)`, la sorgente si salta e lascia una
  riga `format!("{src}: un file a byte non si riscrive, il link punta ancora
  a {from}")`.
- Le righe finiscono nei `rewrite_failures` che ci sono già (righe 399 e 438,
  riempiti alle 1105 e 1495); l'esito è quello parziale che esiste,
  `Ok(Err(KernelError::LinkRewrite(failed.join("; "))))` (righe 8842-8860 e
  9061-9064): il file è rinominato, le note sono aggiornate, e chi ha chiesto
  la rinomina riceve l'avviso.
- Per farlo `invoke_prepared_link_rewrites` restituisce anche le righe
  saltate (per esempio `Result<(Vec<RenameRecoveryEdit>, Vec<String>)>`); i
  chiamanti alle righe 871, 1293 e 2704 le aggiungono ai loro
  `rewrite_failures`.
- Le sorgenti di testo senza riscrittura restano un errore, come oggi.
- `tests/rename_and_events.rs`: un provider di prova a byte (accanto a quello
  di riga 97) che dichiara un link verso `foto.png`; rinominare `foto.png`
  riesce, il file a byte ha gli stessi byte, la nota Markdown che puntava a
  `foto.png` è aggiornata, e l'esito porta la riga con i due nomi.
- «Rinominare» in `craft-files.md`: Fub aggiorna le note e dice quali file
  Craft puntano ancora al vecchio nome; il file Craft si ripara aprendolo
  nella sua app.
Casi limite: due file a byte che puntano allo stesso file (due righe); un
file a byte che punta a sé stesso; rinomina di una cartella intera; una
sorgente di testo e una a byte nello stesso giro; un provider a byte che sa
riscrivere (`Ok(Some(..))`: si comporta come oggi); l'annulla della rinomina
(i file a byte non hanno niente da annullare).
Fatto quando: `cargo test -p fub-kernel --test rename_and_events` ha il test
nuovo che fallisce prima del cambio (la rinomina si fermava) e passa dopo;
gli altri test della rinomina non cambiano.
Prova: scripts/check.sh --rapido; cargo test -p fub-kernel --test
rename_and_events
Stato: [x] fatto

## T6 · Il bundle `fub.craft`

Perché: i formati vanno montati, e qualcuno deve rispondere «dammi
l'anteprima di questo file» con la cache: è il bundle `fub.craft`, una riga
della mappa dei componenti dietro una cargo feature.
Tocca: `crates/fub-host/src/craft/mod.rs` (nuovo),
`crates/fub-host/src/craft/preview.rs` (nuovo); gli scheletri
`crates/fub-host/src/craft/editors.rs`, `crates/fub-host/src/craft/launch.rs`,
`crates/fub-host/src/craft/channel.rs`, `crates/fub-host/src/craft/open_with.rs`
(nuovi, solo la riga `//!` che dice che cosa conterranno);
`crates/fub-host/src/lib.rs` (`#[cfg(feature = "craft")] pub mod craft;`),
`crates/fub-host/src/mount.rs` (i provider e il bundle),
`crates/fub-host/Cargo.toml`, `crates/fub-features/Cargo.toml`,
`crates/fub-features/src/componenti.rs`,
`crates/fub-features/tests/cargo_features.rs`,
`crates/fub-host/tests/componenti.rs`, `crates/fub-host/tests/craft.rs`
(nuovo), `Cargo.lock`; `docs/reference/on-disk-layout.md` (riga 168, la riga
delle cache dei bundle: si cambia, non se ne aggiungono),
`docs/architecture/overview.md` (`host --> craft`),
`docs/reference/craft-formats.md` (sezione «Anteprima e cache»).
Non toccare: `crates/fub-kernel` (T5); `crates/fub-host/src/settings.rs`
(T7); `crates/fub-host/src/control.rs` (T9, T13); la shell (T14);
`.github/scripts/check-cargo-feature-default.mjs` (la feature è nel
`default`, quindi non va in `FUORI_DAL_DEFAULT`).
Dipende da: T1, T2, T3, T4
Cosa fare:
- Cargo: in `fub-host` `fub-format-craft = { workspace = true, optional =
  true }` e `craft = ["dep:fub-format-craft", "fub-features/craft"]`, nel
  `default` (riga 142); in `fub-features` la feature marcatore `craft = []`
  nel suo `default`, come `rich` e `xlsx`.
- `componenti.rs`: `#[cfg(feature = "craft")] Riga::servizio("fub.craft",
  "component.craft.name").group("disegnare").cargo_feature("craft")` accanto
  a `fub.draw` (riga 280); in `NOMI` `("component.craft.name", "File delle app
  Craft", "Craft app files")` accanto alla riga 400. `cargo_features.rs` e
  `crates/fub-host/tests/componenti.rs` (`#[cfg(feature = "craft")]
  ids.push("fub.craft")`, vicino alla riga 150) lo sanno.
- `mount.rs`: `#[cfg(feature = "craft")]
  builtin.extend(fub_format_craft::providers())` accanto ai provider dei
  disegni (riga 335); il bundle accanto a `LinkCardBundle` (riga 512).
- `craft/mod.rs`: `CraftBundle`, sul modello di
  `crates/fub-host/src/link_card.rs`: il manifest copia `uses`, `kind`,
  `group` e `ui` da `fub_features::componenti::riga("fub.craft")`; il
  comando `craft.preview` (`{ doc, size, render }`, in sola lettura, effetto
  `CommandEffect::Custom { ns: "fub.craft", payload }`) e il job
  `craft.render` (in T6 il job risponde «niente CLI» e basta: lo riempie
  T11); le frasi del bundle nel suo catalogo (italiano e inglese).
- `craft/preview.rs`: `pub fn preview(host: &dyn HostApi, doc: &DocId, size:
  PreviewSize) -> Result<CraftPreview, PluginError>`:
  - la revisione da `host.document_revision`; la cache da
    `host.cache_read(&cache_key(..))`, che risponde se è leggibile, della
    versione 1 e dello stesso `doc`;
  - altrimenti i byte da `host.read_document_bytes`, il formato dall'estensione
    (`CraftApp::of_format` dell'id del formato del documento),
    `container::embedded_preview` e `read_meta` per `info`; con l'anteprima
    nel file `origin: "file"` e la cache scritta (`host.cache_write`; un
    errore di scrittura non toglie l'anteprima);
  - per un XMP: `xmp::read` per `info.xmp`; la foto con
    `xmp::photo_candidates` e `host.query_index(IndexQuery::Entries {
    of_kind: None, within: Some(FolderScope::direct(cartella)), page })`
    (per `Stem` la prima in ordine di `DocId`); `info.edits` con
    `edit_copy_of`, se esiste;
  - `render` resta `null` (lo accende T11).
- Un file oltre 64 MiB: `origin: "none"` senza leggerlo (D-8).
- `tests/craft.rs`, con l'host di prova dei test vicini (per esempio
  `crates/fub-host/tests/svg_vault.rs`) e file finti scritti dal test:
  - un `.vectorcraft`, un `.pcraft` e un `.figcraft` con anteprima, e un
    `.vectorcraft` senza; per ognuno `craft.preview` small e large;
  - la seconda chiamata risponde dalla cache;
  - i byte di ogni file uguali prima e dopo (nessuna scrittura);
  - la ricerca trova un testo di un `.figcraft`;
  - `IndexQuery::Backlinks` della foto collegata dà il disegno;
  - `IndexQuery::Tags` trova il tag di un XMP, e `info.photo` e `info.edits`
    di un XMP accanto a `IMG_0001.CR3` e `IMG_0001-Edit.psd`;
  - con il componente spento il comando non c'è e i formati sì (D-7).
- Docs: la riga 168 di `on-disk-layout.md` nomina anche le anteprime di
  `fub.craft`; «Anteprima e cache» in `craft-formats.md` (le chiavi, chi la
  scrive, che si rifà).
Casi limite: un documento sparito fra la revisione e la lettura; la cache di
un'altra versione o di un altro `doc` (si ignora); la cache rotta; due
richieste insieme per lo stesso file; un `.pcraft` con solo `thumb.png`
chiesto `large` (dà quella, e lo dice la misura); un XMP senza foto; un id
che non è un formato Craft (`PluginError` con una chiave del catalogo, mai
un letterale); il vault chiuso.
Fatto quando: `cargo test -p fub-host --test craft --test componenti --test
format_guards --test syntax_declared --test catalogs` e `cargo test -p
fub-features --test cargo_features --test componenti` passano;
`node .github/scripts/check-cargo-feature-default.mjs` e
`node .github/scripts/check-error-literals.mjs` passano senza cambiare
soglie.
Prova: scripts/check.sh --rapido; cargo test -p fub-host --test craft
Stato: [ ] da fare

## T7 · Il registro delle app

Perché: «Apri con» e la CLI devono sapere quali app Craft ci sono, che cosa
aprono e dove sta il loro programma; e chi le ha messe in un posto suo deve
poterlo dire.
Tocca: `crates/fub-host/src/craft/editors.rs` (riempie lo scheletro di T6),
`crates/fub-host/src/settings.rs`,
`crates/fub-abi/tests/a_named_rule_is_declared.rs`,
`docs/product/craft-files.md` (sezione «Quali app trova Fub»).
Non toccare: `crates/fub-host/src/craft/launch.rs` e `channel.rs` (T8, T9, in
parallelo); `crates/fub-host/src/craft/mod.rs` (dichiara già il modulo);
`crates/fub-host/src/shell.rs` (le due impostazioni le disegna il modulo
generico: non vanno in `SETTINGS_WITH_THEIR_OWN_GESTURE`); la shell.
Dipende da: T6
Cosa fare:
- `editors.rs`: `pub struct Editor { id, name, opens, gui, cli,
  single_instance, control }`, tutto `&'static`, e `pub const EDITORS:
  &[Editor]` con le sette righe della tabella «Le app che Fub conosce»:
  `gui` è `<id>`, `cli` è `Some("<id>-cli")` per le tre app con l'anteprima
  (gli argomenti della CLI li scrive T11), `single_instance` dice su quali
  sistemi (`Os::Linux`, `Os::Windows`, `Os::MacOs`), `control` il metodo e
  l'autenticazione del passo (`Auth::None`, `Auth::Token { env:
  Option<&str> }`, `Auth::Key`), che T9 e T10 leggono: un canale con
  `Auth::None` o `Auth::Key` non si usa mai (D-2).
- `pub fn opens(editor: &Editor, extension: &str) -> bool` confronta
  l'estensione con `eq_ignore_ascii_case` (un `IMG.JPG` è un `jpg` per
  PhotoCraft); la riga in `rules()` di `a_named_rule_is_declared.rs`, famiglia
  `Family::AsciiCase`, con la ragione: le estensioni della tabella sono ASCII
  e il sistema le tratta così, e non è il nome di una nota, di un tag o di un
  percorso.
- `pub struct Env { home, os, path: Vec<PathBuf>, local_data, program_files,
  local_app_data, flatpak_roots }` con `Env::from_process()` e, nei test, uno
  costruito a mano: niente in `editors.rs` legge l'ambiente vero fuori da
  `from_process`.
- `pub fn detect(env: &Env, overrides: &[String]) -> Vec<Found>` (`Found {
  id, gui: Option<Launch>, cli: Option<PathBuf>, how }`), `Launch` =
  `Program(PathBuf)` o `Flatpak(String)` o `MacApp(PathBuf)`; nell'ordine:
  - le righe di `craft.editor-paths` (`vectorcraft=/opt/vc/vectorcraft`,
    `vectorcraft-cli=/opt/vc/vectorcraft-cli`): vincono su tutto; un id
    sconosciuto, una riga senza `=` o un percorso relativo si scartano;
  - `installed.json` del launcher (`artcraft-launcher/installed.json` sotto
    la cartella dei dati locali): letto con un tetto di 1 MiB e tollerante (un
    oggetto o un array, con `id` e un percorso fra `path`, `exe`,
    `executable`); un file rotto è come assente;
  - Linux: `/usr/bin/{id}`, `~/.local/bin/{id}`, un AppImage in
    `~/Applications` o `~/AppImages` il cui nome comincia con il nome
    dell'app o con il suo id così come sono scritti (`VectorCraft-…`,
    `vectorcraft-…`: niente piegatura del caso), e il Flatpak `ai.storyteller.{id}` cercato come cartella in
    `~/.local/share/flatpak/app/` e `/var/lib/flatpak/app/` (senza avviare
    `flatpak`);
  - macOS: `/Applications/{Nome}.app` e `~/Applications/{Nome}.app`;
  - Windows: `%LOCALAPPDATA%\Programs\ArtCraft\{Nome}\{id}.exe` e
    `%ProgramFiles%\ArtCraft\{Nome}\{id}.exe`;
  - la CLI accanto al programma trovato o in `~/.local/bin`; mai cercata nel
    `PATH` di sistema per nome nudo.
  Un percorso conta solo se è un file (o una cartella `.app` su macOS); un
  link simbolico si segue una volta.
- `pub fn find(env, overrides) -> Vec<Found>` con una cache di processo di 30
  secondi (un `OnceLock<Mutex<..>>` con l'ora): il menu non rifà le ricerche
  a ogni clic.
- `settings.rs`, tutto `#[cfg(feature = "craft")]`: `CRAFT_EDITOR_PATHS =
  "craft.editor-paths"` (`SettingKind::List`, vuota) e `CRAFT_CLI_PREVIEWS =
  "craft.cli-previews"` (`SettingSpec::toggle`, acceso), tutte e due
  `.for_machine()` (A11) e nel gruppo nuovo `C_GROUP_EXTERNAL_APPS =
  "core.group.external_apps"`, «App esterne» / «External apps», sul modello
  di `URI_ALLOWED` (righe 277 e 474-485). Le frasi in `core_catalog`, in
  italiano e in inglese (accanto alle righe 1828 e 2397): «Dove sono le app
  Craft» con la descrizione delle righe `id=percorso`; «Anteprime con le app
  Craft» con «Fub avvia la CLI dell'app per fare l'anteprima di un file che
  non ne ha una».
- Test in `editors.rs` (`#[cfg(test)]`): con un `Env` su una cartella
  temporanea finta per Linux, macOS e Windows (le regole dei percorsi si
  provano su ogni sistema, perché non avviano niente); le righe di
  `craft.editor-paths` buone e cattive; `installed.json` buono, rotto, enorme,
  con un id sconosciuto; `opens` con `JPG`; nessuna riga di `EDITORS` con
  `opens` vuoto o con due righe con lo stesso id.
- «Quali app trova Fub» in `craft-files.md`: dove le cerca, come dirgli un
  percorso, che cosa vuol dire «Non installata».
Casi limite: `HOME` assente; un percorso con spazi o con caratteri non UTF-8;
un AppImage senza il bit di esecuzione (non conta); `installed.json` che
punta a un file sparito; due righe di `craft.editor-paths` per lo stesso id
(vince l'ultima); un Flatpak installato per il sistema e per l'utente; la
cache dei 30 secondi dopo un cambio di `craft.editor-paths` (si svuota a
ogni cambio dell'impostazione); un'estensione con un punto davanti (`.JPG`).
Fatto quando: `cargo test -p fub-host --lib craft::editors` passa con i casi
qui sopra; `cargo test -p fub-host --test catalogs --test shell_ids_mirror`
passa; `cargo test -p fub-abi --test a_named_rule_is_declared` passa con la
riga nuova (e fallisce senza).
Prova: scripts/check.sh --rapido; cargo test -p fub-host --lib
craft::editors; cargo test -p fub-abi --test a_named_rule_is_declared
Stato: [ ] da fare

## T8 · L'avvio dei programmi

Perché: «Apri con» avvia un'app e la lascia vivere da sola; la CLI si avvia
e si aspetta, con un tempo e un peso massimi. Due modi soli, scritti una
volta, senza shell.
Tocca: `crates/fub-host/src/craft/launch.rs` (riempie lo scheletro di T6),
`docs/reference/external-editors.md` (sezione «Avvio»).
Non toccare: `crates/fub-host/src/craft/editors.rs` e `channel.rs` (T7, T9,
in parallelo); `crates/fub-app/src/reveal.rs` (l'app di sistema resta di
`fub-app`: T10 sposta solo `inside` e `plain`); `crates/fub-host/Cargo.toml`
(`tempfile` è già fra le dipendenze di sviluppo).
Dipende da: T6
Cosa fare:
- `pub fn spawn_detached(program: &Path, args: &[OsString]) ->
  Result<u32, LaunchError>`: `std::process::Command` con argomenti separati,
  stdin, stdout e stderr a `Stdio::null()`, cartella di lavoro la home;
  su unix `CommandExt::process_group(0)` (l'app non muore se Fub si chiude);
  su Windows `creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)`;
  un thread con un nome (`fub-craft-wait`) fa `wait()` perché non restino
  processi zombie, e segna l'uscita nel registro che T10 legge
  (`pub fn on_exit(pid, Box<dyn FnOnce() + Send>)` o un canale: il coder
  sceglie).
- `pub fn run_cli(program: &Path, args: &[OsString], limits: &CliLimits,
  cancelled: &dyn Fn() -> bool) -> Result<CliOutput, LaunchError>`: stdout e
  stderr letti da due thread con un tetto di 64 KiB ciascuno (il resto si
  scarta, senza bloccare il processo); ogni ~100 ms guarda `cancelled()` e
  il tempo (20 s); a tempo scaduto o annullato uccide il processo (su unix
  l'intero gruppo) e aspetta che esca. `CliOutput { status, stdout, stderr }`.
- `pub struct CliLimits { time: Duration, stream: usize }` con il
  `Default` della sezione «I limiti».
- `pub enum LaunchError { NotFound, Denied, TimedOut, Cancelled, Failed(i32),
  Io }` senza testi (`Debug`, `PartialEq`); il testo lo mettono T10 e T11 con
  le chiavi del catalogo.
- Niente `sh -c`, niente `cmd /c`, niente variabili d'ambiente in più: si
  passa l'ambiente di Fub così com'è, meno le variabili di Fub stesse che
  cominciano con `FUB_` (un'app non deve trovare un token di Fub).
- Test `#[cfg(all(test, unix))]` in `launch.rs`, con script `/bin/sh` scritti
  in una cartella temporanea 0700 e resi eseguibili: uno che scrive un file e
  esce 0; uno che dorme 60 s (il tempo lo ferma, e l'annullamento pure, in
  meno di un secondo); uno che scrive 10 MiB su stdout (si tengono 64 KiB, il
  processo non si blocca); uno che esce 3 (`Failed(3)`); uno che stampa
  `FUB_*` (non ci sono); `spawn_detached` di uno che dorme: il pid torna
  subito e l'uscita arriva al registro.
- «Avvio» in `external-editors.md`: i due modi, perché niente shell, i
  limiti, che cosa succede chiudendo Fub.
Casi limite: un programma che non esiste (`NotFound`) o senza il bit di
esecuzione (`Denied`); un argomento con spazi, virgolette, `;` o `$(…)`
(arriva intatto: lo prova uno script che lo riscrive in un file); un
processo che chiude stdout e resta vivo; un figlio del figlio che resta
vivo dopo il tempo (il gruppo lo prende, su unix); l'annullamento mentre il
processo sta partendo; cento avvii di fila (nessun thread che resta).
Fatto quando: `cargo test -p fub-host --lib craft::launch` passa su Linux con
i casi qui sopra, e il test del sonno finisce in meno di 25 s con il tempo e
in meno di un secondo con l'annullamento.
Prova: scripts/check.sh --rapido; cargo test -p fub-host --lib
craft::launch
Stato: [ ] da fare

## T9 · Il canale di controllo

Perché: un'app Craft avviata da Fub con un token scelto da Fub può ricevere
«apri questo file» nella finestra che ha già. Il canale va scritto una volta
e chiuso bene, anche se nessuna app della tabella lo permette ancora (D-2).
Tocca: `crates/fub-host/src/craft/channel.rs` (riempie lo scheletro di T6),
`crates/fub-host/src/control.rs` (solo `fresh_token`, riga 428, che diventa
`pub(crate)`), `docs/reference/permissions-and-security.md` (una
sottosezione accanto a «Canale di controllo», riga 223).
Non toccare: `crates/fub-host/src/craft/editors.rs` e `launch.rs` (T7, T8,
in parallelo); il resto di `control.rs` (T13); il canale di controllo di
Fub (`Call`, `answer`): sono due canali diversi.
Dipende da: T6
Cosa fare:
- `pub struct Channel { port: u16, token: String, framing: Framing }`,
  `pub enum Framing { Line, JsonRpc2 }`; `Channel::new(port, framing)` sceglie
  il token con `fresh_token()`.
- Si connette solo a `127.0.0.1` o `::1` (`SocketAddr` costruito da Fub, mai
  da un nome), con un tempo di connessione di 1 s e di lettura di 2 s.
- `fn auth_request(&self) -> Value`: l'unico punto che scrive
  l'autenticazione (il passo non dice il formato: si scrive come
  `{"method":"auth","params":{"token":…}}` e la si cambia lì quando un'app
  lo documenta).
- `pub fn open(&self, path: &Path) -> Result<(), ChannelError>`: manda
  l'autenticazione e poi `app.open` (`Line`: un JSON per riga) o `ui.open`
  (`JsonRpc2`: `{"jsonrpc":"2.0","id":…}`); legge una risposta per richiesta
  con un tetto di 64 KiB; una risposta con `error` è
  `ChannelError::Refused`.
- `pub enum ChannelError { Unreachable, Refused, BadReply, TimedOut }` senza
  testi.
- Nessuno usa `Channel` con un'app che non è stata avviata da Fub con quel
  token (lo controlla T10); `Auth::None` e `Auth::Key` non creano mai un
  `Channel` (un `match` esaustivo lo rende visibile).
- Test in `channel.rs` con un `TcpListener` su `127.0.0.1:0` in un thread:
  riceve l'autenticazione e il comando, risponde bene, male, troppo, niente;
  le due cornici.
- La sottosezione in `permissions-and-security.md`: Fub parla solo con
  un'app che ha avviato lui, con un token suo, su loopback; mai con un canale
  senza autenticazione.
Casi limite: la porta chiusa (`Unreachable` subito); un server che accetta e
non risponde (`TimedOut` in 2 s); una risposta di 1 MiB senza fine riga
(`BadReply` a 64 KiB); una risposta con un `id` diverso; un percorso con
caratteri non UTF-8 (`BadReply` prima di mandare, perché il JSON vuole
UTF-8); un token che la risposta ripete (non finisce in nessun log).
Fatto quando: `cargo test -p fub-host --lib craft::channel` passa con i casi
qui sopra; i test di `control.rs` (`cargo test -p fub-host --lib control`)
passano invariati.
Prova: scripts/check.sh --rapido; cargo test -p fub-host --lib
craft::channel
Stato: [ ] da fare

## T10 · «Apri con» nell'host

Perché: il menu, l'MCP e il prestito chiedono la stessa cosa: «quali app
aprono questo file» e «aprilo con questa». La risposta è una, nel core.
Tocca: `crates/fub-host/src/open_with.rs` (nuovo, sempre compilato: i tipi e
i due metodi di `Host`), `crates/fub-host/src/craft/open_with.rs` (riempie lo
scheletro di T6), `crates/fub-host/src/vault_path.rs` (nuovo),
`crates/fub-host/src/lib.rs` (`pub mod open_with; pub mod vault_path;`),
`crates/fub-app/src/reveal.rs` (usa `fub_host::vault_path`),
`crates/fub-host/src/settings.rs` (le frasi `host.open_with.*`),
`crates/fub-host/tests/craft_open_with.rs` (nuovo),
`docs/reference/external-editors.md` (sezione «Apri con»).
Non toccare: `crates/fub-host/src/craft/preview.rs` e `craft/mod.rs` (T11,
in parallelo); `crates/fub-app/src/lib.rs` (T12); `crates/fub-host/src/control.rs`
(T13); `launch.rs`, `editors.rs`, `channel.rs` (si usano come sono).
Dipende da: T7, T8, T9
Cosa fare:
- `vault_path.rs`: `pub fn inside(root: &Path, relative: &str) ->
  Result<PathBuf, PluginError>` e `plain`, spostati da
  `crates/fub-app/src/reveal.rs` (righe 71 e 102) con i loro test (righe
  229-243) e la stessa chiave `host.reveal.outside`; `reveal.rs` li usa da
  lì. Nessun testo letterale nuovo negli errori.
- `open_with.rs` (sempre compilato): `#[derive(Serialize, Deserialize)] pub
  struct ExternalEditor { id, name, opens, installed, running }`, `pub enum
  OpenHow { Forwarded, InRunning, NewProcess }` (`snake_case`), `pub struct
  OpenedWith { editor, how }`, e su `Host`:
  - `pub fn external_editors(&self, vault: Option<&str>, doc: Option<&str>)
    -> Result<Vec<ExternalEditor>, PluginError>`: senza la feature `craft`, o
    con `fub.craft` spento (`self.bundles(vault)`, `session.rs` riga 2424), una
    lista vuota; con `doc` solo le app che aprono la sua estensione
    (`editors::opens`), senza `doc` tutte e sette (la shell ci guarda per
    sapere se ce n'è almeno una installata);
  - `pub fn open_with(&self, vault: Option<&str>, path: &str, editor: &str,
    page: Option<u32>) -> Result<OpenedWith, PluginError>`.
- `craft/open_with.rs`, il percorso di `open_with`, in quest'ordine:
  1. `fub.craft` spento → `host.open_with.off`; editor sconosciuto →
     `host.open_with.unknown_editor`; l'estensione che l'app non apre →
     `host.open_with.wrong_kind`; non trovata da `editors::find` →
     `host.open_with.not_installed`;
  2. il percorso con `vault_path::inside` (fuori dal vault →
     `host.reveal.outside`; sparito → `host.open_with.missing`);
  3. un'app avviata da Fub, ancora viva e con un `Channel` (T9) → lo usa:
     `InRunning`; se il canale fallisce passa al punto 4;
  4. un'app con l'istanza singola su questo sistema → la avvia col file
     (l'app lo passa alla finestra aperta, se c'è): `Forwarded`;
  5. altrimenti un processo nuovo: `NewProcess`.
  Il programma: `Launch::Program` con `[file]`; `Launch::Flatpak` con
  `flatpak run ai.storyteller.{id} file` (`flatpak` cercato in `/usr/bin` e
  `/bin`); `Launch::MacApp` con `/usr/bin/open -a {app} file`. PdfCraft con
  `page` riceve `--page N` prima del file; le altre app ignorano `page`. Un
  errore di `spawn_detached` → `host.open_with.launch_failed` con il nome
  dell'app (mai il percorso del programma nel testo).
- Il registro delle app avviate: un `OnceLock<Mutex<HashMap<id, Started>>>`
  in `craft/open_with.rs` (`Started { pid, channel: Option<Channel> }`),
  aggiornato all'uscita (T8); `running` di `external_editors` vuol dire «avviata
  da Fub e non uscita» (A10). In N7 `channel` resta `None` per tutte le sette
  app (D-2): il punto 3 è scritto e provato con un editor di prova.
- Le frasi `host.open_with.*` in `core_catalog` (italiano e inglese), con
  `Text::key` e `Text::message`.
- `tests/craft_open_with.rs` (`#[cfg(unix)]`), con un vault temporaneo e
  script `/bin/sh` indicati da `craft.editor-paths` (impostati con
  `set_setting_for_user`, `session.rs` riga 2746) che scrivono i loro
  argomenti in un file:
  - `external_editors` di un `.pcraft` dà PhotoCraft installata; di un `.xyz`
    niente; senza `doc` le sette;
  - `open_with` di un `.pcraft` con PhotoCraft: lo script riceve il percorso
    assoluto del file, e `how` è `forwarded` su Linux;
  - VectorCraft dà `new_process`, e poi `running: true` finché lo script
    non esce;
  - PdfCraft con `page: 3` riceve `--page 3 file`;
  - un percorso con `..`, un'app sconosciuta, un'app non installata, un `.md`
    a PhotoCraft, `fub.craft` spento: ogni errore con la sua chiave.
- «Apri con» in `external-editors.md`: l'ordine dei tre modi, che cosa vuol
  dire «Già aperta», perché Fub non parla con un canale senza token.
Casi limite: un nome di file che comincia con `-` (si passa sempre il
percorso assoluto, che comincia con `/` o con la lettera del disco: non è
mai preso per un'opzione); un file con lo spazio nel nome;
il vault su un disco montato altrove (il percorso canonico); due «Apri con»
dello stesso file di fila; l'app che esce subito con un errore (`running`
torna `false`); un `vault` che non è aperto.
Fatto quando: `cargo test -p fub-host --test craft_open_with --test catalogs`
e `cargo test -p fub-app --lib reveal` passano;
`node .github/scripts/check-error-literals.mjs` passa senza cambiare
soglie.
Prova: scripts/check.sh --rapido; cargo test -p fub-host --test
craft_open_with
Stato: [ ] da fare

## T11 · Le anteprime con la CLI

Perché: VectorCraft di solito non salva l'anteprima nel file; la sua CLI la
sa fare. Con l'interruttore acceso e l'app installata, la scheda la chiede
una volta e la tiene in cache.
Tocca: `crates/fub-host/src/craft/preview.rs`, `crates/fub-host/src/craft/mod.rs`
(il job `craft.render`), `crates/fub-host/tests/craft_cli.rs` (nuovo),
`docs/reference/craft-formats.md` (sezione «Anteprime con la CLI»).
Non toccare: `crates/fub-host/src/craft/open_with.rs`, `vault_path.rs`,
`lib.rs`, `settings.rs` (T10, in parallelo); `editors.rs` e `launch.rs` (si
usano come sono); `crates/fub-format-craft` (la forma della risposta non
cambia).
Dipende da: T6, T7, T8
Cosa fare:
- In `preview`: se l'anteprima non c'è, l'app ha la CLI (`editors::find`),
  `craft.cli-previews` è acceso e il file non supera 64 MiB, `render` vale
  `{ "app": "VectorCraft" }`; con `render: true` nella domanda il comando
  mette in coda `craft.render` (`host` dei job, come `link_card.rs`) e
  risponde con `queued: true`.
- Il job `craft.render { doc, size }`:
  1. una cartella privata nuova (`tempfile::Builder` sotto la cartella
     temporanea di Fub, permessi 0700 su unix), dove copia i byte del
     documento con il suo nome (`in.vectorcraft`): la CLI non vede mai il
     file del vault (A5);
  2. `launch::run_cli` con gli argomenti della tabella (`convert {in} {out}
     --scale 0.25` per VectorCraft, `convert {in} {out}` per PhotoCraft,
     `render {in} -o {out}` per FigCraft; per `large` VectorCraft senza
     `--scale`), `{in}` e `{out}` assoluti, argomenti separati, e
     l'annullamento del job;
  3. `out.png` letto con un tetto di 16 MiB e controllato con
     `PreviewImage::from_png`; con un PNG buono `origin: "cli"` e la cache
     scritta per la revisione che c'era all'inizio (se il file è cambiato nel
     frattempo la risposta lo dice e non si scrive);
  4. la cartella si cancella sempre, anche dopo un errore.
  L'esito del job è il `CraftPreview` nuovo (la shell lo riceve con
  `job_done`). Un errore (CLI assente, tempo scaduto, PNG cattivo) è un
  `CraftPreview` con `origin: "none"` e `render: null` per quella revisione,
  così la scheda non la richiede in un giro: l'errore sta nel log del job,
  con una chiave del catalogo del bundle.
- Due richieste per lo stesso `doc` e la stessa misura mentre una lavora:
  una sola CLI (un insieme dei lavori in corso nel bundle).
- Le frasi del job nel catalogo del bundle, italiano e inglese.
- `tests/craft_cli.rs` (`#[cfg(unix)]`), con `vectorcraft-cli` puntato da
  `craft.editor-paths` a uno script `/bin/sh` che scrive un PNG minimo in
  `$2` (`printf` con i byte): la prima `craft.preview` di un `.vectorcraft`
  senza anteprima dà `render`; con `render: true` dà `queued` e poi il
  `job_done` con l'immagine; la seconda risponde dalla cache senza avviare
  lo script (lo script conta le sue chiamate in un file); i byte del
  documento uguali; con `craft.cli-previews` spento niente `render`; lo
  script che dorme si ferma a 20 s e annullando il job; lo script che
  scrive 17 MiB o un file che non è un PNG dà `origin: "none"`; la cartella
  privata non c'è più dopo ogni caso.
- «Anteprime con la CLI» in `craft-formats.md`: quando parte, che cosa vede
  l'app, dove va l'anteprima, come si spegne.
Casi limite: il documento rinominato o cancellato mentre la CLI lavora; la
CLI che scrive `out.png` come link simbolico verso un altro file (si legge
con `symlink_metadata` e si rifiuta); la CLI che scrive in `{in}`; la
cartella temporanea piena; uno `.xmp` (niente CLI); un `.pcraft` che ha già
`thumb.png` (niente CLI); la misura `large` quando c'è solo la `small`
della CLI.
Fatto quando: `cargo test -p fub-host --test craft_cli --test craft` passa
con i casi qui sopra; nessuno script di prova resta in esecuzione dopo i
test (gli script si chiamano `fub-craft-test-*`, e `pgrep -f fub-craft-test`
è vuoto).
Prova: scripts/check.sh --rapido; cargo test -p fub-host --test craft_cli
Stato: [ ] da fare

## T12 · L'IPC

Perché: la shell chiede all'app le due cose di T10 attraverso due comandi
Tauri, come fa già per «Apri con un'altra app» (`reveal_in_system`).
Tocca: `crates/fub-app/src/lib.rs` (due comandi e la loro registrazione),
`crates/fub-app/permissions/default.toml` (i due nomi in `allow-shell`, riga
54 e seguenti), `crates/fub-app/tests/lean_ipc.rs`,
`crates/fub-app/tests/ipc_permissions.rs`,
`crates/fub-app/tests/ts_mirror_app.rs`,
`apps/client/src/__fixtures__/mirror-samples-app.json` (generato),
`apps/client/src/host/ipc.ts`, `apps/client/src/host/fake.ts`,
`apps/client/src/host/mirror.test.ts`, `docs/reference/ipc-contract.md`.
Non toccare: `crates/fub-host` (T10 ha scritto ciò che serve); i file MCP
(T13, in parallelo); `crates/fub-app/permissions/mobile.toml` (sul telefono
non si avviano app Craft: i due comandi non vi sono permessi); `reveal_in_system` (la
voce dell'app di sistema resta com'è).
Dipende da: T10
Cosa fare:
- In `lib.rs`, accanto a `reveal_in_system` (riga 1940) e alla sua
  registrazione (riga 2663): `external_editors(window, host, vault:
  Option<String>, doc: Option<String>) -> Result<Vec<ExternalEditor>,
  PluginError>` e `open_with(window, host, vault, path: String, editor:
  String, page: Option<u32>) -> Result<OpenedWith, PluginError>`, come
  `reveal_in_system`: prima `guard_main_shell(&window, …)` (solo la shell
  principale), poi i metodi di `Host` in `spawn_blocking`.
- `default.toml`: `"external_editors"` e `"open_with"` nella lista di
  `allow-shell`.
- `lean_ipc.rs`: le due righe `("external_editors", Why::AppSurface)` e
  `("open_with", Why::AppSurface)` accanto alla riga 373; `ipc_permissions.rs`
  li trova registrati e permessi.
- `ts_mirror_app.rs`: esempi di `ExternalEditor` (installata, non
  installata, già aperta) e di `OpenedWith` (i tre `how`) nella fixture;
  `mirror.test.ts` controlla le chiavi di `ExternalEditor` e `OpenedWith`
  (`APP_RECORD_KEYS`) e i valori di `how`.
- `ipc.ts`: i tipi `ExternalEditor`, `OpenHow`, `OpenedWith` e le due
  funzioni `externalEditors(doc, vault?)`, `openWith(path, editor, page?,
  vault?)`, accanto a `revealInSystem` (riga 227).
- `fake.ts`: le due opzioni (`externalEditors?`, `openWith?`) come
  `revealInSystem` (righe 196 e 1343), e senza opzione la risposta
  «non disponibile» che usa già.
- `ipc-contract.md`: i due comandi, le loro risposte, gli errori.
Casi limite: `doc` assente (le sette app); un `page` negativo o enorme
(`u32` lo rifiuta prima di Rust); la shell di un'app vecchia che non ha i
comandi (la shell tratta il rifiuto come «nessuna app Craft» e il menu resta
quello di oggi: lo dice T16); un `vault` chiuso fra le due chiamate.
Fatto quando: `cargo test -p fub-app --test lean_ipc --test ipc_permissions
--test ts_mirror_app` passa e la fixture è committata; `cd apps/client &&
npx vitest run src/host/mirror.test.ts` passa.
Prova: scripts/check.sh --rapido; cargo test -p fub-app --test lean_ipc
--test ipc_permissions --test ts_mirror_app
Stato: [ ] da fare

## T13 · Gli strumenti MCP

Perché: un agente che lavora nel vault vuole vedere un disegno e passarlo
all'app giusta, con le stesse regole di chi scrive (D-4).
Tocca: `crates/fub-host/src/control.rs` (`Call::ExternalEditors`,
`Call::OpenWith` e i loro rami in `answer`, riga 185),
`crates/fub-cli/src/port.rs`, `crates/fub-cli/src/mcp/tools.rs`,
`crates/fub-cli/tests/mcp.rs`, `docs/reference/mcp-server.md`.
Non toccare: `crates/fub-app` e la shell (T12, in parallelo);
`crates/fub-cli/src/mcp/access.rs` (si usano `check_read` e `check_write`
come sono); il bundle `fub.craft`.
Dipende da: T6, T10
Cosa fare:
- `control.rs`: `Call::ExternalEditors { vault: Option<String>, doc:
  Option<String> }` e `Call::OpenWith { vault, path, editor, page }` (il
  `serde` di `Call` così com'è), che chiamano i metodi di T10; i test di
  `control.rs` che fanno il giro di ogni `Call`.
- `port.rs`: `external_editors` e `open_with` come gli altri metodi
  (all'app se è aperta, al `Host` locale se no, righe 133-240): così «Già
  aperta» lo sa l'app, che ha avviato i programmi.
- `tools.rs`, tre strumenti:
  - `fub_external_editors { doc }`: `check_read(doc)`, poi la lista;
  - `fub_open_with { doc, editor, page?, apply }`: senza `apply` dice che
    cosa farebbe (l'app, se è installata, `forwarded` o `new_process`) senza
    avviare niente; con `apply: true` vuole `check_write(doc)` (D-4) e poi
    `open_with`;
  - `fub_preview { doc, size? }`: `check_read(doc)`, poi `Call::InvokeCommand`
    di `craft.preview` con `render: false` (mai la CLI); il risultato porta
    un contenuto `{"type":"image","data":…,"mimeType":"image/png"}` quando
    c'è l'immagine, e un contenuto di testo con `info` e `origin`. Oggi ogni
    risultato è testo (riga 247): il ramo per l'immagine è nuovo.
- `tests/mcp.rs`: i tre strumenti con un vault di prova: la lista; la prova
  senza `apply`; `apply` fuori dalle radici di scrittura rifiutato; un
  `.figcraft` con anteprima dà il contenuto immagine; un `.vectorcraft` senza
  dà solo il testo con `origin: "none"` e nessun processo avviato.
- `mcp-server.md`: i tre strumenti, le radici, perché `fub_preview` non avvia
  niente.
Casi limite: `doc` fuori dalle radici di lettura; `editor` sconosciuto;
`fub.craft` spento (la lista vuota, `fub_preview` dice che il comando non
c'è); un'anteprima di 8 MiB (passa, ed è il tetto); la CLI di Fub senza
l'app aperta (`running` sempre `false`).
Fatto quando: `cargo test -p fub-cli --test mcp` e i test di `control.rs`
(`cargo test -p fub-host --lib control`) passano.
Prova: scripts/check.sh --rapido; cargo test -p fub-cli --test mcp
Stato: [ ] da fare

## T14 · La scheda Craft e XMP

Perché: è ciò che si vede aprendo un file Craft o un XMP: l'anteprima, i
dati, il pulsante per farla fare all'app (sezione «Che cosa vede chi usa
Fub»).
Tocca: `apps/client/src/editors/craft/index.ts` (nuovo),
`apps/client/src/editors/craft/surface.ts` (nuovo),
`apps/client/src/editors/craft/xmp-view.ts` (nuovo),
`apps/client/src/editors/craft/craft.test.ts` (nuovo),
`apps/client/src/state/craft-previews.ts` (nuovo),
`apps/client/src/state/craft-previews.test.ts` (nuovo),
`apps/client/src/editors/core/bootstrap.ts`, `apps/client/src/ui/format-kind.ts`,
`apps/client/src/ui/format-kind.test.ts`, `apps/client/src/ui/icons.ts`,
`apps/client/src/ui/icons.test.ts`, `apps/client/src/i18n/catalog.ts`,
`apps/client/src/theme/scrittoio/skin/media.css`,
`apps/client/src/theme/scrittoio/anatomia/media.ts`,
`apps/client/src/host/fake.ts`, `crates/fub-features/src/componenti.rs`
(`.ui(&["editors/craft"])` sulla riga `fub.craft`),
`docs/product/craft-files.md` (sezione «La scheda»).
Non toccare: `apps/client/src/editors/media/image-view.ts` (si usa com'è);
`apps/client/src/editors/text/` e `state/preview.ts` (T15);
`apps/client/src/panels/` (T16, T17); `apps/client/src/host/craft.ts` (il
contratto è di T1: se manca un campo, si torna a T1, non si cambia qui); la
mappa delle tinte del kit (nessun ruolo nuovo).
Dipende da: T1, T6
Cosa fare:
- `state/craft-previews.ts`, sul modello di `state/link-cards.ts`:
  `previewOf(doc, size, { render })` chiede `craft.preview` con
  `api.invokeCommand("craft.preview", { doc, size, render }, …,
  ...vaultArg(vault))`, legge l'effetto con `readCraftPreview` (T1), tiene
  una risposta per `doc`, misura e revisione, ascolta con `onAnyEvent` i
  `job_done` di `craft.render` e avvisa chi aspetta; dimentica tutto alla
  chiusura del vault. Una sola domanda in volo per chiave.
- `editors/craft/surface.ts`: la superficie in sola lettura (nessuna
  modalità di modifica, `setReadOnly` che non cambia niente):
  - chiede `large`; con l'immagine fa `decodeImage({ handle, id: doc, len,
    mime: "image/png", kind: "image", revision }, bytes)` e
    `mountImageView(image, alt, life)` (`editors/media/image-view.ts`, righe
    125 e 210): lo zoom e la barra sono quelli di una foto;
  - sotto, la riga dei dati: «Disegno di VectorCraft» (o «Immagine di
    PhotoCraft», «Progetto di FigCraft»), la versione del formato se c'è, il
    peso;
  - senza immagine il riquadro col nome e l'app; con `render` il pulsante
    «Crea l'anteprima con {app}»; all'apertura della scheda chiede una volta
    con `render: true` se `render` c'è (D-1); con `queued` «Preparo
    l'anteprima…»; con un file oltre 64 MiB «File troppo grande per
    l'anteprima».
- `editors/craft/xmp-view.ts`: il voto in stelle (una lettura per lo schermo
  «3 stelle su 5», «Scartata» per -1), l'etichetta col suo colore (Red,
  Yellow, Green, Blue, Purple come le scrive LightCraft; un'altra etichetta
  senza colore), la scelta, le parole chiave come i tag della nota (un clic
  cerca `tag:`), la foto (un clic la apre), le copie `-Edit.psd`, e la riga
  fissa su ⌘S e sulla scrittura automatica (D-5).
- `editors/craft/index.ts` esporta la registrazione; `bootstrap.ts` la
  registra come la famiglia `grid` (riga 326): `owner: "fub.craft"`, una
  famiglia `craft`, i profili `craft` e `xmp`, `formats: {
  "craft-vectorcraft": "craft", "craft-photocraft": "craft",
  "craft-figcraft": "craft", "craft-xmp": "xmp" }` (le chiavi sono gli id dei
  formati: `editors/core/registry.ts` riga 648). Il modulo si carica con un
  `import()`, come la barra della griglia.
- `ui/format-kind.ts`: la specie nuova `photo` (`FormatKind`,
  `FORMAT_ICON` → `format-photo`, `FORMAT_NAME` → `format.kind.photo`);
  `vectorcraft` → `drawing` con la sigla VECTORCRAFT, `figcraft` → `drawing`
  con FIGCRAFT, `pcraft` → `photo` con PHOTOCRAFT, `xmp` → `photo` con XMP.
  `ui/icons.ts`: `format-photo` (una fotografia, nel tratto delle altre
  `format-*`); `icons.test.ts` lo sa.
- `media.css` e `anatomia/media.ts`: il riquadro senza anteprima, la riga
  dei dati, le stelle e l'etichetta, con i ruoli del tema che ci sono (niente
  colori scritti a mano: le cinque etichette usano i ruoli dei colori dei
  tag, se ci sono, o i loro nomi come testo).
- `catalog.ts`: tutte le frasi qui sopra, in tutte le lingue del catalogo,
  più quelle della figura che usa T15 (`craft.figure.no_preview`,
  `craft.figure.alt`).
- `host/fake.ts`: la risposta a `craft.preview` (in `invokeCommand`, riga
  1475) con un'opzione per i test e per il banco: con immagine, senza, con
  `render`, con `queued` e il `job_done` dopo.
- `componenti.rs`: `.ui(&["editors/craft"])` sulla riga di `fub.craft`
  (`ogni_ui_e_una_cartella_del_client` in `crates/fub-features/tests/componenti.rs`
  lo vuole adesso che la cartella c'è).
- `craft.test.ts` e `craft-previews.test.ts`: la superficie con ogni forma
  della risposta, il pulsante che chiede `render: true` una volta sola, il
  `job_done` che porta l'immagine, la vista XMP con ogni campo assente.
- Le foto dal banco (skill `banco`): la scheda di un `.vectorcraft` con
  anteprima, senza anteprima col pulsante, «Preparo l'anteprima…», un XMP
  completo; in chiaro e in scuro.
- «La scheda» in `craft-files.md`.
Dal prototipo: nessun prototipo; dalla tabella «Dal prototipo» le righe
di T14 (l'icona e la sigla, la scheda di un file Craft, la scheda di un XMP,
l'aspetto delle due schede, i testi), fatte con la vista delle immagini, i
tag della nota e la riga dei dati che le schede dei media hanno già.
Casi limite: un'immagine 1×1 e una 8000×8000; una `revision` che cambia
mentre la scheda è aperta (si richiede e si ridisegna); la risposta che
arriva dopo che la scheda è chiusa (si scarta, la `Lifetime` lo garantisce);
un `job_done` di un altro documento; `fub.craft` spento (il formato non ha
superficie e si apre con la vista dei file senza superficie, come oggi); un
XMP con 500 parole chiave (si vanno a capo, niente scorrimento orizzontale);
il nome di un'app che il catalogo non ha (si mostra com'è).
Fatto quando: `cd apps/client && npx vitest run src/editors/craft
src/state/craft-previews.test.ts src/ui/format-kind.test.ts
src/ui/icons.test.ts` passa; `cargo test -p fub-features --test componenti`
e `cargo test -p fub-host --test componenti` passano; le foto del banco
mostrano le quattro schede.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/craft src/state/craft-previews.test.ts
Stato: [ ] da fare

## T15 · Le figure e l'anteprima al passaggio

Perché: `![[logo.vectorcraft]]` in una nota e il passaggio del puntatore su
un link a un file Craft devono mostrare l'anteprima, senza mai avviare l'app.
Tocca: `apps/client/src/editors/craft/figure.ts` (nuovo),
`apps/client/src/editors/craft/figure.test.ts` (nuovo),
`apps/client/src/editors/text/profiles/markdown/mount.ts`,
`apps/client/src/editors/text/profiles/markdown/media.test.ts`,
`apps/client/src/state/preview.ts`, `apps/client/src/state/preview.dom.test.ts`,
`docs/product/craft-files.md` (sezione «Nelle note»).
Non toccare: `apps/client/src/i18n/catalog.ts` (le frasi le ha messe T14);
`apps/client/src/panels/` e `ui/menu-cases.ts` (T16, in parallelo);
`editors/craft/surface.ts` e `xmp-view.ts` (T14); il segnaposto dei disegni
(`scenePlaceholder`, `showEmbeddedDrawing`), che resta com'è.
Dipende da: T14
Cosa fare:
- `figure.ts`: `craftPlaceholder(html: string): { doc, app, name } | null`,
  sul modello di `scenePlaceholder` (`markdown/media.ts`, riga 184): legge la
  `figure.fub-craft` con `data-embed-kind="craft"` (o `craft-xmp`) che dà il
  provider (T1); `showEmbeddedCraft(container, slot, placeholder, life)`, sul
  modello di `showEmbeddedDrawing` (riga 326): chiede `small` con `render:
  false` a `state/craft-previews.ts`; con l'immagine un `<img>` (un URL
  `blob:` liberato dalla `Lifetime`) con la didascalia del nome; senza, il
  riquadro col nome e l'app. Un clic apre il file nella sua scheda.
- `mount.ts`, accanto al ramo dei disegni (riga 474): se `craftPlaceholder`
  riconosce `content.html` e il `doc` coincide, `showEmbeddedCraft` e
  `return`. Se `![[x.vectorcraft]]` non arriva a quel ramo (per esempio
  perché un'altra via lo prende prima), il coder segue il codice e lo dice.
- `state/preview.ts`: la finestrella al passaggio riconosce la stessa figura
  e mostra `showEmbeddedCraft` invece dell'HTML.
- I test: `figure.test.ts` (la figura con e senza immagine, un HTML che non
  è una figura Craft, un `data-embed-doc` diverso dal documento, l'escape del
  nome); `media.test.ts` (la nota con `![[logo.vectorcraft]]` passa da
  `showEmbeddedCraft`); `preview.dom.test.ts` (il passaggio su
  `[[logo.vectorcraft]]`). In nessuno dei tre l'host finto riceve
  `render: true`.
- «Nelle note» in `craft-files.md`.
Dal prototipo: nessun prototipo; le righe di T15 (la figura nella nota,
l'anteprima al passaggio), fatte come la figura dei disegni.
Casi limite: la stessa figura dieci volte nella stessa nota (una domanda
sola); una figura dentro un embed dentro un embed; un XMP incorporato (il
riquadro coi dati principali, senza immagine); la nota chiusa prima della
risposta; un file Craft che non esiste più (resta il riquadro
«non risolto» che c'è già); `fub.craft` spento (il provider dà la figura, la
domanda fallisce: resta il riquadro col nome).
Fatto quando: `cd apps/client && npx vitest run src/editors/craft/figure.test.ts
src/editors/text/profiles/markdown/media.test.ts src/state/preview.dom.test.ts`
passa; una foto del banco con una nota che incorpora un `.figcraft`.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/craft/figure.test.ts src/state/preview.dom.test.ts
Stato: [ ] da fare

## T16 · Il sottomenu «Apri con un'altra app»

Perché: la voce di oggi conosce solo l'app predefinita del sistema; con le
app Craft installate diventa un sottomenu (D-6).
Tocca: `apps/client/src/panels/open-with.ts` (nuovo),
`apps/client/src/panels/open-with.test.ts` (nuovo),
`apps/client/src/state/external-editors.ts` (nuovo),
`apps/client/src/state/external-editors.test.ts` (nuovo),
`apps/client/src/panels/explorer.ts`,
`apps/client/src/editors/media/media-surface.ts`,
`apps/client/src/ui/menu-cases.ts`, `apps/client/src/i18n/catalog.ts`,
`docs/product/editor-menus.md`.
Non toccare: `apps/client/src/ui/menu.ts` (i sottomenu a cascata ci sono
già: `items` può essere una funzione asincrona); `apps/client/src/host/ipc.ts`
(T12); `editors/craft/` e `state/preview.ts` (T15, in parallelo);
`state/document-controller.ts` e `panels/document.ts` (T17).
Dipende da: T12, T14
Cosa fare:
- `state/external-editors.ts`: all'apertura del vault chiede
  `externalEditors(null, vault)` (le sette) e tiene se ce n'è almeno una
  installata; la richiede quando cambia `craft.editor-paths` o il componente
  `fub.craft`; un rifiuto del comando (un'app vecchia) vale «nessuna».
- `panels/open-with.ts`: `openWithEntry(doc, deps): MenuItem`. Senza app
  Craft installate è la voce di oggi (`explorer.open_system`, che chiama
  `handToSystem`). Con almeno una è una voce con `submenu: true` e `items:
  async () => …`: per prima «L'app predefinita del sistema»
  (`open_with.system`), poi le app che `externalEditors(doc)` dà per quel
  file, nell'ordine della tabella; una non installata ha `enabled: false` e
  `hint` «Non installata» (`open_with.not_installed`), una avviata da Fub
  «Già aperta» (`open_with.running`). Un clic chiama `openWith` e, se fallisce,
  mostra l'errore con la frase che arriva dall'host.
- `explorer.ts`: `noteMenu` (riga 978) e `fileMenu` (riga 1011) usano
  `openWithEntry` al posto della voce `explorer.open_system` (righe 999 e
  1022): il numero delle voci non cambia (nove al massimo, `menu-budget.test.ts`).
- `media-surface.ts` (riga 285): la voce `media.open_external` della barra
  diventa `openWithEntry` (con `deps.openExternal` come app di sistema).
- `catalog.ts`: `open_with.system` «L'app predefinita del sistema» / «The
  system's default app», `open_with.not_installed` «Non installata» / «Not
  installed», `open_with.running` «Già aperta» / «Already open»;
  `media.open_external` (righe 1756 e 4727) diventa «Apri con un'altra app» /
  «Open with another app», come `explorer.open_system` (D-6). Le altre
  lingue del catalogo come vuole il catalogo.
- `menu-cases.ts`: il caso del menu di un file con il sottomenu (per i test
  del bilancio e delle foto dei menu).
- I test: `open-with.test.ts` (senza app installate la voce di oggi; con
  PhotoCraft installata il sottomenu di un `.pcraft` con l'app di sistema
  prima; VectorCraft non installata spenta; «Già aperta»; un `.md` col
  sottomenu che ha solo l'app di sistema; il clic che chiama `openWith` con
  l'id giusto; l'errore mostrato); `external-editors.test.ts` (il rifiuto,
  il cambio d'impostazione).
- `editor-menus.md`: il sottomenu, le sue voci, quando compare.
Dal prototipo: nessun prototipo; la riga di T16 (il sottomenu), fatta col
sottomenu a cascata di `ui/menu.ts`, la voce spenta e il suo `hint`.
Casi limite: il menu aperto con il dito (il sottomenu si apre al posto del
menu, con la voce per tornare: lo fa `menu.ts`); la risposta di
`externalEditors(doc)` che tarda (il sottomenu mostra la sua attesa, come
gli altri asincroni); il vault chiuso a menu aperto; un file senza
estensione; un nome di app lungo; l'app che esce mentre il menu è aperto
(«Già aperta» resta fino alla prossima apertura del menu).
Fatto quando: `cd apps/client && npx vitest run src/panels/open-with.test.ts
src/state/external-editors.test.ts src/ui/menu-budget.test.ts src/ui/menu.test.ts`
passa; una foto del banco del sottomenu aperto su un `.pcraft`.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/panels/open-with.test.ts src/ui/menu-budget.test.ts
Stato: [ ] da fare

## T17 · Il prestito

Perché: aprire in GridCraft o in WordCraft un file aperto in Fub non deve
perdere modifiche: Fub salva prima, poi non scrive più finché non lo
riprendi.
Tocca: `apps/client/src/state/lend.ts` (nuovo), `apps/client/src/state/lend.test.ts`
(nuovo), `apps/client/src/state/document-controller.ts`,
`apps/client/src/panels/document.ts`, `apps/client/src/panels/open-with.ts`,
`apps/client/src/i18n/catalog.ts`, `docs/product/craft-files.md` (sezione
«Il prestito»).
Non toccare: `apps/client/src/state/document-session.ts` (salvataggio,
bozze e ricarica restano come sono: il prestito usa `flushPendingSave` e il
sola lettura che ci sono); l'host (il prestito è della shell: l'host non sa
che un file è in prestito); `ui/menu.ts`.
Dipende da: T16
Cosa fare:
- `state/lend.ts`: `lend(doc, app)`, `unlend(doc)`, `lentTo(doc): string |
  null`, `onLendChanged(listener)`; dimentica tutto alla chiusura del vault.
- `panels/open-with.ts`: scegliendo un'app Craft per un documento che ha una
  scheda aperta e modificabile, prima `flushPendingSave()`; se il documento è
  fra quelli il cui salvataggio è fallito, niente «Apri con» e niente
  prestito, e l'avviso «Non ho potuto salvare: {doc} non si apre in {app}»;
  altrimenti `openWith`, e solo se riesce `lend(doc, app)`.
- `document-controller.ts`: il sola lettura di una scheda è «cancellazione
  in sospeso, o chiusura in corso, o in prestito»: `setReadOnlyForDocument`
  (riga 1955), `freezeDocumentSurfaces` e il montaggio di una scheda nuova
  tengono conto di `lentTo(doc)`; `onLendChanged` ridisegna le schede e le
  loro righe; chiudere l'ultima scheda del documento chiama `unlend`.
- `panels/document.ts`: in `noticeLinesOf` (riga 1363) la riga «Aperto in
  {app}» (tono informativo) con l'azione «Riprendi qui», che chiama `unlend`.
- `catalog.ts`: `lend.notice` «Aperto in {app}. Fub non lo modifica finché
  non lo riprendi.», `lend.resume` «Riprendi qui», `lend.save_failed`, in
  tutte le lingue.
- `lend.test.ts`, con l'host finto: un `.docx` aperto e con una modifica
  in coda, «Apri con WordCraft»: il salvataggio parte prima di
  `openWith`; la scheda passa in sola lettura con la riga; un cambio sul
  disco (l'host finto lo annuncia) ricarica la scheda e non c'è conflitto;
  «Riprendi qui» toglie il sola lettura; il salvataggio fallito non apre
  l'app; chiudere la scheda finisce il prestito; la cancellazione in
  sospeso e il prestito insieme (togliere uno non toglie l'altro).
- «Il prestito» in `craft-files.md`: che cosa fa, come finisce, che Fub non
  sa quando l'app si chiude (A10).
Dal prototipo: nessun prototipo; la riga di T17 («Aperto in GridCraft ·
Riprendi qui»), fatta con le righe d'avviso che `noticeLinesOf` disegna già.
Casi limite: lo stesso documento in due riquadri; il prestito di un file che
Fub mostra già in sola lettura (`.xlsx`: la riga c'è, il resto non cambia);
«Apri con» l'app di sistema (nessun prestito: solo le app Craft); il
documento rinominato mentre è in prestito (il prestito segue il nome nuovo,
con l'evento di rinomina che la shell ha); il vault chiuso; la scheda
riaperta dopo «Riprendi qui».
Fatto quando: `cd apps/client && npx vitest run src/state/lend.test.ts
src/panels/open-with.test.ts src/panels/trash.test.ts` passa (`trash.test.ts`
prova la cancellazione in sospeso, l'altro motivo del sola lettura); una
foto del banco della riga «Aperto in WordCraft · Riprendi qui».
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/state/lend.test.ts
Stato: [ ] da fare

## Non verificato stanotte

Il codice delle app Craft non è nel repo e nessuna è installata su questa
macchina: queste cose il piano le prende dal passo 12c e le mette dietro un
punto solo, così che cambiarle sia una riga.

- I nomi dei campi per titolo, testo, versione e file collegati (A3: un
  elenco di nomi in `container.rs` e `linked.rs`).
- Gli argomenti veri delle CLI (`convert`, `render`, `--scale`, `-o`: la
  tabella di T11).
- Il formato dell'autenticazione dei canali, le porte, le variabili
  d'ambiente oltre `GRIDCRAFT_CONTROL_TOKEN` (`auth_request`, T9).
- Se l'istanza singola di PhotoCraft e PdfCraft porta davvero il file nella
  finestra aperta (lo prova l'utente).
- Il formato di `installed.json` del launcher (T7 lo legge con tolleranza).
- I percorsi su macOS e Windows (scritti, provati solo come regole sui
  percorsi; nessun avvio provato fuori da Linux).
- Se un'app Flatpak vede i file del vault (dipende dai permessi del
  Flatpak; se non li vede, «Apri con» la avvia e l'app non trova il file).
- I namespace veri degli XMP di LightCraft (`lc:`) e il `.pcraft` a
  cartella.
