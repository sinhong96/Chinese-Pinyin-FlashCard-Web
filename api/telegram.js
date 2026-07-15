// Chinese pinyin bot — Vercel serverless function, no dependencies.
//
// What it does:
//   - Message a Hanzi/word (1-4 CJK characters), or "/py <word>" -> Claude
//     returns every distinct reading as a structured row (pinyin, Chinese
//     meaning, disambiguating sentence). Rows batch in the Gist; at 15 the
//     batch auto-commits as a new session CSV.
//   - /batch  -> show the current batch
//   - /csv    -> flush the batch to a CSV session now
//   - ✅/🔁 button taps from the daily push mark a card mastered/still-learning
//
// Required Vercel env vars: TELEGRAM_BOT_TOKEN, TELEGRAM_SECRET_TOKEN,
// ANTHROPIC_API_KEY, GITHUB_TOKEN. Optional: ALLOWED_CHAT_ID, GIST_ID.

const { readGist, writeGist, readGistFile, writeGistFile } = require("../lib/store");

const REPO = "sinhong96/Chinese-Pinyin-FlashCard-Web";
const BRANCH = "main";
const TIMEZONE = "Asia/Seoul";
const MODEL = "claude-haiku-4-5";
const BATCH_FILE = "vocab_batch.json";
const BATCH_SIZE = 15;
const USAGE_FILE = "usage.json";
const DAILY_MESSAGE_CAP = 60;

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(200).send("ok");
  if (
    process.env.TELEGRAM_SECRET_TOKEN &&
    req.headers["x-telegram-bot-api-secret-token"] !== process.env.TELEGRAM_SECRET_TOKEN
  ) {
    return res.status(401).send("bad secret");
  }

  const cq = req.body && req.body.callback_query;
  if (cq) {
    try { await handleCallback(cq); } catch (e) { console.error("callback", e.message); }
    return res.status(200).send("ok");
  }

  const msg = req.body && req.body.message;
  const text = msg && msg.text && msg.text.trim();
  const chatId = msg && msg.chat && msg.chat.id;
  if (!text || !chatId) return res.status(200).send("ignored");
  if (process.env.ALLOWED_CHAT_ID && String(chatId) !== process.env.ALLOWED_CHAT_ID) {
    return res.status(200).send("ignored");
  }

  try {
    sendChatAction(chatId);
    const typingTimer = setInterval(() => sendChatAction(chatId), 4000);
    try {
      let reply;
      const wordMatch = parseLookupRequest(text);
      if (/^\/(start|help)\b/i.test(text)) {
        reply = helpText();
      } else if (/^\/csv\b/i.test(text)) {
        reply = await flushBatch();
      } else if (/^\/batch\b/i.test(text)) {
        reply = await batchStatus();
      } else if (wordMatch) {
        reply = await lookupWord(wordMatch);
      } else {
        reply = "Send a Hanzi/word (e.g. 行 or 银行), or /py <word>. /batch to see progress, /csv to save now.";
      }
      const payload = typeof reply === "string" ? { text: reply } : reply;
      if (payload.text) await sendTelegram(chatId, payload.text, { buttons: payload.buttons });
    } finally {
      clearInterval(typingTimer);
    }
  } catch (err) {
    console.error(err);
    await sendTelegram(chatId, "Something went wrong: " + err.message).catch(() => {});
  }
  return res.status(200).send("ok");
};

// "行" (bare 1-4 char Hanzi message) or "/py 银行"
function parseLookupRequest(text) {
  const cmd = text.match(/^\/py\s+(.+)/i);
  if (cmd) return cmd[1].trim();
  if (/^[一-鿿]{1,4}$/.test(text)) return text;
  return null;
}

function helpText() {
  return (
    "Send a Hanzi/word to look up its pinyin (e.g. 行 or 银行), or /py <word>.\n" +
    "/batch — show the current lesson batch\n" +
    "/csv — save the batch to a CSV session now"
  );
}

// ---------- Claude lookup: every distinct reading, structured ----------

const READING_SCHEMA = {
  type: "object",
  properties: {
    readings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          pinyin: { type: "string" },
          meaning: { type: "string" },
          sentence: { type: "string" },
        },
        required: ["pinyin", "meaning", "sentence"],
        additionalProperties: false,
      },
    },
  },
  required: ["readings"],
  additionalProperties: false,
};

const READING_SYSTEM =
  "You give pinyin readings for Chinese characters/words, replying inside Telegram, plain text only " +
  "(no HTML, no markdown).\n\n" +
  "Given a Hanzi character or word, return JSON with 'readings': an array with ONE ENTRY PER DISTINCT " +
  "READING the character/word actually has in real usage (most single characters have one reading; " +
  "polyphonic characters like 行 or 银行 have more — include every genuinely common one, not obscure " +
  "classical-only readings).\n\n" +
  "For each reading:\n" +
  '"pinyin" — that reading, with tone marks (e.g. xíng, háng). No tone numbers, no brackets.\n' +
  '"meaning" — a concise Chinese explanation of that specific reading (近义词/解释 style), e.g. 走、去、可以.\n' +
  '"sentence" — one natural Chinese example sentence using the word WITH THIS READING, so the sentence ' +
  "itself disambiguates which reading is meant.";

async function lookupWord(word) {
  const gen = await claude(READING_SYSTEM, `Word: ${word}`, READING_SCHEMA, { maxTokens: 1500 });
  const out = JSON.parse(gen);
  const readings = (out.readings || []).filter((r) => r.pinyin && r.meaning);
  if (!readings.length) return `Couldn't find a reading for ${word}.`;

  const rows = readings.map((r) => ({ hanzi: word, pinyin: r.pinyin.trim(), meaning: r.meaning.trim(), sentence: (r.sentence || "").trim() }));

  if (!process.env.GIST_ID) {
    const saved = await commitRows(rows);
    return `${saved}\n\n(Batch tracking needs GIST_ID — saved directly.)`;
  }

  const batch = await readGistFile(BATCH_FILE);
  const batchRows = batch.rows || [];
  for (const row of rows) {
    const idx = batchRows.findIndex((r) => r.hanzi === row.hanzi && r.pinyin === row.pinyin);
    if (idx >= 0) batchRows[idx] = row;
    else batchRows.push(row);
  }
  await writeGistFile(BATCH_FILE, { rows: batchRows, startedAt: batch.startedAt || new Date().toISOString() });

  const summary = rows.map((r) => `${r.hanzi} — ${r.pinyin} — ${r.meaning}`).join("\n");
  if (batchRows.length >= BATCH_SIZE) {
    const saved = await flushBatch();
    return `${summary}\n\n🚨 Batch complete (${BATCH_SIZE}/${BATCH_SIZE})! Auto-saving…\n${saved}`;
  }
  return `${summary}\n\n[Batch ${batchRows.length}/${BATCH_SIZE}]`;
}

async function batchStatus() {
  if (!process.env.GIST_ID) return "Batch tracking needs GIST_ID configured.";
  const rows = (await readGistFile(BATCH_FILE)).rows || [];
  if (!rows.length) return "Batch is empty — send a Hanzi/word to start one.";
  return (
    `Current batch (${rows.length}/${BATCH_SIZE}):\n` +
    rows.map((r, i) => `${i + 1}. ${r.hanzi} — ${r.pinyin} — ${r.meaning}`).join("\n") +
    "\n\n/csv to save it now."
  );
}

async function flushBatch() {
  if (!process.env.GIST_ID) return "Batch tracking needs GIST_ID configured.";
  const rows = (await readGistFile(BATCH_FILE)).rows || [];
  if (!rows.length) return "Nothing to save — the batch is empty.";
  const saved = await commitRows(rows);
  await writeGistFile(BATCH_FILE, { rows: [], startedAt: null });
  return saved;
}

// ---------- commit rows [{hanzi, pinyin, meaning, sentence}] to a session CSV ----------

async function commitRows(rows) {
  const csvEscape = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = rows.map((r) => [r.hanzi, r.pinyin, r.meaning, r.sentence].map(csvEscape).join(","));

  const manifest = JSON.parse(await githubRaw("sessions.json"));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
  const compact = today.replace(/-/g, "");
  let entry = manifest.find((e) => e.date === today && e.tag === "Bot");

  if (entry) {
    const existing = await githubRaw(entry.file);
    await ghPut(entry.file, existing.replace(/\n?$/, "\n") + lines.join("\n") + "\n", `Bot: add ${rows.length} row(s)`);
    entry.count += rows.length;
  } else {
    const session = Math.max(0, ...manifest.filter((e) => e.date === today).map((e) => e.session)) + 1;
    const file = `vocablist_csv/${compact}_${String(session).padStart(2, "0")}_LIST_Bot.csv`;
    await ghPut(file, "Hanzi,Pinyin,Meaning,Sentence\n" + lines.join("\n") + "\n", `Bot: new session with ${rows.length} row(s)`);
    const d = new Date(today + "T00:00:00");
    const label = d.toLocaleString("en-US", { month: "short" }) + " " + d.getDate() + (session > 1 ? ` · #${session}` : "");
    entry = { file, date: today, session, tag: "Bot", label, count: rows.length };
    manifest.push(entry);
    manifest.sort((a, b) => (a.date + a.session).localeCompare(b.date + b.session));
  }
  await ghPut("sessions.json", "[\n" + manifest.map((e) => "  " + JSON.stringify(e)).join(",\n") + "\n]\n", "Bot: update sessions.json");

  return (
    `Added ${rows.length} row(s) to ${entry.label} (Bot):\n` +
    rows.map((r) => `• ${r.hanzi} — ${r.pinyin} — ${r.meaning}`).join("\n") +
    "\n\nVercel is redeploying — it'll be in the flashcard app in ~1 min."
  );
}

async function githubRaw(path) {
  const r = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${BRANCH}`,
    { headers: ghHeaders({ Accept: "application/vnd.github.raw+json" }) }
  );
  if (!r.ok) throw new Error(`GitHub read ${path}: ${r.status}`);
  return r.text();
}

function ghHeaders(extra = {}) {
  const h = { "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "cn-pinyin-bot", ...extra };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function ghPut(path, content, message) {
  const url = `https://api.github.com/repos/${REPO}/contents/${path}`;
  let sha;
  const head = await fetch(`${url}?ref=${BRANCH}`, { headers: ghHeaders() });
  if (head.ok) sha = (await head.json()).sha;
  const r = await fetch(url, {
    method: "PUT",
    headers: ghHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      message,
      branch: BRANCH,
      content: Buffer.from(content, "utf-8").toString("base64"),
      ...(sha ? { sha } : {}),
    }),
  });
  if (!r.ok) throw new Error(`GitHub write ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
}

// ---------- daily-push button taps ----------

async function handleCallback(cq) {
  const chatId = cq.message && cq.message.chat && cq.message.chat.id;
  const data = cq.data || "";
  const [action, key] = [data[0], data.slice(2)];
  if (!chatId || !key) return;
  const state = await readGist();
  if (action === "m") delete state[key];
  else if (action === "k") {
    const e = state[key] || { count: 0, lastSent: null };
    e.count = (e.count || 0) + 1;
    e.forgotAt = new Date().toISOString();
    state[key] = e;
  }
  await writeGist(state);
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: cq.id, text: action === "m" ? "Marked mastered ✅" : "Back in the queue 🔁" }),
  }).catch(() => {});
}

// ---------- Telegram send ----------

function sendChatAction(chatId, action = "typing") {
  return fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action }),
  }).catch(() => {});
}

async function sendTelegram(chatId, text, opts = {}) {
  const post = (payload) =>
    fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  for (let i = 0; i < text.length; i += 4000) {
    const chunk = text.slice(i, i + 4000);
    const markup = opts.buttons && i + 4000 >= text.length ? { reply_markup: { inline_keyboard: opts.buttons } } : {};
    const r = await post({ chat_id: chatId, text: chunk, ...markup });
    if (!r.ok) throw new Error(`Telegram send: ${r.status}`);
  }
}

// ---------- Claude API (raw fetch, no SDK) ----------

async function checkDailyCap() {
  if (!process.env.GIST_ID) return;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
  const usage = await readGistFile(USAGE_FILE);
  const count = usage.date === today ? usage.count || 0 : 0;
  if (count >= DAILY_MESSAGE_CAP) {
    throw new Error(`Daily Claude usage cap reached (${DAILY_MESSAGE_CAP}/day) — try again after midnight ${TIMEZONE}.`);
  }
  await writeGistFile(USAGE_FILE, { date: today, count: count + 1 });
}

async function claude(system, userText, outputSchema, opts = {}) {
  await checkDailyCap();
  const body = {
    model: opts.model || MODEL,
    max_tokens: opts.maxTokens || 1500,
    system,
    messages: [{ role: "user", content: userText }],
  };
  if (outputSchema) body.output_config = { format: { type: "json_schema", schema: outputSchema } };
  let r;
  for (let attempt = 0; ; attempt++) {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (r.ok || attempt >= 2 || (r.status < 429 && r.status !== 408)) break;
    await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
  }
  if (r.status === 529) throw new Error("Anthropic's API is overloaded right now — try again in a minute 🙏");
  if (!r.ok) throw new Error(`Claude API ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  if (data.stop_reason === "refusal") throw new Error("Claude declined the request");
  const textBlock = data.content.find((b) => b.type === "text");
  const text = textBlock ? textBlock.text : "";
  if (outputSchema) {
    if (data.stop_reason === "max_tokens") throw new Error("Claude response hit the token limit — try again");
    if (!text.trim()) throw new Error(`Claude returned no text (stop: ${data.stop_reason})`);
  }
  return text;
};
