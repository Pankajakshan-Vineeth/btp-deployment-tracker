'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const cds = require('@sap/cds');
// The CLI's own HTTP client, so these tests also check that CLI and backend agree on the contract.
const { createDeploymentApi } = require('../../src/services/deployment-api');

const server = cds.test(path.join(__dirname, '..'));

// Same as the CLI with authentication method "none".
const client = () => createDeploymentApi({ apiUrl: server.url, timeoutMs: 5000, getHeaders: async () => ({}) });

async function post(pathname, body) {
  const response = await fetch(`${server.url}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

function startRecord(overrides = {}) {
  return {
    deploymentId: randomUUID(),
    artifactName: 'app.mtar',
    artifactSizeBytes: 10485760,
    artifactSha256: 'a'.repeat(64),
    osUsername: 'developer',
    gitUsername: null,
    gitEmail: null,
    gitRepository: 'my-app',
    gitBranch: 'main',
    gitCommitSha: '0123456789abcdef0123456789abcdef01234567',
    gitDirty: false,
    gitLastCommitAuthor: null,
    cfApiEndpoint: 'https://api.cf.eu10.hana.ondemand.com',
    cfOrganization: 'dev-org',
    cfSpace: 'dev-space',
    cfUser: 'deployer@example.com',
    clientPlatform: 'win32',
    cliVersion: '0.1.0',
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

const success = () => ({ status: 'SUCCESS', exitCode: 0, completedAt: new Date().toISOString(), durationMs: 91833 });

const stored = (deploymentId) => SELECT.one.from('btp.tracker.Deployments').where({ deploymentId });

test('start and finish store the record', async () => {
  const record = startRecord();
  assert.deepEqual(await client().start(record), { deploymentId: record.deploymentId, status: 'STARTED' });
  assert.equal((await stored(record.deploymentId)).status, 'STARTED');

  await client().finish(record.deploymentId, success());
  const row = await stored(record.deploymentId);
  assert.equal(row.status, 'SUCCESS');
  assert.equal(row.exitCode, 0);
  assert.equal(row.cfSpace, 'dev-space');
  assert.ok(row.receivedAt);
});

test('repeated start and finish with the same content are accepted', async () => {
  const record = startRecord();
  const result = success();
  await client().start(record);
  await client().start(record);
  await client().finish(record.deploymentId, result);
  assert.equal((await client().finish(record.deploymentId, result)).status, 'SUCCESS');
});

test('conflicting start or finish returns 409', async () => {
  const record = startRecord();
  await client().start(record);
  await assert.rejects(client().start({ ...record, cfSpace: 'prod' }), { status: 409 });

  await client().finish(record.deploymentId, success());
  const failed = { status: 'FAILED', exitCode: 1, completedAt: new Date().toISOString(), durationMs: 5, errorSummary: 'boom' };
  await assert.rejects(client().finish(record.deploymentId, failed), { status: 409 });
});

test('finish for an unknown deployment returns 404', async () => {
  await assert.rejects(client().finish(randomUUID(), success()), { status: 404 });
});

test('the deployment ID in the URL must match the body', async () => {
  const record = startRecord();
  await client().start(record);
  const res = await post(`/api/deployments/${randomUUID()}/finish`, { deploymentId: record.deploymentId, ...success() });
  assert.equal(res.status, 400);
});

test('unknown fields from newer clients are ignored', async () => {
  const record = startRecord();
  assert.equal((await post('/api/deployments/start', { ...record, newField: 'x' })).status, 200);
  assert.equal((await post(`/api/deployments/${record.deploymentId}/finish`, { deploymentId: record.deploymentId, ...success(), newField: 1 })).status, 200);
});

test('invalid input is rejected with 400', async () => {
  const bad = [
    startRecord({ deploymentId: 'not-a-uuid' }),
    startRecord({ artifactSha256: 'abc' }),
    startRecord({ startedAt: 'yesterday' }),
    startRecord({ gitBranch: 'x'.repeat(256) }),
  ];
  for (const record of bad) assert.equal((await post('/api/deployments/start', record)).status, 400, JSON.stringify(record));

  const record = startRecord();
  await client().start(record);
  for (const result of [{ ...success(), exitCode: 1 }, { ...success(), status: 'DONE' }, { ...success(), durationMs: -1 }]) {
    assert.equal((await post(`/api/deployments/${record.deploymentId}/finish`, { deploymentId: record.deploymentId, ...result })).status, 400);
  }
});

test('records and the viewer page are open without login', async () => {
  const record = startRecord();
  await client().start(record);
  const response = await fetch(`${server.url}/odata/v4/deployments/Deployments(${record.deploymentId})`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).artifactName, 'app.mtar');

  const page = await fetch(`${server.url}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /BTP Deployments/);
});
