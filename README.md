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

## Next Milestones

1. Flesh out WebGPU device bootstrap and frame loop in `@terraforming/engine`.
2. Integrate Three.js WebGPU renderer with the playground canvas.
3. Land initial brush→heightfield compute path and display displaced terrain.
