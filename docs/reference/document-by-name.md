# Un documento scritto per nome

> **Ambito:** come un comando legge un parametro `ParamKind::Document` scritto
> a mano nel campo «Documento» della palette: chi vale, quando è un errore,
> quali comandi seguono la regola e quali restano sull'id.
> **Fonti autorevoli:** `crates/fub-abi/src/command.rs` (`document_named`,
> `Args::named_document`, `resolve_document_name`); per le feature
> `crates/fub-features/src/formats.rs`, per l'host
> `crates/fub-host/src/doc_names.rs`.

Il resto del canale fra la shell e l'host sta in
[Il contratto IPC](ipc-contract.md).

Un parametro `ParamKind::Document` porta l'id di un documento, ma il campo
della palette si compila anche a mano: chi scrive «Relazione» invece di
scegliere `Lavoro/Relazione.docx` dall'elenco intende quel documento. Il campo
passa il testo com'è; la regola sta nel core, in `fub_abi::command`
(`document_named`, e per i comandi `Args::named_document`):

1. un id che c'è è sé stesso, anche se il comando non lo accetta: il rifiuto,
   con la sua ragione, è del comando;
2. altrimenti vale il **solo** documento, fra quelli che il comando accetta,
   il cui nome, nome del file, percorso o percorso senza estensione è il testo,
   confrontati con `resolution_key` (NFC, senza maiuscole);
3. nessuno, o più di uno, è un errore `bad_args` con una frase del catalogo di
   chi possiede il comando: «Nessun documento che questo comando può usare si
   chiama «…»» o «Più documenti si chiamano «…»: …», con gli omonimi (i primi
   cinque). Il comando non sceglie mai fra omonimi.

Il filtro «documenti che il comando accetta» è del comando, che lo passa a
`Args::named_document`: una nota e una lavagna con lo stesso nome non rendono
ambiguo un comando della lavagna. Le feature lo dicono con
`formats::document_with` (una capacità del formato, come la prosa o il
frontmatter), `formats::document_named_by` (un formato preciso) o
`formats::any_document`; le frasi le aggiunge ai cataloghi
`formats::speaking`, e per l'host `doc_names`. Il kernel non risolve i nomi al
posto dei comandi: un `ParamSpec` non dichiara quali documenti accetta, e
indovinarlo darebbe omonimi ambigui dove non lo sono.

Leggono il campo così le note (`note.rename`, `note.duplicate`, `note.trash`,
`note.folder_page`, `note.subpage`, `note.task.toggle`, `note.block.move`,
`note.block.sync`), le proprietà, `base.view.*`, i comandi della lavagna,
`version.restore`, `heading.rename`, `note.insert_template`, `note.insert_datetime`, `note.merge`,
le due esportazioni, `craft.preview`, `craft.photo`, i comandi delle note
pubblicate e `trash.os`. Restano sull'id: `version.keep` (conserva il testo di
un documento che può non esserci più), `mention.link` (lo chiama il pannello
dei collegamenti con posizioni e revisione) e i comandi della sincronizzazione
(un documento che c'è solo sul server è un argomento giusto).
