# I file dell'utente: Note, Formato e Convenzioni

Per chi è: studenti e sviluppatori che vogliono comprendere come sono strutturati i file `.md` all'interno di un vault Fub.

---

## Struttura di una nota tipica

Un file di note in Fub è un file di testo normale con estensione `.md` codificato in **UTF-8**. Segue lo standard GitHub Flavored Markdown (GFM) arricchito con le convenzioni più diffuse (come quelle di Obsidian).

```markdown
---
titolo: Algoritmi di Ordinamento
tag:
  - informatica
  - algoritmi
data_creazione: 2026-08-21
---

# Algoritmi di Ordinamento

Gli algoritmi principali sono:
- [[QuickSort]] — efficiente in media \(O(n \log n)\).
- [[MergeSort]] — stabile e ottimo per liste collegate.

Vedi anche la nota su #complessità.
```

---

## Elementi speciali supportati

1. **Frontmatter YAML**:
   - È il blocco all'inizio del file compreso tra due righe con tre trattini `---`.
   - Contiene metadati strutturati (chiave: valore), come tag, data, autore, o proprietà personalizzate.
2. **Wikilink (`[[NomeNota]]` o `[[NomeNota|Testo Personalizzato]]`)**:
   - Creano collegamenti ipertestuali rapidi tra note all'interno dello stesso vault senza dover specificare percorsi assoluti.
3. **Tag (`#tag` o `#categoria/sottocategoria`)**:
   - Etichette che categorizzano la nota e consentono ricerche tematiche istantanee.
4. **Embed e Allegati (`![[diagramma.png]]` o `![[AltraNota]]`)**:
   - Includono immagini, file multimediali o il testo di un'altra nota direttamente nella pagina visualizzata.

---

## Garanzia di portabilità

Fub rispetta scrupolosamente i file dell'utente:
- Quando Fub modifica o risalva una nota, **non riscrive né cancella formattazioni personalizzate o commenti non riconosciuti**.
- Se decidi di spostare le tue note su un altro programma o sincronizzarle con Git, i file rimangono identici e puliti.

---

## Se vuoi il dettaglio

- Guarda [`crates/fub-format-markdown/src/parse.rs`](../../crates/fub-format-markdown/src/parse.rs) per vedere come il parser analizza i wikilink e il frontmatter.
- Guarda [`docs/05-disco/02-cartella-fub.md`](./02-cartella-fub.md) per scoprire come Fub gestisce i propri file ausiliari.
