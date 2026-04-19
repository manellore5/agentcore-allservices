"""
TravelMate AI - AgentCore Browser Tools Setup
Creates Browser Tools session for web research
"""

import json
import logging
from datetime import datetime
from botocore.exceptions import ClientError
from bedrock_agentcore.services.browser_tools import BrowserToolsClient

# Configuration
REGION = "us-west-2"
SESSION_NAME = "travel-research-session"

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("travel-browser-tools")

def create_browser_tools_session():
    """Create AgentCore Browser Tools session for travel research"""
    
    print("🌐 Creating AgentCore Browser Tools Session...")
    client = BrowserToolsClient(region_name=REGION)
    
    try:
        # Create browser session
        session = client.create_session(
            name=SESSION_NAME,
            description="Browser session for travel attraction research and review aggregation",
            browser_type="chromium",
            viewport_width=1920,
            viewport_height=1080,
            timeout_seconds=30
        )
        
        session_id = session.get('id')
        logger.info(f"✅ Created browser tools session: {session_id}")
        
        return session_id, client
        
    except ClientError as e:
        if e.response['Error']['Code'] == 'ValidationException' and "already exists" in str(e):
            # If session already exists, retrieve its ID
            sessions = client.list_sessions()
            session_id = next((s['id'] for s in sessions if s['name'] == SESSION_NAME), None)
            logger.info(f"Session already exists. Using existing session ID: {session_id}")
            return session_id, client
        else:
            raise e
            
    except Exception as e:
        logger.error(f"❌ ERROR: {e}")
        raise e

def test_browser_capabilities(client: BrowserToolsClient, session_id: str):
    """Test basic browser tools capabilities"""
    
    test_actions = [
        {
            "action": "navigate",
            "url": "https://www.google.com"
        },
        {
            "action": "wait",
            "seconds": 2
        },
        {
            "action": "extract_text",
            "selector": "title",
            "limit": 1
        }
    ]
    
    try:
        print("🧪 Testing browser capabilities...")
        result = client.execute_actions(session_id, test_actions)
        print("✅ Browser test completed successfully")
        return True
        
    except Exception as e:
        print(f"⚠️ Browser test failed: {e}")
        return False

if __name__ == "__main__":
    # Create browser tools session
    session_id, client = create_browser_tools_session()
    
    # Test browser capabilities
    test_success = test_browser_capabilities(client, session_id)
    
    # Save session info for notebooks
    session_info = {
        "session_id": session_id,
        "session_name": SESSION_NAME,
        "region": REGION,
        "browser_type": "chromium",
        "viewport": {
            "width": 1920,
            "height": 1080
        },
        "timeout_seconds": 30,
        "capabilities": [
            "attraction_research",
            "review_aggregation",
            "local_tips_research", 
            "web_scraping",
            "real_time_research"
        ],
        "test_status": "passed" if test_success else "failed",
        "created_at": datetime.now().isoformat()
    }
    
    with open('browser_tools_info.json', 'w') as f:
        json.dump(session_info, f, indent=2)
    
    print(f"\n💾 Session information saved to browser_tools_info.json")
    print(f"Session ID: {session_id}")
    print(f"Test Status: {'✅ Passed' if test_success else '❌ Failed'}")
    print(f"Ready for web research automation!")