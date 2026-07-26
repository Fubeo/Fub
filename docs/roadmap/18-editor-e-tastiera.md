# 18. L'editor e la tastiera

Una **seduta** della [roadmap infrastrutturale](../todo.md): ciò che resta della shell e non appartiene a nessuna delle sedute sopra.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Due voci che restano dalla shell e non appartengono a nessuna delle sedute
precedenti. La 18.2 dipende dal registro comandi
([decisione 0009](../decisions/0009-registro-dei-comandi.md)), che è fatto: oggi la
shell **onora** i `keybinding` dichiarati dai comandi e ignora quelli senza
modificatori; ciò che manca è la tastiera **configurabile dall'utente**, che vive
nei settings (11.1), e i comandi **della shell** (toggle dei pannelli, cambio
modalità), che non possono registrarsi nel kernel e finché non c'è un registro di
qua restano bottoni.

Con loro il residuo dichiarato della
[decisione 0004](../decisions/0004-il-grafo-e-i-link-non-wiki.md): l'arco adesso è
vero, **il clic no** — la shell non naviga né i link markdown né i wikilink, e
in anteprima un `.internal-path` porta già il suo `data-path` che nessuno
raccoglie.

### 18.1 Editor

*ex §3.7 · shell · **P1** — il ponte inverso è fatto (decisione 0007); il secondo livello aspetta il capitolo 4*

- [x] **Ponte inverso code unit → byte** (`offsets.ts`): fatto con la [decisione 0007](../decisions/0007-contesto-di-sessione.md)
      (`charToByteIndex`, testato su accenti ed emoji in andata e ritorno), che
      ne aveva bisogno per far attraversare il confine alla selezione. Le due
      direzioni stanno in un punto solo.
- [ ] **Due livelli di decorazione dichiarati**: sintassi dal tree Lezer
      (già fatto), semantica dagli `Span` del modello (embed risolti, callout,
      math) — con la regola di chi vince dove.
- [ ] **Invariante del buffer sporco** irrobustita (oggi custodita da un flag TS)
      e conflitto buffer↔disco esplicito: è lavoro M3 già dichiarato.

### 18.2 Comandi e tastiera

*ex §3.2 · shell · **P1** — il registro c'è (decisione 0009); manca il lato shell*

- [ ] **Registro comandi nel frontend** alimentato da `list_commands` +
      command palette fuzzy + hotkey configurabili (con chord) + conflitti
      segnalati. È la superficie con cui l'utente raggiunge tutto il resto.
