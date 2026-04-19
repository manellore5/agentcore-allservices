#!/bin/bash

# Setup script for mastering-amazon-bedrock-agentcore project
echo "🚀 Setting up project environment..."

# Navigate to project root
cd "$(dirname "$0")"
echo "📁 Working directory: $(pwd)"

# Initialize uv project at root level (shared across all files)
echo "🔧 Initializing uv project..."
uv init --python 3.10
uv venv

# Install required packages in shared environment
echo "📦 Installing packages..."
uv add boto3 python-dotenv jupyter ipykernel requests

# Try to install bedrock packages (may not be publicly available)
echo "📦 Installing AgentCore packages..."
uv add bedrock-agentcore bedrock-agentcore-starter-toolkit strands-agents-tools || echo "⚠️ AgentCore packages not available"

# Install additional packages for notebooks
echo "📦 Installing additional packages..."
uv add strands-agents pandas numpy matplotlib seaborn beautifulsoup4 selenium fastapi
uv add google-api-python-client google-auth-httplib2 google-auth-oauthlib
uv add watchtower structlog

echo "✅ Setup complete! You can now run the notebooks."
echo "💡 To activate the environment: source .venv/bin/activate"