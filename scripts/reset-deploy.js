#!/usr/bin/env node
"use strict";

/**
 * reset:deploy — restore the DEPLOYED demo to its baseline, reliably, every run.
 *
 * Why this exists
 * ---------------
 * Phase 3a hotswaps the reactions Lambda (V1 -> V2). Hotswap calls the Lambda
 * UpdateFunctionCode API directly, so the RUNNING function changes but
 * CloudFormation's record does not. When you then flip the code back to V1 and
 * run a normal `cdk deploy`, CDK compares the V1 asset to the asset CFN already
 * has (also V1) and reports "no changes" — so the live function stays stuck on
 * the hotswapped V2. `--force` and `--revert-drift` don't help, because from
 * CDK's point of view nothing changed.
 *
 * The fix: bypass CDK's change detection entirely and push the baseline handler
 * code straight to the running function with `aws lambda update-function-code`.
 * That API ALWAYS overwrites the code, so the deployed Lambda returns to V1
 * regardless of what CloudFormation thinks. This is idempotent and safe to run
 * before every take.
 *
 * What it does (a COMPLETE "toggle everything back and redeploy"):
 *   1. Reset local code to the committed baseline (git checkout) + rebuild.
 *   2. Confirm AWS credentials are valid.
 *   2.5. Full `cdk deploy --revert-drift` — reverts every TEMPLATE-level change
 *        back to baseline (Phase 3b express CloudFront change, Phase 2 bucket
 *        toggle, frontend assets, etc.).
 *   3. Find the deployed reactions Lambda from the stack's resources.
 *   4. Zip the baseline handler and update the function code directly — this is
 *      the part a normal deploy can't do (hotswap drift is invisible to CFN).
 *   5. Verify GET /reactions reports apiVersion "v1".
 *
 * Usage:  npm run reset:deploy
 */

const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const STACK = "SkipTheWait-FeedbackWall";
const HANDLER_DIR = path.join(ROOT, "lambda", "reactions");

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], ...opts });
}

function step(msg) {
  process.stdout.write("\n▶ " + msg + "\n");
}

function fail(msg) {
  process.stderr.write("\n❌ " + msg + "\n");
  process.exit(1);
}

// 1. Reset local code to baseline + rebuild --------------------------------
step("Resetting local demo code to the committed baseline…");
try {
  run("git checkout -- bin lib lambda frontend rules assets test");
  run("npm run build");
  console.log("  local code reset + built (all toggles back to baseline).");
} catch (e) {
  fail("Local reset/build failed:\n" + (e.stdout || "") + (e.stderr || ""));
}

// 2. Credentials -----------------------------------------------------------
step("Checking AWS credentials…");
try {
  const who = run("aws sts get-caller-identity --query Account --output text").trim();
  console.log("  authenticated to account " + who + ".");
} catch (e) {
  fail(
    "AWS credentials are not valid. Re-authenticate (SSO / Isengard / ada), then re-run.\n" +
      "  Check with: aws sts get-caller-identity",
  );
}

// 2.5. Full baseline deploy ------------------------------------------------
// Reverts every template-level change back to baseline: the Phase 3b express
// CloudFront change (errorResponses), the Phase 2 bucket toggle, frontend
// assets, etc. `--revert-drift` also reconciles the drift hotswap introduced at
// the CloudFormation level. This does NOT reliably fix the running Lambda code
// (hotswap drift is invisible to CFN) — step 4 handles that directly.
step("Deploying the baseline stack (reverts CloudFront/express + all template drift)…");
try {
  run(`npx cdk deploy ${STACK} --revert-drift --require-approval never`, { stdio: "inherit" });
  console.log("  baseline stack deployed.");
} catch (e) {
  fail(
    "Baseline `cdk deploy` failed. Fix the error above, then re-run.\n" +
      (e.stdout || "") + (e.stderr || ""),
  );
}

// 3. Find the deployed reactions Lambda ------------------------------------
step("Locating the deployed reactions Lambda…");
let functionName;
try {
  const out = run(
    `aws cloudformation describe-stack-resources --stack-name ${STACK} ` +
      `--query "StackResources[?ResourceType=='AWS::Lambda::Function'].PhysicalResourceId" --output text`,
  ).trim();
  const names = out.split(/\s+/).filter(Boolean);
  // The reactions handler is the API one; match on the logical id path.
  functionName =
    names.find((n) => /ApiHandler/i.test(n)) ||
    names.find((n) => /Handler/i.test(n) && !/Custom|Deployment|Provider|AutoDelete|LogRetention/i.test(n));
  if (!functionName) {
    // Fallback: query by resource logical id.
    functionName = run(
      `aws cloudformation describe-stack-resource --stack-name ${STACK} ` +
        `--logical-resource-id ApiHandler --query StackResourceDetail.PhysicalResourceId --output text`,
    ).trim();
  }
  if (!functionName) throw new Error("could not identify the reactions function");
  console.log("  function: " + functionName);
} catch (e) {
  fail(
    "Could not find the reactions Lambda in stack " + STACK + ".\n" +
      "Is the stack deployed? Try: cdk deploy " + STACK + "\n" +
      (e.stdout || "") + (e.stderr || ""),
  );
}

// 4. Zip the baseline handler and push it directly -------------------------
step("Pushing the baseline handler code directly (bypasses CFN change detection)…");
const zipPath = path.join(os.tmpdir(), "reactions-baseline-" + Date.now() + ".zip");
try {
  // Zip the contents of the handler dir (index.js at the zip root).
  run(`cd "${HANDLER_DIR}" && zip -qr "${zipPath}" .`);
  run(
    `aws lambda update-function-code --function-name "${functionName}" ` +
      `--zip-file "fileb://${zipPath}" --publish --output text --query LastModified`,
  );
  console.log("  UpdateFunctionCode succeeded — running function is now the V1 baseline.");
} catch (e) {
  fail("update-function-code failed:\n" + (e.stdout || "") + (e.stderr || ""));
} finally {
  try { fs.unlinkSync(zipPath); } catch (_) {}
}

// 5. Verify ----------------------------------------------------------------
step("Verifying the live API reports the baseline version…");
try {
  const apiUrl = run(
    `aws cloudformation describe-stacks --stack-name ${STACK} ` +
      `--query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text`,
  ).trim();

  // update-function-code takes a few seconds to propagate. Poll before warning
  // so we don't cry wolf on what is actually a success.
  let version = "(not reported)";
  for (let attempt = 1; attempt <= 6; attempt++) {
    run("sleep 3");
    const body = run(`curl -s "${apiUrl}reactions"`);
    const m = body.match(/"apiVersion":"([^"]*)"/);
    version = m ? m[1] : "(not reported)";
    if (version === "v1") break;
    process.stdout.write(`  …still "${version}" (attempt ${attempt}/6), waiting for propagation…\n`);
  }

  if (version === "v1") {
    console.log("  ✅ live API reports apiVersion \"v1\". Baseline restored.");
  } else {
    console.log(
      "  ⚠️ live API still reports \"" + version + "\" after ~18s. Re-check in a moment:\n" +
        "     curl -s " + apiUrl + "reactions | grep apiVersion",
    );
  }
} catch (e) {
  console.log("  (Could not auto-verify; check the wall manually.) " + (e.message || ""));
}

console.log("\n✨ reset:deploy complete. Local code + deployed Lambda are on the V1 baseline.\n");
