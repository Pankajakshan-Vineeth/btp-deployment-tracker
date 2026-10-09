'use strict';

const { redact } = require('../utils/logger');

class ApiError extends Error {
  constructor(message, status = null) {
    super(message);
    this.status = status;
  }
}

/** Extracts a short message from a CAP error body ({ error: { message } }), if present. */
function backendMessage(text) {
  try {
    const message = JSON.parse(text)?.error?.message;
    return typeof message === 'string' ? `: ${redact(message).slice(0, 200)}` : '';
  } catch {
    return '';
  }
}

/**
 * HTTP client for the external CAP tracking backend (see API_CONTRACT.md).
 * `getHeaders` supplies authentication headers per request. Error messages never
 * include request headers.
 */
function createDeploymentApi({ apiUrl, getHeaders, timeoutMs, fetchImpl = globalThis.fetch }) {
  async function post(pathname, body) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json', ...(await getHeaders()) };
    let response;
    let text;
    try {
      response = await fetchImpl(`${apiUrl}${pathname}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      text = await response.text();
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        throw new ApiError(`Tracking backend did not respond within ${timeoutMs} ms.`);
      }
      throw new ApiError(`Cannot reach tracking backend: ${redact(error.cause?.code || error.message)}`);
    }

    if (!response.ok) {
      throw new ApiError(`Tracking backend returned HTTP ${response.status}${backendMessage(text)}`, response.status);
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(`Tracking backend returned a malformed (non-JSON) response for ${pathname}.`);
    }
    if (!data || data.deploymentId !== body.deploymentId) {
      throw new ApiError(`Tracking backend response for ${pathname} did not confirm the deployment ID.`);
    }
    return data;
  }

  return {
    start: (record) => post('/api/deployments/start', record),
    finish: (deploymentId, result) =>
      post(`/api/deployments/${encodeURIComponent(deploymentId)}/finish`, { deploymentId, ...result }),
  };
}

module.exports = { ApiError, createDeploymentApi };
