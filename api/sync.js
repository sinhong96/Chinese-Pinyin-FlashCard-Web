// Receives forgot/remove events from the flashcard app and updates the
// review queue in the Gist. Called by the browser after each graded card.
//
// POST body: { action: "forgot" | "remove", hanzi, pinyin, meaning?, sentence? }
//
// Public endpoint (the flashcard page is public, so it can't hold
// credentials). Worst case someone finds the URL and adds junk to the review
// list — low stakes, bounded by MAX_WORDS.

const { readGist, writeGist } = require("../lib/store");
const MAX_WORDS = 2000;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  if (!process.env.GIST_ID) return res.status(200).json({ ok: false, reason: "no GIST_ID" });

  try {
    const { action, hanzi, pinyin, meaning = "", sentence = "" } = req.body || {};
    if (!hanzi || !pinyin || !action) return res.status(400).json({ ok: false });
    const key = `${hanzi}|${pinyin}`;

    const state = await readGist();
    if (action === "forgot") {
      if (Object.keys(state).length >= MAX_WORDS && !state[key]) {
        return res.status(200).json({ ok: false, reason: "queue full" });
      }
      const e = state[key] || { count: 0, lastSent: null };
      e.meaning = meaning;
      e.sentence = sentence;
      e.count = (e.count || 0) + 1;
      e.forgotAt = new Date().toISOString();
      if (!("lastSent" in e)) e.lastSent = null;
      state[key] = e;
    } else {
      delete state[key];
    }
    await writeGist(state);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("sync", e.message);
    res.status(200).json({ ok: false, error: e.message });
  }
};
