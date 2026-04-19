"""
Cognito Configuration Management
Handles saving and loading Cognito OAuth configuration to avoid recreating resources
"""

import json
import os
from pathlib import Path

COGNITO_CONFIG_FILE = "../notebooks/environments/cognito_config.json"


def save_cognito_config(cognito_result, gateway_name):
    """Save Cognito configuration to file"""
    config = {
        "gateway_name": gateway_name,
        "authorizer_config": cognito_result["authorizer_config"],
        "client_info": cognito_result["client_info"]
    }
    
    with open(COGNITO_CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)
    
    print(f"💾 Cognito config saved to {COGNITO_CONFIG_FILE}")

def load_cognito_config(gateway_name):
    """Load existing Cognito configuration from file"""
    if not os.path.exists(COGNITO_CONFIG_FILE):
        return None
    
    try:
        with open(COGNITO_CONFIG_FILE, "r") as f:
            config = json.load(f)
        
        if config.get("gateway_name") == gateway_name:
            print(f"📂 Loaded existing Cognito config for {gateway_name}")
            return {
                "authorizer_config": config["authorizer_config"],
                "client_info": config["client_info"]
            }
    except Exception as e:
        print(f"⚠️ Error loading Cognito config: {e}")
    
    return None

def ensure_user_password_auth(client_id, user_pool_id, region='us-east-1'):
    """Ensure Cognito client has USER_PASSWORD_AUTH enabled"""
    import boto3
    
    cognito_client = boto3.client('cognito-idp', region_name=region)
    
    try:
        # Get current client config
        response = cognito_client.describe_user_pool_client(
            UserPoolId=user_pool_id,
            ClientId=client_id
        )
        
        current_flows = response['UserPoolClient'].get('ExplicitAuthFlows', [])
        
        # Check if USER_PASSWORD_AUTH is already enabled
        if 'ALLOW_USER_PASSWORD_AUTH' not in current_flows:
            print("🔧 Enabling USER_PASSWORD_AUTH flow...")
            
            # Add required auth flows
            updated_flows = list(set(current_flows + ['ALLOW_USER_PASSWORD_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH']))
            
            # Update client with auth flows
            cognito_client.update_user_pool_client(
                UserPoolId=user_pool_id,
                ClientId=client_id,
                ExplicitAuthFlows=updated_flows
            )
            print("✅ USER_PASSWORD_AUTH flow enabled")
        else:
            print("✅ USER_PASSWORD_AUTH already enabled")
            
    except Exception as e:
        print(f"⚠️ Error updating auth flows: {e}")

def activate_oauth_client_credentials(client_info, region='us-east-1'):
    """Enable client_credentials OAuth flow for Gateway authentication"""
    import boto3
    
    cognito_client = boto3.client('cognito-idp', region_name=region)
    
    try:
        cognito_client.update_user_pool_client(
            UserPoolId=client_info['user_pool_id'],
            ClientId=client_info['client_id'],
            AllowedOAuthFlows=['client_credentials'],
            AllowedOAuthScopes=[client_info['scope']],
            AllowedOAuthFlowsUserPoolClient=True
        )
        print("✅ Enabled client_credentials OAuth flow")
    except Exception as e:
        print(f"⚠️ Error enabling OAuth flow: {e}")
        raise

def setup_cognito_oauth(client, gateway_name):
    """Setup Cognito OAuth, reusing existing config if available"""
    import boto3
    
    # Try to load existing config
    cognito_result = load_cognito_config(gateway_name)
    
    if cognito_result:
        # Ensure OAuth flows are properly configured even for existing config
        activate_oauth_client_credentials(cognito_result['client_info'])
        return cognito_result
    
    # Check for existing user pools with same name
    cognito_client = boto3.client('cognito-idp')
    try:
        pools = cognito_client.list_user_pools(MaxResults=60)['UserPools']
        existing_pool = next((p for p in pools if p['Name'] == gateway_name), None)
        
        if existing_pool:
            print(f"⚠️ Found existing Cognito pool: {existing_pool['Name']}")
            # You would need to reconstruct cognito_result from existing resources
            # For now, create new one
            cognito_result = client.create_oauth_authorizer_with_cognito(gateway_name)
    except Exception as e:
        print(f"Warning: Could not check existing pools: {e}")
        cognito_result = client.create_oauth_authorizer_with_cognito(gateway_name)
    
    # Create new Cognito resources
    print("🔐 Creating new Cognito OAuth configuration...")
    cognito_result = client.create_oauth_authorizer_with_cognito(gateway_name)
    
    # Save for future use
    save_cognito_config(cognito_result, gateway_name)
    
    # Ensure USER_PASSWORD_AUTH is enabled
    ensure_user_password_auth(
        cognito_result['client_info']['client_id'],
        cognito_result['client_info']['user_pool_id']
    )
    
    # Enable client_credentials OAuth flow (fixes invalid_grant error)
    activate_oauth_client_credentials(cognito_result['client_info'])
    
    return cognito_result