# بتموس — Battle Royale

A 3D browser-based Battle Royale game (100-player, PUBG-style) built with Three.js + React. Features a shrinking zone, multiple weapons, bots, terrain generation, and squads.

## Run & Operate

- `pnpm --filter @workspace/batmos-game run dev` — run the game frontend (Vite, reads `PORT` env var)
- `pnpm --filter @workspace/api-server run dev` — run the API server (Express 5, reads `PORT` env var)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes to dev database (Drizzle)
- Required env: `DATABASE_URL` — auto-provisioned by Replit (do not set manually)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Game: React + Vite + Three.js (3D rendering), simplex-noise (terrain)
- UI: Tailwind CSS v4, shadcn/ui components, Radix UI
- API: Express 5
- DB: PostgreSQL + Drizzle ORM (`lib/db`)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from `lib/api-spec/openapi.yaml`)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/batmos-game/src/BatmosGame.tsx` — all game logic and 3D rendering (Three.js)
- `artifacts/batmos-game/src/Game.tsx` — game component wrapper
- `artifacts/api-server/src/` — Express app, routes, middlewares
- `lib/db/src/schema/` — Drizzle table definitions (source of truth for DB schema)
- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for API contracts)
- `lib/api-client-react/` — generated React Query hooks (from Orval codegen)
- `lib/api-zod/` — generated Zod schemas (from Orval codegen)

## Architecture decisions

- The game is entirely client-side (Three.js); the API server is for future leaderboards/auth/persistence.
- DB schema is currently empty — no tables defined yet. The API only exposes `/api/healthz`.
- `DATABASE_URL` is runtime-managed by Replit — never set it manually as a secret or env var.
- The game requires WebGL 2; the app shows a graceful Arabic error message when WebGL is unavailable.
- Shadows use PCFSoft shadow map at 2048×2048 on the directional sun light only (performance balance).
- Bot mesh children are positionally ordered: [0]=legL, [1]=legR, [2]=bootL, [3]=bootR, [4]=belt, [5]=torso, [6]=armL, [7]=armR — animation code relies on these indices.
- Cover points are generated at each building corner (+1.2m offset) and marked with `occupiedBy: botId`.
- Building AABBs are stored for both player push-out collision and bot pathfinding deflection.

## Product

A 100-player Battle Royale: parachute onto a procedurally generated 3D map, loot weapons (AK-47, M416, AWM, UZI, Shotgun), fight 99 bots, survive the shrinking zone, be the last one standing.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- After any DB schema change in `lib/db/src/schema/`, run `pnpm --filter @workspace/db run push` to apply it to the dev database.
- After any OpenAPI spec change in `lib/api-spec/openapi.yaml`, run codegen to regenerate hooks/schemas.
- The game `CONFIG` object at the top of `BatmosGame.tsx` controls all tunable game parameters.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
