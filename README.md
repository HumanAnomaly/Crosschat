<p align="center">
  <img src="assets/screenshot.png" alt="Crosschat">
</p>

<h1 align="center">Crosschat</h1>

<p align="center">
  CrossChat is an open-source chat hub that lets anyone chat seamlessly across Telegram, Discord, and the web, without being tied to a single platform.
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
