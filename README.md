# Terraforming Prototype

Browser-based terraforming and erosion playground targeting WebGPU + Three.js. See `docs/concept` for the high-level design pillars.

## Getting Started

```bash
pnpm install
pnpm dev
```

The dev script launches the playground app (`apps/playground`) with Vite and hot module reload. WebGPU must be enabled in your browser.

## Workspace Layout

- `apps/playground`: Vite + React shell for interactive experiments.
- `packages/engine`: Engine bootstrap, simulation placeholders, renderer wiring.
- `apps/playground/src/ui`: React HUD and controls on top of the engine API.
- `packages/assets`: Shared textures, lookup tables, and static assets.

## Deployment

The project is automatically deployed to GitHub Pages at: **https://laubsauger.github.io/terraforming/**

### Deployment Setup

- **Automatic deployment** via GitHub Actions when pushing to `main` branch
- **Build script**: `pnpm build:deploy` (sets correct base path for GitHub Pages)
- **Manual deployment**: `pnpm deploy`

### GitHub Pages Configuration

1. Repository settings → Pages → Source: GitHub Actions
2. The `.github/workflows/deploy.yml` workflow handles the build and deployment
3. Base path is automatically set to `/terraforming/` for proper asset loading

## Development

```bash
# Local development
pnpm dev

# Build for production
pnpm build

# Build for GitHub Pages deployment
pnpm build:deploy

# Type checking
pnpm typecheck

# Run all checks
pnpm check
```

## Next Milestones

1. Flesh out WebGPU device bootstrap and frame loop in `@terraforming/engine`.
2. Integrate Three.js WebGPU renderer with the playground canvas.
3. Land initial brush→heightfield compute path and display displaced terrain.
