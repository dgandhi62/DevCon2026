#!/usr/bin/env node
"use strict";

/**
 * Ground-state check for the "AWS CDK — Skip the wait" demo.
 *
 * Run this BEFORE a demo to confirm everything is in its known-good baseline,
 * and AFTER a rehearsal to find out what you left broken.
 *
 *   node test/ground-state.js
 *   npm test
 *
 * IMPORTANT: this demo contains DELIBERATELY broken/slow code (Phase 1's slow
 * analytics construct, Phase 2's public bucket). So "ground state" does NOT mean
 * "everything passes". It means:
 *
 *   - the WORKING things work        (app synths clean with no warnings)
 *   - the BROKEN things are broken in the EXPECTED way
 *       (public bucket fails validation with CT.S3.PR.1)
 *   - the SLOW thing is measurably slower than the fast path
 *   - all the demo files are present and wired correctly
 *
 * No test framework — pure Node so it always runs. Offline only (no AWS account,
 * no deploy). Exit code 0 = ground state good; non-zero = something drifted.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const cdkBin = path.join(ROOT, "node_modules", ".bin", "cdk");

// ---- tiny test harness ----
let passed = 0;
let failed = 0;
const failures = [];

function check(name, fn) {
  process.stdout.write(`  … ${name}`);
  try {
    const detail = fn();
    passed++;
    process.stdout.write(`\r  ✅ ${name}${detail ? `  (${detail})` : ""}\n`);
  } catch (err) {
    failed++;
    failures.push({ name, message: err.message });
    process.stdout.write(`\r  ❌ ${name}\n`);
    process.stdout.write(`       ${err.message}\n`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

/**
 * Run a cdk synth for one stack. Returns { code, out } where `out` is combined
 * stdout+stderr. Never throws on non-zero exit — we assert on the code.
 *
 * MEMOIZED: the base app synth is deliberately slow (~15-20s). Several checks
 * inspect the same synth output, so we run each unique (stack + args) synth
 * once and reuse the result — otherwise the suite would take minutes.
 */
const synthCache = new Map();
function synth(stack, extraArgs = []) {
  const key = stack + " " + extraArgs.join(" ");
  if (synthCache.has(key)) return synthCache.get(key);
  const result = runSynth(stack, extraArgs);
  synthCache.set(key, result);
  return result;
}

function runSynth(stack, extraArgs = []) {
  const args = ["synth", stack, "--no-color", ...extraArgs];
  try {
    const out = execSync(`"${cdkBin}" ${args.join(" ")}`, {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "1" },
      // The base app synth is deliberately slow (~15-20s, Phase 1). Give it
      // plenty of headroom and a large buffer so the harness never flakes on a
      // cold, slow synth.
      timeout: 120000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { code: 0, out };
  } catch (e) {
    // execSync throws on non-zero exit OR timeout; capture what we can.
    const out = `${e.stdout || ""}\n${e.stderr || ""}`;
    // A timeout kill surfaces as e.signal (e.g. SIGTERM) with null status.
    const code = e.status == null ? (e.signal ? 124 : 1) : e.status;
    return { code, out };
  }
}

function fileExists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}

function nowMs() {
  return Date.now();
}

/**
 * Is a line matching `pattern` present AND uncommented (i.e. active code)?
 * Used to check which side of a DEMO TOGGLE is currently live. A line is
 * considered commented if its first non-whitespace characters are `//`.
 */
function hasActiveLine(src, pattern) {
  return src.split("\n").some((line) => {
    if (/^\s*\/\//.test(line)) return false; // commented out
    return pattern.test(line);
  });
}

// ============================================================
console.log("\n=== Ground-state check: AWS CDK — Skip the wait ===");
console.log("(offline only — no AWS account or deploy involved)");

// ------------------------------------------------------------
section("1. Project files present");

const REQUIRED_FILES = [
  "bin/app.ts",
  "lib/feedback-wall-stack.ts",
  "lib/constructs/database.ts",
  "lib/constructs/api.ts",
  "lib/constructs/website.ts",
  "lib/constructs/analytics.ts",
  "lib/constructs/analytics.config.json",
  "lambda/reactions/index.js",
  "frontend/index.html",
  "frontend/app.js",
  "frontend/styles.css",
  "frontend/config.js",
  "rules/s3-block-public-access.guard",
  ".kiro/skills/cdk-synth-performance.md",
  "cdk.json",
  "package.json",
  "tsconfig.json",
];

for (const f of REQUIRED_FILES) {
  check(`exists: ${f}`, () => {
    assert(fileExists(f), `missing file: ${f}`);
  });
}

// ------------------------------------------------------------
section("2. TypeScript compiles (npm run build)");

check("tsc build succeeds", () => {
  try {
    execSync("npm run build", { cwd: ROOT, encoding: "utf-8", stdio: "pipe" });
  } catch (e) {
    throw new Error(
      "build failed — run `npm run build` to see errors:\n" +
        `${(e.stdout || "") + (e.stderr || "")}`.slice(0, 800),
    );
  }
});

check("compiled entry bin/app.js exists after build", () => {
  assert(fileExists("bin/app.js"), "bin/app.js not produced by build");
});

// ------------------------------------------------------------
section("3. The WORKING app synthesizes clean");

check("SkipTheWait-FeedbackWall synths (exit 0)", () => {
  const { code } = synth("SkipTheWait-FeedbackWall");
  assert(code === 0, `expected exit 0, got ${code}`);
});

check("app synth has NO deprecation warnings", () => {
  const { out } = synth("SkipTheWait-FeedbackWall");
  const bad = out
    .split("\n")
    .filter((l) => /deprecated|\[WARNING\]/i.test(l))
    // The runtime-deprecation line only appears if someone downgraded the
    // Lambda runtime; treat any deprecation as drift.
    .map((l) => l.trim());
  assert(bad.length === 0, `unexpected warnings:\n       ${bad.join("\n       ")}`);
});

check("app template contains the core resources", () => {
  const { out } = synth("SkipTheWait-FeedbackWall");
  for (const type of [
    "AWS::DynamoDB::Table",
    "AWS::Lambda::Function",
    "AWS::ApiGateway::RestApi",
    "AWS::CloudFront::Distribution",
    "AWS::S3::Bucket",
  ]) {
    assert(out.includes(type), `template missing resource type: ${type}`);
  }
});

// ------------------------------------------------------------
section("4. Phase 2 — website-bucket validation toggle (baseline = LOCKED)");

check("Phase 2 toggle is on state C (LOCKED) — baseline", () => {
  const site = read("lib/constructs/website.ts");
  // Baseline: the locked bucket (BLOCK_ALL) is the ACTIVE new s3.Bucket call.
  const lockedActive = hasActiveLine(site, /blockPublicAccess:\s*s3\.BlockPublicAccess\.BLOCK_ALL/);
  // The public toggles (publicReadAccess) must be commented in baseline.
  const publicActive = hasActiveLine(site, /publicReadAccess:\s*true/);
  assert(
    lockedActive && !publicActive,
    "Phase 2 website-bucket toggle is not on the LOCKED baseline. Reset website.ts to state C.",
  );
});

check("all three Phase 2 states exist in website.ts (A built-in, B plugin, C locked)", () => {
  const site = read("lib/constructs/website.ts");
  assert(/A\) BUILT-IN/.test(site), "state A (built-in validation) block missing");
  assert(/B\) POLICY PLUGIN/.test(site), "state B (plugin validation) block missing");
  assert(/C\) LOCKED/.test(site), "state C (locked baseline) block missing");
});

check("baseline app synths clean (bucket LOCKED, plugin OFF)", () => {
  // Baseline: the site bucket is locked (state C) and the policy plugin is OFF
  // by default, so synth must succeed with no validation findings.
  const { code, out } = synth("SkipTheWait-FeedbackWall");
  assert(code === 0, `expected baseline to synth clean, got exit ${code}`);
  assert(!out.includes("CT.S3.PR.1"), "baseline unexpectedly tripped the public-access rule");
});

// ------------------------------------------------------------
section("5. Phase 1 — the BASE app is slow to synth (bottleneck baked in)");

let fastMs = 0;
let slowMs = 0;

check("base app synths (exit 0) — analytics ON by default", () => {
  // Uncached (runSynth): we need to measure a REAL synth, not a cache hit.
  const t = nowMs();
  const { code } = runSynth("SkipTheWait-FeedbackWall");
  slowMs = nowMs() - t;
  assert(code === 0, `expected exit 0, got ${code}`);
  return `${slowMs} ms`;
});

check("fast baseline synths (exit 0) — analytics OFF", () => {
  const t = nowMs();
  const { code } = runSynth("SkipTheWait-FeedbackWall", ["-c", "includeAnalytics=false"]);
  fastMs = nowMs() - t;
  assert(code === 0, `expected exit 0, got ${code}`);
  return `${fastMs} ms`;
});

check("base app is clearly slower than the fast baseline (bottleneck exists)", () => {
  // Hardware-independent: only assert the base (analytics-on) synth is
  // meaningfully slower than the analytics-off baseline. If the hoist fix was
  // applied, this fails — the signal to reset lib/constructs/analytics.ts.
  const delta = slowMs - fastMs;
  assert(
    delta > 700,
    `base app synth was only ${delta}ms slower than the fast baseline ` +
      `(${slowMs} vs ${fastMs}). The Phase 1 bottleneck may have been fixed — ` +
      "reset lib/constructs/analytics.ts to the SLOW toggle.",
  );
  return `+${delta} ms`;
});

// ------------------------------------------------------------
section("6. Phase 1 — toggle is on the SLOW (baseline) side");

check("analytics SLOW block is active, FAST block is commented", () => {
  const src = read("lib/constructs/analytics.ts");
  // SLOW baseline: reportHashFor re-renders the bundle per session (active).
  const slowActive = hasActiveLine(src, /reportHashFor\s*=\s*\(\)\s*=>\s*hashReportBundle\(renderReportBundle\(\)\)/);
  // FAST fix: reportHash rendered once (should be commented in baseline).
  const fastActive = hasActiveLine(src, /const\s+reportHash\s*=\s*hashReportBundle\(renderReportBundle\(\)\)/);
  assert(
    slowActive && !fastActive,
    "Phase 1 toggle is on the FAST side (or unclear). Reset to baseline: " +
      "the SLOW block should be active and the FAST block commented.",
  );
});

check("the bottleneck (per-session bundle render) is intact", () => {
  const src = read("lib/constructs/analytics.ts");
  assert(/function renderReportBundle/.test(src), "renderReportBundle removed");
  assert(/readdirSync\(TEMPLATES_DIR/.test(src), "the template directory read removed");
  // The template bundle must be sizable, or the synth won't be slow.
  const fsMod = require("fs");
  const pathMod = require("path");
  const dir = pathMod.join(__dirname, "..", "assets", "insight-templates");
  const files = fsMod.readdirSync(dir).filter((f) => f.endsWith(".hbs"));
  let bytes = 0;
  for (const f of files) bytes += fsMod.statSync(pathMod.join(dir, f)).size;
  assert(files.length >= 200, `only ${files.length} template files — too few for a slow synth`);
  assert(bytes > 10 * 1024 * 1024, `template bundle is only ${(bytes / 1048576).toFixed(1)}MB — too small`);
  return `${files.length} files, ${(bytes / 1048576).toFixed(0)}MB`;
});

check("analytics.config.json has the session catalog", () => {
  const cfg = JSON.parse(read("lib/constructs/analytics.config.json"));
  assert(Array.isArray(cfg.sessions), "sessions array missing");
  assert(cfg.sessions.length >= 5, `expected several sessions, got ${cfg.sessions.length}`);
  return `${cfg.sessions.length} sessions`;
});

check("the slow work is VISIBLE — insights flow to the wall panel", () => {
  // analytics exposes the payload...
  const an = read("lib/constructs/analytics.ts");
  assert(/public readonly insights/.test(an), "SessionAnalytics no longer exposes `insights`");
  // ...the website injects it...
  const site = read("lib/constructs/website.ts");
  assert(/SESSION_INSIGHTS/.test(site), "website no longer injects window.SESSION_INSIGHTS");
  // ...and the frontend renders it.
  const html = read("frontend/index.html");
  assert(/insightsGrid/.test(html), "frontend has no Session Insights panel");
  const fe = read("frontend/app.js");
  assert(/renderInsights/.test(fe) && /SESSION_INSIGHTS/.test(fe), "frontend no longer renders insights");
});

check("analytics is ON by default in the base app", () => {
  const stack = read("lib/feedback-wall-stack.ts");
  assert(
    /includeAnalytics\s*\?\?\s*true/.test(stack),
    "analytics is no longer ON by default (base app should be slow out of the box)",
  );
});

// ------------------------------------------------------------
section("7. Phase 2 — the policy plugin (Layer 2) is OFF by default");

check("the CFN-Guard plugin toggle is OFF (not registered) — baseline", () => {
  const src = read("bin/app.ts");
  const pluginOn =
    hasActiveLine(src, /addPlugins\(/) || hasActiveLine(src, /new CfnGuardValidator\(/);
  assert(
    !pluginOn,
    "Phase 2 plugin toggle is ON (CfnGuardValidator active). Baseline is OFF — comment the " +
      "addPlugins block in bin/app.ts.",
  );
});

check("the plugin toggle block still exists (commented) so it can be turned ON", () => {
  const src = read("bin/app.ts");
  assert(/CfnGuardValidator/.test(src), "the CfnGuardValidator toggle block is gone from bin/app.ts");
  assert(/s3-block-public-access\.guard/.test(src), "the scoped rule reference is gone");
});

check("the scoped public-access guard rule exists", () => {
  assert(fileExists("rules/s3-block-public-access.guard"), "missing the guard rule file");
});

// ------------------------------------------------------------
section("8. Phase 3 — hotswap/express targets are intact");

check("Lambda handler exposes the 3 API routes", () => {
  const src = read("lambda/reactions/index.js");
  assert(/listReactions/.test(src), "listReactions handler missing");
  assert(/createReaction/.test(src), "createReaction handler missing");
  assert(/upvote/.test(src), "upvote handler missing");
});

check("API construct uses a directory asset (no build step for hotswap)", () => {
  const src = read("lib/constructs/api.ts");
  assert(
    /Code\.fromAsset/.test(src),
    "api.ts should use lambda.Code.fromAsset so hotswap needs no build",
  );
  assert(
    /NODEJS_22_X/.test(src),
    "api.ts Lambda runtime drifted from NODEJS_22_X",
  );
});

check("website construct injects config.js (express target wiring)", () => {
  const src = read("lib/constructs/website.ts");
  assert(/BucketDeployment/.test(src), "website.ts missing BucketDeployment");
  assert(/FEEDBACK_API/.test(src), "website.ts no longer injects the API URL config");
});

check("frontend expects the same API contract", () => {
  const src = read("frontend/app.js");
  assert(/FEEDBACK_API/.test(src), "frontend/app.js no longer reads window.FEEDBACK_API");
  assert(/\/reactions/.test(src), "frontend/app.js no longer calls /reactions");
});

check("Phase 3a hotswap toggle is on V1 (baseline API_VERSION)", () => {
  const src = read("lambda/reactions/index.js");
  const v1Active = hasActiveLine(src, /const API_VERSION\s*=\s*"v1"/);
  const v2Active = hasActiveLine(src, /const API_VERSION\s*=\s*"v2/);
  assert(
    v1Active && !v2Active,
    "hotswap toggle is on V2 (API_VERSION bumped). Reset to V1 baseline.",
  );
});

check("hotswap change is surfaced to the wall (apiVersion in list response)", () => {
  const src = read("lambda/reactions/index.js");
  assert(
    /apiVersion:\s*API_VERSION/.test(src),
    "listReactions no longer returns apiVersion — the wall badge won't update",
  );
  const fe = read("frontend/app.js");
  assert(/updateApiBadge/.test(fe), "frontend no longer updates the api badge");
});

check("Phase 3b express toggle is on V1 (baseline, no errorResponses)", () => {
  const src = read("lib/constructs/website.ts");
  const v2Active = hasActiveLine(src, /errorResponses:\s*\[/);
  assert(
    !v2Active,
    "express toggle is on V2 (errorResponses live). Reset to V1 baseline.",
  );
});

// ============================================================
// Cleanup synth output so we don't leave cdk.out lying around.
try {
  fs.rmSync(path.join(ROOT, "cdk.out"), { recursive: true, force: true });
} catch (_) {
  /* ignore */
}

console.log("\n" + "=".repeat(52));
console.log(`  RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\n  Ground state has DRIFTED. What to do:");
  console.log("  • If you were rehearsing, you probably left an edit in place.");
  console.log("  • Reset with git:   git stash   (or)   git checkout -- <file>");
  console.log("  • Then re-run:      npm test");
  console.log("\n  Failing checks:");
  for (const f of failures) console.log(`    ❌ ${f.name}\n       ${f.message}`);
  console.log("=".repeat(52) + "\n");
  process.exit(1);
}
console.log("  Ground state is GOOD. Safe to start the demo. 🚀");
console.log("=".repeat(52) + "\n");
process.exit(0);
