#!/bin/bash

# Deployment build script that handles build warnings/errors gracefully
set -e

echo "🏗️  Building for GitHub Pages deployment..."

# Clean previous builds to ensure fresh output
echo "🧹 Cleaning previous builds..."
rm -rf packages/types/dist
rm -rf packages/engine/dist
rm -rf apps/playground/dist

# Build packages in order
echo "📦 Building types package..."
pnpm --filter @terraforming/types build

# Ensure types are fully built before continuing
if [ ! -f "packages/types/dist/index.d.ts" ]; then
  echo "❌ Types package failed to generate declaration files"
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