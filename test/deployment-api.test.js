'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDeploymentApi } = require('../src/services/deployment-api');
const { getAuthHeaders } = require('../src/services/auth');
const { validateApiUrl } = require('../src/config/configuration');
const { fakeFetch, acceptAll, API_URL, SECRET_TOKEN } = require('./helpers');

const headers = async () => ({ Authorization: `Bearer ${SECRET_TOKEN}` });
const api = (fetchImpl, timeoutMs = 200) => createDeploymentApi({ apiUrl: API_URL, getHeaders: headers, timeoutMs, fetchImpl });

test('start posts JSON with the bearer token', async () => {
  const fetchImpl = fakeFetch(acceptAll);
  await api(fetchImpl).start({ deploymentId: 'id-1', artifactName: 'app.mtar' });
  const [call] = fetchImpl.calls;
  assert.equal(call.url, `${API_URL}/api/deployments/start`);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.Authorization, `Bearer ${SECRET_TOKEN}`);
  assert.equal(call.body.artifactName, 'app.mtar');
});

test('finish posts to the deployment-specific URL', async () => {
  const fetchImpl = fakeFetch(acceptAll);
  await api(fetchImpl).finish('id-1', { status: 'SUCCESS', exitCode: 0 });
  assert.equal(fetchImpl.calls[0].url, `${API_URL}/api/deployments/id-1/finish`);
  assert.deepEqual(fetchImpl.calls[0].body, { deploymentId: 'id-1', status: 'SUCCESS', exitCode: 0 });
});

test('HTTP errors carry the status and the CAP error message, never the token', async () => {
  const fetchImpl = fakeFetch(() => ({ status: 400, body: { error: { message: 'artifactSha256 is required' } } }));
  await assert.rejects(api(fetchImpl).start({ deploymentId: 'id-1' }), (error) => {
    assert.equal(error.status, 400);
    assert.match(error.message, /HTTP 400: artifactSha256 is required/);
    assert.doesNotMatch(error.message, new RegExp(SECRET_TOKEN));
    return true;
  });
});

test('malformed (non-JSON) responses are rejected', async () => {
  const fetchImpl = fakeFetch(() => ({ status: 200, body: '<html>login page</html>' }));
  await assert.rejects(api(fetchImpl).start({ deploymentId: 'id-1' }), /malformed/);
});

test('responses that do not confirm the deployment ID are rejected', async () => {
  const fetchImpl = fakeFetch(() => ({ status: 200, body: { ok: true } }));
  await assert.rejects(api(fetchImpl).start({ deploymentId: 'id-1' }), /did not confirm/);
});

test('timeouts are reported', async () => {
  const hang = (url, init) =>
    new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  await assert.rejects(api(hang, 50).start({ deploymentId: 'id-1' }), /did not respond within 50 ms/);
});

test('connection failures are reported', async () => {
  const refuse = async () => {
    throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
  };
  await assert.rejects(api(refuse).start({ deploymentId: 'id-1' }), /Cannot reach tracking backend: ECONNREFUSED/);
});

test('works with the real fetch against a local HTTP server', async (t) => {
  const http = require('node:http');
  let received;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      received = { url: req.url, auth: req.headers.authorization, body: JSON.parse(body) };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ deploymentId: received.body.deploymentId, status: 'STARTED' }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const client = createDeploymentApi({ apiUrl: `http://127.0.0.1:${server.address().port}`, getHeaders: headers, timeoutMs: 2000 });
  const data = await client.start({ deploymentId: 'id-real' });
  assert.equal(data.status, 'STARTED');
  assert.equal(received.url, '/api/deployments/start');
  assert.equal(received.auth, `Bearer ${SECRET_TOKEN}`);
});

test('env-token auth requires BTP_TRACKER_API_TOKEN', async () => {
  await assert.rejects(getAuthHeaders({ authMethod: 'env-token' }, { env: {} }), /BTP_TRACKER_API_TOKEN is not set/);
  assert.deepEqual(await getAuthHeaders({ authMethod: 'env-token' }, { env: { BTP_TRACKER_API_TOKEN: 'abc' } }), {
    Authorization: 'Bearer abc',
  });
});

test('command auth uses the command output and hides it on failure', async () => {
  const config = { authMethod: 'command', tokenCommand: ['az', 'account', 'get-access-token'] };
  const ok = async (cmd, args) => ({ code: 0, stdout: `token-from-${cmd}-${args.length}\n` });
  assert.deepEqual(await getAuthHeaders(config, { run: ok }), { Authorization: 'Bearer token-from-az-2' });

  const fail = async () => ({ code: 1, stdout: 'partial-secret', stderr: '' });
  await assert.rejects(getAuthHeaders(config, { run: fail }), (error) => !error.message.includes('partial-secret'));
});

test('auth method "none" sends no Authorization header', async () => {
  assert.deepEqual(await getAuthHeaders({ authMethod: 'none', apiUrl: API_URL }, {}), {});
});

test('validateApiUrl requires https except for localhost and rejects embedded credentials', () => {
  assert.equal(validateApiUrl('https://tracker.example.test/'), 'https://tracker.example.test');
  assert.equal(validateApiUrl('http://localhost:4004'), 'http://localhost:4004');
  assert.throws(() => validateApiUrl('http://tracker.example.test'), /must use https/);
  assert.throws(() => validateApiUrl('https://user:pass@tracker.example.test'), /must not contain credentials/);
  assert.throws(() => validateApiUrl('not a url'), /Invalid/);
});
