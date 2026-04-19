# Test Folder - Gateway Testing Utilities

This folder contains utilities for testing the AgentCore Gateway functionality.

## Important Files

### Core Testing
- `gateway_tester.py` - Main gateway testing utility with proper token management
- `api_direct_test.py` - Direct API testing (bypassing gateway) for comparison

### Configuration & Utilities  
- `gateway_inspector.py` - Inspect gateway configuration and status
- `pyproject.toml` - Project dependencies

## Usage

1. Set your AWS profile: `export AWS_PROFILE=your-profile`
2. Run gateway tests: `python gateway_tester.py`
3. Test APIs directly: `python api_direct_test.py`
4. Inspect gateway config: `python gateway_inspector.py`

## Removed Files

The following files were removed during cleanup as they contained:
- Hardcoded credentials/tokens
- Duplicate functionality
- Experimental/debugging code
- Outdated configurations