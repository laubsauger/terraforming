# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
**Terraforming** - A WebGPU-first browser-based terraforming and erosion simulation playground built with Three.js, React, and TypeScript.

## Development Commands

### Essential Commands
```bash
# Install dependencies (using pnpm)
pnpm install

# Run development server with hot reload
pnpm dev

# Type check all packages
pnpm typecheck

# Build for production
pnpm build

# Run all checks (typecheck + lint)
pnpm check
```

### Package-Specific Commands
```bash
# Run playground app only
pnpm --filter @terraforming/playground dev

# Build specific package
pnpm --filter @terraforming/engine build

# Watch mode for development
pnpm --filter @terraforming/engine build:watch
pnpm --filter @terraforming/types build:watch
```

## Architecture

### Monorepo Structure
- **apps/playground/** - React UI application with Vite, handles user interaction and visualization
- **packages/engine/** - Core WebGPU simulation engine with complete GPU compute pipeline
- **packages/types/** - Shared TypeScript definitions for engine interfaces
- **packages/assets/** - Shared textures and resources (optional package)

### Tech Stack
- **WebGPU**: All compute-heavy operations run on GPU via compute shaders
- **Three.js**: WebGPURenderer with TSL (Three.js Shading Language) for rendering
- **React 18 + TypeScript**: UI layer with Zustand for state management
- **Tailwind CSS v4 + shadcn/ui**: Component styling
- **Vite**: Build tool with HMR

### Path Aliases
Configured in both TypeScript and Vite:
- `@terraforming/types` → packages/types/src
- `@terraforming/engine` → packages/engine/src
- `@playground/*` → apps/playground/src/*

## Code Maintenance Guidelines

### File Management
- **When creating new files, always cleanup old ones** - Remove deprecated versions to avoid duplication
- **Generally prefer patching over duplication** - Modify existing code rather than creating parallel implementations
- **Keep the codebase clean** - Remove unused imports, files, and dependencies
- **Avoid redundant implementations** - If replacing a system (e.g., WGSL with TSL), remove the old implementation

## Key Implementation Notes

### Engine Integration Pattern
The engine provides a complete WebGPU-based simulation API that the playground consumes. When implementing engine features:
1. Define types in `packages/types/src/index.ts`
2. Implement WebGPU compute shaders in `packages/engine/src/gpu/shaders/*.wgsl`
3. Create pipeline management in `packages/engine/src/gpu/pipelines/*.ts`
4. Add simulation systems in `packages/engine/src/sim/*.ts`
5. Integrate rendering in `packages/engine/src/render/*.ts`
6. Export through `packages/engine/src/index.ts`
7. The playground automatically uses the updated engine through workspace dependencies

### WebGPU Requirements
- The project requires WebGPU support in the browser
- GPU timestamp queries are used for performance profiling
- All simulation systems (terrain, fluids, erosion) run as compute shaders

### UI State Management
- Zustand store at `apps/playground/src/store/uiStore.ts` manages UI state
- Current interaction system: Alt+Click brush with pickup/deposit modes for soil/rock/lava
- Brush state includes mode, material, radius, strength, hand mass/capacity
- Engine state is separate from UI state and synchronized via useEffect hooks

### Performance Monitoring
The engine exposes detailed performance metrics through the `getPerformanceStats()` API, including:
- GPU timings for each render pass
- Triangle/vertex counts
- Memory usage statistics

## Key File Locations

### Core Engine Files
- `packages/engine/src/index.ts` - Main engine API and initialization
- `packages/engine/src/render/TerrainRenderer.ts` - Primary renderer with WebGPU integration
- `packages/engine/src/sim/BrushSystem.ts` - Mass-conserving brush system
- `packages/engine/src/sim/fields.ts` - GPU texture field management
- `packages/engine/src/sim/hand.ts` - Brush hand state management

### GPU Compute Shaders
- `packages/engine/src/gpu/shaders/BrushPass_workgroup_quota.wgsl` - Mass-conserving brush operations
- `packages/engine/src/gpu/shaders/ApplyDeltas.wgsl` - Apply brush changes to fields
- `packages/engine/src/gpu/shaders/ThermalRepose.wgsl` - Angle-of-repose physics
- `packages/engine/src/gpu/shaders/*.wgsl` - Various simulation passes

### Material Systems (TSL)
- `packages/engine/src/render/materials/TerrainMaterialTSL.ts` - Terrain rendering with displacement
- `packages/engine/src/render/materials/WaterMaterialTSL.ts` - Water material with beach breaks
- `packages/engine/src/render/materials/LavaMaterialTSL.ts` - Lava material system

### UI Components
- `apps/playground/src/components/TerraformingUI.tsx` - Main UI panel
- `apps/playground/src/components/sections/BrushSection.tsx` - Brush controls
- `apps/playground/src/store/uiStore.ts` - Zustand state management

### Documentation
- `docs/concept/01_core.md` - Core system architecture
- `docs/brush_system_gpu_capacity_thermal_repose_wgsl_ts.md` - Brush system specs
- `AGENTS.md` - Team structure and implementation strategy

## Architecture Patterns

### GPU-First Design
- All simulation runs on GPU via compute shaders
- Ping-pong buffer patterns for iterative operations
- Direct texture binding for performance (not compute shader copying)
- Mass conservation via GPU atomics with fixed-point arithmetic

### Render Integration
- Three.js WebGPURenderer with TSL (Three Shading Language)
- Direct GPU texture access for field data
- Material-specific visual feedback and animations
- 3-stage interaction: hover → alt-ready → alt+click active

### State Management
- Engine state separate from UI state
- UI synchronizes with engine via useEffect hooks
- Brush system manages hand mass/capacity state
- Material densities: soil (1600), rock (2600), lava (2700 kg/m³)