# web: the screens

A [shadcn/ui](https://ui.shadcn.com) monorepo (Turborepo + npm workspaces, Next.js 16, Tailwind 4).

| Path | What | Port |
|---|---|---|
| `apps/cloud` | **Agent Cloud**: home, catalog (`/explore`), my agents, Studio, the coffee scenario, login | 3000 |
| `apps/home` | **Smart home app**: spaces, devices, external connections, activity, profile | 3001 |
| `packages/ui` | shadcn/ui components and the theme (`src/styles/globals.css`) | |
| `packages/core` | what both apps share: the server-side proxy and its allowlist (`proxy.ts`, `handlers.ts`), login sessions (`session.ts`), API hooks (`api.ts`), labels, icons, the agent sheet, login form, cards | |

Both apps talk to the services only through their own server-side proxy (`app/api/[service]/[...path]`):
the person's login session (an httpOnly cookie, shared by both apps on the same host) goes to the
Agent Hub and Studio; the Collector and Gateway are read with `DASHBOARD_TOKEN` after the session is
checked. Device commands, `tokens/verify` and agent registration are not reachable from here.

```bash
npm install
npm run dev              # both apps (turbo); services from ../docker-compose.yml on 127.0.0.1
npm run build
npm test -w @workspace/core   # the proxy allowlist (node --test)
npx shadcn@latest add <component>   # run inside apps/cloud or apps/home; it lands in packages/ui
```

Outside Docker the apps read `HUB_URL`, `STUDIO_URL`, `COLLECTOR_URL`, `GATEWAY_URL` (default
127.0.0.1:8400/8500/8200/8100) and `DASHBOARD_TOKEN` from the environment (e.g. `set -a; . ../.env`).
In Docker, `web/Dockerfile` builds both into one image; `docker-compose.yml` runs it as `cloud-web`
and `home-web`.
