# Cadence

Release planning for independent artists. Dependency-aware timelines, AI-generated plans, real-time cascade recalculation.

## Stack

- **Frontend:** React + TypeScript + Vite
- **Styling:** Tailwind CSS v4
- **Routing:** React Router v6
- **Backend / Auth / DB:** Supabase
- **Payments:** Stripe (Phase 2)
- **AI:** Anthropic API / Claude (Phase 2)
- **Hosting:** Vercel (frontend) + Supabase (backend)

## Local Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Set up environment variables
```bash
cp .env.example .env
```
Open `.env` and fill in your Supabase project URL and anon key.
Get these from: https://supabase.com/dashboard → your project → Settings → API

### 3. Run the dev server
```bash
npm run dev
```
App runs at http://localhost:5173

## Supabase Setup

1. Create a free project at https://supabase.com
2. Go to Settings → API and copy your Project URL and anon key into `.env`
3. Auth is handled automatically — Supabase email/password auth is enabled by default

## Project Structure

```
src/
  components/     # Shared UI components (Sidebar, AppLayout)
  pages/          # Route-level page components
  hooks/          # Custom React hooks (useAuth)
  lib/            # Third-party client setup (supabase.ts)
```

## Roadmap

- **Phase 0** (now): Landing page + waitlist
- **Phase 1**: Release planner core — dependency graph, cascade recalculation, timeline view
- **Phase 2**: Calendar sync, collaborators, AI plan generation
- **Phase 3**: Multi-artist, goals, API integrations
