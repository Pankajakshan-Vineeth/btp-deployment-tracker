'use strict';

const cds = require('@sap/cds');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_FIELDS = [
  'artifactName', 'artifactSizeBytes', 'artifactSha256', 'osUsername', 'gitUsername', 'gitEmail',
  'gitRepository', 'gitBranch', 'gitCommitSha', 'gitDirty', 'gitLastCommitAuthor', 'cfApiEndpoint',
  'cfOrganization', 'cfSpace', 'cfUser', 'clientPlatform', 'cliVersion', 'startedAt',
];
const RESULT_FIELDS = ['status', 'exitCode', 'completedAt', 'durationMs', 'signal', 'errorSummary'];
const TIMESTAMPS = new Set(['startedAt', 'completedAt']);

const pick = (data, fields) => Object.fromEntries(fields.map((f) => [f, data[f] ?? null]));
const isIso = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value));
const isCount = (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0;

/** DB values come back normalized (Int64 as string, timestamps reformatted); compare loosely. */
function normalize(field, value) {
  if (value === null || value === undefined) return null;
  return TIMESTAMPS.has(field) ? Date.parse(value) : String(value);
}
const same = (stored, incoming, fields) => fields.every((f) => normalize(f, stored[f]) === normalize(f, incoming[f]));

module.exports = class TrackerService extends cds.ApplicationService {
  init() {
    const { Deployments } = cds.entities('btp.tracker');

    // Rejects values the HANA column would not accept, using the lengths from db/schema.cds.
    const checkLengths = (req, record) => {
      for (const [field, value] of Object.entries(record)) {
        const max = Deployments.elements[field].length;
        if (max && typeof value === 'string' && value.length > max) req.reject(400, `${field} exceeds ${max} characters.`);
      }
    };

    this.on('start', async (req) => {
      const { deploymentId } = req.data;
      const record = pick(req.data, CLIENT_FIELDS);
      if (!UUID.test(deploymentId ?? '')) return req.reject(400, 'deploymentId must be a UUID.');
      if (!record.artifactName) return req.reject(400, 'artifactName is required.');
      if (!/^[0-9a-f]{64}$/.test(record.artifactSha256 ?? '')) return req.reject(400, 'artifactSha256 must be a SHA-256 hex digest.');
      if (!isCount(record.artifactSizeBytes)) return req.reject(400, 'artifactSizeBytes must be a non-negative integer.');
      if (!isIso(record.startedAt)) return req.reject(400, 'startedAt must be an ISO-8601 timestamp.');
      checkLengths(req, record);

      const existing = await SELECT.one.from(Deployments, deploymentId);
      if (existing) {
        if (!same(existing, record, CLIENT_FIELDS)) {
          return req.reject(409, `Deployment ${deploymentId} already exists with different content.`);
        }
        return { deploymentId, status: existing.status };
      }
      // ponytail: two simultaneous starts with one ID make the second INSERT fail; the CLI retries via a new run.
      await INSERT.into(Deployments).entries({
        deploymentId,
        ...record,
        status: 'STARTED',
        receivedAt: new Date().toISOString(),
      });
      return { deploymentId, status: 'STARTED' };
    });

    this.on('finish', async (req) => {
      const { deploymentId } = req.data;
      const result = pick(req.data, RESULT_FIELDS);
      const pathId = req.headers['x-path-deployment-id'];
      if (pathId !== undefined && pathId !== deploymentId) return req.reject(400, 'deploymentId does not match the URL.');
      if (!UUID.test(deploymentId ?? '')) return req.reject(400, 'deploymentId must be a UUID.');
      if (!['SUCCESS', 'FAILED'].includes(result.status)) return req.reject(400, 'status must be SUCCESS or FAILED.');
      if (!Number.isInteger(result.exitCode)) return req.reject(400, 'exitCode must be an integer.');
      if ((result.status === 'SUCCESS') !== (result.exitCode === 0)) {
        return req.reject(400, 'status SUCCESS requires exitCode 0, and exitCode 0 requires SUCCESS.');
      }
      if (!isIso(result.completedAt)) return req.reject(400, 'completedAt must be an ISO-8601 timestamp.');
      if (!isCount(result.durationMs)) return req.reject(400, 'durationMs must be a non-negative integer.');
      checkLengths(req, result);

      let existing = await SELECT.one.from(Deployments, deploymentId);
      if (!existing) return req.reject(404, `Deployment ${deploymentId} is unknown.`);
      if (existing.status === 'STARTED') {
        const updated = await UPDATE(Deployments).set(result).where({ deploymentId, status: 'STARTED' });
        if (updated) return { deploymentId, status: result.status };
        existing = await SELECT.one.from(Deployments, deploymentId); // a concurrent finish won
      }
      if (!same(existing, result, RESULT_FIELDS)) {
        return req.reject(409, `Deployment ${deploymentId} already has a different result.`);
      }
      return { deploymentId, status: existing.status };
    });

    return super.init();
  }
};
