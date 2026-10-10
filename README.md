# Memory AI (Tiny)

Your private AI friend that remembers everything. One Cloudflare Worker serves the website and the API.

- **Chat** with your Tiny/Byte character above the chat bar (same spot and poses as your zip). No daily limit.
- **Voice**: voice chat screen (talk, she answers out loud), mic dictation, a Listen button on every reply.
- **Play**: Tic-Tac-Toe, Rock Paper Scissors, Word Chain, 20 Questions, Truth or Dare, Trivia. Scores saved.
- **New today**: 6 fresh things to create today, made from what she knows about you. Refreshes at 6:00 IST.
- **Notes**: write pages, or save any reply or whole chat. Autosave with a stale-edit guard, Markdown preview, and "Ask Tiny about this" so she reads the note you have open. Notes are also found by meaning in later chats.
- **Reminders and routines**: say "every morning at 8, cheer me on" or "remind me tomorrow 6 pm to call mom". She does it on time using your memories, saves it in a Routines chat and sends it to Telegram.
- **Ask before she remembers** (optional): new facts wait for your OK in Memory.
- **Slash commands** in the chat bar: /note, /remember, /remind, /today, /play, /voice, /new.
- **Act like a girl**: name, vibe, language, extra instructions, voice, Telegram, backups.
- **Memory** and **History**: see, pin, edit, forget; search every chat from the website and Telegram.
- **Telegram bot**: same brain and memory. Text and voice notes both ways. Only you can use it.

## Free stack
Workers + static assets, D1 (chats, memories), Vectorize (finds memories by meaning),
KV (settings, today's ideas), Workers AI (embeddings, voice), Groq (main model, speech to text), OpenRouter (backup model).

No R2 and no card needed. Nothing here stores PDFs, images or any files, only text.

## Voices
Tiny (girl: Hannah, Autumn, Diana) and Byte (boy: Troy, Austin, Daniel) use Groq Orpheus first. Do the one-time "accept terms" click at console.groq.com/playground?model=canopylabs%2Forpheus-v1-english. If it is not accepted or busy, Cloudflare Aura/Melo take over, then your browser voice. 

### Real Hindi voice (optional, free to start)
Cloudflare and Groq have no Hindi voice, so Hindi and Hinglish use your browser's voice by default. For a real one, add either secret (Sarvam is tried first):
```bash
npx wrangler secret put SARVAM_API_KEY   # sarvam.ai, Bulbul voices (priya / aditya), free signup credits
npx wrangler secret put GEMINI_API_KEY   # aistudio.google.com, Gemini voices (Kore / Puck), free tier
```
Voice names are in `wrangler.toml` (`SARVAM_GIRL`, `GEMINI_GIRL`, ...). Telegram voice replies use Sarvam only (it makes mp3). Sarvam's Bulbul names and Gemini's TTS model change over time, so if Hindi falls back to the browser voice, check the names in `wrangler.toml` and `npx wrangler tail`.

## Phone app, notifications and reminders on time
The site is an installable app (PWA). Because her Worker runs on Cloudflare day and night, reminders reach you even when the app is closed.
```bash
npm run vapid                              # prints two keys
npx wrangler secret put VAPID_PUBLIC       # paste the first
npx wrangler secret put VAPID_PRIVATE      # paste the second
npm run deploy
```
Then open the site on your phone, go to **Act like a girl**, tap **Install the app** and **Turn on notifications**. On iPhone, first use Share, then Add to Home Screen, and open it from there (iOS 16.4 or newer). Reminders now run on the minute (the cron runs every minute).

## Looking after you
- **Mood check-in**: once a day at the time you pick she asks how you feel (tap 1 to 5 on the Mood page, in the notification, or on the Telegram buttons). She remembers the last week and follows up gently.
- **"Are you forgetting me?"**: after 2 days (you choose) without a message she sends a sad little note with 😢. It repeats every 2 days, up to 3 times, only between 10 am and 9 pm India time, and starts over when you come back.
- **Texting style**: replies arrive as a few short bubbles with typing dots (Telegram too). Turn it off on the same page.
- **Hands-free**: switch on "Hey Tiny". It listens while the website is open in Chrome or Edge, and opens voice chat when you call her. Browsers do not allow listening when the page is closed.
- **Games**: Word Scramble and Hangman join the quiz, with a points board and her sticker reactions.

## Setup (about 15 minutes)
You need Node 20+ and a free Cloudflare account. Run these inside this folder.

```bash
npm install
npx wrangler login

# 1. create the storage
npx wrangler d1 create memory-ai-db          # copy the database_id into wrangler.toml
npx wrangler kv namespace create KV          # copy the id into wrangler.toml
npx wrangler vectorize create memory-ai-index --dimensions=1024 --metric=cosine

# 2. create the tables
npm run db:init        # safe to run again after updates

# 3. secrets
npx wrangler secret put ACCESS_KEY           # your own long passphrase: this is your login
npx wrangler secret put GROQ_API_KEY         # free at console.groq.com
npx wrangler secret put OPENROUTER_API_KEY   # optional, free at openrouter.ai

# 4. go live
npm run deploy
```
Open the URL it prints, enter your ACCESS_KEY, and start talking.

## Telegram (optional)
1. In Telegram, message @BotFather, send `/newbot`, copy the token.
2. `npx wrangler secret put TELEGRAM_BOT_TOKEN` and `npx wrangler secret put TG_WEBHOOK_SECRET` (any random text).
3. `npm run deploy`, then on the site go to **Act like a girl** and press **Connect the bot**.
4. Message your bot once. It replies with your Telegram ID. Run `npx wrangler secret put OWNER_TG_ID`, paste it, and deploy again.

Bot commands: `/new`, `/remember <fact>`, `/today`, `/voice on|off`.

## Things worth knowing
- **No usage limit in the code.** The free plans of Cloudflare, Groq and OpenRouter have their own daily caps. When Groq is full the app tries the next model, then OpenRouter. Workers Free allows about 100,000 requests a day and Workers AI gives 10,000 free "neurons" a day, which is plenty for one person.
- **Model names** live in `wrangler.toml` under `[vars]`. If a model is retired, change the name there and deploy. OpenRouter free model ids change often, so check openrouter.ai/models for current free ones.
- **Voice**: speech to text is Groq Whisper (Workers AI Whisper as backup). Spoken replies use the voice chain above. Browser voice uses the pitch slider, so Tiny and Byte can sound different.
- **Privacy**: everything is behind your ACCESS_KEY. Changing that secret logs out every device. The app never stores passwords, card numbers or ID numbers it hears about.
- **Backups** go to KV (text only) every Sunday 02:30 IST (last 4 kept). **Back up now** and **Download all** are on the persona page.
- **Local testing**: `npm run db:init:local` then `npm run dev`. Vectorize and Workers AI need a Cloudflare login to work locally; without them the app falls back to keyword memory search and browser voice.

## Ideas borrowed from OpenDots
Notes (its Spaces and pages), reminders (its scheduled tasks), approve-before-saving (its review card) and the call timer, mute and captions come from ideas in the OpenDots template (MIT). No OpenDots code is included. Its Slack, MCP connections, per-agent computers and CopilotKit conversation services need Docker and paid or self-hosted services, so they are not part of this free Worker.

## Updating an existing deployment
Run `npm run db:init` (adds the notes, tasks and moods tables), then `npm run deploy`. The crons are updated automatically (every minute, daily ideas, weekly backup: 3 of the 5 free triggers). If you use Telegram, press **Connect the bot** again so the mood buttons work.
