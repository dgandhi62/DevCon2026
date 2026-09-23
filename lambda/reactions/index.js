"use strict";

/**
 * Reactions API — the backend of the CDK Booth Feedback Wall.
 *
 * This is hand-written JavaScript on purpose: no compile step sits between an
 * edit here and `cdk deploy --hotswap`. Change this file, hotswap it, and the
 * running Lambda is updated through the Lambda UpdateFunctionCode API in
 * seconds — no CloudFormation cycle. That is the Phase 3 hotswap demo.
 *
 * Routes (fronted by API Gateway):
 *   GET  /reactions                 -> list reactions (most-voted first)
 *   POST /reactions                 -> create a reaction
 *   POST /reactions/{id}/upvote     -> increment a reaction's vote count
 *
 * The AWS SDK v3 is provided by the Lambda Node.js managed runtime, so there
 * are no node_modules to bundle for this handler.
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const { randomUUID } = require("crypto");

const TABLE_NAME = process.env.TABLE_NAME;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const VALID_MOODS = ["fire", "mind", "love", "think", "rocket"];
const MAX_MESSAGE = 140;
const MAX_NAME = 24;

// ┌──────────────────────────────────────────────────────────────────────────┐
// │ DEMO TOGGLE — PHASE 3a  (HOTSWAP: Lambda code change, VISIBLE on the wall) │
// │                                                                            │
// │ This is the only thing that changes between V1 and V2 — pure Lambda code.  │
// │ Nothing in the CloudFormation template moves. That is exactly the case     │
// │ hotswap handles: `cdk deploy --hotswap` skips CloudFormation and calls the │
// │ Lambda UpdateFunctionCode API directly (seconds, no changeset, no CFN      │
// │ events).                                                                   │
// │                                                                            │
// │ VISIBLE PROOF: listReactions() returns this string; the wall shows it as   │
// │ the "api:" badge in the header. Flip V1 -> V2, hotswap, and the badge      │
// │ changes live on screen within one poll (~5s). No build step — plain JS.    │
// │                                                                            │
// │   cdk deploy SkipTheWait-FeedbackWall --hotswap --require-approval never   │
// │                                                                            │
// │ PROS to show:  fast dev loop, no CloudFormation round-trip, instant edit-  │
// │                to-running-code.                                            │
// │ CONS to raise: introduces drift (resource no longer matches the deployed   │
// │                template), no rollback, only supported resource types, and  │
// │                it is DEVELOPMENT-ONLY — never production.                   │
// └──────────────────────────────────────────────────────────────────────────┘

// ---- V1 (default) ----------------------------------------------------------
const API_VERSION = "v1";
// ----------------------------------------------------------------------------

// ---- V2 (hotswapped) -------------------------------------------------------
// const API_VERSION = "v2 · hotswapped 🔥";
// ----------------------------------------------------------------------------

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  const rawPath = event.rawPath || event.path || "/reactions";

  try {
    // POST /reactions/{id}/upvote
    const upvoteMatch = rawPath.match(/\/reactions\/([^/]+)\/upvote\/?$/);
    if (method === "POST" && upvoteMatch) {
      return await upvote(decodeURIComponent(upvoteMatch[1]));
    }

    if (rawPath.replace(/\/+$/, "").endsWith("/reactions")) {
      if (method === "GET") return await listReactions();
      if (method === "POST") return await createReaction(event);
    }

    return respond(404, { message: "Not found: " + method + " " + rawPath });
  } catch (err) {
    // Never let an uncaught throw turn into an opaque API Gateway 502.
    console.error("Unhandled error:", err);
    return respond(500, { message: "Internal error", detail: String(err && err.message) });
  }
};

async function listReactions() {
  const out = await ddb.send(new ScanCommand({ TableName: TABLE_NAME }));
  const items = (out.Items || []).slice();
  items.sort((a, b) => {
    if ((b.votes || 0) !== (a.votes || 0)) return (b.votes || 0) - (a.votes || 0);
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });
  // apiVersion rides along on every list response so the wall's header badge
  // reflects the deployed handler — the visible proof of a hotswap.
  return respond(200, { reactions: items, apiVersion: API_VERSION });
}

async function createReaction(event) {
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return respond(400, { message: "Body must be valid JSON" });
  }

  const message = String(body.message || "").trim();
  if (!message) return respond(400, { message: "message is required" });
  if (message.length > MAX_MESSAGE) {
    return respond(400, { message: "message too long (max " + MAX_MESSAGE + ")" });
  }

  const name = String(body.name || "anon").trim().slice(0, MAX_NAME) || "anon";
  const mood = VALID_MOODS.includes(body.mood) ? body.mood : "fire";

  const reaction = {
    id: randomUUID(),
    name,
    message,
    mood,
    votes: 0,
    createdAt: new Date().toISOString(),
  };

  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: reaction }));
  return respond(201, { reaction });
}

async function upvote(id) {
  const out = await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { id },
      UpdateExpression: "SET votes = if_not_exists(votes, :zero) + :one",
      ExpressionAttributeValues: { ":one": 1, ":zero": 0 },
      ConditionExpression: "attribute_exists(id)",
      ReturnValues: "ALL_NEW",
    })
  );
  return respond(200, { reaction: out.Attributes });
}

function respond(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      // Booth frontend is served from a different origin (CloudFront); allow it.
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    },
    body: JSON.stringify(payload),
  };
}
