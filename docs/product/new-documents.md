# Documenti e fogli nuovi

> **Per chi:** chi crea un documento di Word o una cartella di Excel dal vault,
> e chi chiama i due comandi da uno script o dalla palette.
> **Risultato:** sapere come nascono un `.docx` e un `.xlsx` vuoti, come si
> chiamano e quando un comando rifiuta di crearli.

«Nuovo documento» (`document.create`, con la feature `rich`) e «Nuovo foglio»
(`sheet.create`, con la feature `xlsx`) fanno nascere un
[documento di Word](word-documents.md) o una cartella di Excel vuoti e li
aprono. Hanno gli argomenti `name` e `folder` e le regole dei nomi di «Nuovo
disegno», descritte in [Vault e file](vault-and-files.md):

- senza nome si chiamano «Documento senza titolo» e «Foglio senza titolo»
  («Untitled document» e «Untitled spreadsheet» in inglese), e se quel nome è
  preso « 1», « 2», … con la convenzione dei nomi liberi;
- un nome senza estensione riceve `.docx` o `.xlsx`; un nome con un'altra
  estensione, anche di un formato vicino come `.odt` o `.xlsm`, è un errore;
- un nome semplice nasce nella cartella `folder`, se è data, altrimenti nella
  radice; un path esplicito conserva la propria cartella;
- un nome occupato è un errore e mai una sovrascrittura, e prima di scrivere
  il nome passa la regola dei nomi nuovi.

Il `.docx` lo scrive il codec dei documenti da un documento senza paragrafi.
Il `.xlsx` lo scrive GridCraft, con un foglio solo che si chiama come lo
chiama Excel nella lingua di chi lo crea: «Foglio1», «Sheet1». Tutti e due i
file si rileggono col loro codec prima di entrare nel vault, e si scrivono
soltanto se il nome è ancora libero, con la scrittura atomica del kernel.

Una cartella in cui il sistema non lascia creare file risponde con l'errore di
I/O del kernel, e non nasce niente. La prova a vuoto nomina il file senza
scriverlo; l'annullamento lo manda nel cestino.

I comandi appartengono ai bundle `fub.rich` e `fub.xlsx`: spento il bundle, o
compilato l'host senza la feature, non sono dichiarati.

## Dove si trova

- `crates/fub-host/src/new_file.rs`: i nomi, la prova a vuoto e la scrittura.
- `crates/fub-host/src/rich.rs` e `crates/fub-host/src/workbook.rs`: i due
  comandi, le loro frasi e i byte vuoti.
- `crates/fub-format-xlsx/src/lib.rs`: la cartella vuota scritta da GridCraft.
