# Disegni, preferenze del motore

> **Per chi:** chi disegna nello spazio Completo e vuole cambiare come si
> comporta il motore del disegno (griglia, guide, passi della tastiera,
> esportazione e così via).
> **Risultato:** sapere dove si cambiano le preferenze del motore, quando
> valgono e cosa succede quando non si possono cambiare.

In **Impostazioni › Disegni**, in fondo al gruppo, il riquadro **«Motore del
disegno»** elenca le preferenze del motore del Disegno completo. C'è solo con
un vault aperto e il componente «Disegno completo» acceso; con il componente
spento il riquadro non c'è.

Il riquadro si apre a richiesta: solo allora arriva la parte che conosce le
preferenze, e un'Impostazioni aperta senza aprirlo non la carica.

- **Le categorie** sono quelle del motore («Generale», «Guide e griglia»,
  «Prestazioni»…), ognuna in un riquadro suo, con i titoletti dentro. Le
  parole sono quelle del disegno, in italiano e in inglese.
- **Ogni preferenza** ha il suo campo: una casella, un numero con la sua unità
  e i suoi limiti (le lunghezze in punti, `pt`), una scelta o un testo. Un
  campo si salva quando lo si cambia; un testo e un colore quando si esce dal
  campo. Un colore si scrive `#rrggbb`. Un valore che il motore non accetta lo
  dice e il campo torna al valore che vale.
- **«Ripristina»**, in fondo a ogni categoria, rimette le preferenze di quella
  categoria come di serie.
- **Le cartelle** del motore (caratteri, plug-in, recupero, modelli) non ci
  sono: in Fub sono del vault e del kernel, e il motore non tocca il disco.

Le preferenze cambiate valgono per i disegni **aperti da adesso**; un disegno
già aperto le prende quando lo si riapre. Alcune preferenze sono del motore e
in Fub non cambiano niente di visibile (per esempio quelle della scheda
grafica o della schermata iniziale): restano nell'elenco perché sono sue.

Le preferenze sono di questa macchina: l'impostazione `draw.motore` (feature
`draw`), un JSON con la sua versione, `{"v":1,"prefs":{"<chiave>":<valore>}}`,
con solo le preferenze cambiate. Un valore che non si legge vale come le
preferenze di serie; uno scritto da un Fub più nuovo vale per le preferenze
che si capiscono. In tutti e due i casi il riquadro lo dice, spegne i campi e
offre solo «Azzera le preferenze del motore», per non riscriverlo perdendo
ciò che non capisce; per un valore più nuovo chiede conferma.

Dove sta: [`docs/architecture/disegno-completo.md`](../architecture/disegno-completo.md#le-preferenze-del-motore).
