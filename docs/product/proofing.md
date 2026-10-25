# Correttore

> **Per chi:** chi scrive nelle note e chi modifica il correttore.
> **Risultato:** sapere cosa segna il correttore, in quali lingue e dove vive.

Nelle note Markdown in scrittura (Sorgente e Live) le parole sconosciute hanno
un'ondina rossa e i dubbi di grammatica un'ondina arancione. Al passaggio del
puntatore, o con la tastiera dei segni di CodeMirror (Mod+Maiusc+M apre
l'elenco, F8 va al segno successivo), un riquadro dice cosa non va e offre:

- fino a quattro correzioni. Una correzione è una modifica come una battuta:
  entra nella cronologia del riquadro e si annulla con Mod+Z;
- «Aggiungi al dizionario» per una parola, che entra nel dizionario personale
  del vault;
- «Ignora», che vale fino alla chiusura del riquadro.

Il correttore legge soltanto la prosa: titoli, paragrafi, voci di elenco,
citazioni, celle di tabella e note. Salta il frontmatter, il codice, le
formule, l'HTML, gli indirizzi dei link, i wikilink, i tag e i commenti `%%`.
Una correzione si offre soltanto quando la parola sta tutta in un tratto di
testo semplice: un segno che attraversa il markup (`**`, `_`) si mostra ma non
si corregge. In sola lettura le correzioni non ci sono.

Nei documenti di videoscrittura il correttore segna allo stesso modo il testo
di ogni paragrafo, anche nelle celle; immagini, campi e note contano come
separatori.
Le correzioni, «Aggiungi al dizionario» e «Ignora» stanno nel menu contestuale
del segno, dal clic destro o dal tasto del menu contestuale. La lingua
dichiarata dal documento vale come il `lang` di una nota.

La lingua è quella dell'impostazione «Lingua del testo» (di serie quella
dell'interfaccia); una nota la cambia per sé con `lang` nel frontmatter. Le
lingue sono italiano, inglese, portoghese, polacco, ceco, croato, russo e
turco. L'inglese ha l'ortografia sempre, con la grafia della regione
dell'etichetta: britannica per `en-GB` e le regioni che scrivono come il Regno
Unito (`en-AU`, `en-IE`, …: «colour»), canadese per `en-CA`, americana per le
altre («color»). Le
altre lingue hanno l'ortografia quando sulla macchina c'è il dizionario
Hunspell della lingua (`it_IT`, `pt_BR`, …), per esempio quello di
LibreOffice o del pacchetto `hunspell-it`. Senza dizionario
restano le regole grammaticali della lingua: parole ripetute, spazi doppi,
punteggiatura e confusioni frequenti come «un pò» o «qual'è». Altre
impostazioni spengono la grammatica e fanno contare come corrette le parole in
maiuscolo o con cifre.
L'indonesiano non è fra le scelte dell'impostazione, ma una nota o un
documento che lo dichiara (`lang: id`) si corregge come le altre lingue, con
il dizionario `id_ID`.

Il correttore è il plugin ufficiale `fub.proof` («Proofing»). Spento dal
pannello dei componenti, la nota si scrive come prima e non ha segni. Il
controllo non attraversa il confine a ogni battuta: parte dopo una pausa,
chiede soltanto i paragrafi visibili e cambiati, e scarta una risposta arrivata
dopo una modifica.

## Dove si trova

- `crates/fub-features/src/proof.rs`: la feature `fub.proof`, con la route,
  i comandi del dizionario e le impostazioni.
- `vendor/wordcraft/`: il motore di WordCraft, con provenienza e licenza in
  `UPSTREAM.md`.
- `apps/client/src/editors/core/proof.ts`: il client condiviso dalle
  superfici.
- `apps/client/src/editors/text/profiles/markdown/proof.ts`: l'adattatore
  Markdown.
- `apps/client/src/editors/rich/proof.ts`: l'adattatore dei documenti di
  Word.

Il disegno del confine è in
[Superficie ricca e correttore](../architecture/rich-surface-and-proofing.md#correttore-condiviso).
