'use strict';

const path = require('node:path');

/**
 * Collects Git context for `cwd`. Every field is null when unavailable (Git not
 * installed, not a repository, no commits yet). This is context only: it does not
 * prove the MTAR was built from this commit.
 */
async function collectGitInfo({ run, cwd }) {
  const git = async (...args) => {
    const result = await run('git', args, { cwd });
    return result.code === 0 ? result.stdout.trim() : null;
  };

  const [userName, userEmail, root] = await Promise.all([
    git('config', 'user.name'),
    git('config', 'user.email'),
    git('rev-parse', '--show-toplevel'),
  ]);
  const info = {
    userName: userName || null,
    userEmail: userEmail || null,
    repositoryName: null,
    branch: null,
    commitSha: null,
    dirty: null,
    lastCommitAuthor: null,
  };
  if (!root) return info;

  const [branch, commitSha, status, lastCommitAuthor] = await Promise.all([
    git('branch', '--show-current'),
    git('rev-parse', 'HEAD'),
    git('status', '--porcelain'),
    git('log', '-1', '--format=%an <%ae>'),
  ]);
  return {
    ...info,
    repositoryName: path.basename(root),
    branch: branch || null, // empty on a detached HEAD
    commitSha: commitSha || null,
    dirty: status === null ? null : status.length > 0,
    lastCommitAuthor: lastCommitAuthor || null,
  };
}

module.exports = { collectGitInfo };
