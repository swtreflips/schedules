# Vite Environment Variables — How They Work In This App

A short reference for how environment variables flow from your local machine and Vercel into the React app's JavaScript bundle.

---

## The core idea

Vite has one rule that controls everything:

> **Only environment variables prefixed with `VITE_` are exposed to the client code.**

Anything else is invisible to the React app. This is intentional — it's the line between "safe to ship to browsers" and "must stay on the server."

```
Set in env                    Available in React code as
────────────────              ─────────────────────────────
VITE_GEOAPI_URL    ───────►   import.meta.env.VITE_GEOAPI_URL
SUPABASE_KEY       ───────►   (never reaches the browser)
PORT=3000          ───────►   (never reaches the browser)
```

When you run `npm run build`, Vite inlines every `VITE_*` value as a string literal in the output JS. So `import.meta.env.VITE_GEOAPI_URL` becomes the literal string `"https://geoapi-1cu6.onrender.com"` in the bundle that ships to users.

---

## Reading them in code

```ts
const geoapiUrl = import.meta.env.VITE_GEOAPI_URL;
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
```

That's the whole API. No `process.env`, no `require('dotenv')`, no setup — Vite does it.

Vite also exposes some built-ins for free:

```ts
import.meta.env.MODE       // "development" | "production"
import.meta.env.DEV        // true in dev, false in build
import.meta.env.PROD       // inverse of DEV
import.meta.env.BASE_URL   // app's base path, usually "/"
```

---

## ⚠️ The big security warning

**`VITE_*` variables are PUBLIC.** They end up as plain strings in the JS bundle. Anyone can:

- Open DevTools → Sources → search the bundle
- Run `curl https://your-app.vercel.app/assets/index-abc123.js`
- View the page source

…and read them.

This is fine for:
- ✅ The geocoder URL — it's a public API
- ✅ Supabase's **anon** key — it's literally called the "publishable" key, designed for client use, protected by Row Level Security on the database side
- ✅ Stripe **publishable** key, analytics IDs, feature flags

This is NEVER okay for:
- ❌ Supabase **service_role** key (full DB admin access — bypass RLS)
- ❌ Any API secret, private key, or auth token
- ❌ Stripe **secret** key
- ❌ Database connection strings with passwords

**Rule of thumb:** if it has the word "secret," "service," "private," or "admin" in the name, don't put it behind `VITE_`. Server-only.

This app's three planned env vars are all safe-for-client:

| Variable | What | Why public is OK |
|---|---|---|
| `VITE_GEOAPI_URL` | Render URL for the geocoder | It's a public service URL |
| `VITE_SUPABASE_URL` | Supabase project URL | Public by design |
| `VITE_SUPABASE_ANON_KEY` | Supabase publishable key | Designed for client use; RLS protects the data |

---

## Setting them locally

Create a `.env.local` file in the `React/` folder root (next to `package.json`). This file is `.gitignore`d — it never gets committed.

```bash
# React/.env.local
VITE_GEOAPI_URL=https://geoapi-1cu6.onrender.com
VITE_SUPABASE_URL=https://jnuigkggmynerrbxvkzy.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
```

After editing this file, **restart the dev server** (`Ctrl+C` then `npm run dev`). Vite reads env files at startup, not on the fly.

### Env file precedence

Vite looks for these files in order (highest precedence first):

```
.env.local              ← personal, never committed
.env.development        ← per-mode, can be committed (no secrets!)
.env                    ← base, can be committed (no secrets!)
```

For this project we use **`.env.local` only**. Don't commit any `.env*` file — the existing [.gitignore](.gitignore) already excludes them.

---

## Setting them on Vercel

Vercel has three "environments" for env vars, each independent:

| Environment | When it's used | Typical content |
|---|---|---|
| **Production** | Deploys from the `main` branch | Real Supabase project, real geocoder |
| **Preview** | Every PR / non-main branch | Often same as production, or a staging Supabase |
| **Development** | When you run `vercel dev` locally (rare) | Usually same as `.env.local` |

### To add a variable

1. Vercel dashboard → your project → **Settings** → **Environment Variables**
2. Click **Add New**
3. Name: `VITE_GEOAPI_URL` (case-sensitive, including the `VITE_` prefix)
4. Value: `https://geoapi-1cu6.onrender.com`
5. Environments: check **Production**, **Preview**, **Development** (usually all three for safe-for-client values)
6. Save

**Critical:** env vars are baked into the build at build time, not read at request time. So after adding/changing a var, you must **trigger a redeploy** for it to take effect. Either:
- Push a new commit
- Or in the Vercel UI: Deployments → click the latest → ⋯ menu → **Redeploy**

---

## TypeScript typing (when we actually use them)

Out of the box, `import.meta.env.VITE_FOO` is typed as `string | undefined`. To get strict typing and autocomplete, declare the vars in a `src/vite-env.d.ts` file:

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

After that, `import.meta.env.VITE_GEOAPI_URL` is typed as `string` (not `string | undefined`), and TypeScript will autocomplete the available names.

We don't have this file yet — we'll add it the first time we wire one of these vars in.

---

## Practical pattern for this app

When we wire the first env var (likely `VITE_GEOAPI_URL` for the destination geocoder), the steps will be:

1. Add it to `React/.env.local` for dev
2. Add it to Vercel dashboard for all three environments
3. Create/update `src/vite-env.d.ts` to type it
4. Read it in code: `const url = import.meta.env.VITE_GEOAPI_URL`
5. Push — Vercel rebuilds with the var inlined into the production bundle

---

## TL;DR

| You want to… | Do this |
|---|---|
| Use an env var in React code | Prefix it `VITE_`, read via `import.meta.env.VITE_FOO` |
| Set it locally | `React/.env.local` (gitignored), restart dev server |
| Set it for production | Vercel dashboard → Settings → Environment Variables, then redeploy |
| Use a secret key | **Don't.** Put it on a server (FastAPI / Supabase functions / Vercel API routes) |
| Get TypeScript autocomplete | Declare in `src/vite-env.d.ts` |
