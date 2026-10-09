'use strict';

// Applied to everything the tool prints, sends to the backend or writes to disk.
// Over-redaction is acceptable; leaking a credential is not.
const REDACTIONS = [
  [/(authorization\s*[:=]\s*)[^\r\n]+/gi, '$1[REDACTED]'],
  [/(bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, '$1[REDACTED]'],
  [/((?:access_token|refresh_token|id_token|client_secret|password|passwd|secret|api[_-]?key|token)["']?\s*[:=]\s*["']?)[^\s,;"'&]+/gi, '$1[REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '[REDACTED_JWT]'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@'],
];

function redact(value) {
  let text = String(value);
  for (const [pattern, replacement] of REDACTIONS) text = text.replace(pattern, replacement);
  return text;
}

function createLogger({ out = process.stdout, err = process.stderr } = {}) {
  return {
    info: (message = '') => out.write(`${redact(message)}\n`),
    warn: (message) => err.write(`Warning: ${redact(message)}\n`),
    error: (message) => err.write(`Error: ${redact(message)}\n`),
  };
}

module.exports = { redact, createLogger };
