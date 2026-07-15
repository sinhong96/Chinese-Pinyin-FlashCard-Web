const assert = require("assert");
const { analyzePinyin, matchPinyin } = require("../lib/pinyin.js");

// analyzePinyin: tone-mark and tone-number inputs normalize to the same shape
assert.deepStrictEqual(analyzePinyin("xíng"), { toneless: "xing", tones: [2] });
assert.deepStrictEqual(analyzePinyin("xing2"), { toneless: "xing", tones: [2] });
assert.deepStrictEqual(analyzePinyin("yínháng"), { toneless: "yinhang", tones: [2, 2] });
assert.deepStrictEqual(analyzePinyin("yin2hang2"), { toneless: "yinhang", tones: [2, 2] });
assert.deepStrictEqual(analyzePinyin("lǜ"), { toneless: "lv", tones: [4] });
assert.deepStrictEqual(analyzePinyin("nǚ"), { toneless: "nv", tones: [3] });
assert.deepStrictEqual(analyzePinyin("de"), { toneless: "de", tones: [] }); // neutral tone, no digit/mark

// matchPinyin: 5 = perfect, 3 = right syllable(s) wrong tone(s), 1 = wrong
assert.strictEqual(matchPinyin("xíng", "xíng"), 5);
assert.strictEqual(matchPinyin("xing2", "xíng"), 5); // tone-number input accepted
assert.strictEqual(matchPinyin("xing4", "xíng"), 3); // right syllable, wrong tone
assert.strictEqual(matchPinyin("xin", "xíng"), 1); // wrong syllable
assert.strictEqual(matchPinyin("yínháng", "yínháng"), 5);
assert.strictEqual(matchPinyin("yīnháng", "yínháng"), 3); // one syllable's tone wrong
assert.strictEqual(matchPinyin("de", "de"), 5); // both neutral, no tones to compare
assert.strictEqual(matchPinyin("nǚ", "nǚ"), 5); // ü/v handling round-trips

console.log("All pinyin.js tests passed.");
