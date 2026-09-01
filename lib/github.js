// /lib/github.js
// GitHub Contents API helpers, shared by the MCP server.

import { linkRepoToVercel } from './vercel.js';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_API = 'https://api.github.com';

async function githubRequest(path, options = {}) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

async function getFileSha(owner, repo, path, branch) {
  const query = branch ? `?ref=${encodeURIComponent(branch)}` : '';
  const { ok, data } = await githubRequest(`/repos/${owner}/${repo}/contents/${path}${query}`);
  if (ok && data && !Array.isArray(data)) return data.sha;
  return null;
}

async function getDefaultBranch(owner, repo) {
  const { ok, data } = await githubRequest(`/repos/${owner}/${repo}`);
  if (ok && data?.default_branch) return data.default_branch;
  return 'main';
}

async function getBranchSha(owner, repo, branch) {
  const { ok, data } = await githubRequest(`/repos/${owner}/${repo}/git/ref/heads/${branch}`);
  if (ok && data?.object?.sha) return data.object.sha;
  return null;
}

async function getCommitTreeSha(owner, repo, commitSha) {
  const { ok, data } = await githubRequest(`/repos/${owner}/${repo}/git/commits/${commitSha}`);
  if (ok && data?.tree?.sha) return data.tree.sha;
  return null;
}

export async function createOrUpdateFile({ owner, repo, path, content, message, branch }) {
  const existingSha = await getFileSha(owner, repo, path, branch);
  const body = {
    message: message || (existingSha ? `Update ${path}` : `Create ${path}`),
    content: Buffer.from(content, 'utf-8').toString('base64'),
    ...(existingSha ? { sha: existingSha } : {}),
    ...(branch ? { branch } : {}),
  };
  const { ok, status, data } = await githubRequest(
    `/repos/${owner}/${repo}/contents/${path}`,
    { method: 'PUT', body: JSON.stringify(body) }
  );
  if (!ok) throw new Error(`GitHub API error (${status}): ${JSON.stringify(data).slice(0, 300)}`);
  return { path, sha: data?.content?.sha, committed: true };
}

export async function deleteFile({ owner, repo, path, message, branch }) {
  const sha = await getFileSha(owner, repo, path, branch);
  if (!sha) throw new Error(`File not found: ${path}`);
  const body = { message: message || `Delete ${path}`, sha, ...(branch ? { branch } : {}) };
  const { ok, status, data } = await githubRequest(
    `/repos/${owner}/${repo}/contents/${path}`,
    { method: 'DELETE', body: JSON.stringify(body) }
  );
  if (!ok) throw new Error(`GitHub API error (${status}): ${JSON.stringify(data).slice(0, 300)}`);
  return { path, deleted: true };
}

export async function listFiles({ owner, repo, path, branch }) {
  const query = branch ? `?ref=${encodeURIComponent(branch)}` : '';
  const { ok, status, data } = await githubRequest(
    `/repos/${owner}/${repo}/contents/${path || ''}${query}`
  );
  if (!ok) throw new Error(`GitHub API error (${status}): ${JSON.stringify(data).slice(0, 300)}`);
  if (!Array.isArray(data)) return [{ name: data.name, path: data.path, type: data.type }];
  return data.map((item) => ({ name: item.name, path: item.path, type: item.type }));
}

export async function readFile({ owner, repo, path, branch }) {
  const query = branch ? `?ref=${encodeURIComponent(branch)}` : '';
  const { ok, status, data } = await githubRequest(
    `/repos/${owner}/${repo}/contents/${path}${query}`
  );
  if (!ok) throw new Error(`GitHub API error (${status}): ${JSON.stringify(data).slice(0, 300)}`);
  if (Array.isArray(data)) throw new Error(`Path is a directory, not a file: ${path}`);
  const content = data.content ? Buffer.from(data.content, 'base64').toString('utf-8') : '';
  return { path, content, sha: data.sha };
}

export async function createRepo({ owner, name, description, private: isPrivate = false }) {
  // Assumes the owner is the same account the GITHUB_TOKEN belongs to
  // (a personal repo, not an org). /user/repos creates under whoever
  // the token authenticates as — there's no separate "owner" param on
  // this endpoint.
  const body = {
    name,
    description: description || '',
    private: isPrivate,
    auto_init: true, // creates an initial commit/README so the repo has a real default branch right away
  };
  const { ok, status, data } = await githubRequest('/user/repos', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!ok) throw new Error(`GitHub API error (${status}): ${JSON.stringify(data).slice(0, 300)}`);

  // Link to a new Vercel project right away, so pushes to any branch on
  // this repo get real preview URLs automatically. Never lets a Vercel
  // hiccup undo or block the GitHub repo creation that already succeeded.
  const vercel = await linkRepoToVercel({ name: data.name, owner: data.owner.login, repo: data.name });

  return {
    name: data.name,
    full_name: data.full_name,
    html_url: data.html_url,
    default_branch: data.default_branch,
    created: true,
    vercel,
  };
}

export async function createBranch({ owner, repo, branch, from_branch }) {
  const base = from_branch || (await getDefaultBranch(owner, repo));
  const baseSha = await getBranchSha(owner, repo, base);
  if (!baseSha) throw new Error(`Could not find base branch "${base}" to branch from.`);
  const body = { ref: `refs/heads/${branch}`, sha: baseSha };
  const { ok, status, data } = await githubRequest(`/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!ok) throw new Error(`GitHub API error (${status}): ${JSON.stringify(data).slice(0, 300)}`);
  return { branch, from_branch: base, created: true };
}

export async function createPullRequest({ owner, repo, title, head, base, body: prBody }) {
  const baseBranch = base || (await getDefaultBranch(owner, repo));
  const requestBody = { title, head, base: baseBranch, body: prBody || '' };
  const { ok, status, data } = await githubRequest(`/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    body: JSON.stringify(requestBody),
  });
  if (!ok) throw new Error(`GitHub API error (${status}): ${JSON.stringify(data).slice(0, 300)}`);
  return {
    number: data.number,
    html_url: data.html_url,
    title: data.title,
    state: data.state,
    created: true,
  };
}

export async function deleteRepo({ owner, repo }) {
  // Irreversible — GitHub does not soft-delete or trash repositories.
  const { ok, status, data } = await githubRequest(`/repos/${owner}/${repo}`, {
    method: 'DELETE',
  });
  if (!ok) throw new Error(`GitHub API error (${status}): ${JSON.stringify(data).slice(0, 300)}`);
  return { owner, repo, deleted: true };
}

export async function searchCode({ owner, repo, query }) {
  // GitHub's code search — finds where something actually lives instead
  // of guessing at folder paths. Scoped to one repo with repo:owner/repo.
  const q = `${query} repo:${owner}/${repo}`;
  const { ok, status, data } = await githubRequest(`/search/code?q=${encodeURIComponent(q)}`);
  if (!ok) throw new Error(`GitHub API error (${status}): ${JSON.stringify(data).slice(0, 300)}`);
  return {
    total_count: data.total_count,
    items: (data.items || []).map((item) => ({
      name: item.name,
      path: item.path,
      html_url: item.html_url,
    })),
  };
}

export async function commitFiles({ owner, repo, branch, message, files }) {
  // Uses the Git Data API (blobs -> tree -> commit -> ref) instead of
  // the simple Contents API, so multiple file changes land as ONE
  // atomic commit — either all of them apply, or none do.
  const targetBranch = branch || (await getDefaultBranch(owner, repo));
  const latestCommitSha = await getBranchSha(owner, repo, targetBranch);
  if (!latestCommitSha) throw new Error(`Could not find branch "${targetBranch}".`);
  const baseTreeSha = await getCommitTreeSha(owner, repo, latestCommitSha);
  if (!baseTreeSha) throw new Error(`Could not resolve base tree for branch "${targetBranch}".`);

  const treeEntries = [];
  for (const file of files) {
    if (file.content === undefined || file.content === null) {
      treeEntries.push({ path: file.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const { ok, status, data } = await githubRequest(`/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: file.content, encoding: 'utf-8' }),
    });
    if (!ok) throw new Error(`GitHub API error creating blob for ${file.path} (${status}): ${JSON.stringify(data).slice(0, 300)}`);
    treeEntries.push({ path: file.path, mode: '100644', type: 'blob', sha: data.sha });
  }

  const treeRes = await githubRequest(`/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
  });
  if (!treeRes.ok) throw new Error(`GitHub API error creating tree (${treeRes.status}): ${JSON.stringify(treeRes.data).slice(0, 300)}`);

  const commitRes = await githubRequest(`/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: message || `Batch commit: ${files.length} file(s)`,
      tree: treeRes.data.sha,
      parents: [latestCommitSha],
    }),
  });
  if (!commitRes.ok) throw new Error(`GitHub API error creating commit (${commitRes.status}): ${JSON.stringify(commitRes.data).slice(0, 300)}`);

  const refRes = await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${targetBranch}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commitRes.data.sha }),
  });
  if (!refRes.ok) throw new Error(`GitHub API error updating branch ref (${refRes.status}): ${JSON.stringify(refRes.data).slice(0, 300)}`);

  return {
    branch: targetBranch,
    commit_sha: commitRes.data.sha,
    files_changed: files.length,
    committed: true,
  };
}
