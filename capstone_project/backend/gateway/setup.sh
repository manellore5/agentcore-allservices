#!/bin/bash

# TravelMate AI - Gateway Setup Script
# Installs all dependencies and prepares environment

echo "🚀 Setting up TravelMate Gateway environment..."

# Check if uv is installed
if ! command -v uv &> /dev/null; then
    echo "❌ uv is not installed. Please install it first:"
    echo "   curl -LsSf https://astral.sh/uv/install.sh | sh"
    exit 1
fi

# Install Python dependencies
echo "📦 Installing Python dependencies..."
uv pip install -r requirements.txt --break-system-packages

# Check for API keys
echo "🔑 Checking API key environment variables..."

missing_keys=()

if [ -z "$AVIATIONSTACK_API_KEY" ]; then
    missing_keys+=("AVIATIONSTACK_API_KEY")
fi

if [ -z "$HOTELBEDS_API_KEY" ]; then
    missing_keys+=("HOTELBEDS_API_KEY")
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
    echo "  - Hotelbeds: https://developer.hotelbeds.com/register"
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
echo "2. Run: python gateway_setup.py"
echo "3. Test: python test_gateway.py"