# Archivia

Segna la data di oggi nella proprietà `archiviata` e sposta la nota nella
cartella `Archivio`, con lo stesso nome. Un solo «Annulla» rimette la nota dov'era
e toglie la proprietà.

```fub-recipe
fub-recipe: 1
id: archivia
title: Archivia
description: Segna la data e sposta la nota in Archivio.
surfaces: [slash]
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
