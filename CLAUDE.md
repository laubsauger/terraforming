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
pnpm --filter @playground dev

# Build specific package
pnpm --filter @terraforming/engine build
```

## Architecture

### Monorepo Structure
- **apps/playground/** - React UI application with Vite, handles user interaction and visualization
- **packages/engine/** - Core WebGPU simulation engine (currently stub implementation)
- **packages/types/** - Shared TypeScript definitions for engine interfaces
- **packages/assets/** - Shared textures and resources

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

## Key Implementation Notes

### Engine Integration Pattern
The engine provides a stub API that the playground consumes. When implementing engine features:
1. Define types in `packages/types/src/index.ts`
2. Implement the actual WebGPU logic in `packages/engine/src/index.ts`
3. The playground automatically uses the updated engine through the monorepo structure

### WebGPU Requirements
- The project requires WebGPU support in the browser
- GPU timestamp queries are used for performance profiling
- All simulation systems (terrain, fluids, erosion) run as compute shaders

### UI State Management
- Zustand store at `apps/playground/src/store/` manages UI state
- Interaction tools: Select (Q), Raise (W), Smooth (E), Water (R), Lava (T)
- Engine state is separate from UI state

### Performance Monitoring
The engine exposes detailed performance metrics through the `getPerformanceStats()` API, including:
- GPU timings for each render pass
- Triangle/vertex counts
- Memory usage statistics

## Design Documentation
Comprehensive technical specifications are in `docs/concept/01_core.md`, including:
- Detailed system architecture
- WGSL shader implementations
- Fluid simulation algorithms
- Performance targets and optimization strategies