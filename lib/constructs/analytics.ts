import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Construct } from 'constructs';

/**
 * PHASE 1 — "Where is my time going?"
 *
 * SessionAnalytics powers the **Session Insights panel** on the wall. For each
 * session it renders the insight-report bundle (assets/insight-templates) into
 * finished HTML and derives a short content hash used as a cache-busting stamp,
 * exposed as `insights`. The website construct injects that payload into the
 * frontend, so the panel is a real, visible feature.
 */
/** One session's insights, as rendered by the wall's Session Insights panel. */
export interface SessionInsight {
  readonly id: string;
  readonly title: string;
  readonly track: string;
  readonly capacity: number;
  /** Short hash of the rendered insight-report bundle (cache-buster). */
  readonly templatesHash: string;
}

export class SessionAnalytics extends Construct {
  /**
   * The per-session insights payload, computed at synth time. The website
   * construct injects this into the frontend so the wall can render the
   * Session Insights panel. THIS is the visible output of the slow work.
   */
  public readonly insights: SessionInsight[];

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const sessions = readCatalog().sessions;
    const insights: SessionInsight[] = [];

    // ---- SLOW (default): re-render the report bundle per session --------
    const reportHashFor = () => hashReportBundle(renderReportBundle());
    // ---------------------------------------------------------------------

    // ---- FAST (the fix): render ONCE, then reuse the hash ---------------
    // const reportHash = hashReportBundle(renderReportBundle());
    // const reportHashFor = () => reportHash;
    // ---------------------------------------------------------------------

    for (const session of sessions) {
      const templatesHash = reportHashFor().slice(0, 8);

      insights.push({
        id: session.id,
        title: session.title,
        track: session.track,
        capacity: session.capacity,
        templatesHash,
      });
    }

    this.insights = insights;
  }
}

const CATALOG_PATH = path.join(__dirname, 'analytics.config.json');
const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'assets', 'insight-templates');

interface SessionCatalog {
  sessions: Array<{ id: string; title: string; track: string; capacity: number }>;
}

/** Read + parse the (small) session catalog. */
function readCatalog(): SessionCatalog {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8')) as SessionCatalog;
}

/**
 * Render the insight-report bundle: read every template file in the bundle and
 * assemble them into one finished document (a trivial {{token}} substitution
 * stands in for the templating engine). Genuinely expensive — it reads and
 * processes the entire template directory on each call, and (unlike CDK's
 * cached asset fingerprinting) it does the real work every time.
 *
 * THE BUG is not this function — it's that the SLOW toggle calls it once per
 * session, re-reading and re-assembling the identical bundle every time.
 * Hoisting the call out of the loop (the FAST toggle) fixes it.
 */
function renderReportBundle(): string {
  const files = fs.readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.hbs'));
  let assembled = '';
  for (const file of files) {
    const template = fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf-8');
    assembled += template.replace(/{{(\w+)}}/g, (_m, key) => String(key).toUpperCase());
  }
  return assembled;
}

/** Short content hash of the rendered bundle — the cache-busting stamp. */
function hashReportBundle(rendered: string): string {
  return crypto.createHash('sha256').update(rendered).digest('hex');
}
