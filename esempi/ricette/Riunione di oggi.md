# Riunione di oggi

Crea nella cartella `Riunioni` la nota della riunione di oggi, dal template
`Riunione` della cartella dei template, col nome «Riunione» e la data. Se il
nome è già preso, Fub sceglie il primo libero («Riunione 2026-11-18 1»).

Serve un template che si chiami `Riunione`: senza, la prova lo dice e la
ricetta non parte.

```fub-recipe
fub-recipe: 1
id: riunione-di-oggi
title: Riunione di oggi
description: Crea la nota della riunione di oggi dal template Riunione.
steps:
  - run: note.from_template
    args:
      template: Riunione
      name: "Riunione {{date}}"
      folder: Riunioni
```
