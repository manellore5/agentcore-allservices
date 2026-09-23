# Test Folder - Gateway Testing Utilities

This folder contains utilities for testing the AgentCore Gateway functionality.

## Important Files

### Core Testing
- `api_direct_test.ts` - Direct API testing (bypassing gateway) for comparison

### Configuration & Utilities
- `deno.json` - Project dependencies for this folder

## Usage

1. Set your AWS profile: `export AWS_PROFILE=your-profile`
2. Put the three API keys in a `.env` file at the project root (see the main README)
3. Test APIs directly: `deno run -A tests/api_direct_test.ts`

To exercise the Gateway itself, use `capstone_project/backend/gateway/test_gateway.ts`, or run
[Notebook 03](../capstone_project/notebooks/03-gateway-integration.ipynb).
