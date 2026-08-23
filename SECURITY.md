# Security policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

Use GitHub's private vulnerability reporting ("Report a vulnerability" under the
repo's Security tab), or email the maintainers at **security@tracium.ai**.

We aim to acknowledge within 3 business days and to ship a fix or mitigation for
confirmed issues before any public disclosure.

## Scope notes for self-hosters

- **`JWT_SECRET` must be unique per deployment** — it signs and verifies auth
  tokens. Never ship the default.
- **The collector's OTLP ports (4317/4318) are unauthenticated by default.** Keep
  them on a trusted network; see
  [deploy/docs/collector-auth.md](deploy/docs/collector-auth.md) for bearer-token
  and mTLS options.
- **`capture_content` stores raw prompts/completions** in ClickHouse when enabled.
