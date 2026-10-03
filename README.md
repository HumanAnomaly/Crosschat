<p align="center">
  <img src="assets/screenshot.png" alt="Crosschat">
</p>

<h1 align="center">Crosschat</h1>

<p align="center">
  CrossChat is an open-source chat hub that lets anyone chat seamlessly across Telegram, Discord, WhatsApp, and the web, without being tied to a single platform.
</p>

<p align="center">
  <a href="https://github.com/HumanAnomaly/Crosschat"><img src="https://img.shields.io/github/stars/HumanAnomaly/Crosschat?style=flat-square&logo=github" alt="stars"></a>
  <a href="https://github.com/HumanAnomaly/Crosschat/blob/main/LICENSE"><img src="https://img.shields.io/github/license/HumanAnomaly/Crosschat?style=flat-square" alt="license"></a>
  <img src="https://img.shields.io/badge/node-18%2B-green?style=flat-square&logo=node.js" alt="node">
  <img src="https://img.shields.io/badge/pnpm-10-blue?style=flat-square&logo=pnpm" alt="pnpm">
</p>


## Install

```bash
pnpm i
cp .env.example .env
pnpm generate:secrets
pnpm build
pnpm dev
```

## WhatsApp (zapo.to)

```bash
pnpm --filter @crosschat/whatsapp session:add wa
pnpm --filter @crosschat/whatsapp session:list
pnpm --filter @crosschat/whatsapp session:status wa
pnpm --filter @crosschat/whatsapp session:remove wa
```

Solo per project: `apps/whatsapp` owns the `zapo-js` session. No session or a
broken session means the service runs inactive (`/health` reports
`active:false`) instead of crashing. Pairing uses an 8-char code by default
(`WHATSAPP_PAIR_WITH_CODE=true`); pass `--qr-only` to scan a QR instead.

> Tips: Discord and Telegram work automatically with just a token
> (`DISCORD_BOT_TOKEN` / `TELEGRAM_BOT_TOKEN`): fill in `.env`, build, start,
> done. Every platform is optional: a missing token or a failed service is
> treated as not installed, the rest keeps running (`pnpm start` never requires
> the full set). WhatsApp needs one extra step: a token is not enough, you must
> add a session first (`session:add wa`, then enter the pairing code on your
> phone), and confirm `session:status wa` shows active plus `/health` shows
> `active:true` before linking on the web. Without that, the WA service
> intentionally stays idle and inactive.

## Bot menus & chatting

Each platform exposes the same features through its own native menu:

| Platform | Menu | Commands |
|---|---|---|
| Telegram | Menu button + inline buttons (auto-registered on boot) | `/start` status & actions, `/status` full info, `/help` command list, `/delete` (reply to one of YOUR messages) |
| Discord | Slash commands (auto-deployed on login) | `/start`, `/status`, `/help`, `/wired [code]`, `/newcode`, `/disconnect` |
| WhatsApp | Plain-text commands with `/` prefix (send `/menu` any time) | `/wired`, `/newcode`, `/status`, `/menu`, `/disconnect`, `/delete` (as a reply) |

How chatting works:

1. Link once: generate a code on the web and send it to the bot, or run the
   bot's `newcode`/`/newcode` flow and enter that code on the web.
2. After linking, just chat normally: every message (text, photos, video,
   documents, voice notes up to 20MB) forwards both ways between the web room
   and the platform DM.
3. Delete one of YOUR messages to remove it on both sides (web: right-click /
   long-press; Telegram: `/delete` as a reply; Discord/WhatsApp: delete the
   native message). You can only delete your own messages.
4. Either side can disconnect at any time; the room closes on both sides.

---

## How it works

```mermaid
flowchart LR
    W[web: sign in with Google] --> C[generate pairing code]
    C --> T[user sends code to Telegram bot]
    T --> L[1:1 link created]
    T2[press Wired in platform] --> C2[bot shows code]
    C2 --> W2[user enters code on web]
    W2 --> L
    L --> B[bridge forwards both ways]
    B --> M[text + media up to 20MB]
    D[disconnect either side] --> U[link closed, room closed]
```
## License

MIT, see [LICENSE](LICENSE).
