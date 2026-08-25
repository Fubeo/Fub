# Le note Markdown

Il provider ufficiale riconosce file `.md` e `.markdown` come testo UTF-8. Usa
Comrak per il Markdown e aggiunge le convenzioni dichiarate dal descrittore
“Markdown (Obsidian)”.

## Sintassi supportate dal provider

- frontmatter YAML;
- wikilink;
- tag;
- callout;
- embed;
- note a piè di pagina;
- liste di definizione.

Altre forme possono essere innestate da regole sintattiche registrate nel
vault. La matematica non è una capacità nativa attiva del provider corrente: la
sorgente matematica resta visibile finché il rendering dedicato non viene
riaperto come lavoro.

## Esempio

```markdown
---
titolo: Algoritmi di ordinamento
tags:
  - informatica
  - algoritmi
---

# Algoritmi di ordinamento

Vedi [[QuickSort]] e [[MergeSort|l'algoritmo MergeSort]].

> [!NOTE]
> Il costo dipende dai dati e dall'implementazione.
```

## Portabilità e fedeltà

Le note restano normali file di testo e possono essere versionate, sincronizzate
o aperte con altri editor. Questo non equivale a una garanzia di identità byte
per byte dopo ogni operazione.

Il parser conserva modello semantico e span della sorgente. Le modifiche a un
file esistente devono preferire patch mirate per non riscrivere parti estranee.
La serializzazione completa, usata per documenti o frammenti nuovi, genera
Markdown canonico e può cambiare dettagli non rappresentati nel modello, come
alcune spaziature, indentazioni o scelte equivalenti di delimitatore.

Un nodo che il serializer non sa rappresentare produce un errore invece di
essere eliminato in silenzio.

Dettagli tecnici:

- [`../../crates/fub-format-markdown/src/parse.rs`](../../crates/fub-format-markdown/src/parse.rs)
- [`../../crates/fub-format-markdown/src/serialize.rs`](../../crates/fub-format-markdown/src/serialize.rs)
- [`../02-componenti/05-fub-format-markdown.md`](../02-componenti/05-fub-format-markdown.md)
