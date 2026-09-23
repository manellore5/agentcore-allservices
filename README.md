# Mastering Amazon Bedrock AgentCore

Official code repository for the Udemy course on building production-ready AI agents using Amazon Bedrock AgentCore.

## Overview

This comprehensive course teaches you how to build enterprise-grade AI agents using Amazon Bedrock AgentCore. Through hands-on implementation of an AI Travel Companion application, you'll master all seven core components of the AgentCore framework and learn how to deploy production-ready AI solutions on AWS.

## What You'll Build

An intelligent **AI Travel Companion** that:
- Plans complete travel itineraries through conversational interaction
- Remembers user preferences (hotel types, food restrictions, budget constraints)
- Searches flights, hotels, and attractions using real-time APIs
- Optimizes budget allocation across travel components
- Analyzes reviews and provides recommendations
- Saves itineraries to Google Drive with OAuth authentication
- Provides real-time monitoring and observability

## Course Structure

### Hands-On Learning Path

The course follows a progressive, notebook-based approach where each chapter builds upon the previous:

1. **[Foundation & AWS Setup](capstone_project/notebooks/01-foundation.ipynb)** - Environment configuration and AgentCore introduction
2. **[Runtime Setup](capstone_project/notebooks/02-runtime-setup.ipynb)** - Creating your first conversational agent
3. **[Gateway Integration](capstone_project/notebooks/03-gateway-integration.ipynb)** - Connecting to external APIs and services
4. **[Memory Implementation](capstone_project/notebooks/04-memory-implementation.ipynb)** - Adding user preference memory
5. **[Identity & OAuth](capstone_project/notebooks/05-identity-oauth.ipynb)** - Implementing secure authentication
6. **[Code Interpreter](capstone_project/notebooks/06-code-interpreter.ipynb)** - Dynamic code execution for calculations
7. **[Browser Tools](capstone_project/notebooks/07-browser-tools.ipynb)** - Web scraping and research capabilities
8. **[Final Integration](capstone_project/notebooks/08-final-integration.ipynb)** - Bringing it all together
9. **[AgentCore Observability Lab](capstone_project/notebooks/09-agentcore_observability_lab.ipynb)** - Tracing sessions, spans, and CloudWatch telemetry
10. **[AgentCore Policy Lab](capstone_project/notebooks/10-agentcore_policy_lab.ipynb)** - Applying guardrails and runtime policy controls
11. **[AgentCore Evaluations Lab](capstone_project/notebooks/11-agentcore_evaluations_lab.ipynb)** - Running offline and online evaluations for production agents

## Prerequisites

### Required
- **AWS Account** with appropriate IAM permissions for:
  - Amazon Bedrock
  - Amazon Cognito (for OAuth)
  - AWS Lambda (for runtime deployment)
  - CloudWatch (for monitoring)
- **Deno 2.9+** - [Installation guide](https://docs.deno.com/runtime/getting_started/installation) (`setup.sh` installs the pinned version from `.deno-version` if it is missing)
- **VS Code** with two extensions: **Jupyter** (Microsoft) and **Deno** (denoland). The notebooks run TypeScript on Deno's own Jupyter kernel, so **no Python is required**
- Basic knowledge of TypeScript and AWS concepts

### Optional API Keys
For full functionality, obtain free API keys from:
- [OpenWeatherMap](https://openweathermap.org/api) - Weather data
- [ExchangeRate API](https://www.exchangerate-api.com/) - Currency conversion
- [AviationStack](https://aviationstack.com/) - Flight data

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/puria-izady/mastering-amazon-bedrock-agentcore.git
cd mastering-amazon-bedrock-agentcore
```

### 2. Run Setup Script

```bash
chmod +x setup.sh
./setup.sh
```

This will:
- Install the pinned Deno version, or check the one you already have
- Download and cache every dependency listed in `deno.json`
- Register the Deno Jupyter kernel, so the notebooks can run TypeScript
- Check for the optional API keys

### 3. Configure AWS Credentials

Set up your AWS credentials using one of these methods:

**Option A: AWS SSO Profile**
```bash
export AWS_PROFILE=your-profile-name
export AWS_REGION=us-east-1
```

**Option B: Environment Variables**
```bash
export AWS_ACCESS_KEY_ID=your-access-key
export AWS_SECRET_ACCESS_KEY=your-secret-key
export AWS_REGION=us-east-1
```

### 4. Configure API Keys (Optional)

Create a `.env` file in the project root:

```bash
OPENWEATHERMAP_API_KEY=your-key-here
EXCHANGERATE_API_KEY=your-key-here
AVIATIONSTACK_API_KEY=your-key-here
```

### 5. Start Learning

Open the repository in VS Code, then open
[`capstone_project/notebooks/01-foundation.ipynb`](capstone_project/notebooks/01-foundation.ipynb).
Click **Select Kernel** in the top right, choose **Jupyter Kernel...**, and pick **Deno**.

Then run the cells. There is no virtual environment to activate: Deno caches dependencies itself.

## Project Structure

```
mastering-amazon-bedrock-agentcore/
├── capstone_project/           # Main course project
│   ├── notebooks/              # Interactive learning notebooks (01-11)
│   │   ├── 01-foundation.ipynb
│   │   ├── 02-runtime-setup.ipynb
│   │   ├── 03-gateway-integration.ipynb
│   │   ├── 04-memory-implementation.ipynb
│   │   ├── 05-identity-oauth.ipynb
│   │   ├── 06-code-interpreter.ipynb
│   │   ├── 07-browser-tools.ipynb
│   │   ├── 08-final-integration.ipynb
│   │   ├── 09-agentcore_observability_lab.ipynb
│   │   ├── 10-agentcore_policy_lab.ipynb
│   │   ├── 11-agentcore_evaluations_lab.ipynb
│   │   └── environments/       # Configuration files
│   ├── backend/                # TypeScript implementation
│   │   ├── gateway/            # API Gateway setup
│   │   ├── identity/           # OAuth and authentication
│   │   ├── memory/             # Memory configuration
│   │   └── runtime/            # Agent runtime code
│   ├── toolkit/                # AgentCore helper clients used by the notebooks
│   ├── shared/                 # Notebook helpers and agent observability
│   └── README.md               # Project-specific documentation
├── tests/                      # Testing utilities
├── setup.sh                    # Environment setup script
├── deno.json                   # Dependencies, tasks and lint/format settings
├── deno.lock                   # Locked dependency versions
├── .deno-version               # Deno version this course is pinned to
└── README.md                   # This file
```

> **Note on `misc/mcp.json`:** that file configures MCP servers for your editor and launches them
> with `uvx`, a Python tool. It is editor configuration rather than course code, and the AWS
> documentation MCP server it points at is published for Python only, so it is left as it is.

## AgentCore Components Covered

### 1. Runtime
Learn to create and configure the agent runtime environment, manage conversation flow, and implement multi-turn dialogue capabilities.

### 2. Gateway
Connect your agent to external APIs and services using OpenAPI specifications, handle authentication, and manage API integrations.

### 3. Memory
Implement user preference storage, context retention across conversations, and intelligent memory retrieval for personalized experiences.

### 4. Identity
Secure your agent with OAuth 2.0, integrate with AWS Cognito, and manage user authentication flows.

### 5. Code Interpreter
Enable dynamic code execution for complex calculations, data processing, and algorithm implementations.

### 6. Browser Tools
Add web scraping capabilities, automated research, and dynamic content extraction to your agent.

### 7. Orchestration
Coordinate multiple tools and components, manage complex workflows, and optimize agent decision-making.

## Key Features & Learning Outcomes

After completing this course, you will:

- ✅ Understand Amazon Bedrock AgentCore architecture
- ✅ Build production-ready AI agents from scratch
- ✅ Integrate external APIs and services
- ✅ Implement secure authentication with OAuth 2.0
- ✅ Add memory and context management
- ✅ Deploy agents to AWS infrastructure
- ✅ Monitor and observe agent behavior in production
- ✅ Handle edge cases and error scenarios
- ✅ Optimize performance and cost

## Technologies Used

- **Amazon Bedrock AgentCore** - AI agent framework
- **AWS Services** - Lambda, Cognito, CloudWatch
- **TypeScript on Deno** - Primary programming language and runtime
- **Jupyter Notebooks** - Interactive learning environment, on Deno's own kernel
- **OAuth 2.0** - Secure authentication
- **OpenAPI/REST** - API integration
- **Playwright** - Browser automation, driving AgentCore's hosted browser
- **Strands Agents** - Agent framework

## Testing

The repository includes testing utilities in the `tests/` directory:

```bash
# Unit tests for the toolkit helpers and shared modules
deno task test

# Type-check, lint and format
deno task check
deno task fmt

# Call the third-party APIs directly, bypassing the Gateway
deno run -A tests/api_direct_test.ts
```

See [tests/README.md](tests/README.md) for detailed testing documentation.

## Support & Resources

- **Course Platform**: Udemy (link coming soon)
- **Issues**: [GitHub Issues](https://github.com/puria-izady/mastering-amazon-bedrock-agentcore/issues)
- **Documentation**: Each notebook contains detailed explanations and documentation
- **AWS Documentation**: [Amazon Bedrock AgentCore](https://docs.aws.amazon.com/bedrock/)

## Contributing

This is a course repository. While it's primarily for educational purposes, bug reports and improvements are welcome through GitHub Issues.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## Troubleshooting

### Common Issues

**Issue**: `bedrock-agentcore` package not found
- **Solution**: Run `./setup.sh`, and check your Deno version matches `.deno-version` (`deno --version`)

**Issue**: AWS credentials not working
- **Solution**: Verify your IAM permissions include Bedrock access in your region

**Issue**: API keys not loading
- **Solution**: Check that your `.env` file is in the project root directory

**Issue**: Deno kernel not offered in VS Code
- **Solution**: Install the **Jupyter** and **Deno** extensions, run `deno jupyter --install --force`, then reload VS Code

**Issue**: A notebook cell cannot find a module
- **Solution**: Run `deno install` from the project root; every dependency is pinned in `deno.json`

For more issues, check the troubleshooting section in each notebook.

## Acknowledgments

Built with Amazon Bedrock AgentCore and the AWS ecosystem. Special thanks to the AWS AI team for creating this powerful framework for building production-grade AI agents.

---

**Ready to master AI agent development?** Start with [Notebook 01: Foundation & AWS Setup](capstone_project/notebooks/01-foundation.ipynb)
