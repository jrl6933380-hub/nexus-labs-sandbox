// /lib/vercel.js
// Links a newly created GitHub repo to a new Vercel project, so it
// gets real branch preview URLs automatically on every push — the
// same behavior Vercel already gives any git-connected project, just
// applied the moment a repo is created instead of as a manual step.

// Accepts either name — Vercel's dashboard doesn't allow renaming an
// existing env var (only editing its value), so this reads whichever
// one is actually set instead of forcing a delete-and-recreate.
const VERCEL_TOKEN = process.env.VERCEL_TOKEN || process.env.NEXS_TOKEN;
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID; // optional — omit for a personal-scope token
const VERCEL_API = 'https://api.vercel.com';

export async function linkRepoToVercel({ name, owner, repo }) {
  if (!VERCEL_TOKEN) {
    // Not configured — this is expected until the env var is added.
    // Callers should treat this as "skipped", not a hard failure, so
    // repo creation itself never breaks because of it.
    return { linked: false, reason: 'No Vercel token configured (checked VERCEL_TOKEN and NEXS_TOKEN)' };
  }

  const query = VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(VERCEL_TEAM_ID)}` : '';
  const res = await fetch(`${VERCEL_API}/v9/projects${query}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VERCEL_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      gitRepository: { type: 'github', repo: `${owner}/${repo}` },
    }),
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    console.error('linkRepoToVercel failed:', res.status, JSON.stringify(data).slice(0, 300));
    return { linked: false, reason: `Vercel API error (${res.status})` };
  }

  return {
    linked: true,
    project_id: data.id,
    project_name: data.name,
  };
}
