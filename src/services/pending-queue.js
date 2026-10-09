'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { configDir } = require('../config/configuration');

// Finish events that could not be sent. One JSON file per deployment holding only
// { deploymentId, apiUrl, result, queuedAt }; never credentials.

function pendingDir(env) {
  return path.join(configDir(env), 'pending');
}

function savePending({ deploymentId, apiUrl, result }, env = process.env) {
  const dir = pendingDir(env);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${deploymentId}.json`);
  const event = { deploymentId, apiUrl, result, queuedAt: new Date().toISOString() };
  fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`, { mode: 0o600 });
  return file;
}

function listPending(env = process.env) {
  let names;
  try {
    names = fs.readdirSync(pendingDir(env)).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }
  const entries = [];
  for (const name of names) {
    const file = path.join(pendingDir(env), name);
    try {
      entries.push({ file, event: JSON.parse(fs.readFileSync(file, 'utf8')) });
    } catch {
      // Unreadable entry: leave it for manual inspection.
    }
  }
  return entries;
}

/** Re-sends pending finish events for this backend. Never throws. */
async function retryPending({ client, apiUrl, env = process.env, logger }) {
  for (const { file, event } of listPending(env)) {
    if (event.apiUrl !== apiUrl) continue; // never send a record to a different backend
    try {
      await client.finish(event.deploymentId, event.result);
      fs.rmSync(file, { force: true });
      logger.info(`Recorded the pending result of earlier deployment ${event.deploymentId}.`);
    } catch (error) {
      if (error.status === 409) {
        fs.rmSync(file, { force: true });
        logger.warn(`Backend reports a conflicting result for earlier deployment ${event.deploymentId} (HTTP 409); pending entry discarded.`);
      } else {
        logger.warn(`Result of earlier deployment ${event.deploymentId} is still pending: ${error.message}`);
        if (!error.status) return; // unreachable or auth failure: don't retry every entry
      }
    }
  }
}

module.exports = { pendingDir, savePending, listPending, retryPending };
