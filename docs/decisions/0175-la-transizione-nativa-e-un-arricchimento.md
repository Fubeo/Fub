# 0175 — La transizione nativa è un arricchimento

**Stato**: accolta
**Data**: 2026-08-24
**Chiude**: [§30.8](../roadmap/30-il-moto-e-del-tema.md#302-la-shell-dirige-il-tema-decide-il-ritmo)

---

## La capacità del motore non può diventare la semantica del gesto

La shell deve entrare e uscire da una superficie anche dove la View
Transitions API non esiste. Fare dell'API la strada principale produrrebbe due
applicazioni: una coi gesti completi e una coi cambi a secco. Rinunciarvi del
tutto, invece, butterebbe via un'integrazione utile sui motori che la offrono.

## Deciso

`frontend/src/ui/motion.ts` conserva una sola semantica pubblica:
`enterSurface`, `exitSurface` e `finishSurface`. Classi e
`animationend`/`transitionend` restano la base; un limite di sicurezza conclude
il gesto se il motore non consegna l'evento.

Quando `document.startViewTransition` è disponibile, la stessa mutazione viene
eseguita dentro una transizione nativa con un nome temporaneo per superficie.
Quando non lo è, il percorso a classi resta identico. Una nuova richiesta sulla
stessa superficie cancella la precedente, quindi un'apertura rapida non può
lasciare classi o nomi appesi.

Moto ridotto non sceglie un'altra funzione: conclude immediatamente lo stesso
gesto. La struttura resta proprietaria del cambio di stato; il tema continua a
decidere solo ritmo e forma visiva.

## Presidi

`frontend/src/ui/motion.test.ts` esercita supporto presente e assente,
interruzione, uscita, limite di sicurezza e moto ridotto. I chiamanti dei
pannelli usano le tre funzioni senza conoscere la View Transitions API.

## Scartate

| Via | Scartata perché |
| --- | --- |
| View Transitions come base obbligatoria | Il supporto del motore deciderebbe se il gesto esiste. |
| Due API pubbliche, nativa e a classi | Ogni chiamante dovrebbe scegliere e le due semantiche divergerebbero. |
| Un timer scritto da ogni pannello | Replicherebbe cancellazione, pulizia e moto ridotto in ogni superficie. |
| Disabilitare l'arricchimento | Confonderebbe una base portabile con il rifiuto di usare una capacità disponibile. |
