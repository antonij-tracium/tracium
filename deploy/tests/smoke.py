"""End-to-end release check using only the Python standard library; no paid APIs."""
import json
import os
import secrets
import time
import urllib.error
import urllib.request

API = os.environ['API_URL']
OTLP = os.environ['OTLP_URL']


def request(base, path, payload=None, token=None, method=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    body = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(base + path, body, headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()


def eventually(fn, timeout=60):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            result = fn()
            if result:
                return result
        except (OSError, ValueError):
            pass
        time.sleep(1)
    raise AssertionError('Timed out waiting for stack or telemetry')


def account():
    email = 'smoke-' + secrets.token_hex(6) + '@example.test'
    password = secrets.token_hex(16)
    status, result = request(API, '/v1/auth/register', {'email': email, 'password': password})
    assert status == 201, (status, result)
    status, result = request(API, '/v1/auth/login', {'email': email, 'password': password})
    assert status == 200, (status, result)
    return result['token']


def workspace(token, name):
    status, result = request(API, '/v1/workspaces', {'name': name, 'slug': name, 'env': 'development'}, token)
    assert status == 201, (status, result)
    return result['id']


def apikey(token, workspace_id):
    """Mint an ingest key for a workspace and return its one-time plaintext token."""
    status, result = request(API, '/v1/workspaces/' + workspace_id + '/api-keys', {'name': 'smoke'}, token)
    assert status == 201, (status, result)
    return result['token']


def attr(key, value):
    return {'key': key, 'value': {'stringValue': value}}


def span_payload(trace_id, text):
    now = time.time_ns()
    span = {
        'traceId': trace_id, 'spanId': secrets.token_hex(8), 'name': 'chat gpt-4o-mini', 'kind': 3,
        'startTimeUnixNano': str(now - 1_000_000_000), 'endTimeUnixNano': str(now),
        'attributes': [attr('gen_ai.system', 'openai'), attr('gen_ai.request.model', 'gpt-4o-mini'),
                       attr('gen_ai.input.messages', text),
                       {'key': 'gen_ai.usage.input_tokens', 'value': {'intValue': '100'}},
                       {'key': 'gen_ai.usage.output_tokens', 'value': {'intValue': '20'}}],
    }
    # No tracium.workspace.id: ingest is key-only and the key decides the
    # workspace. The collector stamps it, overriding anything the sender sets.
    return {'resourceSpans': [{'resource': {'attributes': [attr('service.name', 'oss-smoke')]},
            'scopeSpans': [{'spans': [span]}]}]}


def ingest(ingest_key, trace_id, text):
    status, result = request(OTLP, '/v1/traces', span_payload(trace_id, text), token=ingest_key)
    assert status == 200, (status, result)


eventually(lambda: request(API, '/v1/health')[0] == 200)
owner = account()
outsider = account()
ws = workspace(owner, 'smoke-owner')
other_ws = workspace(outsider, 'smoke-other')
ws_key = apikey(owner, ws)
other_key = apikey(outsider, other_ws)

# Ingest is mandatory-auth: no key and a bogus key are both rejected, nothing stored.
probe_id = secrets.token_hex(16)
status, _ = request(OTLP, '/v1/traces', span_payload(probe_id, 'NO_KEY'))
assert status == 401, ('keyless ingest must be rejected', status)
status, _ = request(OTLP, '/v1/traces', span_payload(probe_id, 'BOGUS_KEY'),
                    token='trc_' + secrets.token_hex(32))
assert status == 401, ('bogus-key ingest must be rejected', status)

trace_id = secrets.token_hex(16)
ingest(ws_key, trace_id, 'OWNER_ONLY_CONTENT')
# The same trace ID under another workspace's key must never join the owner's trace.
ingest(other_key, trace_id, 'OTHER_WORKSPACE_CONTENT')


def visible():
    status, page = request(API, '/v1/traces?workspace_id=' + ws, token=owner)
    return status == 200 and any(row['trace_id'] == trace_id for row in page['items'])


eventually(visible)
for suffix in ('', '/spans'):
    path = '/v1/traces/' + trace_id + suffix
    status, result = request(API, path + '?workspace_id=' + ws, token=owner)
    assert status == 200, (status, result)
    raw = json.dumps(result)
    assert 'OWNER_ONLY_CONTENT' in raw and 'OTHER_WORKSPACE_CONTENT' not in raw, raw
    status, _ = request(API, path + '?workspace_id=' + ws, token=outsider)
    assert status == 403, status
    # An unrelated new account has no workspace membership at all.
    stranger = account()
    status, _ = request(API, path, token=stranger)
    assert status == 404, status

status, kpis = request(API, '/v1/metrics/kpis?range=24h&workspace_id=' + ws, token=owner)
assert status == 200 and kpis['runs']['value'] > 0, (status, kpis)
print('PASS: register, login, workspace, ingest key issuance, mandatory-key OTLP ingestion (keyless/bogus rejected), dashboard API proxy, trace visibility, metrics, and cross-workspace isolation')
