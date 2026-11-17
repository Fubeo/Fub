# Corpus senza perdite della pre-alpha

I file su cui gira `cargo test -p fub-host --test prealpha_corpus` (PA T13):
per ogni formato della pre-alpha, aprire e chiudere come la shell non cambia
un byte, una revisione vecchia dà il conflitto tipizzato, la sola lettura
rifiuta con la sua specie e il file resta, e una modifica piccola a un
formato di testo cambia i byte solo dove si è modificato.

## Regole

- Ogni file è una **copia** di un file di un corpus che c'è già, o è
  costruito da quello: i corpus d'origine restano dove sono.
- Niente file di una macchina o di un vault vero, niente dati personali.
- I file sono byte: il `.gitattributes` di questa cartella li tiene fuori
  dalla normalizzazione dei fine riga, perché CRLF e BOM ci sono apposta.
- Un file in più si aggiunge alla tabella qui sotto e a `CORPUS` nel test:
  `il_corpus_è_tutto_qui_e_ha_la_provenienza` controlla che la cartella non
  abbia altro e che questa pagina nomini ogni file.

## Da dove viene ogni file

| File | Da dove viene | Che cosa esercita |
|---|---|---|
| `Markdown/Alpha CRLF.md` | `tests/fixtures/sample-vault/Progetti/Alpha.md`, coi fine riga portati a CRLF | frontmatter e CRLF |
| `Markdown/Nota B con BOM.md` | `tests/fixtures/sample-vault/Nota B.md`, col BOM UTF-8 davanti | frontmatter, BOM e LF |
| `Markdown/Indice è più già.md` | `tests/fixtures/sample-vault/index.md` con in fondo la riga «Fuori dal piano base: la mappa 🗺️, la chiave di violino 𝄞 e il gatto 🐈.», poi BOM e CRLF | caratteri fuori dal piano base, BOM, CRLF, frontmatter, un nome con spazi e accenti |
| `Documenti/Senza perdite.docx` | copia di `crates/fub-format-rich/tests/corpus/docx/senza-perdite.docx` | un docx modificabile senza perdite |
| `Documenti/Protetto.docx` | copia di `crates/fub-format-rich/tests/corpus/docx/protetto.docx` | la sola lettura per `documentProtection` |
| `Fogli/Conti con formule.xlsx` | costruito come `Package` di `crates/fub-format-xlsx/tests/common/mod.rs` (stessi XML, stili `STYLES`, un foglio `Foglio1`), col foglio `PLAIN` di `crates/fub-format-xlsx/tests/corpus.rs` più una riga 3 con `SUM(A1,B1)` e `B1/A1` | un xlsx con formule |
| `Disegni/Mappa del quartiere.svg` | copia di `crates/fub-format-svg/tests/fixtures/foreign-crlf-bom.svg`, ricostruito sul formato di Inkscape | un SVG di un altro programma, con BOM e CRLF |
| `Lavagne/Città con BOM.canvas` | `crates/fub-format-canvas/tests/fixtures/unicode_escape_unknown.canvas`, coi fine riga portati a CRLF e il BOM UTF-8 davanti | un `.canvas` di Obsidian con CRLF, BOM, escape `\u` e campi sconosciuti |
| `PDF/Scena.pdf` | copia di `crates/fub-features/tests/baselines/draw/scena.pdf` | un PDF letto come risorsa |

Le licenze sono quelle dei corpus d'origine: `MIT OR Apache-2.0`, come Fub.

## Le modifiche dei documenti e dei fogli

Qui un `.docx` e un `.xlsx` si aprono, si chiudono e si scrivono da una
revisione vecchia o in sola lettura; le loro modifiche hanno già i test nei
crate dei formati:

- `.docx`: `crates/fub-format-rich/tests/corpus.rs` (le modifiche standard
  E0–E7 di ogni file del corpus, con i risultati attesi in `expected/`);
- `.xlsx`: `crates/fub-format-xlsx/tests/corpus.rs` (salvataggio
  deterministico, punto fisso e innesto che non tocca le altre parti) e,
  attraverso l'host, `crates/fub-host/tests/xlsx_workbooks.rs`.
