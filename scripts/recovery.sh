#!/bin/bash

echo "🚀 Starting Tax Modeler 2026 Emergency Recovery..."

# 1. Kill any existing next-server processes
echo "⚡ Killing stale Node/Next processes..."
killall node 2>/dev/null || true

# 2. Clear Turbopack/Next.js cache
echo "🗑 Clearing .next cache..."
rm -rf .next

# 3. Clear temporary artifacts
echo "🧹 Cleaning temporary files..."
rm -f src/shared/lib/engine/engine-tax.ts.tmp 2>/dev/null || true

# 4. Optional: check for duplicate lockfiles (Turbo root warning)
if [ -f "package-lock.json" ] && [ -f "../../package-lock.json" ]; then
  echo "⚠️ Warning: Duplicate lockfiles detected in parent directory. This may confuse Turbopack."
fi

echo "✅ Recovery complete. You can now run: npm run dev"
