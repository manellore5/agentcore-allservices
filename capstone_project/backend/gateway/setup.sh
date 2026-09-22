#!/bin/bash

# TravelMate AI - Gateway Setup Script
# Installs all dependencies and prepares environment

echo "🚀 Setting up TravelMate Gateway environment..."

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

# Check if deno is installed (replaces uv + a Python virtual environment)
if ! command -v deno &> /dev/null; then
    echo "❌ deno is not installed. Please install it first:"
    echo "   curl -fsSL https://deno.land/install.sh | sh"
    exit 1
fi

# Install TypeScript dependencies from the repository root's deno.json
echo "📦 Installing TypeScript dependencies..."
(cd "$REPO_ROOT" && deno install)

# Check for API keys
echo "🔑 Checking API key environment variables..."

missing_keys=()

if [ -z "$AVIATIONSTACK_API_KEY" ]; then
    missing_keys+=("AVIATIONSTACK_API_KEY")
fi

if [ -z "$OPENWEATHERMAP_API_KEY" ]; then
    missing_keys+=("OPENWEATHERMAP_API_KEY")
fi

if [ -z "$EXCHANGERATE_API_KEY" ]; then
    missing_keys+=("EXCHANGERATE_API_KEY")
fi

if [ ${#missing_keys[@]} -gt 0 ]; then
    echo "⚠️ Missing API keys. Please set the following environment variables:"
    for key in "${missing_keys[@]}"; do
        echo "   export $key=your_api_key_here"
    done
    echo ""
    echo "API Registration Links:"
    echo "  - Aviationstack: https://aviationstack.com/signup"
    echo "  - OpenWeatherMap: https://openweathermap.org/api"
    echo "  - ExchangeRate-API: https://www.exchangerate-api.com/"
else
    echo "✅ All API keys found!"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Set missing API keys (if any)"
echo "2. Run: deno task gateway:setup"
echo "3. Test: deno run -A capstone_project/backend/gateway/test_gateway.ts"
