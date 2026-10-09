'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CliError } = require('../utils/errors');

const DEFAULT_TIMEOUT_MS = 15000;

function configDir(env = process.env) {
  if (env.BTP_TRACKER_CONFIG_DIR) return env.BTP_TRACKER_CONFIG_DIR;
  if (process.platform === 'win32' && env.APPDATA) return path.join(env.APPDATA, 'btp-deployment-tracker');
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'btp-deployment-tracker');
}

function configFile(env = process.env) {
  return path.join(configDir(env), 'config.json');
}

/** Config file values overridden by environment variables. Never contains secrets. */
function loadConfig(env = process.env) {
  const file = configFile(env);
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new CliError(`Cannot read configuration file ${file}: ${error.message}`, 2);
  }
  return {
    apiUrl: env.BTP_TRACKER_API_URL || stored.apiUrl || null,
    authMethod: env.BTP_TRACKER_AUTH_METHOD || stored.authMethod || 'env-token',
    tokenCommand: stored.tokenCommand || null,
    timeoutMs: Number(env.BTP_TRACKER_TIMEOUT_MS || stored.timeoutMs) || DEFAULT_TIMEOUT_MS,
  };
}

function saveConfig({ apiUrl, authMethod, tokenCommand }, env = process.env) {
  const file = configFile(env);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify({ apiUrl, authMethod, tokenCommand }, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600); // writeFileSync's mode only applies when the file is created
  return file;
}

function isLocalUrl(value) {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

/** Returns the normalized base URL (no trailing slash) or throws a CliError. */
function validateApiUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new CliError(`Invalid tracking backend URL: "${value}"`, 2);
  }
  if (url.username || url.password) throw new CliError('The tracking backend URL must not contain credentials.', 2);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalUrl(value))) {
    throw new CliError('The tracking backend URL must use https:// (http:// is only allowed for localhost).', 2);
  }
  if (url.search || url.hash) throw new CliError('The tracking backend URL must not contain a query or fragment.', 2);
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

module.exports = { configDir, configFile, loadConfig, saveConfig, isLocalUrl, validateApiUrl };
