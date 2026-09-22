#!/bin/bash

# Setup script for mastering-amazon-bedrock-agentcore project
set -e
echo "🚀 Setting up project environment..."

# Navigate to project root
cd "$(dirname "$0")"
echo "📁 Working directory: $(pwd)"

DENO_VERSION=$(cat .deno-version)

# Install Deno at the pinned version (replaces uv + a Python virtual environment)
if ! command -v deno &> /dev/null; then
  echo "🔧 Installing Deno v$DENO_VERSION..."
  curl -fsSL https://deno.land/install.sh | sh -s "v$DENO_VERSION"
  export PATH="$HOME/.deno/bin:$PATH"
  echo "💡 Add this to your shell profile: export PATH=\"\$HOME/.deno/bin:\$PATH\""
else
  INSTALLED=$(deno --version | head -1 | cut -d' ' -f2)
  echo "🔧 Found Deno v$INSTALLED (project pins v$DENO_VERSION)"
  if [ "$INSTALLED" != "$DENO_VERSION" ]; then
    echo "⚠️  Version mismatch. Run: deno upgrade --version $DENO_VERSION"
  fi
fi

# Resolve and cache every dependency from deno.json into deno.lock
echo "📦 Installing packages..."
deno install

# Register the Deno Jupyter kernel so the notebooks run TypeScript (replaces ipykernel)
echo "📓 Installing the Deno Jupyter kernel..."
deno jupyter --install --force

# Check for API keys
echo "🔑 Checking API key environment variables..."

missing_keys=()

if [ -z "$OPENWEATHERMAP_API_KEY" ]; then
  missing_keys+=("OPENWEATHERMAP_API_KEY")
fi

if [ -z "$EXCHANGERATE_API_KEY" ]; then
  missing_keys+=("EXCHANGERATE_API_KEY")
fi

if [ -z "$AVIATIONSTACK_API_KEY" ]; then
  missing_keys+=("AVIATIONSTACK_API_KEY")
fi

if [ ${#missing_keys[@]} -gt 0 ]; then
  echo "⚠️  Optional API keys not set: ${missing_keys[*]}"
  echo "   The gateway notebooks need them; see the README for where to get them."
fi

echo "✅ Setup complete! You can now run the notebooks."
echo "💡 Open the notebooks in VS Code with the Jupyter and Deno extensions installed,"
echo "   then pick the 'Deno' kernel. No Python is required."
