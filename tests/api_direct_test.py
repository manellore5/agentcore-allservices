"""
Direct API Testing Utility

Test external APIs directly (bypassing the gateway) for comparison and debugging.
This helps verify if issues are with the gateway integration or the APIs themselves.
"""

import requests
import json
from typing import Dict, Any, Optional


class DirectAPITester:
    """Test external APIs directly"""
    
    def __init__(self):
        """Initialize with API keys (should be loaded from environment)"""
        # Note: In production, these should come from environment variables
        self.api_keys = {
            "EXCHANGERATE_API_KEY": "",
            "OPENWEATHERMAP_API_KEY": "",
            "AVIATIONSTACK_API_KEY": ""
        }
    
    def test_currency_api(self, from_currency: str = "USD", to_currency: str = "EUR") -> Optional[Dict[str, Any]]:
        """Test ExchangeRate-API directly"""
        print(f"🔄 Testing Currency API: {from_currency} -> {to_currency}")
        
        api_key = self.api_keys["EXCHANGERATE_API_KEY"]
        url = f"https://v6.exchangerate-api.com/v6/{api_key}/pair/{from_currency}/{to_currency}"
        
        try:
            response = requests.get(url, timeout=10)
            print(f"   Status: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                print("✅ Currency API - Success")
                print(f"   Base: {data.get('base_code')}")
                print(f"   Target: {data.get('target_code')}")
                print(f"   Rate: {data.get('conversion_rate')}")
                return data
            else:
                print(f"❌ Currency API - Failed")
                print(f"   Response: {response.text}")
                return None
                
        except Exception as e:
            print(f"❌ Currency API - Exception: {e}")
            return None
    
    def test_weather_api(self, city: str = "Rome,IT") -> Optional[Dict[str, Any]]:
        """Test OpenWeatherMap API directly"""
        print(f"🔄 Testing Weather API: {city}")
        
        api_key = self.api_keys["OPENWEATHERMAP_API_KEY"]
        url = f"https://api.openweathermap.org/data/2.5/weather"
        params = {
            "q": city,
            "appid": api_key,
            "units": "metric"
        }
        
        try:
            response = requests.get(url, params=params, timeout=10)
            print(f"   Status: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                print("✅ Weather API - Success")
                print(f"   City: {data.get('name')}")
                print(f"   Temperature: {data.get('main', {}).get('temp')}°C")
                print(f"   Description: {data.get('weather', [{}])[0].get('description')}")
                return data
            else:
                print(f"❌ Weather API - Failed")
                print(f"   Response: {response.text}")
                return None
                
        except Exception as e:
            print(f"❌ Weather API - Exception: {e}")
            return None
    
    def test_flight_api(self, dep_iata: str = "JFK", arr_iata: str = "FCO", limit: int = 5) -> Optional[Dict[str, Any]]:
        """Test Aviationstack API directly"""
        print(f"🔄 Testing Flight API: {dep_iata} -> {arr_iata}")
        
        api_key = self.api_keys["AVIATIONSTACK_API_KEY"]
        url = "https://api.aviationstack.com/v1/flights"
        params = {
            "access_key": api_key,
            "dep_iata": dep_iata,
            "arr_iata": arr_iata,
            "limit": limit
        }
        
        try:
            response = requests.get(url, params=params, timeout=10)
            print(f"   Status: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                print("✅ Flight API - Success")
                
                flights = data.get('data', [])
                print(f"   Found {len(flights)} flights")
                
                for i, flight in enumerate(flights[:3]):  # Show first 3
                    airline = flight.get('airline', {}).get('name', 'Unknown')
                    flight_num = flight.get('flight', {}).get('iata', 'Unknown')
                    status = flight.get('flight_status', 'Unknown')
                    print(f"   Flight {i+1}: {airline} {flight_num} - {status}")
                
                return data
            else:
                print(f"❌ Flight API - Failed")
                print(f"   Response: {response.text}")
                return None
                
        except Exception as e:
            print(f"❌ Flight API - Exception: {e}")
            return None
    
    def run_all_tests(self):
        """Run all direct API tests"""
        print("🧪 Running Direct API Tests")
        print("=" * 50)
        
        # Test Currency API
        self.test_currency_api()
        print()
        
        # Test Weather API
        self.test_weather_api()
        print()
        
        # Test Flight API
        self.test_flight_api()
        print()
        
        print("=" * 50)
        print("✅ Direct API testing complete")


def main():
    """Main function to run direct API tests"""
    tester = DirectAPITester()
    tester.run_all_tests()


if __name__ == "__main__":
    main()