// La nota della prova del motore del PDF (ADR 0247): una nota come se ne
// scrivono, con ciò che il piano chiede di provare: titoli, una tabella, del
// codice, una formula (in linea e a blocco), un diagramma e un'immagine, una
// riga con due caratteri diversi, un link sottolineato. È lunga tre pagine
// A4, perché la prova passi anche dai tagli fra le pagine. L'immagine è la
// foto del vault del banco (`photo-fixture.ts`, con `?photo=senza`).

export const NOTA_TITOLO = "Relazione di prova";
export const NOTA_DOC = "Prove/Relazione di prova.md";

const PARAGRAFO =
  "Il motore scrive il PDF dagli elenchi che la vista misura: ogni lettera sta dove il browser l'ha messa, " +
  "con la crenatura e gli spazi del paragrafo giustificato o no, e il testo resta testo, che si seleziona e si cerca. " +
  "Così l'anteprima e il file coincidono, perché nascono dalla stessa misura.";

export const NOTA = `# ${NOTA_TITOLO}

Questa nota prova l'esportazione: **grassetto**, *corsivo*, ***tutti e due***, \`codice in linea\` nella stessa riga,
un [collegamento sottolineato](https://example.invalid/) e una formula in linea, $E = mc^2$, fra le parole.

## La tabella

| Voce | Quantità | Prezzo |
| :--- | ---: | ---: |
| Carta A4 | 12 | 4,50 € |
| Inchiostro nero | 3 | 21,00 € |
| Rilegatura | 1 | 8,90 € |

## Il codice

\`\`\`rust
fn somma(a: u32, b: u32) -> u32 {
    // La somma di due numeri.
    a + b
}
\`\`\`

## La formula

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3} \\qquad \\sqrt{a^2 + b^2}
$$

## Il diagramma

\`\`\`mermaid
graph LR
  A[Vista] --> B[Elenco]
  B --> C[Core]
  C --> D[PDF]
\`\`\`

## L'immagine

![[Foto/spiaggia.jpg]]

> Una citazione, col suo bordo a sinistra: il bordo è un riquadro, il testo è testo.

## Il resto

- Un elenco puntato, con una voce.
- Una seconda voce, un po' più lunga, che va a capo se la colonna è stretta come quella di una pagina A4.

1. Un elenco numerato.
2. La seconda voce.

${PARAGRAFO}

${PARAGRAFO}

${PARAGRAFO}

### Un titolo di terzo livello

${PARAGRAFO}

${PARAGRAFO}

${PARAGRAFO}

${PARAGRAFO}

${PARAGRAFO}

---

${PARAGRAFO}

${PARAGRAFO}

${PARAGRAFO}

${PARAGRAFO}
`;
