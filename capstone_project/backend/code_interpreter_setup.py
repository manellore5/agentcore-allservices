"""
TravelMate AI - AgentCore Code Interpreter Setup
Creates Code Interpreter runtime for advanced calculations
"""

import json
import logging
from datetime import datetime
from botocore.exceptions import ClientError
from bedrock_agentcore.services.code_interpreter import CodeInterpreterClient

# Configuration
REGION = "us-west-2"
RUNTIME_NAME = "travel-code-interpreter"

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("travel-code-interpreter")

def create_code_interpreter_runtime():
    """Create AgentCore Code Interpreter runtime for travel calculations"""
    
    print("🧮 Creating AgentCore Code Interpreter Runtime...")
    client = CodeInterpreterClient(region_name=REGION)
    
    # Required packages for travel calculations
    packages = [
        "pandas",
        "numpy", 
        "matplotlib",
        "seaborn",
        "scipy",
        "scikit-learn"
    ]
    
    try:
        # Create runtime
        runtime = client.create_runtime(
            name=RUNTIME_NAME,
            description="Code interpreter for travel budget calculations and data analysis",
            python_version="3.11",
            packages=packages
        )
        
        runtime_id = runtime.get('id')
        logger.info(f"✅ Created code interpreter runtime: {runtime_id}")
        
        return runtime_id, client
        
    except ClientError as e:
        if e.response['Error']['Code'] == 'ValidationException' and "already exists" in str(e):
            # If runtime already exists, retrieve its ID
            runtimes = client.list_runtimes()
            runtime_id = next((r['id'] for r in runtimes if r['name'] == RUNTIME_NAME), None)
            logger.info(f"Runtime already exists. Using existing runtime ID: {runtime_id}")
            return runtime_id, client
        else:
            raise e
            
    except Exception as e:
        logger.error(f"❌ ERROR: {e}")
        raise e

def test_runtime_capabilities(client: CodeInterpreterClient, runtime_id: str):
    """Test basic code interpreter capabilities"""
    
    test_code = """
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

# Test basic functionality
print("✅ Code Interpreter Runtime Test")
print(f"Pandas version: {pd.__version__}")
print(f"NumPy version: {np.__version__}")

# Simple calculation test
budget = 5000
days = 10
daily_budget = budget / days

print(f"Sample calculation: ${budget} for {days} days = ${daily_budget}/day")

# Create simple test visualization
plt.figure(figsize=(8, 6))
categories = ['Flights', 'Hotels', 'Food', 'Activities']
amounts = [budget * 0.25, budget * 0.35, budget * 0.20, budget * 0.20]
plt.pie(amounts, labels=categories, autopct='%1.1f%%')
plt.title('Sample Budget Breakdown')
plt.savefig('test_chart.png')
plt.show()

print("✅ Test visualization created: test_chart.png")
"""
    
    try:
        print("🧪 Testing runtime capabilities...")
        result = client.execute_code(runtime_id, test_code)
        print("✅ Runtime test completed successfully")
        return True
        
    except Exception as e:
        print(f"⚠️ Runtime test failed: {e}")
        return False

if __name__ == "__main__":
    # Create code interpreter runtime
    runtime_id, client = create_code_interpreter_runtime()
    
    # Test runtime capabilities
    test_success = test_runtime_capabilities(client, runtime_id)
    
    # Save runtime info for notebooks
    runtime_info = {
        "runtime_id": runtime_id,
        "runtime_name": RUNTIME_NAME,
        "region": REGION,
        "python_version": "3.11",
        "packages": [
            "pandas",
            "numpy", 
            "matplotlib",
            "seaborn",
            "scipy",
            "scikit-learn"
        ],
        "capabilities": [
            "budget_analysis",
            "cost_comparison", 
            "budget_optimization",
            "data_visualization",
            "statistical_analysis"
        ],
        "test_status": "passed" if test_success else "failed",
        "created_at": datetime.now().isoformat()
    }
    
    with open('code_interpreter_info.json', 'w') as f:
        json.dump(runtime_info, f, indent=2)
    
    print(f"\n💾 Runtime information saved to code_interpreter_info.json")
    print(f"Runtime ID: {runtime_id}")
    print(f"Test Status: {'✅ Passed' if test_success else '❌ Failed'}")
    print(f"Ready for advanced travel calculations!")