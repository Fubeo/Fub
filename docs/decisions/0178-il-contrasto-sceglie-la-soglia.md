# 0178 — Il contrasto sceglie la soglia

**Stato**: accolta
**Data**: 2026-08-24
**Chiude**: [§31.7](../roadmap/31-da-dove-viene-cio-che-si-vede.md#317-il-contrasto-ha-più-di-una-soglia)

---

## Alto contrasto non è un terzo foglio scritto a mano

Il tema di serie aveva una sola soglia e nessuna risposta alla preferenza di
sistema. Duplicare i fogli per l'alto contrasto avrebbe duplicato anche tinte,
famiglie e correzioni. Lasciare tutto a `forced-colors`, invece, coprirebbe solo
il caso in cui il sistema prende direttamente il controllo dei colori.

## Deciso

La ricetta accetta un livello `normal` o `high`. Le stesse voci, famiglie e
fondi vengono risolti con soglie diverse e generano i fogli chiaro/scuro ad alto
contrasto accanto a quelli normali. La scelta è una preferenza macchina a tre
stati: normale, alto, sistema; nello stato sistema decide
`prefers-contrast: more`.

La fixture delle coppie resta unica e viene letta sia dalla ricetta sia dal
caricatore dei temi. Il livello alto deve reggere le sue soglie senza cambiare
la semantica dei ruoli.

`forced-colors: active` è un pavimento separato nella struttura: restituisce al
sistema colori e controlli dove il tema non deve prevalere. Non è una quinta
variante generata e non sostituisce la scelta di alto contrasto.

## Presidi

`frontend/src/theme/contrast-high.test.ts` verifica le coppie nelle due luci e
nelle due soglie. `theme/forced-colors.test.ts` presidia il blocco strutturale;
`theme/theme.test.ts` copre precedenza fra scelta esplicita e preferenza di
sistema. `theme:verify` impedisce deriva dei quattro fogli generati.

## Scartate

| Via | Scartata perché |
| --- | --- |
| Fogli high scritti a mano | Ogni correzione della ricetta dovrebbe essere ripetuta e potrebbe divergere. |
| Solo `prefers-contrast` | Toglierebbe alla persona la scelta esplicita. |
| Solo `forced-colors` | È un modo imposto dal sistema, non una variante del tema con soglie più alte. |
| Soglie locali nei test | Il caricatore e la generazione non condividerebbero più lo stesso contratto. |
