# 0176 — La distanza di una superficie è una scala

**Stato**: accolta
**Data**: 2026-08-24
**Chiude**: [§31.5](../roadmap/31-da-dove-viene-cio-che-si-vede.md#315-quanto-è-lontana-una-superficie)

---

## Un'ombra non misura la stessa cosa nelle due luci

Nel chiaro un'ombra separa una superficie dal fondo. Nel buio la stessa ombra
nera si perde nel fondo e non dichiara alcuna distanza. Copiare ombre con
opacità diverse nei due fogli ripete la forma, ma non conserva il significato.

## Deciso

La ricetta del tema di serie dichiara una scala ordinata di elevazioni: carta,
base, chrome, superficie flottante e dialogo. Ogni gradino produce la coppia di
token `surface` e `border`; l'ombra è un effetto derivato del gradino, non la
sua identità.

La luce chiara usa soprattutto l'ombra; quella scura aumenta chiarezza e bordo.
I componenti consumano il livello semantico che possiedono invece di scegliere
un'ombra locale. La struttura conserva il pavimento delle metriche: il tema può
cambiare la distanza percepita, non spostare la scocca.

Gli stati vuoti e il chrome iniziale usano la stessa scala. Non nasce una
seconda grammatica per le superfici visibili prima dell'apertura di un vault.

## Presidi

`frontend/src/theme/structure.test.ts` confronta i livelli fra le due luci,
verifica l'ordine della scala e impedisce a foglio e pelle di reintrodurre ombre
locali fuori ricetta. `theme:generate` rende i fogli derivati dalla stessa
sorgente.

## Scartate

| Via | Scartata perché |
| --- | --- |
| Una scala di sole ombre | Nel buio più nero non significa più lontano. |
| Valori separati scritti nei due fogli | Due elenchi possono divergere senza che il presidio sappia quale esprime il livello. |
| Elevazione nella struttura | Congelerebbe l'aspetto della superficie nel foglio non sostituibile. |
| Metriche della scocca nel tema | La distanza percepita diventerebbe una modifica del layout. |
