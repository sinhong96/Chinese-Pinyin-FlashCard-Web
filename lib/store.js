// Shared review-queue/batch store, kept in a private GitHub Gist so writes
// never touch the repo (a repo commit would trigger a Vercel redeploy on
// every tap). Same pattern as the Korean flashcard project's lib/store.js.
//
// Data model — a map keyed by "<hanzi>|<pinyin>" (composite key, since one
// Hanzi can have multiple readings/rows):
//   { "<hanzi>|<pinyin>": { meaning, sentence, count, forgotAt, lastSent } }
//   - count:    how many times it's been marked "still learning"
//   - forgotAt: ISO timestamp of the most recent "still learning"
//   - lastSent: ISO timestamp of the last daily push (null = never sent)
//
// Requires env: GIST_ID, and GITHUB_TOKEN with Gist read/write.

const GIST_FILE = "weak_words.json";

function ghHeaders(extra = {}) {
  const h = { "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "cn-pinyin-bot", ...extra };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function readGistFile(file) {
  const r = await fetch(`https://api.github.com/gists/${process.env.GIST_ID}`, { headers: ghHeaders() });
  if (!r.ok) throw new Error(`Gist read: ${r.status}`);
  const data = await r.json();
  const f = data.files && data.files[file];
  if (!f || !f.content) return {};
  try {
    return JSON.parse(f.content);
  } catch {
    return {};
  }
}

async function writeGistFile(file, obj) {
  const r = await fetch(`https://api.github.com/gists/${process.env.GIST_ID}`, {
    method: "PATCH",
    headers: ghHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ files: { [file]: { content: JSON.stringify(obj, null, 2) } } }),
  });
  if (!r.ok) throw new Error(`Gist write: ${r.status}`);
}

const readGist = () => readGistFile(GIST_FILE);
const writeGist = (obj) => writeGistFile(GIST_FILE, obj);

module.exports = { ghHeaders, readGist, writeGist, readGistFile, writeGistFile };
