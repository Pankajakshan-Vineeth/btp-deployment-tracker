'use strict';

const { randomUUID } = require('node:crypto');
const { inspectArtifact, sha256File } = require('../collectors/artifact');
const { collectGitInfo } = require('../collectors/git');
const { collectSystemInfo } = require('../collectors/system');
const { collectCfInfo, CF_MISSING_MESSAGE } = require('../collectors/cloud-foundry');
const { loadConfig, validateApiUrl } = require('../config/configuration');
const { getAuthHeaders } = require('../services/auth');
const { createDeploymentApi } = require('../services/deployment-api');
const { savePending, retryPending } = require('../services/pending-queue');
const { redact } = require('../utils/logger');
const { CliError } = require('../utils/errors');

const EXIT_TRACKING_UNAVAILABLE = 3;

function formatDuration(ms) {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function show(value) {
  if (value === null || value === undefined) return 'unknown';
  return typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value);
}

function quoteForDisplay(arg) {
  return /\s/.test(arg) ? `"${arg}"` : arg;
}

/** Last lines of cf output, redacted and bounded, for the backend record. */
function summarizeError({ stdout = '', stderr = '', error }) {
  const text = stderr.trim() || stdout.trim() || error?.message || 'cf deploy failed without output.';
  const tail = text.split(/\r?\n/).filter((line) => line.trim()).slice(-15).join('\n');
  return redact(tail).slice(-2000);
}

function printSummary(logger, record, artifactPath) {
  logger.info(`Deployment ID: ${record.deploymentId}`);
  logger.info(`Application artifact: ${record.artifactName}`);
  logger.info(`Artifact path: ${artifactPath}`);
  logger.info(`Artifact SHA-256: ${record.artifactSha256}`);
  logger.info(`Artifact size: ${record.artifactSizeBytes} bytes`);
  logger.info(`CF API endpoint: ${show(record.cfApiEndpoint)}`);
  logger.info(`Organization: ${show(record.cfOrganization)}`);
  logger.info(`Space: ${show(record.cfSpace)}`);
  logger.info(`CF user (authenticated): ${show(record.cfUser)}`);
  logger.info(`OS user (unverified): ${show(record.osUsername)}`);
  logger.info(`Git user (unverified): ${show(record.gitUsername)} <${show(record.gitEmail)}>`);
  logger.info(`Repository: ${show(record.gitRepository)}`);
  logger.info(`Branch: ${show(record.gitBranch)}`);
  logger.info(`Commit: ${show(record.gitCommitSha)}${record.gitDirty ? ' (uncommitted changes present)' : ''}`);
  logger.info('Note: Git details describe the working directory, not necessarily the MTAR contents.');
}

function createTracker({ env, run, fetchImpl }) {
  const config = loadConfig(env);
  if (!config.apiUrl) {
    throw new Error('no backend URL configured (set BTP_TRACKER_API_URL or run "btp-deploy --config").');
  }
  const apiUrl = validateApiUrl(config.apiUrl);
  const client = createDeploymentApi({
    apiUrl,
    timeoutMs: config.timeoutMs,
    fetchImpl,
    getHeaders: () => getAuthHeaders({ ...config, apiUrl }, { env, run }),
  });
  return { apiUrl, client };
}

/**
 * Tracks and runs `cf deploy`. Returns the process exit code: 0 on success, the
 * cf exit code on deployment failure. Throws CliError for precondition failures.
 */
async function deploy({ mtarPath, cfArgs = [], dryRun = false, allowUntracked = false }, deps) {
  const { run, logger, env = process.env, cwd = process.cwd(), fetchImpl = globalThis.fetch } = deps;

  logger.info('BTP Deployment Tracker\n');
  const artifact = inspectArtifact(mtarPath, cwd);

  const cf = await collectCfInfo({ run });
  if (!cf.installed) throw new CliError(CF_MISSING_MESSAGE, 2);
  if (!cf.loggedIn || !cf.org || !cf.space) {
    const message = 'Not logged in to Cloud Foundry or no org/space targeted. Run "cf login" (and "cf target -o ORG -s SPACE").';
    if (!dryRun) throw new CliError(message, 2);
    logger.warn(message);
  }

  const [git, artifactSha256] = await Promise.all([collectGitInfo({ run, cwd }), sha256File(artifact.path)]);
  const system = collectSystemInfo();

  const record = {
    deploymentId: randomUUID(),
    artifactName: artifact.name,
    artifactSizeBytes: artifact.sizeBytes,
    artifactSha256,
    osUsername: system.osUsername,
    gitUsername: git.userName,
    gitEmail: git.userEmail,
    gitRepository: git.repositoryName,
    gitBranch: git.branch,
    gitCommitSha: git.commitSha,
    gitDirty: git.dirty,
    gitLastCommitAuthor: git.lastCommitAuthor,
    cfApiEndpoint: cf.apiEndpoint,
    cfOrganization: cf.org,
    cfSpace: cf.space,
    cfUser: cf.user,
    clientPlatform: system.platform,
    cliVersion: system.cliVersion,
    startedAt: null,
  };
  printSummary(logger, record, artifact.path);

  const cfCommand = ['deploy', artifact.path, ...cfArgs];
  if (dryRun) {
    logger.info(`\nDry run: would execute: cf ${cfCommand.map(quoteForDisplay).join(' ')}`);
    logger.info('Dry run: cf deploy was NOT executed and no deployment record was sent.');
    return 0;
  }

  let tracker = null;
  try {
    tracker = createTracker({ env, run, fetchImpl });
    await retryPending({ client: tracker.client, apiUrl: tracker.apiUrl, env, logger });
    record.startedAt = new Date().toISOString();
    await tracker.client.start(record);
    logger.info('\nDeployment start recorded.');
  } catch (error) {
    const reason = `Deployment tracking is unavailable: ${error.message}`;
    if (!allowUntracked) {
      throw new CliError(
        `${reason}\ncf deploy was NOT started. Fix the tracking configuration (see "btp-deploy --config"), ` +
          'or re-run with --allow-untracked to deploy without a tracking record.',
        EXIT_TRACKING_UNAVAILABLE,
      );
    }
    logger.warn(`${reason}\nContinuing WITHOUT tracking because --allow-untracked was given.`);
    tracker = null;
    record.startedAt = new Date().toISOString();
  }

  logger.info('Starting deployment...\n');
  const startMs = Date.now();
  // Ctrl+C reaches cf directly; stay alive until it exits so the result is recorded.
  const onInterrupt = () => logger.warn('Interrupt received; waiting for cf deploy to exit...');
  process.on('SIGINT', onInterrupt);
  let result;
  try {
    result = await run('cf', cfCommand, { cwd, echo: true });
  } finally {
    process.off('SIGINT', onInterrupt);
  }

  const succeeded = result.code === 0;
  const outcome = {
    status: succeeded ? 'SUCCESS' : 'FAILED',
    exitCode: result.code ?? 1,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startMs,
  };
  if (result.signal) outcome.signal = result.signal;
  if (!succeeded) outcome.errorSummary = summarizeError(result);

  logger.info(succeeded ? '\nDeployment successful.\n' : '\nDeployment failed.\n');

  if (tracker) {
    try {
      await tracker.client.finish(record.deploymentId, outcome);
      logger.info('Deployment result recorded.');
    } catch (error) {
      try {
        const file = savePending({ deploymentId: record.deploymentId, apiUrl: tracker.apiUrl, result: outcome }, env);
        logger.warn(`Could not record the deployment result: ${error.message}\nSaved to ${file}; it will be retried on the next btp-deploy run.`);
      } catch (saveError) {
        logger.warn(`Could not record the deployment result (${error.message}) or save it for retry (${saveError.message}).`);
      }
    }
  } else {
    logger.warn('This deployment was NOT recorded in the tracking backend.');
  }

  logger.info(`Status: ${outcome.status}`);
  if (!succeeded) logger.info(`Exit code: ${outcome.exitCode}`);
  logger.info(`Duration: ${formatDuration(outcome.durationMs)}`);
  logger.info(`Deployment ID: ${record.deploymentId}`);
  return succeeded ? 0 : outcome.exitCode;
}

module.exports = { deploy, summarizeError, formatDuration, EXIT_TRACKING_UNAVAILABLE };
