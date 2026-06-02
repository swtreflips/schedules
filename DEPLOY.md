# DEPLOY.md — Wiring the Pieces Together for Production

A practical setup checklist. Tells you what needs to exist (and where) for the React app to deliver the full user experience end-to-end, and what's still on the React side to build.

This is **not** an implementation guide — it's a configuration/wiring map.

---

## What production looks like

A user opens the app, picks **Port of Loading**, enters a **Final Destination** (city/state or ZIP), picks a **Cargo Ready Date**, and toggles **carriers**. The grid then shows one schedule per active carrier — the earliest valid ETA — and each row can be expanded to swap in an alternative schedule for that carrier.

The qualification rule is:

```
schedule qualifies IF
    schedule.port_of_loading  ==  user POL
  AND
    distance(schedule.last_cy_geom, geocode(user destination)) <= radius
  AND
    schedule.etd > user CRD
  AND
    schedule.carrier ∈ enabled carriers
```

The first two checks happen **server-side** in Supabase (one round trip).
The last two happen **client-side** in React (instant filtering on already-fetched rows).

---

## The pieces

| Piece | Where | Status | Responsibility |
|---|---|---|---|
| React shell | Vercel (`*.vercel.app`) | ✅ deployed | UI, state, orchestration, last-mile filtering, grid grouping |
| Geocoder | Render (`https://geoapi-1cu6.onrender.com`) | ✅ deployed | Text → coordinates, cache-first via Supabase |
| Geocode cache | Supabase `geocode_cache` table | ✅ deployed | First-write storage for resolved coordinates |
| Schedules DB | Supabase `schedules` + `ports` tables, PostGIS-enabled | ✅ deployed (data loaded) | Schedule rows with `last_cy_geom`, port reference data |
| Schedules RPC | Supabase `nearby_schedules` function | ❌ **needs to be created** | Single endpoint React calls for filtered schedules |

Two of these (React, geocoder) are deployed. Supabase is loaded with data. The missing piece is **one PostgreSQL function** that does the AND of POL match + geographic radius check.

---

## End-to-end data flow

When the user clicks Search:

```
[1] React reads form state
    ────────────────────────────────────────────
    pol             = "Laem Chabang, Thailand"
    destination     = "Hialeah, FL"
    crd             = "2026-05-26"
    enabledCarriers = { MSC, MAE, COS, HPL, ONE, ... }
    radiusMiles     = 100   (default; future control)

[2] React → GeoAPI on Render
    ────────────────────────────────────────────
    GET https://geoapi-1cu6.onrender.com/geocode?q=Hialeah,%20FL

    GeoAPI checks Supabase geocode_cache:
      - hit  → return cached row immediately
      - miss → call Nominatim (≤ 1 req/s), upsert into cache, return

    Response: { latitude: 25.8576, longitude: -80.2781, ... }

[3] React → Supabase (supabase-js, direct from browser)
    ────────────────────────────────────────────
    supabase.rpc('nearby_schedules', {
      p_pol:           "Laem Chabang, Thailand",
      p_lat:           25.8576,
      p_lon:           -80.2781,
      p_radius_meters: 160934   // 100 mi → meters
    })

    Postgres runs:
      SELECT * FROM schedules
       WHERE port_of_loading = p_pol
         AND last_cy_geom IS NOT NULL
         AND ST_DWithin(last_cy_geom, point, p_radius_meters);

    Returns N matching schedule rows.

[4] React client-side filtering
    ────────────────────────────────────────────
    schedules
      .filter(s => new Date(s.etd) > new Date(crd))   // CRD gate
      .filter(s => enabledCarriers.has(s.carrier_code)) // carrier gate

[5] React grouping & best-pick
    ────────────────────────────────────────────
    group by carrier_code → for each group sort by eta asc → pick [0]
    Result: array of "selected schedule per carrier" rows for the grid.
    Alternates per carrier are kept in state for the row-expand UI.

[6] AG Grid renders
    ────────────────────────────────────────────
    One row per carrier. Click a row → expand → list alternatives →
    pick one → that carrier's "selected schedule" updates → row re-renders.
```

Two network calls per search: geocode (~50ms cached, ~1s miss) + RPC (~50–200ms typical). Everything else is in-memory.

---

## What needs to be set up

### A. Supabase: create the `nearby_schedules` RPC

Run this once in the Supabase SQL Editor. It's the only missing server-side piece:

```sql
create or replace function nearby_schedules(
  p_pol           text,
  p_lat           double precision,
  p_lon           double precision,
  p_radius_meters double precision
)
returns setof schedules
language sql
stable
as $$
  select s.*
  from schedules s
  where s.port_of_loading = p_pol
    and s.last_cy_geom is not null
    and st_dwithin(
      s.last_cy_geom,
      st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography,
      p_radius_meters
    )
  order by s.eta asc;
$$;

-- Allow the public anon role to call it
grant execute on function nearby_schedules(text, double precision, double precision, double precision)
  to anon;
```

**Caveats to think about** (don't have to solve today, but flag for later):

- `port_of_loading = p_pol` is an **exact string match**. If your scraper sometimes writes `"Laem Chabang, Thailand"` and other times `"LAEM CHABANG"`, this match fails silently. A `ports` table with canonical UNLOCODE + aliases solves it eventually; for v1, decide whether the React form sends the exact string the scraper writes, or whether to use `ILIKE`/normalized-name matching in the function.
- If you want CRD pre-filtering on the server too (smaller payloads), add `p_min_etd date` as a parameter and `and s.etd > p_min_etd` to the WHERE clause. Right now the plan keeps it client-side since the user said so.

### B. Supabase: row-level security (RLS) on `schedules`

The React app authenticates as the **anon** role (publishable key). For that role to read `schedules`, you need either:

```sql
-- Option 1: enable RLS, allow anon read
alter table schedules enable row level security;
create policy "anon can read schedules"
  on schedules for select
  to anon
  using (true);
```

Or, if you don't want RLS on this table at all (it's not user-sensitive data):

```sql
-- Option 2: just grant select to anon, leave RLS off
grant select on schedules to anon;
```

Same answer applies to `geocode_cache` — though GeoAPI uses the service_role key from Render, not the anon key, so it's already covered.

Check current state in Supabase dashboard → Authentication → Policies. Pick one approach and apply.

### C. Supabase: CORS allow-list

Supabase dashboard → **Project Settings** → **API** → **CORS Allowed Origins**. Add:

```
https://schedules-<your-hash>.vercel.app
https://schedules-*.vercel.app          ← wildcards for preview deploys
http://localhost:5173                    ← Vite dev server
```

Without this, the browser blocks the `supabase.rpc()` call.

### D. GeoAPI: CORS allow-list

The FastAPI service at `https://geoapi-1cu6.onrender.com` needs the same Vercel + localhost origins. Currently in [api/app.py](../api/app.py) there's no `CORSMiddleware` — the React app will get a CORS error on the first `/geocode` call from the browser. Add this to `api/app.py` and redeploy on Render:

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "https://schedules-<your-hash>.vercel.app",
        # any custom domain you map later
    ],
    allow_methods=["GET"],
    allow_headers=["*"],
)
```

This is a change to the `swtreflips/geoapi` repo, not the React repo. Commit there, push, Render auto-redeploys.

### E. React: install dependencies

Two libs to add (haven't been touched yet):

```powershell
cd c:\Users\Mike\Documents\GitHub\Schedules\React
npm install @supabase/supabase-js
```

That's it. `fetch` is built into the browser — no extra geocoder client needed.

### F. React: environment variables

Three values, set in **two places** (see [VITE.md](VITE.md) for the mechanics).

| Variable | Value | Local | Vercel |
|---|---|---|---|
| `VITE_GEOAPI_URL` | `https://geoapi-1cu6.onrender.com` | `.env.local` | dashboard → Settings → Env Vars |
| `VITE_SUPABASE_URL` | `https://jnuigkggmynerrbxvkzy.supabase.co` | `.env.local` | dashboard |
| `VITE_SUPABASE_ANON_KEY` | the anon (publishable) key from Supabase dashboard → API | `.env.local` | dashboard |

After adding to Vercel: **trigger a redeploy** (push a commit or click Redeploy). Env vars are inlined at build time.

⚠️ Use the **anon** key only. The service_role key gives full DB admin access and must never reach the browser bundle.

---

## What React still needs to build

Rough order. Each is a separate slice; don't try to do them in one push.

| # | Slice | What it does | New files |
|---|---|---|---|
| 1 | **Supabase + GeoAPI clients** | Two tiny modules: `supabase.ts` (creates the client) and `geoapi.ts` (`fetch` wrapper around `/geocode`) | `src/lib/supabase.ts`, `src/lib/geoapi.ts`, `src/vite-env.d.ts` |
| 2 | **Search submit + state machine** | Add a Search button (or Enter-to-submit). State: `idle \| geocoding \| fetching \| success \| error`. Surface a small status indicator near the carrier strip. | Modify `SearchPanel.tsx`, new `src/state/search.ts` |
| 3 | **Wire RPC + populate grid** | On success, hand `rows` to `SchedulesGrid`. Grid stops being empty. | Modify `SchedulesGrid.tsx` to accept `rowData` prop |
| 4 | **Client-side filters (CRD + carriers)** | Apply `etd > crd` and `enabledCarriers.has(carrier_code)` before grouping. React-only, no new fetches. | Add `src/lib/filters.ts` or inline in `SchedulesGrid` |
| 5 | **Group-by-carrier (one row per carrier, best ETA)** | Reduce filtered rows to one-per-carrier (earliest ETA). Keep all alternatives in a sibling Map keyed by carrier_code. | Logic in `SchedulesGrid.tsx` |
| 6 | **Expandable rows for chain selection** | AG Grid `detailCellRenderer`-like pattern (Community: roll it manually). Click a row → reveal alternatives → pick one → row swaps. | Custom expand component in `SchedulesGrid/` |
| 7 | **Wire POL autocomplete** | The PortOfLoadingField listbox is already shaped for this. Source: `select distinct port_of_loading from schedules` (cache in-memory on app load). | Modify `PortOfLoadingField.tsx` |
| 8 | **Radius control** | A small selector (25/50/100/200/500 mi) in the SearchPanel — default 100. Adds one piece of state, passes through to RPC. | Modify `SearchPanel.tsx` |
| 9 | **Empty/error states** | Distinct overlays for "no POL selected", "geocoding…", "no matches in radius", "request failed — retry". Already structurally allowed by AG Grid `noRowsOverlay`. | Modify `SchedulesGrid.tsx` |

A reasonable first push is **slices 1–4** — that's enough to see real data flowing end-to-end. Grouping + expansion (5–6) come after.

---

## Slice 1 in detail — connecting Supabase and GeoAPI to the app

"Connect" is a slightly misleading word here. There's no persistent connection to set up. Both backends are just HTTP endpoints, and the "connection" is really a configured client object that knows their URLs and credentials. Once it exists, the rest of the app uses it like any function.

### What "connecting" actually means

When you connect a desktop app to Postgres directly, there's a real network socket, credentials, a connection pool. That is **not** what happens here. Supabase exposes your database over HTTP (via PostgREST), and GeoAPI is plain REST. Every call from React is an isolated `fetch()` to a URL. Nothing sits open in the background.

So "connecting" the app means three things:

```
┌──────────────────────────────────────────────────────────────┐
│  A — install the npm package (one terminal command)         │
└──────────────────────────────────────────────────────────────┘
              npm install @supabase/supabase-js
              │
              └─► adds to package.json + node_modules
              (GeoAPI needs no install — fetch() is built-in.)

┌──────────────────────────────────────────────────────────────┐
│  B — create a client object for each backend                │
└──────────────────────────────────────────────────────────────┘
              src/lib/supabase.ts  ← createClient(url, key)
              src/lib/geoapi.ts    ← fetch wrapper

┌──────────────────────────────────────────────────────────────┐
│  C — env vars (set once locally, once on Vercel)            │
└──────────────────────────────────────────────────────────────┘
              .env.local                  Vercel Dashboard
              VITE_SUPABASE_URL=...      VITE_SUPABASE_URL=...
              VITE_SUPABASE_ANON_KEY=... VITE_SUPABASE_ANON_KEY=...
              VITE_GEOAPI_URL=...        VITE_GEOAPI_URL=...
```

After those three, the app is "connected." Any component can import the clients and use them.

### The Supabase side

```ts
// src/lib/supabase.ts  ← the entire "connection" file
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
```

Two lines of real code. `createClient` returns an object that has `.rpc()`, `.from()`, `.auth.*`, etc. — that object **is** the "connection." Exported once, imported everywhere:

```ts
import { supabase } from "../lib/supabase";

const { data, error } = await supabase.rpc("nearby_schedules", { ... });
```

### The GeoAPI side — even simpler

No SDK, because the geocoder isn't a database — it's one REST endpoint. A thin `fetch` wrapper is enough:

```ts
// src/lib/geoapi.ts
export interface Coords { latitude: number; longitude: number }

export async function geocode(query: string): Promise<Coords> {
  const url = `${import.meta.env.VITE_GEOAPI_URL}/geocode?q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocode failed: ${res.status}`);
  return res.json();
}
```

No client object, just a function. The "connection" is conceptual — it's the env var that points the wrapper at the right host.

### The singleton pattern (why we create once at module load)

The `createClient()` call sits at the **module top level**, not inside a function. That means it runs **exactly once** — the first time anything imports `supabase.ts`. Every subsequent `import { supabase }` gets the *same* object.

```
First import:    createClient runs → object built → cached & returned
Second import:   cached object returned (no createClient call)
Third import:    cached object returned
...
```

This matters because:
- **No duplicate instances** scattered through the app
- **Shared state** (auth tokens, configured retry behavior) stays consistent
- **One place to debug, one place to configure**

Standard pattern for any SDK client.

### What happens when you actually call something

```ts
await supabase.rpc("nearby_schedules", { p_pol, p_lat, p_lon, p_radius_meters });
```

The SDK does this under the hood:

```
1. Build URL:       POST https://<project>.supabase.co/rest/v1/rpc/nearby_schedules
2. Add headers:     apikey: <VITE_SUPABASE_ANON_KEY>
                    Authorization: Bearer <same key>
                    Content-Type: application/json
3. Body:            { "p_pol": "...", "p_lat": ..., "p_lon": ..., ... }
4. fetch() it       (standard browser fetch)
5. Wait for response
6. Parse JSON → return { data, error }
```

Nothing magical. The SDK is a thin wrapper over `fetch` that knows Supabase's URL patterns, attaches your API key automatically, and unifies error handling.

### Why use the SDK vs raw fetch

You *could* call Supabase with `fetch()` directly — it's all HTTP. But the SDK saves you:

| Without SDK | With SDK |
|---|---|
| Build URL strings yourself, careful with rpc paths | `supabase.rpc('name', params)` |
| Set apikey + Authorization headers on every call | Set once at `createClient` |
| Manual JSON parsing + error checking each time | `{ data, error }` returned consistently |
| No types — JSON is `any` | Strong types if you generate them from your schema |
| Roll your own realtime subscriptions if you want them | `supabase.channel(...).subscribe(...)` |
| Roll your own auth if you add login later | `supabase.auth.signInWithOAuth(...)` |

For this app we use only `.rpc()`. But the rest of the surface area is one method call away if/when needed (auth, realtime, storage).

### TypeScript: declaring the env vars (`vite-env.d.ts`)

Out of the box, `import.meta.env.VITE_FOO` is typed as `string | undefined`. To get strict typing + autocomplete (and to avoid `string | undefined` noise everywhere), add `src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEOAPI_URL: string;
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

Once this file exists, the env reads in `supabase.ts` and `geoapi.ts` are typed as plain `string`, and the TypeScript autocomplete will suggest the available `VITE_*` names. See [VITE.md](VITE.md) for the full mechanics.

### Files slice 1 adds

```
React/
├── .env.local                ← NEW (gitignored — your local secrets)
└── src/
    ├── vite-env.d.ts         ← NEW (TypeScript declarations for env vars)
    └── lib/                  ← NEW directory
        ├── supabase.ts       ← NEW (Supabase client singleton)
        └── geoapi.ts         ← NEW (fetch wrapper for /geocode)
```

Plus one `package.json` change (`@supabase/supabase-js` added) and three env vars set in the Vercel dashboard.

### TL;DR for slice 1

- **"Connecting" = creating a configured client object once, importing it everywhere.** Not a persistent network connection.
- **Supabase** → install SDK → `createClient()` at module top level → singleton, imported as `{ supabase }`.
- **GeoAPI** → no SDK needed → plain `fetch` wrapped in a typed `geocode()` function.
- **Env vars feed both** — `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GEOAPI_URL`. Set in `.env.local` + Vercel.
- **Declare env vars in `vite-env.d.ts`** for strict TypeScript types.
- **No UI changes** in this slice. It's pure setup — the wrappers exist but nothing calls them yet. Slice 2 wires them to the Search button.

---

## Slice 2 in detail — how the two requests chain together

When the user clicks Search, two HTTP requests fire to two different backends. They look similar from a distance but the relationship between them is the important part.

### Sequential, not parallel

The two calls **cannot** run at the same time because the second one needs the first one's output:

```
GeoAPI call returns:   { latitude: 25.85, longitude: -80.27 }
                                  │
                                  └──► fed into ──┐
                                                  ▼
Supabase RPC needs:    { p_lat: ..., p_lon: ..., p_pol: ..., ... }
```

Until GeoAPI responds, we don't have coordinates, so we have nothing to send to Supabase. This is a **data dependency** — the two requests are *chained*, not concurrent.

`Promise.all` is *not* the right tool here. It's for independent requests where neither needs the other's output (something like "fetch carrier list + fetch user preferences on page load" — both can fire at once). When there's a dependency, you `await` the first, then call the second.

### Three layers of separation

Even though the requests run in sequence, the code that *makes* them is split into three independent pieces. Each layer has one job.

```
src/
├── lib/
│   ├── geoapi.ts          ← Layer 1: knows only how to call /geocode
│   └── supabase.ts        ← Layer 1: knows only how to call Supabase RPCs
└── state/
    └── searchSchedules.ts ← Layer 2: chains them in the right order
                              (called from SearchPanel onClick — Layer 3)
```

**Layer 1 — adapters** (one per backend, fully isolated)

```ts
// src/lib/geoapi.ts
export interface Coords { latitude: number; longitude: number }

export async function geocode(query: string): Promise<Coords> {
  const url = `${import.meta.env.VITE_GEOAPI_URL}/geocode?q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocode failed: ${res.status}`);
  return res.json();
}
```

```ts
// src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";
import type { Schedule } from "../types/schedule";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export async function findNearbySchedules(args: {
  pol: string;
  lat: number;
  lon: number;
  radiusMiles: number;
}): Promise<Schedule[]> {
  const { data, error } = await supabase.rpc("nearby_schedules", {
    p_pol: args.pol,
    p_lat: args.lat,
    p_lon: args.lon,
    p_radius_meters: args.radiusMiles * 1609.34,
  });
  if (error) throw error;
  return data;
}
```

Each file imports nothing from the other. `geoapi.ts` doesn't know Supabase exists; `supabase.ts` doesn't know GeoAPI exists. They're swappable — if you replaced GeoAPI with LocationIQ tomorrow, you'd rewrite the body of `geocode()` and nothing else changes.

**Layer 2 — orchestrator** (the only place that knows about both)

```ts
// src/state/searchSchedules.ts
import { geocode } from "../lib/geoapi";
import { findNearbySchedules } from "../lib/supabase";

export async function searchSchedules(input: {
  pol: string;
  destination: string;
  radiusMiles: number;
}) {
  // Step 1 — fire the GeoAPI call, await its result
  const { latitude, longitude } = await geocode(input.destination);

  // Step 2 — only now do we have coords, fire the Supabase call
  const schedules = await findNearbySchedules({
    pol: input.pol,
    lat: latitude,
    lon: longitude,
    radiusMiles: input.radiusMiles,
  });

  return schedules;
}
```

The `await` on line 1 is what makes it sequential. JavaScript pauses execution there until GeoAPI responds, then continues to line 2.

**Layer 3 — UI handler** (in `SearchPanel.tsx`)

```tsx
const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
const [rows, setRows] = useState<Schedule[]>([]);

async function handleSearch() {
  if (!pol || !destination) return;
  setStatus("loading");
  try {
    const schedules = await searchSchedules({ pol, destination, radiusMiles });
    setRows(schedules);
    setStatus("idle");
  } catch (e) {
    setStatus("error");
  }
}

<button onClick={handleSearch}>Search</button>
```

The UI only knows about the orchestrator. It doesn't know GeoAPI or Supabase exist by name. Same shape as Layer 1 — one job, no awareness of internals below it.

### What it looks like on the network

DevTools Network tab during one Search:

```
Time →
0ms        80ms                              280ms
│          │                                 │
├──────────┤                                 │
│  GET geoapi /geocode  (returns 200, JSON)  │
│                                            │
│          ├────────────────────────────────┤
│          │  POST supabase /rpc/nearby_schedules
│          │  (waits for geoapi to finish first)
│          │
```

Two distinct requests, to two different hosts, one after the other. Total wall-clock time = sum of both. Typically ~300ms (cache hit) to ~1.5s (cache miss on geocode).

### Why this separation matters in practice

| Benefit | What it gets you |
|---|---|
| **Independent error handling** | GeoAPI fails (Render down)? Catch in the orchestrator, tell user "address lookup failed." Supabase fails (RLS misconfigured)? Different message. UI handler doesn't need to know which call broke. |
| **Cancelable** | User changes their mind mid-search and types a new destination? `AbortController` cancels the in-flight GeoAPI call without touching Supabase code. |
| **Testable** | Unit-test `geocode("Hialeah, FL")` against a mock fetch. Unit-test the orchestrator with a stubbed `geocode` returning fake coords. The UI handler doesn't need a real backend to test. |
| **Swappable** | Replace GeoAPI with LocationIQ → rewrite one file. Replace Supabase with a custom REST API → rewrite one file. Nothing above those layers cares. |
| **Future parallelization** | When POL autocomplete + carrier list need to load on app boot, they're independent — fire them with `Promise.all` in a *different* orchestrator. The pattern is the same; only the chaining strategy changes. |

### TL;DR for slice 2

- **Sequential** — Supabase needs GeoAPI's coords first, so `await` between them.
- **Three files** — `geoapi.ts` (one backend), `supabase.ts` (other backend), `searchSchedules.ts` (chains them).
- **`Promise.all` is not for this case** — that's for independent requests; this one has a data dependency.
- **The UI only sees one function** — `searchSchedules(...)`. It doesn't know how many backends are behind it.

---

## Pre-production checklist

Before you flip the production switch on the live `*.vercel.app` URL:

- [ ] `nearby_schedules` RPC exists and is callable from the Supabase SQL Editor's "Function tester"
- [ ] `anon` role can `select` from `schedules` (test by running a query with the anon key from `curl` or Supabase REST tab)
- [ ] Supabase CORS allows your Vercel domain + `http://localhost:5173`
- [ ] GeoAPI on Render has `CORSMiddleware` deployed with your Vercel domain in `allow_origins`
- [ ] `VITE_GEOAPI_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` set on Vercel for **Production** + **Preview** + **Development**
- [ ] A fresh deploy after setting env vars (they don't apply retroactively)
- [ ] Manual end-to-end test: POL = "Laem Chabang, Thailand", Dest = "Hialeah, FL", CRD = tomorrow, all carriers enabled → grid shows at least one row
- [ ] Console clean except for AG Grid Community licence notice
- [ ] Mobile-narrow viewport (~600px) still functional

---

## Things deliberately out of scope here

- **MapLibre/route geometry** — corridor visualization is a separate platform layer per [parent CLAUDE.md](../CLAUDE.md). Comes after the grid works.
- **Rank View** — the global top-N flat view per [React/CLAUDE.md](CLAUDE.md). Same data, different layout — comes after Carrier View is solid.
- **POL fuzzy/canonical matching** — if exact-string POL matching turns out to miss schedules, a `ports` table join is the right fix. Defer until we see the problem.
- **Auth** — currently the app is fully anonymous. Adding Supabase Auth + per-user saved searches is a future layer.
- **Booking handoff** — exporting the priority list to a forwarder (CSV or API) — explicitly out of v1.
