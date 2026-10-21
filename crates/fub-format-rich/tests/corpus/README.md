# Corpus dei documenti di videoscrittura

I file su cui gira il banco `tests/corpus.rs`: apertura, esportazioni e
modifiche standard (E0–E5) di ogni file, confrontate con i risultati attesi in
`expected/`. Il banco gira dentro `cargo test --workspace`.

## Regole

- Ogni file è creato apposta per il corpus, senza dati personali: autori e
  testi di prova.
- Licenza `CC0-1.0` oppure `MIT OR Apache-2.0`, come Fub. Nessun file
  scaricato dal web con licenza ignota.
- Fino a 256 KB per file e 15 MB in tutto, senza Git LFS. Il test
  `il_manifesto_descrive_ogni_file_e_nient_altro` lo controlla.
- Ogni file ha una voce in `MANIFEST.toml`: origine, programma che l'ha
  prodotto, licenza, riga della matrice, cosa esercita e cosa ci si aspetta.
- I file sono byte: `.gitattributes` li tiene fuori dalla normalizzazione
  dei fine riga.

## I risultati attesi

`expected/<file>.json` riassume l'esito di oggi: motivo di sola lettura,
impronta della proiezione, differenze del controllo dei byte
(`preservation::report`), modello dell'indice, avvisi delle esportazioni e
risultato di ogni modifica. Dopo un salvataggio il banco riapre i byte e
confronta la proiezione con quella voluta, a meno dei dati opachi e dei
suggerimenti di resa (`reopened`).

Quando un cambiamento è voluto, per esempio in una PR che aggiorna WordCraft:

```text
UPDATE_CORPUS=1 cargo test -p fub-format-rich --test corpus
```

Il diff di `expected/` è il resoconto di ciò che è cambiato. Chi rivede la PR
ne spiega ogni riga.

Altri due test usano gli stessi file: `le_mutazioni_non_fanno_panic` (tredici
mutazioni deterministiche per file, senza panic ed entro un tempo) e `tempi`
(ignorato, da lanciare con `--release -- --ignored --nocapture tempi`).

## Rifare i file

I file di oggi sono costruiti a mano dalle specifiche da
`examples/genera_corpus.rs`, che li riscrive identici:

```text
cargo run -p fub-format-rich --example genera_corpus
```

## Righe della matrice ancora scoperte

Questo è il primo nucleo. Nessun file è prodotto dai programmi veri, perché
sulla macchina che l'ha costruito non c'erano Word, LibreOffice, Google Docs,
pandoc, python-docx o docx4j. Mancano quindi:

- documenti salvati da Word 365 su Windows e Mac, compresi SmartArt, grafici,
  oggetti OLE, gruppi di forme, font incorporati, glossario e protezione per
  moduli;
- `.docx` scritti da LibreOffice, Google Docs, Pages, pandoc, python-docx e
  docx4j, e un `altChunk` RTF;
- un `.docx` cifrato con una password;
- `.odt` con revisioni e stili salvati da LibreOffice;
- RTF di Word, WordPad e TextEdit;
- un `.doc` salvato da Word con stili e tabelle;
- una bomba di decompressione sopra i limiti, che non sta nei 256 KB.

Chi aggiunge uno di questi file lo scrive apposta, ne dichiara programma e
versione nel manifesto e rigenera i risultati attesi.
