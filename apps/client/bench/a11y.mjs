// **L'accessibilità resa**: `axe-core` su ogni scena, in tutte e due le luci
// (§31.1), più i gesti che un browser compie davvero quando si usa la tastiera.
//
//     node bench/a11y.mjs
//
// Una scansione strutturale non basta: il nome può esserci ma il fuoco non
// arrivare mai, un controllo può avere un ruolo valido ma non reagire a Invio,
// e un `aria-disabled` può continuare ad attivare l'azione. Questo banco usa
// axe per tutte le regole applicabili e il browser per il percorso osservabile.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { SCENE, LIGHTS, sceneUrl } from "./scene.mjs";
import { openStage, openPage, prepareScene, OUTPUT } from "./stage.mjs";
/// Debito storico dichiarato. Non è un'esenzione dalle altre regole:
/// ogni violazione fuori dal debito resta bloccante e viene riportata.
const DEBT = [];

const REPORT = join(OUTPUT, "accessibilita");
const require = createRequire(import.meta.url);

const OUTCOMES = {
  clean: "pulita",
  violations: "violazioni",
  opaque: "muta",
  unstable: "instabile",
};

async function main() {
  await rm(REPORT, { recursive: true, force: true });
  await mkdir(REPORT, { recursive: true });

  const axeSource = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
  const stage = await openStage();
  const report = [];

  try {
    for (const light of LIGHTS) {
      const page = await openPage(stage.browser, light);
      for (const scene of SCENE) {
        report.push(await aScene(page, scene, light, stage.base, axeSource));
      }
      await page.context().close();
    }
  } finally {
    await stage.close();
  }

  await writeFile(
    join(REPORT, "accessibilita.json"),
    `${JSON.stringify(
      report.map((r) => ({ ...r, scene: r.scene.id })),
      null,
      2,
    )}\n`,
  );
  return summary(report);
}

async function aScene(page, scene, light, base, axeSource) {
  const row = {
    scene,
    light,
    examined: 0,
    failures: [],
    declared: [],
    incompletes: [],
    keyboard: [],
  };

  try {
    await prepareScene(page, scene, light, base, sceneUrl);
  } catch (e) {
    row.outcome = OUTCOMES.unstable;
    row.reason = e.message.split("\n")[0];
    console.error(`✗ ${scene.id} (${light}): ${row.reason}`);
    return row;
  }

  // Lo script resta nella pagina fra una scena e l'altra, ma non si usa mai
  // una configurazione precedente: ogni passata parte dal documento corrente.
  const hasAxe = await page.evaluate(() => Boolean(window.axe));
  if (!hasAxe) await page.addScriptTag({ content: axeSource });

  // Nessuna selezione manuale: una nuova regola axe applicabile deve diventare
  // senza che questo file debba essere aggiornato a mano.
  const outcome = await page.evaluate(
    async () =>
      // eslint-disable-next-line no-undef
      await window.axe.run(document, {
        // Gli iframe sono web_view del catalogo e portano `about:blank`: il
        // documento figlio non appartiene alla superficie che si sta provando.
        iframes: false,
      }),
  );

  const count = (group) => group.reduce((n, r) => n + r.nodes.length, 0);
  row.examined =
    count(outcome.passes) + count(outcome.violations) + count(outcome.incomplete);

  for (const rule of outcome.violations) {
    for (const node of rule.nodes) {
      const issue = describe(rule, node);
      // Il debito dichiarato non attenua le altre violazioni: ogni rilievo
      // non corrispondente a una voce esplicita resta bloccante.
      const declared = issue.rule === "color-contrast"
        ? DEBT.find(
            (d) => d.light === light && d.front === issue.front && d.behind === issue.behind,
          )
        : undefined;
      if (declared) {
        declared.seen = true;
        row.declared.push(issue);
      } else {
        row.failures.push(issue);
      }
    }
  }
  for (const rule of outcome.incomplete) {
    for (const node of rule.nodes) row.incompletes.push(describe(rule, node));
  }

  // axe non può osservare l'ordine del Tab né la sintesi degli eventi
  // d'interazione. Queste prove sono sul DOM reso della stessa scena.
  const semanticFailures = await inspectSemantics(page);
  row.keyboard = await inspectKeyboard(page);
  row.failures.push(...semanticFailures, ...row.keyboard);

  if (row.failures.length > 0) row.outcome = OUTCOMES.violations;
  else if (row.examined === 0) row.outcome = OUTCOMES.opaque;
  else row.outcome = OUTCOMES.clean;

  print(row);
  return row;
}

/// Un rilievo axe, ridotto a regola e indicazioni che permettono di ripararlo.
function describe(rule, node) {
  const checks = [...(node.any ?? []), ...(node.all ?? []), ...(node.none ?? [])];
  const check = checks.find((c) => c.message || c.data) ?? {};
  const data = check.data ?? {};
  return {
    source: "axe",
    rule: rule.id,
    impact: rule.impact ?? null,
    where: node.target.join(" "),
    text: (node.html ?? "").replace(/\s+/g, " ").slice(0, 120),
    help: rule.help ?? null,
    helpUrl: rule.helpUrl ?? null,
    reason: check.message ?? node.failureSummary ?? null,
    measured: data.contrastRatio ?? null,
    expected: data.expectedContrastRatio ?? null,
    front: data.fgColor ?? null,
    behind: data.bgColor ?? null,
  };
}

/// Cose che il browser può portare al fuoco. Il valore restituito è intenzionale:
/// usa il tabIndex calcolato e non un elenco di classi della shell.
async function inspectSemantics(page) {
  return page.evaluate(() => {
    const issues = [];
    const nativeRole = (el) => {
      const tag = el.tagName.toLowerCase();
      if (tag === "a" && el.hasAttribute("href")) return "link";
      if (tag === "button" || tag === "summary") return "button";
      if (tag === "select") return el.multiple ? "listbox" : "combobox";
      if (tag === "textarea") return "textbox";
      if (tag === "input") {
        const type = (el.getAttribute("type") ?? "text").toLowerCase();
        if (["submit", "reset", "button", "image", "file"].includes(type)) return "button";
        return {
          checkbox: "checkbox",
          radio: "radio",
          range: "slider",
          number: "spinbutton",
          search: "searchbox",
        }[type] ?? (type === "hidden" ? null : "textbox");
      }
      // `isContentEditable` è ereditato: i figli di `.cm-content` non sono
      // textbox separati. Consideriamo solo il nodo che dichiara l'attributo.
      const editable = el.getAttribute("contenteditable")?.toLowerCase();
      if (editable && editable !== "false") return "textbox";
      return null;
    };
    const hidden = (el) => {
      // I discendenti di details chiusi conservano talvolta un rettangolo
      // di layout, ma non sono renderizzati né raggiungibili col focus.
      if (!el.checkVisibility()) return true;
      for (let n = el; n; n = n.parentElement) {
        if (n.hidden || n.inert || n.getAttribute("aria-hidden") === "true") return true;
        const style = getComputedStyle(n);
        if (style.display === "none" || style.visibility === "hidden") return true;
      }
      const rect = el.getBoundingClientRect();
      return rect.width === 0 || rect.height === 0;
    };
    const name = (el) => {
      const labelled = el.getAttribute("aria-labelledby");
      if (labelled) {
        const text = labelled
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .trim();
        if (text) return text;
      }
      for (const attr of ["aria-label", "alt", "title"]) {
        const text = el.getAttribute(attr)?.trim();
        if (text) return text;
      }
      const label = el.closest("label") ??
        (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
      if (label?.textContent?.trim()) return label.textContent.trim();
      if (["INPUT", "TEXTAREA"].includes(el.tagName) &&
          ["submit", "reset", "button"].includes((el.getAttribute("type") ?? "").toLowerCase())) {
        return el.getAttribute("value")?.trim() ?? "";
      }
      return el.textContent?.replace(/\s+/g, " ").trim() ?? "";
    };
    const where = (el) => {
      const id = el.id ? `#${el.id}` : "";
      return `${el.tagName.toLowerCase()}${id}${el.dataset.a11yProbe ? `[${el.dataset.a11yProbe}]` : ""}`;
    };
    const namedRoles = new Set([
      "application", "button", "checkbox", "combobox", "grid", "link", "listbox",
      "menuitem", "option", "radio", "searchbox", "slider", "spinbutton", "switch",
      "tab", "textbox", "treeitem",
    ]);
    const controls = [...document.querySelectorAll("*")].filter((el) => {
      const disabled = el.matches(":disabled");
      const focusable = el.tabIndex >= 0;
      const role = el.getAttribute("role") || nativeRole(el);
      return !hidden(el) && (focusable || role || disabled);
    });

    for (const el of controls) {
      const role = el.getAttribute("role") || nativeRole(el);
      if (!role && el.tabIndex >= 0) {
        issues.push({
          source: "browser",
          rule: "name-role-value",
          where: where(el),
          reason: "un elemento raggiungibile da tastiera non espone un ruolo",
        });
      }
      if (role && namedRoles.has(role) && !name(el)) {
        issues.push({
          source: "browser",
          rule: "accessible-name",
          where: where(el),
          reason: `il controllo ${role} non ha un nome accessibile`,
        });
      }

      const attr = (key) => el.getAttribute(key);
      const validBoolean = (key) => attr(key) === "true" || attr(key) === "false";
      if (["checkbox", "radio", "switch"].includes(role) &&
          !["INPUT"].includes(el.tagName) && !validBoolean("aria-checked")) {
        issues.push({
          source: "browser",
          rule: "aria-value",
          where: where(el),
          reason: `${role} deve esporre aria-checked true/false`,
        });
      }
      if (role === "tab" && !validBoolean("aria-selected")) {
        issues.push({
          source: "browser",
          rule: "aria-value",
          where: where(el),
          reason: "tab deve esporre aria-selected true/false",
        });
      }
      if (role === "combobox" && el.getAttribute("role") && !validBoolean("aria-expanded")) {
        issues.push({
          source: "browser",
          rule: "aria-value",
          where: where(el),
          reason: "combobox deve esporre aria-expanded true/false",
        });
      }
      if (["slider", "spinbutton"].includes(role) &&
          el.tagName !== "INPUT" && !attr("aria-valuenow")) {
        issues.push({
          source: "browser",
          rule: "aria-value",
          where: where(el),
          reason: `${role} deve esporre aria-valuenow`,
        });
      }
    }

    for (const el of document.querySelectorAll("button, input, select, textarea, [role]")) {
      if (hidden(el) || !el.matches(":disabled") || el.hasAttribute("aria-disabled")) continue;
      const tabindex = el.getAttribute("tabindex");
      if (tabindex !== null && Number(tabindex) >= 0) {
        issues.push({
          source: "browser",
          rule: "disabled",
          where: where(el),
          reason: "un controllo disabled non può appartenere all'ordine del Tab",
        });
      }
    }
    return issues;
  });
}

/// Verifica l'ordine effettivo del Tab, il fuoco visibile e l'attivazione
/// prodotta da Invio/Spazio. I click vengono fermati in cattura: si osserva
/// l'evento browser senza aprire modali, cambiare note o mutare la scena.
async function inspectKeyboard(page) {
  const candidates = await page.evaluate(() => {
    const hidden = (el) => {
      if (!el.checkVisibility()) return true;
      for (let n = el; n; n = n.parentElement) {
        if (n.hidden || n.inert || n.getAttribute("aria-hidden") === "true") return true;
        const style = getComputedStyle(n);
        if (style.display === "none" || style.visibility === "hidden") return true;
      }
      const rect = el.getBoundingClientRect();
      return rect.width === 0 || rect.height === 0;
    };
    const modal = [...document.querySelectorAll("[aria-modal=\"true\"], [role=\"menu\"]")]
      .filter((el) => !hidden(el))
      .at(-1);
    const scope = modal ?? document;
    const nodes = [...scope.querySelectorAll("*")].filter(
      (el) => !hidden(el) && !el.matches(":disabled") && el.tabIndex >= 0,
    );
    const ordered = nodes
      .map((el, index) => ({ el, index, tabIndex: el.tabIndex }))
      .sort((a, b) => {
        const ap = a.tabIndex > 0;
        const bp = b.tabIndex > 0;
        if (ap !== bp) return ap ? -1 : 1;
        if (ap && a.tabIndex !== b.tabIndex) return a.tabIndex - b.tabIndex;
        return a.index - b.index;
      });
    ordered.forEach(({ el }, index) => {
      el.dataset.a11yProbe = String(index);
    });
    return ordered.map(({ el }, index) => ({
      probe: String(index),
      role: el.getAttribute("role"),
      tag: el.tagName,
      disabled: el.getAttribute("aria-disabled") === "true",
      command: ["BUTTON", "SUMMARY"].includes(el.tagName) ||
        ["button", "menuitem", "tab", "checkbox", "radio", "switch"].includes(el.getAttribute("role")),
      link: el.tagName === "A" && el.hasAttribute("href"),
    }));
  });
  // Le superfici dei riquadri possono ridisegnare le tab quando ricevono il
  // fuoco. Riassegnare i marcatori sulla DOM corrente evita di confondere una
  // sostituzione lecita del nodo con una perdita del fuoco.
  const refreshProbes = () => page.evaluate(() => {
    const hidden = (el) => {
      if (!el.checkVisibility()) return true;
      for (let n = el; n; n = n.parentElement) {
        if (n.hidden || n.inert || n.getAttribute("aria-hidden") === "true") return true;
        const style = getComputedStyle(n);
        if (style.display === "none" || style.visibility === "hidden") return true;
      }
      const rect = el.getBoundingClientRect();
      return rect.width === 0 || rect.height === 0;
    };
    const modal = [...document.querySelectorAll("[aria-modal=\"true\"], [role=\"menu\"]")]
      .filter((el) => !hidden(el))
      .at(-1);
    const scope = modal ?? document;
    const nodes = [...scope.querySelectorAll("*")].filter(
      (el) => !hidden(el) && !el.matches(":disabled") && el.tabIndex >= 0,
    );
    const ordered = nodes
      .map((el, index) => ({ el, index, tabIndex: el.tabIndex }))
      .sort((a, b) => {
        const ap = a.tabIndex > 0;
        const bp = b.tabIndex > 0;
        if (ap !== bp) return ap ? -1 : 1;
        if (ap && a.tabIndex !== b.tabIndex) return a.tabIndex - b.tabIndex;
        return a.index - b.index;
      });
    ordered.forEach(({ el }, index) => {
      el.dataset.a11yProbe = String(index);
    });
  });
  const failures = [];

  try {
    await page.evaluate(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
      window.scrollTo(0, 0);
      // `blur()` lascia Chromium con il punto di partenza della navigazione
      // precedente. Mettere a fuoco temporaneamente il body riallinea il
      // primo Tab con il primo candidato del documento.
      const body = document.body;
      const previousTabIndex = body.getAttribute("tabindex");
      body.setAttribute("tabindex", "-1");
      body.focus({ preventScroll: true });
      if (previousTabIndex === null) body.removeAttribute("tabindex");
      else body.setAttribute("tabindex", previousTabIndex);
    });
    // Un composito (la griglia: una sola fermata del Tab, il discendente
    // attivo avanza dentro con `aria-activedescendant`) trattiene il fuoco
    // mentre il Tab interno avanza. Senza questa distinzione ogni Tab interno
    // sembrerebbe un ordine sbagliato; con un'eccezione per scena si
    // nasconderebbe invece una trappola vera. Rilevato l'avanzamento interno,
    // si salta in fondo al composito (Ctrl+End, il gesto che la griglia
    // dichiara) e si esce con un Tab: si verifica l'uscita senza attraversare
    // le celle una alla volta. Se non avanza né il fuoco né il discendente,
    // resta il rilievo di prima.
    let previousProbe = null;
    let previousDescendant = null;
    const readActual = () => page.evaluate(() => {
        const el = document.activeElement;
        if (!(el instanceof HTMLElement)) return null;
        const hasIndicator = (style, pseudo, after) =>
          style.outlineStyle !== "none" ||
          style.boxShadow !== "none" ||
          pseudo.outlineStyle !== "none" ||
          pseudo.boxShadow !== "none" ||
          after.outlineStyle !== "none" ||
          after.boxShadow !== "none";
        const style = getComputedStyle(el);
        const pseudo = getComputedStyle(el, "::before");
        const after = getComputedStyle(el, "::after");
        // Il fuoco di un iframe è nel documento figlio: Chromium non attiva
        // `:focus-visible` sull'host, ma il suo involucro può osservarlo con
        // `:focus-within` e dipingere lo stesso anello.
        const frameShell = el.tagName === "IFRAME" ? el.parentElement : null;
        // Un Tab verso un iframe fa perdere il focus della finestra ospite,
        // quindi il monitor della shell aggiunge una classe esplicita; il
        // ramo `:focus-within` copre invece il focus programmatico.
        const shellFocused =
          frameShell?.classList.contains("ui-webview-frame--keyboard") ||
          frameShell?.matches(":focus-within");
        const shellIndicator =
          shellFocused &&
          hasIndicator(
            getComputedStyle(frameShell),
            getComputedStyle(frameShell, "::before"),
            getComputedStyle(frameShell, "::after"),
          );
        const indicator =
          (el.matches(":focus-visible") && hasIndicator(style, pseudo, after)) ||
          (el.tagName === "IFRAME" && shellIndicator);
        const descendantId = el.getAttribute("aria-activedescendant");
        const descendant = descendantId ? document.getElementById(descendantId) : null;
        return {
          probe: el.dataset.a11yProbe ?? null,
          indicator,
          descendant: descendant
            ? `${descendantId}:${descendant.getAttribute("aria-rowindex")}:${descendant.getAttribute("aria-colindex")}`
            : null,
          composite: el.getAttribute("role") === "grid" && descendant !== null,
        };
      });
    for (const expected of candidates) {
      await page.keyboard.press("Tab");
      await refreshProbes();
      let actual = await readActual();
      if (
        actual?.composite &&
        actual.probe !== expected.probe &&
        actual.probe === previousProbe &&
        actual.descendant !== previousDescendant
      ) {
        await page.keyboard.press("Control+End");
        await page.keyboard.press("Tab");
        await refreshProbes();
        actual = await readActual();
      }
      if (!actual || actual.probe !== expected.probe) {
        failures.push({
          source: "browser",
          rule: "tab-order",
          where: actual?.probe ? `[${actual.probe}]` : "document",
          reason: `Tab atteso su [${expected.probe}], arrivato su ${actual?.probe ?? "nessun elemento"}`,
        });
        break;
      }
      if (!actual.indicator) {
        failures.push({
          source: "browser",
          rule: "focus-visible",
          where: `[${expected.probe}]`,
          reason: "il fuoco da tastiera non ha un indicatore visibile",
        });
      }
      previousProbe = actual.probe;
      previousDescendant = actual.descendant;
    }

    await page.evaluate(() => {
      window.__a11yKeyboardProbe = { active: false, target: null, clicks: 0 };
      window.__a11yKeyboardListener = (event) => {
        const probe = window.__a11yKeyboardProbe;
        if (!probe?.active || event.target !== probe.target) return;
        probe.clicks += 1;
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      document.addEventListener("click", window.__a11yKeyboardListener, true);
    });
    for (const candidate of candidates) {
      const keys = candidate.link ? ["Enter"] : candidate.command ? ["Enter", "Space"] : [];
      if (!keys.length) continue;
      for (const key of keys) {
        await refreshProbes();
        await page.evaluate((probe) => {
          const target = document.querySelector(`[data-a11y-probe="${probe}"]`);
          if (!(target instanceof HTMLElement)) return;
          target.focus({ preventScroll: true });
          window.__a11yKeyboardProbe = { active: true, target, clicks: 0 };
        }, candidate.probe);
        const focused = await page.evaluate(
          (probe) => document.activeElement?.dataset.a11yProbe === probe,
          candidate.probe,
        );
        if (!focused) {
          failures.push({
            source: "browser",
            rule: "keyboard-focus",
            where: `[${candidate.probe}]`,
            reason: "il controllo dichiarato raggiungibile non riceve il fuoco",
          });
          continue;
        }
        await page.keyboard.press(key);
        const clicks = await page.evaluate(() => {
          const probe = window.__a11yKeyboardProbe;
          if (probe) probe.active = false;
          return probe?.clicks ?? 0;
        });
        if (candidate.disabled ? clicks > 0 : clicks !== 1) {
          failures.push({
            source: "browser",
            rule: candidate.disabled ? "disabled" : "keyboard-activation",
            where: `[${candidate.probe}]`,
            reason: candidate.disabled
              ? `${key === "Space" ? "Spazio" : "Invio"} attiva un controllo aria-disabled`
              : `${key === "Space" ? "Spazio" : "Invio"} non produce esattamente un click osservabile`,
          });
        }
      }
    }
  } finally {
    await page.evaluate(() => {
      if (window.__a11yKeyboardListener) {
        document.removeEventListener("click", window.__a11yKeyboardListener, true);
      }
      delete window.__a11yKeyboardListener;
      delete window.__a11yKeyboardProbe;
      document.querySelectorAll("[data-a11y-probe]").forEach((el) => delete el.dataset.a11yProbe);
    });
  }
  return failures;
}

function print(row) {
  const name = `${row.scene.id} (${row.light})`;
  if (row.outcome === OUTCOMES.opaque) {
    console.error(`✗ ${name}: nessun elemento esaminato — la pagina non è quella attesa`);
    return;
  }
  if (row.outcome === OUTCOMES.violations) {
    console.error(`✗ ${name}: ${row.failures.length} violazioni`);
    for (const issue of row.failures) {
      console.error(`    [${issue.rule ?? "browser"}] ${issue.where} — ${issue.reason ?? issue.help ?? "senza dettaglio"}`);
      if (issue.helpUrl) console.error(`      ${issue.helpUrl}`);
      if (issue.measured) {
        console.error(`      ${issue.measured}:1 invece di ${issue.expected}:1 — ${issue.front ?? "?"} su ${issue.behind ?? "?"}`);
      }
      if (issue.text) console.error(`      ${issue.text}`);
    }
    return;
  }
  const debt = row.declared.length > 0 ? `, ${row.declared.length} nel debito` : "";
  console.log(`· ${name}: ${row.examined} elementi${debt}, tastiera verificata`);
}

function summary(report) {
  const count = (outcome) => report.filter((r) => r.outcome === outcome).length;
  const incompletes = report.flatMap((r) => r.incompletes.map((i) => ({ ...i, row: r })));

  if (incompletes.length > 0) {
    console.log(`\n${incompletes.length} indecisi: axe non è riuscito a determinare una regola.`);
    for (const i of incompletes) {
      console.log(`    ${i.row.scene.id} (${i.row.light}) [${i.rule}] ${i.where} — ${i.reason ?? "senza motivo"}`);
    }
  }

  const fixed = DEBT.filter((d) => !d.seen);
  if (fixed.length > 0) {
    console.error(`\n${fixed.length} voci del debito non si vedono più:`);
    for (const d of fixed) {
      console.error(`    ${d.front} su ${d.behind} (${d.light}) — ${d.cosa.split(".")[0]}`);
    }
    console.error("  Se sono riparate, si tolgono da DEBITO: è la metà del presidio.");
  }

  const declared = report.reduce((n, r) => n + r.declared.length, 0);
  if (declared > 0) {
    console.log(`\n${declared} rilievi nel debito dichiarato, su ${DEBT.length} coppie:`);
    for (const d of DEBT) console.log(`    ${d.front} su ${d.behind} — §${d.voce}`);
  }

  const red =
    count(OUTCOMES.violations) + count(OUTCOMES.opaque) + count(OUTCOMES.unstable) + fixed.length;
  const examined = report.reduce((n, r) => n + r.examined, 0);
  const redScenes =
    count(OUTCOMES.violations) + count(OUTCOMES.opaque) + count(OUTCOMES.unstable);
  console.log(`\n${report.length - redScenes}/${report.length} scene pulite, ${examined} elementi esaminati`);
  console.log(`Il referto: ${join(REPORT, "accessibilita.json")}`);

  if (red === 0) return 0;
  if (fixed.length > 0) return 1;
  return 1;
}

process.exitCode = await main();
