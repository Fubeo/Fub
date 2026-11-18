# Segna come letta

Mette la proprietà `letta` della nota a vero, così una base o una ricerca
`[letta:true]` la trova fra quelle già lette.

```fub-recipe
fub-recipe: 1
id: segna-come-letta
title: Segna come letta
description: Mette la proprietà letta a vero.
surfaces: [slash]
steps:
  - run: note.property.set
    args:
      doc: "{{doc}}"
      key: letta
      value: "true"
```
