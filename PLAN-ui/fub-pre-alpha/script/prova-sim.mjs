// Prova il simulatore v2 di Fub pre-alpha. Esce con 1 se:
//  - uno stato non si monta (niente «pronto» in 20 s) o la pagina dà un errore;
//  - il simulatore dice che non ha trovato un pezzo (la riga «Il simulatore non
//    ha trovato…» sotto lo schermo);
//  - un controllo visibile ha un esito fuori dalla lista buona: un avviso
//    generico che non sta in eccezioni-sim.mjs, uno stato che non c'è, un errore;
//  - un clic vero su un campione di controlli non fa niente (né un altro stato,
//    né un avviso, né un cambio nello schermo);
//  - un passo di uno scenario non si monta.
// node prova-sim.mjs <out-dir> <foto-dir> [fasi=stati,clic,scenari] [larghezze=piena,700,tel] [solo=id,id]
import { chromium } from "./client.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [dir, fotoDir, ...resto] = process.argv.slice(2);
const opz = Object.fromEntries(resto.map((a) => a.split("=")));
const fasi = new Set((opz.fasi ?? "stati,clic,scenari").split(","));
const larghezze = (opz.larghezze ?? "piena,700,tel").split(",");
const solo = opz.solo ? new Set(opz.solo.split(",")) : null;
mkdirSync(join(fotoDir, "scenari"), { recursive: true });

const BUONI = new Set(["vai", "torna", "spento", "apre", "avviso-specifico", "cambia", "nativo", "zona", "menu", "eccezione"]);
// Gli esiti che un clic vero deve far vedere (gli altri possono non cambiare
// niente: un controllo spento, un campo che prende il fuoco).
const VIVI = ["vai", "torna", "apre", "menu", "avviso-specifico", "cambia", "zona"];

// Gli stessi argomenti del banco (bench/stage.mjs): i caratteri si disegnano
// come nelle catture.
const b = await chromium.launch({ args: ["--font-render-hinting=none", "--disable-lcd-text", "--force-color-profile=srgb", "--disable-dev-shm-usage"] });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errori = [];
p.on("pageerror", (e) => errori.push(`pageerror ${e.message}`));
p.on("console", (m) => m.type() === "error" && !/Failed to load resource|Blocked script execution/.test(m.text()) && errori.push(`console ${m.text()}`));
await p.route(/^https?:/, (r) => r.abort());
p.setDefaultTimeout(20000);
const falli = [];
const fallisci = (riga) => {
  falli.push(riga);
  console.log(`NO   ${riga}`);
};

await p.goto(`file://${dir}/simulatore.html#stato=nota-riposo&moto=pieno`);
await p.waitForFunction(() => document.getElementById("sim-box")?.dataset.pronto, null, { timeout: 30000 });
const STATI = await p.evaluate(() => window.SIM_STATI.map((s) => ({ id: s.id, n: s.n, g: s.g, telefono: !!s.telefono, tel: !!s.tel?.cap })));
const SCENARI = await p.evaluate(() => window.SIM_SCENARI.map((s) => ({ id: s.id, nome: s.nome, passi: s.passi.map((x) => x.stato) })));

// Monta uno stato e aspetta che sia pronto. Il moto cambia fra ridotto e calmo
// per rimontare lo stesso stato (lo stesso indirizzo non rimonta niente).
let giro = 0;
async function monta(id, luce, larghezza) {
  const moto = giro++ % 2 ? "calmo" : "ridotto";
  await p.evaluate(([h]) => {
    delete document.getElementById("sim-box").dataset.pronto;
    document.getElementById("sim-msg").textContent = "";
    location.hash = h;
  }, [`stato=${id}&luce=${luce}&larghezza=${larghezza}&moto=${moto}`]);
  const ok = await p
    .waitForFunction(([id, luce]) => {
      const k = document.getElementById("sim-box").dataset.pronto;
      return k && k.startsWith(`${id}--`) && k.endsWith(`-${luce}`);
    }, [id, luce])
    .then(() => true, () => false);
  if (!ok) return null;
  await p.waitForTimeout(60);
  // I montaggi si alternano fra «calmo» e «ridotto»: col movimento calmo le
  // entrate sono ancora a metà (opacità, posizione) e l elenco dei controlli
  // visibili cambierebbe da un montaggio all altro. Si aspettano le animazioni
  // finite (non quelle che girano per sempre, come gli scheletri), al più 1,5 s.
  await p.evaluate(() => {
    const doc = document.getElementById("sim-schermo").contentDocument;
    const finite = doc.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
    return Promise.race([Promise.all(finite.map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 1500))]);
  });
  return p.evaluate(() => ({ manca: document.getElementById("sim-manca").hidden ? "" : document.getElementById("sim-manca").textContent }));
}

// I controlli visibili dello schermo, nello stesso ordine e con lo stesso
// esito che solo-simulatore.js dà al clic (come inventario-clic.mjs). Con
// «segna» mette data-prova sul controllo numero «segna» e da lì conta i
// cambi del DOM dello schermo.
const controlli = (segna) =>
  p.evaluate((segna) => {
    const doc = document.getElementById("sim-schermo").contentDocument;
    const win = doc.defaultView;
    const SEL = 'button, a[href], input, select, textarea, summary, [role=button], [role=tab], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=radio], [role=switch], [role=checkbox], [role=option], [role=treeitem], [role=link], [role=gridcell], [role=columnheader], [role=slider], [role=spinbutton], [contenteditable=true], [tabindex="0"]';
    // Tagliato da un antenato che scorre o ritaglia (overflow, contain): non
    // si vede e non si può cliccare, quindi non conta e non è «coperto».
    const tagliato = (el, x, y) => {
      for (let a = el.parentElement; a && a !== doc.body; a = a.parentElement) {
        const s = win.getComputedStyle(a);
        if (s.overflowX === "visible" && s.overflowY === "visible" && !/paint|strict|content/.test(s.contain)) continue;
        const r = a.getBoundingClientRect();
        if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) return true;
      }
      return false;
    };
    // Ciò che sta sopra di proposito: i veli (dialoghi, cassetti, impostazioni,
    // lanciatore), gli strati, i pannelli e i menu aperti, e la striscia del
    // bordo del cassetto chiuso (frame/peek.ts: aria-hidden, larga 10 px,
    // apre il cassetto passandoci sopra; c è anche nel client).
    const SOPRA = "iframe[data-sim-strato], .kit-dialog-scrim, .drawer-scrim, .settings-scrim, .launcher-veil, .drawer-edge";
    const APERTI = ".kit-dialog, [role=dialog], [role=menu], [role=listbox], [role=tooltip], .toast, #notify-panel, .app-menu.open, .slash-stage";
    const vis = (el) => {
      if (el.closest("[data-sim-velo], [hidden], [inert]")) return false;
      const rc = el.getBoundingClientRect();
      if (rc.width < 2 || rc.height < 2 || rc.bottom < 0 || rc.right < 0 || rc.top > win.innerHeight || rc.left > win.innerWidth) return false;
      const cs = win.getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0 || cs.pointerEvents === "none") return false;
      const top = doc.elementFromPoint(rc.left + rc.width / 2, rc.top + rc.height / 2);
      // Sotto il centro deve esserci il controllo (o un suo figlio): un velo
      // o un dialogo sopra lo coprono, e il clic andrebbe a loro. Un controllo
      // coperto da qualcosa che non è un controllo, un velo o uno strato si
      // segna: lì il clic di chi prova finirebbe nel vuoto.
      if (top && el.contains(top)) return true;
      if (tagliato(el, rc.left + rc.width / 2, rc.top + rc.height / 2)) return false;
      if (top && !top.matches?.(SOPRA) && !top.closest(SEL) && !top.closest(APERTI)) {
        coperti.push(`${(el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40)}\t${top.tagName.toLowerCase()}${top.id ? "#" + top.id : ""}.${String(top.className?.baseVal ?? top.className).split(" ").slice(0, 2).join(".")}`);
      }
      return false;
    };
    const coperti = [];
    const out = [];
    let k = 0;
    for (const el of doc.querySelectorAll(SEL)) {
      if (!vis(el)) continue;
      const d = doc.__simDecidi ? doc.__simDecidi(el) : null;
      const nome = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.value || "").replace(/\s+/g, " ").trim().slice(0, 50);
      if (segna === k) {
        el.setAttribute("data-prova", "");
        window.__mut = 0;
        window.__oss?.disconnect();
        window.__oss = new win.MutationObserver((l) => (window.__mut += l.filter((m) => m.attributeName !== "data-prova").length));
        window.__oss.observe(doc, { subtree: true, childList: true, attributes: true, characterData: true });
      }
      out.push({ k: k++, tag: el.tagName.toLowerCase(), nome, esito: d?.esito ?? "morto", dettaglio: String(d?.dettaglio ?? "").slice(0, 90) });
    }
    window.__coperti = coperti;
    return out;
  }, segna ?? -1);

const scelti = STATI.filter((s) => !solo || solo.has(s.id));

// ── 1. Ogni stato si monta, ogni controllo ha un esito buono ──────────────
if (fasi.has("stati")) {
  for (const larghezza of larghezze) {
    const righe = [];
    const coperti = [];
    let n = 0;
    for (const luce of larghezza === "piena" ? ["light", "dark"] : ["light"]) {
      for (const s of scelti) {
        const r = await monta(s.id, luce, larghezza);
        if (!r) {
          fallisci(`S${s.n} ${s.id} ${larghezza} ${luce}: non si monta`);
          continue;
        }
        n++;
        if (r.manca) fallisci(`S${s.n} ${s.id} ${larghezza} ${luce}: ${r.manca}`);
        if (luce !== "light") continue;
        for (const c of await controlli()) {
          righe.push([s.id, c.tag, c.nome, c.esito, c.dettaglio].join("\t"));
          if (c.esito === "avviso-generico") fallisci(`S${s.n} ${s.id} ${larghezza}: «${c.nome}» ha solo l'avviso generico (dagli un esito o mettilo in eccezioni-sim.mjs)`);
          else if (!BUONI.has(c.esito)) fallisci(`S${s.n} ${s.id} ${larghezza}: «${c.nome}» → ${c.esito} ${c.dettaglio}`);
        }
        for (const c of await p.evaluate(() => window.__coperti ?? [])) coperti.push(`${s.id}\t${c}`);
      }
    }
    writeFileSync(join(fotoDir, `inventario-${larghezza}.tsv`), righe.join("\n") + "\n");
    writeFileSync(join(fotoDir, `coperti-${larghezza}.tsv`), coperti.join("\n") + "\n");
    if (coperti.length) console.log(`coperti ${larghezza}: ${coperti.length} controlli sotto qualcosa che non è un controllo (coperti-${larghezza}.tsv)`);
    const conta = {};
    for (const r of righe) conta[r.split("\t")[3]] = (conta[r.split("\t")[3]] ?? 0) + 1;
    console.log(`stati ${larghezza}: ${n} montati, ${righe.length} controlli ${JSON.stringify(conta)}`);
  }
}

// ── 2. Clic veri: per ogni stato un controllo per tipo di esito ───────────
// Il clic di Playwright nello schermo deve cambiare qualcosa: lo stato,
// l'avviso sotto lo schermo o il DOM dello schermo; «vai» deve arrivare lì.
if (fasi.has("clic")) {
  for (const larghezza of larghezze) {
    let provati = 0;
    for (const s of scelti) {
      if (larghezza === "tel" && !s.telefono && !s.tel) continue;
      if (larghezza !== "tel" && s.telefono) continue;
      if (!(await monta(s.id, "light", larghezza))) continue;
      const tutti = await controlli();
      const campione = VIVI.map((e) => tutti.find((c) => c.esito === e)).filter(Boolean);
      for (const [i, c] of campione.entries()) {
        if (i > 0 && !(await monta(s.id, "light", larghezza))) break;
        const ora = await controlli(c.k);
        if (ora[c.k]?.nome !== c.nome) {
          fallisci(`S${s.n} ${s.id} ${larghezza}: dopo il rimontaggio «${c.nome}» non è più al suo posto`);
          continue;
        }
        provati++;
        const prima = await p.evaluate(() => location.hash);
        const cliccato = await p
          .frameLocator("#sim-schermo")
          .locator("[data-prova]")
          .first()
          .click({ force: true, timeout: 3000 })
          .then(() => true, (e) => (fallisci(`S${s.n} ${s.id} ${larghezza}: «${c.nome}» non si clicca (${e.message.split("\n")[0]})`), false));
        if (!cliccato) continue;
        await p.waitForTimeout(250);
        const dopo = await p.evaluate(() => ({ hash: location.hash, msg: document.getElementById("sim-msg").textContent.trim(), mut: window.__mut ?? 0 }));
        const stato = new URLSearchParams(dopo.hash.slice(1)).get("stato");
        if (c.esito === "vai" && stato !== c.dettaglio) fallisci(`S${s.n} ${s.id} ${larghezza}: «${c.nome}» doveva portare a ${c.dettaglio}, è in ${stato}`);
        else if (dopo.hash === prima && !dopo.msg && !dopo.mut) fallisci(`S${s.n} ${s.id} ${larghezza}: il clic su «${c.nome}» (${c.esito}) non fa niente`);
      }
      // Il velo di un dialogo o di un cassetto: il clic su un suo angolo
      // libero deve chiudere (kit/dialog.ts, desktop-shell.ts).
      if (!(await monta(s.id, "light", larghezza))) continue;
      const velo = await p.evaluate(() => {
        const doc = document.getElementById("sim-schermo").contentDocument;
        const w = doc.defaultView;
        for (const v of doc.querySelectorAll(".kit-dialog-scrim, .drawer-scrim:not([hidden]), .settings-scrim")) {
          for (const [x, y] of [[4, 4], [w.innerWidth - 4, w.innerHeight - 4], [4, w.innerHeight - 4], [w.innerWidth - 4, 4]]) {
            if (doc.elementFromPoint(x, y) !== v) continue;
            const r = v.getBoundingClientRect();
            v.setAttribute("data-prova-velo", "");
            return { x: x - r.left, y: y - r.top };
          }
        }
        return null;
      });
      if (velo) {
        provati++;
        const prima = await p.evaluate(() => location.hash);
        await p.frameLocator("#sim-schermo").locator("[data-prova-velo]").first().click({ force: true, position: velo, timeout: 3000 });
        await p.waitForTimeout(250);
        const dopo = await p.evaluate(() => ({ hash: location.hash, msg: document.getElementById("sim-msg").textContent.trim() }));
        const fuori = await p.evaluate(() => !document.getElementById("sim-schermo").contentDocument.querySelector(".kit-dialog-scrim[data-prova-velo], .drawer-scrim[data-prova-velo]:not([hidden])"));
        if (dopo.hash === prima && !fuori) fallisci(`S${s.n} ${s.id} ${larghezza}: il clic sul velo non chiude niente`);
      }
    }
    console.log(`clic ${larghezza}: ${provati} clic veri`);
  }
}

// ── 3. Gli scenari, passo per passo, con i bottoni della pagina ───────────
if (fasi.has("scenari")) {
  let passi = 0;
  for (const sc of SCENARI) {
    await p.evaluate(() => delete document.getElementById("sim-box").dataset.pronto);
    await p.selectOption("#sim-scenario", sc.id);
    for (let i = 0; i < sc.passi.length; i++) {
      const ok = await p
        .waitForFunction(([id]) => document.getElementById("sim-box").dataset.pronto?.startsWith(`${id}--`), [sc.passi[i]])
        .then(() => true, () => false);
      const testa = (await p.textContent("#sim-passo-n")).trim();
      if (!ok) fallisci(`scenario ${sc.id}, passo ${i + 1}: ${sc.passi[i]} non si monta`);
      else if (testa !== `Passo ${i + 1} di ${sc.passi.length}`) fallisci(`scenario ${sc.id}, passo ${i + 1}: la pagina dice «${testa}»`);
      else {
        const manca = await p.evaluate(() => (document.getElementById("sim-manca").hidden ? "" : document.getElementById("sim-manca").textContent));
        if (manca) fallisci(`scenario ${sc.id}, passo ${i + 1}: ${manca}`);
        await p.waitForTimeout(100);
        await p.locator("#sim-box").screenshot({ path: join(fotoDir, "scenari", `${sc.id}-${String(i + 1).padStart(2, "0")}.png`) });
        passi++;
      }
      if (i < sc.passi.length - 1) {
        await p.evaluate(() => delete document.getElementById("sim-box").dataset.pronto);
        await p.click("#sim-passo-dopo");
      }
    }
  }
  await p.selectOption("#sim-scenario", "");
  console.log(`scenari: ${SCENARI.length}, ${passi} passi fotografati`);
}

for (const e of errori) fallisci(e);
console.log(falli.length ? `${falli.length} problemi` : "errori: nessuno");
await b.close();
process.exit(falli.length ? 1 : 0);
