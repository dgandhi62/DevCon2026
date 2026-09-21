import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

/**
 * PHASE 1 — "Where is my time going?"
 *
 * SessionAnalytics builds a CloudWatch dashboard with one row of widgets per
 * conference session, plus a per-session "fingerprint" used as a widget title.
 *
 * It works. It is also needlessly slow to synthesize — and the slowness is a
 * DUPLICATED-WORK bug, not cross-stack references and not sheer resource count.
 *
 * The bug (look at buildSessionFingerprint below):
 *   For every session, the constructor re-reads analytics.config.json from
 *   disk, re-parses the JSON, and re-computes a deliberately expensive hash
 *   over the ENTIRE file. That work is identical on every iteration — the
 *   input never changes — so it should happen once, not once per session.
 *
 * In a CPU profile of `cdk synth` this shows up as "Construction"-phase time
 * dominated by ONE user-code function (buildSessionFingerprint / hashConfig),
 * called N times with identical input. The synth-performance skill should
 * name this function and these line numbers.
 *
 * THE FIX (shown live on stage): read + parse + hash ONCE before the loop and
 * reuse the result. See docs/PRESENTER-SCRIPT.md for the exact diff.
 */
export interface SessionAnalyticsProps {
  /** The reactions table to chart alongside the session widgets. */
  readonly table: dynamodb.Table;

  /**
   * How hard to make the per-session hash. Higher = more dramatic on stage.
   * Each unit is one extra pass of PBKDF2 rounds over the config bytes.
   *
   * @default 900
   */
  readonly hashRounds?: number;
}

export class SessionAnalytics extends Construct {
  /** The generated dashboard. */
  public readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: SessionAnalyticsProps) {
    super(scope, id);

    const hashRounds = props.hashRounds ?? 900;

    this.dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: 'DevCon2026-FeedbackWall-Sessions',
    });

    // We loop over the sessions to build a widget row for each one.
    //
    // BUG: buildSessionFingerprint() re-reads + re-parses + re-hashes the whole
    // config file on EVERY iteration. The file is the same every time. This is
    // the duplicated work the Phase 1 demo hunts down.
    const sessionCount = readConfig().sessions.length;

    for (let i = 0; i < sessionCount; i++) {
      const fingerprint = buildSessionFingerprint(i, hashRounds); // <-- duplicated work

      const session = readConfig().sessions[i]; // <-- another duplicated read

      this.dashboard.addWidgets(
        new cloudwatch.TextWidget({
          markdown: `### ${session.title}\n\`${fingerprint.slice(0, 16)}\` · track: ${session.track}`,
          width: 24,
          height: 1,
        }),
        new cloudwatch.GraphWidget({
          title: `Reactions volume — ${session.title}`,
          width: 12,
          height: 6,
          left: [
            props.table.metricConsumedReadCapacityUnits(),
            props.table.metricConsumedWriteCapacityUnits(),
          ],
        }),
        new cloudwatch.GraphWidget({
          title: `Table latency — ${session.title}`,
          width: 12,
          height: 6,
          left: [
            props.table.metricSuccessfulRequestLatency({
              dimensionsMap: { TableName: props.table.tableName, Operation: 'GetItem' },
            }),
          ],
        }),
      );
    }
  }
}

/** Absolute path to the session catalog consumed at synth time. */
const CONFIG_PATH = path.join(__dirname, 'analytics.config.json');

interface SessionConfig {
  namespace: string;
  sessions: Array<{ id: string; title: string; track: string; capacity: number }>;
}

/**
 * Read + parse the config from disk. Cheap on its own — but called from inside
 * the loop (and from buildSessionFingerprint), so it runs N times per synth.
 */
function readConfig(): SessionConfig {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw) as SessionConfig;
}

/**
 * Compute a per-session "fingerprint". The expensive part is hashConfig(),
 * which hashes the ENTIRE config file — the same bytes every call. Only the
 * cheap suffix (the session index) actually varies between calls, so hashing
 * the whole file every time is pure duplicated work.
 */
function buildSessionFingerprint(sessionIndex: number, rounds: number): string {
  const base = hashConfig(rounds); // identical result every call — should be hoisted
  return crypto
    .createHash('sha256')
    .update(base + ':' + sessionIndex)
    .digest('hex');
}

/**
 * Deliberately expensive hash over the whole config file. Reads the file again,
 * then runs PBKDF2 over its bytes. This is where the synth seconds go.
 */
function hashConfig(rounds: number): string {
  const raw = fs.readFileSync(CONFIG_PATH); // duplicated read #3
  // PBKDF2 is intentionally CPU-heavy; `rounds` scales it for the demo.
  const derived = crypto.pbkdf2Sync(raw, 'devcon-2026-salt', rounds * 1000, 32, 'sha512');
  return derived.toString('hex');
}
