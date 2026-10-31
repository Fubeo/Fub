#!/usr/bin/env node
// Il cancello del rilascio: un installer nasce soltanto da un commit che ha
// passato la CI per intero, e un tag del canale stabile soltanto con le firme
// che quel canale promette (docs/development/versioning-and-releases.md).
//
//   node check-release-gate.mjs ci <sha>        la CI di <sha> è verde e completa
//   node check-release-gate.mjs signing <tag>   le firme del canale ci sono
//   node check-release-gate.mjs --self-test     le regole, senza rete
//
// `ci` legge `GITHUB_REPOSITORY` e `GH_TOKEN` (o `GITHUB_TOKEN`); `signing`
// guarda soltanto se le variabili dei segreti sono valorizzate, mai il valore.

const CI_WORKFLOW = "ci.yml";

// I job che la CI esegue su ogni push: una corsa che non li ha tutti verdi,
// anche saltati, non è una prova.
export const REQUIRED_JOBS = [
  "invarianti",
  "supply chain",
  "fmt + clippy",
  "build + test (ubuntu-latest)",
  "build + test (windows-latest)",
  "build + test (macos-latest)",
  "documentazione canonica",
  "client",
  "varianti di feature e motori in vendor",
  "banco visivo",
  "contrasto e tastiera (dark)",
  "contrasto e tastiera (light)",
  "banchi del grafo",
];

export const SIGNING = {
  macos: [
    "APPLE_CERTIFICATE",
    "APPLE_CERTIFICATE_PASSWORD",
    "APPLE_SIGNING_IDENTITY",
    "APPLE_ID",
    "APPLE_PASSWORD",
    "APPLE_TEAM_ID",
  ],
  windows: ["WINDOWS_CERTIFICATE", "WINDOWS_CERTIFICATE_PASSWORD"],
};

/** `true` se il tag è del canale stabile: `vX.Y.Z` senza suffisso. */
export function isStable(tag) {
  return /^v\d+\.\d+\.\d+$/.test(tag);
}

/**
 * Le ragioni per cui le corse di CI di `sha` non bastano; vuoto se una basta.
 * `runs` sono le corse del workflow, `jobsOf(run)` i job di una corsa.
 */
export function ciProblems(sha, runs, jobsOf) {
  const candidates = runs.filter(
    (run) => run.head_sha === sha && run.event !== "schedule" && run.status === "completed",
  );
  if (candidates.length === 0) return [`nessuna corsa completata di ${CI_WORKFLOW} per ${sha}`];
  const problems = [];
  for (const run of candidates) {
    const missing = missingJobs(run, jobsOf(run));
    if (run.conclusion === "success" && missing.length === 0) return [];
    problems.push(
      `corsa ${run.id} (${run.event}): esito ${run.conclusion}` +
        (missing.length ? `, job non verdi: ${missing.join(", ")}` : ""),
    );
  }
  return problems;
}

function missingJobs(run, jobs) {
  return REQUIRED_JOBS.filter(
    (required) =>
      !jobs.some((job) => job.name.startsWith(required) && job.conclusion === "success"),
  );
}

/** Le variabili di firma che mancano per `tag`; vuoto se il canale non ne chiede. */
export function signingProblems(tag, env) {
  if (!isStable(tag)) return [];
  return Object.entries(SIGNING).flatMap(([platform, names]) =>
    names.filter((name) => !env[name]).map((name) => `${platform}: manca ${name}`),
  );
}

async function api(path) {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

async function checkCi(sha) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo || !/^[0-9a-f]{40}$/.test(sha ?? "")) {
    console.error("uso: GITHUB_REPOSITORY=owner/repo check-release-gate.mjs ci <sha di 40 cifre>");
    process.exit(2);
  }
  const { workflow_runs: runs } = await api(
    `/repos/${repo}/actions/workflows/${CI_WORKFLOW}/runs?head_sha=${sha}&per_page=100`,
  );
  const jobs = new Map();
  for (const run of runs) {
    if (run.head_sha !== sha || run.status !== "completed") continue;
    const { jobs: list } = await api(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`);
    jobs.set(run.id, list);
  }
  return ciProblems(sha, runs, (run) => jobs.get(run.id) ?? []);
}

function selfTest() {
  const sha = "a".repeat(40);
  const green = REQUIRED_JOBS.map((name) => ({ name: `${name} (x)`, conclusion: "success" }));
  const run = (over) => ({ id: 1, head_sha: sha, event: "push", status: "completed", conclusion: "success", ...over });
  const cases = [
    ["una corsa verde e completa basta", ciProblems(sha, [run({})], () => green).length === 0],
    ["senza corse non si rilascia", ciProblems(sha, [], () => green).length === 1],
    ["una corsa di un altro commit non conta", ciProblems(sha, [run({ head_sha: "b".repeat(40) })], () => green).length === 1],
    ["la corsa settimanale non conta", ciProblems(sha, [run({ event: "schedule" })], () => green).length === 1],
    ["una corsa rossa non basta", ciProblems(sha, [run({ conclusion: "failure" })], () => green).length === 1],
    ["un job saltato non è verde", ciProblems(sha, [run({})], () => green.map((job, i) => (i === 0 ? { ...job, conclusion: "skipped" } : job))).length === 1],
    ["un job mancante non è verde", ciProblems(sha, [run({})], () => green.slice(1)).length === 1],
    ["una rossa e una verde: basta la verde", ciProblems(sha, [run({ id: 2, conclusion: "failure" }), run({})], () => green).length === 0],
    ["v1.2.3 è stabile", isStable("v1.2.3")],
    ["v1.2.3-rc.1 non è stabile", !isStable("v1.2.3-rc.1")],
    ["lo stabile senza segreti fallisce", signingProblems("v1.2.3", {}).length === 8],
    ["lo stabile con tutti i segreti passa", signingProblems("v1.2.3", Object.fromEntries(Object.values(SIGNING).flat().map((name) => [name, "x"]))).length === 0],
    ["una variabile vuota è un segreto mancante", signingProblems("v1.2.3", { APPLE_ID: "" }).length === 8],
    ["una prerelease non chiede firme", signingProblems("v1.2.3-rc.1", {}).length === 0],
  ];
  const failed = cases.filter(([, ok]) => !ok);
  for (const [name] of failed) console.error(`self-test fallito: ${name}`);
  if (failed.length) process.exit(1);
  console.log(`self-test: ${cases.length} casi del cancello di rilascio`);
}

const [command, value] = process.argv.slice(2);
if (command === "--self-test") {
  selfTest();
} else if (command === "ci") {
  const problems = await checkCi(value);
  if (problems.length) {
    console.error(`il commit ${value} non ha una CI verde e completa:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`CI verde e completa per ${value}`);
} else if (command === "signing") {
  const problems = signingProblems(value ?? "", process.env);
  if (problems.length) {
    console.error(`il tag ${value} è del canale stabile e non ha le firme che promette:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(isStable(value ?? "") ? `firme del canale stabile presenti per ${value}` : `${value} non è del canale stabile: firme facoltative`);
} else {
  console.error("uso: check-release-gate.mjs ci <sha> | signing <tag> | --self-test");
  process.exit(2);
}
