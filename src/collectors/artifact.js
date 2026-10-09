'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { CliError } = require('../utils/errors');

/** Validates the MTAR path and returns { path, name, sizeBytes }. */
function inspectArtifact(mtarPath, cwd = process.cwd()) {
  const fullPath = path.resolve(cwd, mtarPath);
  let stats;
  try {
    stats = fs.statSync(fullPath);
  } catch {
    throw new CliError(`MTAR file not found or not readable: ${fullPath}`, 2);
  }
  if (!stats.isFile()) throw new CliError(`Not a file: ${fullPath}`, 2);
  if (path.extname(fullPath).toLowerCase() !== '.mtar') {
    throw new CliError(`Expected an .mtar file, got: ${path.basename(fullPath)}`, 2);
  }
  return { path: fullPath, name: path.basename(fullPath), sizeBytes: stats.size };
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    fs.createReadStream(filePath)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

module.exports = { inspectArtifact, sha256File };
