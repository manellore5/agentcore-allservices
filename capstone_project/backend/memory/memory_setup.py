"""
TravelMate AI - AgentCore Memory Setup
Creates Memory resource with travel-specific strategies
"""

import json
import logging
from datetime import datetime
from botocore.exceptions import ClientError
from bedrock_agentcore.memory import MemoryClient
from bedrock_agentcore.memory.constants import StrategyType

# Configuration
REGION = "us-west-2"
MEMORY_NAME = "TravelMateMemory"

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("travel-memory")

def create_travel_memory():
    """Create AgentCore Memory resource for travel agent"""
    
    # Initialize Memory Client
    print("🧠 Creating AgentCore Memory for Travel Agent...")
    client = MemoryClient(region_name=REGION)
    
    # Define memory strategies for travel planning
    strategies = [
        {
            StrategyType.USER_PREFERENCE.value: {
                "name": "TravelPreferences",
                "description": "Captures user travel preferences and behavior",
                "namespaces": ["travel/user/{actorId}/preferences"]
            }
        },
        {
            StrategyType.SEMANTIC.value: {
                "name": "TravelSemantic",
                "description": "Stores travel facts and trip information",
                "namespaces": ["travel/user/{actorId}/semantic"]
            }
        },
        {
            StrategyType.SUMMARY.value: {
                "name": "TravelSummary", 
                "description": "Maintains conversation summaries for context",
                "namespaces": ["travel/user/{actorId}/summary"]
            }
        }
    ]
    
    # Create memory resource
    try:
        memory = client.create_memory_and_wait(
            name=MEMORY_NAME,
            strategies=strategies,
            description="Memory for AI Travel Companion agent",
            event_expiry_days=365,  # Keep travel memories for 1 year
        )
        memory_id = memory['id']
        logger.info(f"✅ Created memory: {memory_id}")
        
        return memory_id, client
        
    except ClientError as e:
        if e.response['Error']['Code'] == 'ValidationException' and "already exists" in str(e):
            # If memory already exists, retrieve its ID
            memories = client.list_memories()
            memory_id = next((m['id'] for m in memories if m['id'].startswith(MEMORY_NAME)), None)
            logger.info(f"Memory already exists. Using existing memory ID: {memory_id}")
            return memory_id, client
        else:
            raise e
            
    except Exception as e:
        logger.error(f"❌ ERROR: {e}")
        raise e

def get_namespaces(client: MemoryClient, memory_id: str):
    """Get namespace mapping for memory strategies"""
    strategies = client.get_memory_strategies(memory_id)
    return {i["type"]: i["namespaces"][0] for i in strategies}

def seed_travel_preferences(client: MemoryClient, memory_id: str, user_id: str):
    """Seed initial travel preferences for demonstration"""
    
    # Sample travel interactions to establish preferences
    travel_interactions = [
        ("I prefer mid-range hotels, nothing too fancy but clean and comfortable.", "USER"),
        ("Noted! I'll focus on 3-4 star hotels with good reviews for cleanliness and comfort.", "ASSISTANT"),
        ("I'm vegetarian, so I need restaurants with good vegetarian options.", "USER"),
        ("Perfect! I'll make sure to recommend destinations and restaurants known for excellent vegetarian cuisine.", "ASSISTANT"),
        ("My budget is usually around $3000-5000 for a 10-day international trip.", "USER"),
        ("That's a great budget range! I can help you plan amazing trips within $3000-5000 for 10 days.", "ASSISTANT"),
        ("I love historical sites and museums, not so much into nightlife or beaches.", "USER"),
        ("Excellent! I'll focus on destinations rich in history and culture with world-class museums.", "ASSISTANT")
    ]
    
    try:
        client.create_event(
            memory_id=memory_id,
            actor_id=user_id,
            session_id="preference_setup",
            messages=travel_interactions
        )
        print(f"✅ Seeded travel preferences for user: {user_id}")
        
    except Exception as e:
        print(f"⚠️ Error seeding preferences: {e}")

if __name__ == "__main__":
    # Create memory resource
    memory_id, client = create_travel_memory()
    
    # Display memory strategies
    print(f"\n📋 Memory Strategies:")
    strategies = client.get_memory_strategies(memory_id)
    for strategy in strategies:
        print(f"  • {strategy['name']}: {strategy['description']}")
    
    # Seed sample preferences
    sample_user_id = "travel_user_001"
    seed_travel_preferences(client, memory_id, sample_user_id)
    
    # Save memory info for notebooks
    memory_info = {
        "memory_id": memory_id,
        "memory_name": MEMORY_NAME,
        "region": REGION,
        "strategies": [s["type"] for s in strategies],
        "sample_user_id": sample_user_id
    }
    
    with open('memory_info.json', 'w') as f:
        json.dump(memory_info, f, indent=2)
    
    print(f"\n💾 Memory information saved to memory_info.json")
    print(f"Memory ID: {memory_id}")
    print(f"Ready for integration with travel agent!")