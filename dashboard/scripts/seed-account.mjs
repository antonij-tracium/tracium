// Seed a login account that owns the workspaces the trace data is tagged with.
//
// Creates (or reuses) an account via the API, then makes it the OWNER of the
// three seeded workspaces (fixed ids, shared with seed.mjs) by writing the
// workspace + membership rows directly into Postgres — so the account → member →
// workspace → span chain is complete and the workspace access boundary lets this
// account (and only accounts you add as members) read the seeded telemetry.
//
// This runs automatically as the first step of `npm run seed`; run it alone with
// `npm run seed:account` to (re)create just the account and its workspaces.
//
//   npm run seed                                # account + workspaces + telemetry
//   npm run seed:account                        # this step only
//   SEED_EMAIL=me@x.com SEED_PASSWORD=... npm run seed
//
// Requires the stack to be running (docker compose) — the workspace rows are
// written via `docker compose exec postgres`. Idempotent: re-running reuses the
// account (register → login) and upserts the workspaces.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { WORKSPACES } from "./seed.mjs";

const API = process.env.API_ENDPOINT || "http://localhost:8090";
const EMAIL = process.env.SEED_EMAIL || "demo@tracium.ai";
const PASSWORD = process.env.SEED_PASSWORD || "tracium-demo-1234";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function decodeJwtSub(token) {
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  return payload.sub;
}

async function authenticate() {
  // Register; on 409 (already exists) fall back to login.
  const body = JSON.stringify({ email: EMAIL, password: PASSWORD });
  let res = await fetch(`${API}/v1/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body,
  });
  if (res.status === 409) {
    console.log(`  account ${EMAIL} already exists — logging in`);
    res = await fetch(`${API}/v1/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
    });
  } else if (res.ok) {
    console.log(`  registered account ${EMAIL}`);
  }
  if (!res.ok) throw new Error(`auth failed (${res.status}): ${await res.text()}`);
  return (await res.json()).token;
}

function sqlLiteral(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function psql(sql) {
  // -tA: tuple-only, unaligned. Runs as the tracium superuser via the container's
  // local socket (no password needed inside the container).
  return execFileSync(
    "docker",
    ["compose", "exec", "-T", "postgres", "psql", "-U", "tracium", "-d", "tracium", "-tAc", sql],
    { cwd: REPO_ROOT, encoding: "utf8" },
  ).trim();
}

async function main() {
  console.log(`seeding account -> ${API}`);
  const token = await authenticate();
  const userId = decodeJwtSub(token);
  console.log(`  account id: ${userId}`);

  for (const ws of WORKSPACES) {
    // Upsert the workspace with its FIXED id, owned by this account.
    psql(
      `INSERT INTO workspaces (id, user_id, name, slug, env, role, members)
       VALUES (${sqlLiteral(ws.id)}, ${sqlLiteral(userId)}, ${sqlLiteral(ws.name)},
               ${sqlLiteral(ws.slug)}, ${sqlLiteral(ws.env)}, 'Owner', 1)
       ON CONFLICT (id) DO UPDATE
         SET user_id = EXCLUDED.user_id, name = EXCLUDED.name,
             slug = EXCLUDED.slug, env = EXCLUDED.env;`,
    );
    // Owner membership — the access-boundary row that lets this account read it.
    psql(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES (${sqlLiteral(ws.id)}, ${sqlLiteral(userId)}, 'owner')
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner';`,
    );
    console.log(`  owns workspace: ${ws.name.padEnd(12)} ${ws.id}`);
  }

  console.log("\naccount ready. Sign in with:");
  console.log(`  email:    ${EMAIL}`);
  console.log(`  password: ${PASSWORD}`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
