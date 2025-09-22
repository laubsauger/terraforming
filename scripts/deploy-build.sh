#!/bin/bash

# Deployment build script that handles build warnings/errors gracefully
set -e

echo "🏗️  Building for GitHub Pages deployment..."

# Build packages in order
echo "📦 Building types package..."
pnpm --filter @terraforming/types build

echo "🔧 Building engine package..."
pnpm --filter @terraforming/engine build

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