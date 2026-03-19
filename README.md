# smart-ink (React scene editor)

## What this repo is
This is a Vite-based React app (with React Three Fiber / Drei) that powers the `smart-ink` 3D scene editor: it renders scenes, provides an editor-style UI, and includes utilities to export scene data (e.g. for downstream tools like Blender).

Entry points:
- `src/main.tsx` -> React root render
- `src/App.tsx` -> main app/editor

## Prerequisites
- Node.js 18+ (LTS recommended)
- npm

## Quick start
1. Clone and install:
   - `git clone <repo-url>`
   - `cd smart-ink` 
   - `npm ci`
     - If you don't have `package-lock.json`, use `npm install` instead.
2. Start the dev server:
   - `npm run dev`
3. Open in your browser:
   - `http://localhost:5173`

Note: `npm run dev` uses Vite configured with `host: "0.0.0.0"` (see `vite.config.ts`), so it may be reachable from other devices on your local network.

## Available scripts
- `npm run dev` - start Vite dev server
- `npm run build` - build production assets
- `npm run preview` - preview the production build locally
- `npm run typecheck` - run TypeScript project checks (`tsc -b`)
- `npm run lint` - run ESLint (`eslint .`)

## Project structure (high-level)
- `index.html` - Vite entry HTML
- `src/main.tsx` - React root render
- `src/App.tsx` - main app/editor logic
- `src/components/` - reusable UI components
- `src/utils/` - helper functions (scene export utilities, etc.)
- `src/types/` and `src/types.ts` - shared types
- `public/` - static assets served as-is
- `src/assets/` - assets bundled by the app

## Troubleshooting
- Blank page or errors in the browser: open the browser dev tools and check the console/network tabs for the first error.
- Port already in use: Vite defaults to `5173`. Stop the conflicting process or change the port in `vite.config.ts`.
- Dependency install issues: delete `node_modules` and run `npm ci` again.
