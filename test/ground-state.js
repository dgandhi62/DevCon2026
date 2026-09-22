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
 *   - the WORKING things work        (app synths clean, fixed stack passes)
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
 */
function synth(stack, extraArgs = []) {
  const args = ["synth", stack, "--no-color", ...extraArgs];
  try {
    const out = execSync(`"${cdkBin}" ${args.join(" ")}`, {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "1" },
    });
    return { code: 0, out };
  } catch (e) {
    // execSync throws on non-zero exit; capture what we can.
    const out = `${e.stdout || ""}\n${e.stderr || ""}`;
    return { code: e.status == null ? 1 : e.status, out };
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
  "lib/phase2-broken-stack.ts",
  "lib/phase2-fixed-stack.ts",
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
section("4. Phase 2 — validation behaves as scripted");

check("BROKEN stack FAILS synth (exit != 0)", () => {
  const { code } = synth("SkipTheWait-Phase2-Broken");
  assert(code !== 0, "expected the broken stack to FAIL synth, but it passed");
});

check("BROKEN failure is the S3 public-access rule (CT.S3.PR.1)", () => {
  const { out } = synth("SkipTheWait-Phase2-Broken");
  assert(
    out.includes("CT.S3.PR.1"),
    "expected rule CT.S3.PR.1 in the validation output",
  );
  assert(
    /block public access/i.test(out),
    "expected 'block public access' in the failure message",
  );
});

check("BROKEN failure names the construct path", () => {
  const { out } = synth("SkipTheWait-Phase2-Broken");
  assert(
    out.includes("SkipTheWait-Phase2-Broken/PublicAssets/Resource"),
    "expected the PublicAssets construct path in the report",
  );
});

check("FIXED stack PASSES synth (exit 0)", () => {
  const { code } = synth("SkipTheWait-Phase2-Fixed");
  assert(code === 0, `expected the fixed stack to pass, got exit ${code}`);
});

// ------------------------------------------------------------
section("5. Phase 1 — slow synth is measurably slower");

let fastMs = 0;
let slowMs = 0;

check("app WITHOUT analytics synths (exit 0)", () => {
  const t = nowMs();
  const { code } = synth("SkipTheWait-FeedbackWall");
  fastMs = nowMs() - t;
  assert(code === 0, `expected exit 0, got ${code}`);
  return `${fastMs} ms`;
});

check("app WITH analytics synths (exit 0)", () => {
  const t = nowMs();
  const { code } = synth("SkipTheWait-FeedbackWall", ["-c", "includeAnalytics=true"]);
  slowMs = nowMs() - t;
  assert(code === 0, `expected exit 0, got ${code}`);
  return `${slowMs} ms`;
});

check("analytics path is clearly slower (the Phase 1 bottleneck exists)", () => {
  // We don't assert an absolute time (hardware varies), only that the slow path
  // is meaningfully slower. If someone already applied the hoist fix, this fails
  // — which is the signal to reset analytics.ts to its baseline (slow) state.
  const delta = slowMs - fastMs;
  assert(
    delta > 700,
    `analytics synth was only ${delta}ms slower than fast (${fastMs} vs ${slowMs}). ` +
      "The Phase 1 bottleneck may have been fixed/removed — reset lib/constructs/analytics.ts.",
  );
  return `+${delta} ms`;
});

// ------------------------------------------------------------
section("6. Phase 1 — toggle is on the SLOW (baseline) side");

check("analytics SLOW block is active, FAST block is commented", () => {
  const src = read("lib/constructs/analytics.ts");
  // SLOW baseline: getFingerprint re-hashes per iteration (active).
  const slowActive = hasActiveLine(src, /getFingerprint\s*=\s*\(i:\s*number\)\s*=>\s*buildSessionFingerprint/);
  // FAST fix: baseHash computed once (should be commented in baseline).
  const fastActive = hasActiveLine(src, /const\s+baseHash\s*=\s*hashConfig/);
  assert(
    slowActive && !fastActive,
    "Phase 1 toggle is on the FAST side (or unclear). Reset to baseline: " +
      "the SLOW block should be active and the FAST block commented.",
  );
});

check("the bottleneck helpers still exist in the file", () => {
  const src = read("lib/constructs/analytics.ts");
  assert(/function buildSessionFingerprint/.test(src), "buildSessionFingerprint removed");
  assert(/pbkdf2Sync/.test(src), "pbkdf2Sync (the expensive hash) removed");
});

check("analytics.config.json has the session catalog", () => {
  const cfg = JSON.parse(read("lib/constructs/analytics.config.json"));
  assert(Array.isArray(cfg.sessions), "sessions array missing");
  assert(cfg.sessions.length >= 5, `expected several sessions, got ${cfg.sessions.length}`);
  return `${cfg.sessions.length} sessions`;
});

// ------------------------------------------------------------
section("7. Phase 2 — toggle is on the BROKEN (baseline) side");

check("Phase2-Broken toggle is on the BROKEN side (public access active)", () => {
  const src = read("lib/phase2-broken-stack.ts");
  // BROKEN baseline: publicReadAccess: true is active code.
  const brokenActive = hasActiveLine(src, /publicReadAccess:\s*true/);
  // FIXED: BLOCK_ALL active would mean the toggle was flipped.
  const fixedActive = hasActiveLine(src, /BlockPublicAccess\.BLOCK_ALL/);
  assert(
    brokenActive && !fixedActive,
    "Phase 2 toggle is on the FIXED side (or unclear). Reset to baseline: " +
      "the BROKEN block should be active and the FIXED block commented.",
  );
});

check("the always-passing Phase2-Fixed stack still uses BLOCK_ALL", () => {
  const src = read("lib/phase2-fixed-stack.ts");
  assert(
    /BlockPublicAccess\.BLOCK_ALL/.test(src),
    "the standalone fixed stack no longer uses BLOCK_ALL",
  );
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

check("Phase 3a hotswap toggle is on V1 (baseline, no source stamp)", () => {
  const src = read("lambda/reactions/index.js");
  const v2Active = hasActiveLine(src, /source:\s*"hotswap-demo"/);
  assert(
    !v2Active,
    "hotswap toggle is on V2 (the source stamp is live). Reset to V1 baseline.",
  );
});

check("Phase 3b express toggle is on V1 (baseline, no errorResponses)", () => {
  const src = read("lib/constructs/website.ts");
  const v2Active = hasActiveLine(src, /errorResponses:\s*\[/);
  assert(
    !v2Active,
    "express toggle is on V2 (errorResponses live). Reset to V1 baseline.",
  );
});

// ------------------------------------------------------------
section("9. Validation plugin is wired in bin/app.ts");

check("bin/app.ts registers the CfnGuard validator", () => {
  const src = read("bin/app.ts");
  assert(/CfnGuardValidator/.test(src), "CfnGuardValidator import/use missing");
  assert(
    /Validations\.of\(app\)\.addPlugins/.test(src),
    "validation should be registered via Validations.of(app).addPlugins(...)",
  );
  assert(
    /s3-block-public-access\.guard/.test(src),
    "the scoped public-access rule is no longer referenced",
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
