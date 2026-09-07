# Security assessment — 2026-09-07

Five additional findings were identified in the current working tree. Prior
production-readiness findings are not repeated here. Priorities below describe
remediation order, not calculated CVSS scores.

> **Remediation status (updated 2026-09-07).** Four of the five findings have
> since been fixed in application code (the original assessment was made before
> any code changes):
>
> - **FIXED** — Login rate limiting trusts forwarding headers: the limiter now
>   keys on the socket peer and honours `X-Forwarded-For` only from configured
>   `auth.trusted_proxies`; the dashboard nginx overwrites the header with the
>   real peer instead of appending.
> - **OPEN** — Email-based membership grants do not establish mailbox ownership.
> - **FIXED** — URL can silently replace a dashboard session: bearer-token login
>   via query parameter was removed.
> - **FIXED** — Collector identity cache grows without limit: the OSS passthrough
>   resolver is no longer cached, and `CachedResolver` is now a bounded LRU.
> - **FIXED** — Metrics bypass span ingest limits: token-count ceiling and
>   identifier sanitization now apply on the metrics path (shared
>   `internal/ingest` bounds) and again in the exporter as defense-in-depth.
>
> Each fix ships with regression tests. See the per-finding notes below.

## P1 — Login rate limiting trusts attacker-controlled forwarding headers

**Status: FIXED.**

**Location:** `api/internal/middleware/ratelimit.go:110` and
`dashboard/nginx.conf:11`.

The limiter takes the first `X-Forwarded-For` value without checking whether the
socket peer is a trusted proxy. The shipped dashboard proxy appends to an
incoming header, retaining an attacker-selected first value. A client can choose
a new value for each login or registration attempt and evade the per-IP limit.
Arbitrary non-IP strings also become limiter keys, allowing extra map growth.

The local middleware test holds the socket peer constant and sets a one-request
limit. Requests return `[200, 429, 200, 200]`: changing only the supplied header
restores access, including with a non-IP value. Proxy header composition is
established from configuration; this pass did not start nginx.

**Fix:** default to the socket peer, accept forwarding information only from
explicitly trusted proxy addresses, and parse the chain consistently with that
trust configuration. Sanitize client-supplied forwarding headers at the public
edge. Test the actual shipped proxy/API combination against spoofed headers.

## P1 — Email-based membership grants do not establish mailbox ownership

**Status: OPEN.**

**Location:** `api/internal/auth/service.go:31`, `api/internal/auth/store.go:54`,
and `api/internal/handler/workspaces.go:152`.

Public registration accepts a syntactically valid email, stores it immediately,
and issues a session. The account schema has no verified-email state. Owners
grant membership by looking up an email and immediately authorizing its account.

An attacker can register an intended colleague's email before that colleague
registers. If a workspace owner subsequently adds that email, the attacker gets
the membership and can read that workspace's traces and captured content.
This requires both advance registration of an unused email and a later owner
grant; it does not take over an already registered account.

Source inspection establishes registration and the absence of verification. A
handler test with mock lookup/storage confirms that the email-selected account
receives membership immediately, without a verification or acceptance step.
No real accounts or invitations were created.

**Fix:** require proven mailbox ownership before an email-selected account can
receive access, or use a single-use invitation delivered to that mailbox with
an acceptance flow that cannot attach access to an attacker-held session. For
deployments without email delivery, disable public signup and use an explicitly
trusted provisioning/identity workflow.

## P2 — A URL can silently replace an existing dashboard session

**Status: FIXED.**

**Location:** `dashboard/src/modules/auth/auth.ts:8` and
`dashboard/src/App.tsx:24`.

Opening `/?token=<value>` overwrites the stored session before normal routing.
There is no exchange, confirmation, or binding to a login initiated by that
browser. An attacker can supply their own valid account token in a link and
switch the recipient into the attacker's account. The displayed account email
remains from the recipient's previous session, making the mismatch harder to
notice. Subsequent actions use the substituted account. This is session
replacement/login CSRF, not extraction of the recipient's original token.

The current TypeScript was executed in an isolated VM. It replaced an existing
token with the URL value while retaining the old displayed email. Placeholder
tokens were used; API validation and browser navigation were not exercised.

**Fix:** remove bearer-token login from query parameters, or replace it with a
short-lived single-use exchange bound to a browser-initiated login. Derive the
displayed identity from the authenticated account. URL cleanup happens after the
initial navigation and is not a remedy for placing a credential in that URL.

## P2 — Collector identity cache grows without a limit or eviction

**Status: FIXED.**

**Location:** `collector/internal/user/cached.go:23` and
`collector/processor/traciumprocessor/factory.go:79`.

The default passthrough resolver is wrapped in a permanent `sync.Map` cache.
Each distinct sender-supplied user label adds an entry that has no expiry or size
limit. Limiting each label's length does not bound the number of entries. A
sender able to reach the collector can continually grow resident memory, even
after exported data has drained from the durable queue. The metric path also
retains user labels longer than the span limit.

A bounded test resolved 10,000 short synthetic identities and observed all
10,000 entries retained. Source inspection establishes the lack of eviction.
An actual OOM was deliberately not attempted. Exploitability depends on ingest
reachability; default network isolation reduces who can send, but a shared ingest
token does not bound an authorized sender's cardinality.

**Fix:** avoid caching the identity passthrough operation. If caching a costly
external resolver is needed, impose a strict entry/byte budget and eviction.
Apply the same field bounds on both traces and metrics.

## P2 — Metrics bypass the ingest limits enforced for spans

**Status: FIXED.**

**Location:** `collector/processor/traciumprocessor/metrics.go:168` and
`collector/exporter/clickhousespanexporter/metrics.go:104`.

The metrics path prices raw token totals without the span chain's token ceiling
or identifier sanitization. A single token-usage point with `1e15` input tokens
for `gpt-4o` was accepted and stamped with `$2.5e9` cost; its 4,096-byte user label
was also retained. The exporter copies those values into a metric row, and the
writer has no equivalent validation before insertion.

This allows a sender with ingest access to bypass the protections added to span
ingestion and corrupt the workspace's metric-derived usage/cost totals. The local
test confirms processor behavior; storage and aggregation consequences are
inferred from the inspected exporter/write/query paths. No rows were inserted.

**Fix:** apply shared bounds before both enrichment paths, including token counts,
non-finite numeric input, model/user/workspace identifiers and timestamp validity.
Keep defense-in-depth validation where exporter components can run independently.

## Validation and limits

- [Go probe output](go-probes.txt): four bounded reproductions, using overlays.
- [Session replacement result](url-token.json): current TypeScript with isolated storage.
- [Workspace access checks](access-controls.txt): existing trace/spans tests pass
  for members, unrelated accounts, empty membership and explicit forbidden scope.
- [Reproduction instructions](../../tests/security/README.md).

The review followed auth, membership, trace/metric scoping, ingestion enrichment,
custom attributes, frontend session handling, and deployment proxy configuration.
No additional SQL injection or cross-workspace read bypass was established in
the inspected paths. Existing content stripping covers its recognized span
content keys; it should not be interpreted as general secret redaction.

No external dependency audit, network scan, Docker stress test, or live-account
mutation was performed. Package advisory reachability, deployed proxy behavior,
full browser flows and an end-to-end mailbox-verification scenario remain outside
this local source-and-test assessment. A finite review is not a security guarantee.
