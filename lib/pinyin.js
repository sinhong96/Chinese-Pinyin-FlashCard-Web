// Pinyin normalization + tone-aware matching. No dependencies, no build step —
// loaded both as a Node module (bot/tests, via require) and as a plain
// <script> tag in the browser (functions attach to window). Same file, same
// logic, so the front end and any future tooling can never drift apart.
//
// The core idea: scan the string once, left to right. A tone-marked vowel
// contributes its plain vowel to `toneless` and its tone number (1-4) to
// `tones`; a trailing digit (tone-number input style, e.g. "xing2")
// contributes only to `tones`, nothing to `toneless`. Neutral-tone syllables
// (no mark, no digit — e.g. "de") contribute nothing to `tones` at all. This
// means tone-mark and tone-number input normalize to the identical shape
// without needing a real pinyin syllable dictionary.

const TONE_CHARS = { a: "āáǎà", e: "ēéěè", i: "īíǐì", o: "ōóǒò", u: "ūúǔù", v: "ǖǘǚǜ" };

function analyzePinyin(str) {
  const s = String(str || "").trim().toLowerCase().replace(/ü/g, "v").replace(/u:/g, "v");
  let toneless = "";
  const tones = [];
  for (const ch of s) {
    if (/[1-5]/.test(ch)) {
      tones.push(Number(ch));
      continue;
    }
    let matched = false;
    for (const base in TONE_CHARS) {
      const idx = TONE_CHARS[base].indexOf(ch);
      if (idx !== -1) {
        toneless += base;
        tones.push(idx + 1);
        matched = true;
        break;
      }
    }
    if (!matched && /[a-z]/.test(ch)) toneless += ch;
  }
  return { toneless, tones };
}

function matchPinyin(input, answer) {
  const a = analyzePinyin(input);
  const b = analyzePinyin(answer);
  if (a.toneless !== b.toneless) return 1;
  const toneMatch = a.tones.length === b.tones.length && a.tones.every((t, i) => t === b.tones[i]);
  return toneMatch ? 5 : 3;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { analyzePinyin, matchPinyin };
}
if (typeof window !== "undefined") {
  window.analyzePinyin = analyzePinyin;
  window.matchPinyin = matchPinyin;
}
