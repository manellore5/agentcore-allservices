"""
TravelMate AI - AgentCore Gateway Setup
Creates Gateway with all 4 travel API integrations
"""

import json
import os
from bedrock_agentcore_starter_toolkit.operations.gateway.client import GatewayClient

# Configuration
REGION = "us-west-2"
GATEWAY_NAME = "TravelMateGateway"

# API Keys (load from environment)
API_KEYS = {
    "aviationstack": os.getenv("AVIATIONSTACK_API_KEY"),
    "hotelbeds": os.getenv("HOTELBEDS_API_KEY"),
    "openweathermap": os.getenv("OPENWEATHERMAP_API_KEY"),
    "exchangerate": os.getenv("EXCHANGERATE_API_KEY")
}

def load_openapi_spec(filename):
    """Load OpenAPI specification from file"""
    with open(f"openapi_specs/{filename}", "r") as f:
        return json.load(f)

def create_travel_gateway():
    """Create TravelMate Gateway with all targets"""
    
    # Initialize Gateway client
    print("Initializing Gateway client...")
    client = GatewayClient(region_name=REGION)
    
    # Set up Cognito OAuth (EZ Auth)
    print("Setting up OAuth with Cognito...")
    cognito_result = client.create_oauth_authorizer_with_cognito(GATEWAY_NAME)
    
    # Create Gateway
    print(f"Creating Gateway: {GATEWAY_NAME}...")
    gateway = client.create_mcp_gateway(
        name=GATEWAY_NAME,
        role_arn=None,  # Auto-create
        authorizer_config=cognito_result['authorization'],
        enable_semantic_search=True,
        exception_level="DEBUG"
    )
    
    print(f"✅ Gateway created!")
    print(f"   MCP Endpoint: {gateway.get_mcp_url()}")
    print(f"   Gateway ID: {gateway.gateway_id}")
    
    # Add Aviationstack target
    print("\n1️⃣ Adding Aviationstack (flights)...")
    aviationstack_spec = load_openapi_spec("aviationstack.json")
    
    aviationstack_target = client.create_mcp_gateway_target(
        gateway=gateway,
        target_type="openApiSchema",
        target_payload={
            "inlinePayload": json.dumps(aviationstack_spec)
        },
        credentials={
            "api_key": API_KEYS["aviationstack"],
            "credential_location": "QUERY_PARAMETER",
            "credential_parameter_name": "access_key"
        }
    )
    print("   ✅ Aviationstack target added")
    
    # Add Hotelbeds target
    print("\n2️⃣ Adding Hotelbeds (hotels)...")
    hotelbeds_spec = load_openapi_spec("hotelbeds.json")
    
    hotelbeds_target = client.create_mcp_gateway_target(
        gateway=gateway,
        target_type="openApiSchema",
        target_payload={
            "inlinePayload": json.dumps(hotelbeds_spec)
        },
        credentials={
            "api_key": API_KEYS["hotelbeds"],
            "credential_location": "HEADER",
            "credential_parameter_name": "Api-Key"
        }
    )
    print("   ✅ Hotelbeds target added")
    
    # Add OpenWeatherMap target
    print("\n3️⃣ Adding OpenWeatherMap (weather)...")
    weather_spec = load_openapi_spec("openweathermap.json")
    
    weather_target = client.create_mcp_gateway_target(
        gateway=gateway,
        target_type="openApiSchema",
        target_payload={
            "inlinePayload": json.dumps(weather_spec)
        },
        credentials={
            "api_key": API_KEYS["openweathermap"],
            "credential_location": "QUERY_PARAMETER",
            "credential_parameter_name": "appid"
        }
    )
    print("   ✅ OpenWeatherMap target added")
    
    # Add ExchangeRate-API target
    print("\n4️⃣ Adding ExchangeRate-API (currency)...")
    currency_spec = load_openapi_spec("exchangerate.json")
    
    currency_target = client.create_mcp_gateway_target(
        gateway=gateway,
        target_type="openApiSchema",
        target_payload={
            "inlinePayload": json.dumps(currency_spec)
        },
        credentials={
            "api_key": API_KEYS["exchangerate"],
            "credential_location": "HEADER",
            "credential_parameter_name": "Authorization"
        }
    )
    print("   ✅ ExchangeRate-API target added")
    
    # Print OAuth credentials
    print("\n" + "="*60)
    print("🎉 GATEWAY SETUP COMPLETE!")
    print("="*60)
    print(f"\nMCP Endpoint: {gateway.get_mcp_url()}")
    print(f"\nOAuth Credentials:")
    print(f"  Client ID: {cognito_result['client_info']['client_id']}")
    print(f"  Scope: {cognito_result['client_info']['scope']}")
    print(f"\nAvailable Tools:")
    print("  - searchFlights (Aviationstack)")
    print("  - searchHotels (Hotelbeds)")
    print("  - getHotelDetails (Hotelbeds)")
    print("  - getCurrentWeather (OpenWeatherMap)")
    print("  - getWeatherForecast (OpenWeatherMap)")
    print("  - getExchangeRates (ExchangeRate-API)")
    print("  - convertCurrency (ExchangeRate-API)")
    
    return gateway, cognito_result

if __name__ == "__main__":
    # Check API keys
    missing_keys = [k for k, v in API_KEYS.items() if not v]
    if missing_keys:
        print(f"❌ Missing API keys: {', '.join(missing_keys)}")
        print("Set environment variables:")
        for key in missing_keys:
            print(f"  export {key.upper()}_API_KEY=your_key_here")
        exit(1)
    
    # Create gateway
    gateway, cognito = create_travel_gateway()