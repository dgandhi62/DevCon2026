import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

/**
 * PHASE 1 — "Where is my time going?"
 *
 * SessionAnalytics powers the **Session Insights panel** you see on the wall.
 * At synth time it precomputes a per-session insights payload (title, track,
 * a capacity bar, and a short "fingerprint" badge) and exposes it as
 * `insights`. The website construct injects that payload into the frontend, so
 * the panel is a real, visible feature of the app — not a hidden dashboard.
 *
 * It works. It is also needlessly slow to synthesize — and the slowness is a
 * DUPLICATED-WORK bug, not cross-stack references and not sheer resource count.
 *
 * THE BUG (see the SLOW block below + hashConfig):
 *   For every session, the constructor re-reads analytics.config.json from
 *   disk, re-parses the JSON, and re-computes a deliberately expensive hash
 *   over the ENTIRE file. That work is identical on every iteration — the
 *   input never changes — so it should happen once, not once per session.
 *
 * In a CPU profile of `cdk synth` this shows up as "Construction"-phase time
 * dominated by ONE user-code function (buildSessionFingerprint / hashConfig),
 * called N times with identical input. The cdk-synth-performance skill should
 * name this function and these line numbers.
 *
 * THE FIX: compute the invariant read + hash ONCE before the loop and reuse it
 * (the FAST block below). The panel renders identically; synth gets fast.
 */
export interface SessionAnalyticsProps {
  /** The reactions table to chart on the (secondary) CloudWatch dashboard. */
  readonly table: dynamodb.Table;

  /**
   * How hard to make the per-session hash. Higher = more dramatic on stage.
   * Each unit is one extra pass of PBKDF2 rounds over the config bytes.
   *
   * @default 900
   */
  readonly hashRounds?: number;
}

/** One session's insights, as rendered by the wall's Session Insights panel. */
export interface SessionInsight {
  readonly id: string;
  readonly title: string;
  readonly track: string;
  readonly capacity: number;
  /** Short hash badge shown on the card (derived at synth time). */
  readonly fingerprint: string;
}

export class SessionAnalytics extends Construct {
  /** The CloudWatch dashboard (secondary artifact). */
  public readonly dashboard: cloudwatch.Dashboard;

  /**
   * The per-session insights payload, precomputed at synth time. The website
   * construct injects this into the frontend so the wall can render the
   * Session Insights panel. THIS is the visible output of the slow work.
   */
  public readonly insights: SessionInsight[];

  constructor(scope: Construct, id: string, props: SessionAnalyticsProps) {
    super(scope, id);

    const hashRounds = props.hashRounds ?? 900;

    this.dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: 'DevCon2026-FeedbackWall-Sessions',
    });

    const insights: SessionInsight[] = [];

    // ┌──────────────────────────────────────────────────────────────────┐
    // │ DEMO TOGGLE — PHASE 1  (slow synth ↔ fast synth)                   │
    // │                                                                    │
    // │ Comment ONE block, uncomment the OTHER. Do not edit the loop body. │
    // │  • SLOW block  = the duplicated-work bug (default; skill finds it)  │
    // │  • FAST block  = the fix (read + hash ONCE, hoisted out of loop)    │
    // └──────────────────────────────────────────────────────────────────┘

    // ---- SLOW (default): duplicated work on every iteration -------------
    const sessionCount = readConfig().sessions.length;
    const getSession = (i: number) => readConfig().sessions[i];          // re-reads file
    const getFingerprint = (i: number) => buildSessionFingerprint(i, hashRounds); // re-hashes file
    // ---------------------------------------------------------------------

    // ---- FAST (the fix): compute the invariant work ONCE, before loop ---
    // const config = readConfig();                       // read + parse once
    // const baseHash = hashConfig(hashRounds);           // hash the file once
    // const sessionCount = config.sessions.length;
    // const getSession = (i: number) => config.sessions[i];
    // const getFingerprint = (i: number) =>
    //   crypto.createHash('sha256').update(baseHash + ':' + i).digest('hex');
    // ---------------------------------------------------------------------

    for (let i = 0; i < sessionCount; i++) {
      const fingerprint = getFingerprint(i);
      const session = getSession(i);

      // The visible artifact: one insight record per session for the panel.
      insights.push({
        id: session.id,
        title: session.title,
        track: session.track,
        capacity: session.capacity,
        fingerprint: fingerprint.slice(0, 8),
      });

      // Secondary artifact: a CloudWatch dashboard row per session.
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

    this.insights = insights;
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
