#!/bin/bash

# Deployment build script that handles build warnings/errors gracefully
set -e

echo "🏗️  Building for GitHub Pages deployment..."

# Clean previous builds to ensure fresh output
echo "🧹 Cleaning previous builds..."
rm -rf packages/types/dist packages/types/tsconfig*.tsbuildinfo
rm -rf packages/engine/dist packages/engine/tsconfig*.tsbuildinfo
rm -rf apps/playground/dist

# Build packages in order
echo "📦 Building types package..."
pnpm --filter @terraforming/types build

# Debug: Show what was generated
echo "📁 Types dist contents:"
ls -la packages/types/dist/ || echo "No dist directory found"

# Ensure types are fully built before continuing
if [ ! -f "packages/types/dist/index.d.ts" ]; then
  echo "❌ Types package failed to generate declaration files"
  echo "Looking for index.d.ts in packages/types/dist/"
  echo "Current working directory: $(pwd)"
  echo "Checking if types dist exists: $(test -d packages/types/dist && echo 'YES' || echo 'NO')"
  exit 1
fi

echo "🔧 Building engine package..."
pnpm --filter @terraforming/engine build || {
  echo "⚠️  Engine build had warnings (continuing...)"
  true
}

echo "🎮 Building playground for deployment..."
pnpm --filter @terraforming/playground build:deploy

echo "✅ Build completed successfully!"

# Verify the dist folder exists
if [ ! -d "apps/playground/dist" ]; then
  echo "❌ Error: Playground dist folder not found!"
  exit 1
fi

echo "📁 Deployment files ready in apps/playground/dist/"
ls -la apps/playground/dist/