# Chinese Pinyin Flashcard

Pinyin-recall flashcards for Hanzi/words you already understand but aren't
sure how to pronounce. Sibling project to the Korean TOPIK flashcard app —
same SM-2 + Telegram-bot architecture, fully separate deploy.

See `docs/superpowers/specs/2026-07-15-chinese-pinyin-flashcard-design.md`
and `docs/superpowers/plans/2026-07-15-chinese-pinyin-flashcard.md` in the
Korean-FlashCard-Web repo for the original design rationale and plan.

## Env vars (set in Vercel, never committed)
| Var | Used by | Purpose |
|-----|---------|---------|
| `TELEGRAM_BOT_TOKEN` | telegram, daily | Bot auth (from @BotFather) |
| `TELEGRAM_SECRET_TOKEN` | telegram | Verifies webhook calls |
| `ANTHROPIC_API_KEY` | telegram | Claude API for lessons |
| `GITHUB_TOKEN` | telegram, store | PAT — repo Contents R/W + Gists |
| `GIST_ID` | sync, daily, store, telegram | Private Gist holding batch/review state |
| `ALLOWED_CHAT_ID` | telegram, daily | Restricts bot to your chat |
| `CRON_SECRET` | daily | Protects the cron endpoint |
