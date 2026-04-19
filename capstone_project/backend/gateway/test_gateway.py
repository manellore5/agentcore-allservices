"""
TravelMate AI - Gateway Integration Tests
Tests all 4 travel API integrations through AgentCore Gateway
"""

import json
import requests
import os
from datetime import datetime, timedelta

# Test configuration
GATEWAY_MCP_URL = os.getenv("GATEWAY_MCP_URL")  # Set after gateway creation
OAUTH_TOKEN = os.getenv("OAUTH_TOKEN")  # Get from Cognito

def test_search_flights():
    """Test Aviationstack flight search"""
    print("🧪 Testing flight search...")
    
    payload = {
        "method": "searchFlights",
        "params": {
            "dep_iata": "JFK",
            "arr_iata": "FCO",
            "flight_date": "2024-12-15"
        }
    }
    
    response = make_mcp_request(payload)
    
    if response and "data" in response:
        flights = response["data"]
        print(f"   ✅ Found {len(flights)} flights")
        if flights:
            flight = flights[0]
            print(f"   📍 {flight.get('airline', {}).get('name', 'Unknown')} - {flight.get('flight', {}).get('number', 'N/A')}")
    else:
        print("   ❌ Flight search failed")
    
    return response

def test_search_hotels():
    """Test Hotelbeds hotel search"""
    print("🧪 Testing hotel search...")
    
    # Calculate dates (check-in tomorrow, check-out day after)
    checkin = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
    checkout = (datetime.now() + timedelta(days=2)).strftime("%Y-%m-%d")
    
    payload = {
        "method": "searchHotels",
        "params": {
            "stay": {
                "checkIn": checkin,
                "checkOut": checkout
            },
            "occupancies": [
                {
                    "rooms": 1,
                    "adults": 2,
                    "children": 0
                }
            ],
            "destination": {
                "code": "NYC"
            }
        }
    }
    
    response = make_mcp_request(payload)
    
    if response and "hotels" in response:
        hotels = response["hotels"].get("hotels", [])
        print(f"   ✅ Found {len(hotels)} hotels")
        if hotels:
            hotel = hotels[0]
            print(f"   🏨 {hotel.get('name', 'Unknown Hotel')} - {hotel.get('categoryCode', 'N/A')} stars")
    else:
        print("   ❌ Hotel search failed")
    
    return response

def test_get_hotel_details():
    """Test Hotelbeds hotel details"""
    print("🧪 Testing hotel details...")
    
    # Use a sample hotel code (this would come from search results)
    payload = {
        "method": "getHotelDetails",
        "params": {
            "hotelCode": 12345
        }
    }
    
    response = make_mcp_request(payload)
    
    if response and "hotel" in response:
        hotel = response["hotel"]
        print(f"   ✅ Hotel details retrieved")
        print(f"   🏨 {hotel.get('name', 'Unknown Hotel')}")
        print(f"   📍 {hotel.get('address', {}).get('content', 'Address not available')}")
    else:
        print("   ❌ Hotel details failed")
    
    return response

def test_get_weather():
    """Test OpenWeatherMap current weather"""
    print("🧪 Testing current weather...")
    
    payload = {
        "method": "getCurrentWeather",
        "params": {
            "q": "Rome,IT",
            "units": "metric"
        }
    }
    
    response = make_mcp_request(payload)
    
    if response and "main" in response:
        weather = response
        temp = weather["main"]["temp"]
        desc = weather["weather"][0]["description"]
        print(f"   ✅ Weather retrieved")
        print(f"   🌤️ Rome: {temp}°C, {desc}")
    else:
        print("   ❌ Weather retrieval failed")
    
    return response

def test_get_weather_forecast():
    """Test OpenWeatherMap weather forecast"""
    print("🧪 Testing weather forecast...")
    
    payload = {
        "method": "getWeatherForecast",
        "params": {
            "q": "Florence,IT",
            "units": "metric",
            "cnt": 3
        }
    }
    
    response = make_mcp_request(payload)
    
    if response and "list" in response:
        forecasts = response["list"]
        print(f"   ✅ Forecast retrieved ({len(forecasts)} periods)")
        if forecasts:
            forecast = forecasts[0]
            temp = forecast["main"]["temp"]
            desc = forecast["weather"][0]["description"]
            print(f"   🌤️ Florence: {temp}°C, {desc}")
    else:
        print("   ❌ Weather forecast failed")
    
    return response

def test_get_exchange_rates():
    """Test ExchangeRate-API exchange rates"""
    print("🧪 Testing exchange rates...")
    
    payload = {
        "method": "getExchangeRates",
        "params": {
            "base": "USD"
        }
    }
    
    response = make_mcp_request(payload)
    
    if response and "rates" in response:
        rates = response["rates"]
        print(f"   ✅ Exchange rates retrieved")
        print(f"   💱 USD to EUR: {rates.get('EUR', 'N/A')}")
        print(f"   💱 USD to GBP: {rates.get('GBP', 'N/A')}")
    else:
        print("   ❌ Exchange rates failed")
    
    return response

def test_convert_currency():
    """Test ExchangeRate-API currency conversion"""
    print("🧪 Testing currency conversion...")
    
    payload = {
        "method": "convertCurrency",
        "params": {
            "from": "USD",
            "to": "EUR",
            "amount": 1000
        }
    }
    
    response = make_mcp_request(payload)
    
    if response and "result" in response:
        result = response["result"]
        rate = response.get("info", {}).get("rate", "N/A")
        print(f"   ✅ Currency conversion successful")
        print(f"   💱 $1000 USD = €{result} EUR (rate: {rate})")
    else:
        print("   ❌ Currency conversion failed")
    
    return response

def make_mcp_request(payload):
    """Make MCP request to Gateway"""
    if not GATEWAY_MCP_URL:
        print("   ❌ GATEWAY_MCP_URL not set")
        return None
    
    if not OAUTH_TOKEN:
        print("   ❌ OAUTH_TOKEN not set")
        return None
    
    headers = {
        "Authorization": f"Bearer {OAUTH_TOKEN}",
        "Content-Type": "application/json"
    }
    
    try:
        response = requests.post(GATEWAY_MCP_URL, json=payload, headers=headers)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"   ❌ Request failed: {e}")
        return None
    except json.JSONDecodeError as e:
        print(f"   ❌ JSON decode failed: {e}")
        return None

def run_all_tests():
    """Run all integration tests"""
    print("🚀 Starting TravelMate Gateway Integration Tests")
    print("=" * 60)
    
    # Check environment
    if not GATEWAY_MCP_URL:
        print("❌ Missing GATEWAY_MCP_URL environment variable")
        print("   Set it after creating the gateway:")
        print("   export GATEWAY_MCP_URL=https://your-gateway-url/mcp")
        return
    
    if not OAUTH_TOKEN:
        print("❌ Missing OAUTH_TOKEN environment variable")
        print("   Get OAuth token from Cognito and set:")
        print("   export OAUTH_TOKEN=your_oauth_token")
        return
    
    # Run tests
    tests = [
        ("Flight Search", test_search_flights),
        ("Hotel Search", test_search_hotels),
        ("Hotel Details", test_get_hotel_details),
        ("Current Weather", test_get_weather),
        ("Weather Forecast", test_get_weather_forecast),
        ("Exchange Rates", test_get_exchange_rates),
        ("Currency Conversion", test_convert_currency)
    ]
    
    results = {}
    
    for test_name, test_func in tests:
        print(f"\n📋 {test_name}")
        print("-" * 40)
        try:
            result = test_func()
            results[test_name] = "✅ PASS" if result else "❌ FAIL"
        except Exception as e:
            print(f"   ❌ Test error: {e}")
            results[test_name] = "❌ ERROR"
    
    # Summary
    print("\n" + "=" * 60)
    print("📊 TEST SUMMARY")
    print("=" * 60)
    
    for test_name, status in results.items():
        print(f"{status} {test_name}")
    
    passed = sum(1 for status in results.values() if "✅" in status)
    total = len(results)
    
    print(f"\n🎯 Results: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All tests passed! Gateway is ready for production.")
    else:
        print("⚠️ Some tests failed. Check API keys and Gateway configuration.")

if __name__ == "__main__":
    run_all_tests()