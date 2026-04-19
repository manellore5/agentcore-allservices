#!/usr/bin/env python3
"""
Identity Helper - Manages AgentCore credential provider access
Retrieves API keys and credentials from AWS Secrets Manager via credential providers
"""

import json
import boto3
from typing import Optional, Dict, Any


class IdentityHelper:
    """Helper class for managing AgentCore identity and credential providers"""
    
    def __init__(self, region: str = "us-east-1"):
        """Initialize identity helper with AWS clients
        
        Args:
            region: AWS region for API calls
        """
        self.region = region
        self.agentcore_client = boto3.client('bedrock-agentcore-control', region_name=region)
        self.secrets_client = boto3.client('secretsmanager', region_name=region)
    
    def get_api_key_by_provider_name(self, provider_name_prefix: str) -> Optional[str]:
        """Retrieve API key from credential provider by name prefix
        
        Args:
            provider_name_prefix: Prefix to search for (e.g., 'ExchangeRate-ApiKey')
        
        Returns:
            API key string or None if not found
        """
        try:
            # Step 1: List all credential providers
            print(f"🔍 Searching for credential provider: {provider_name_prefix}...")
            response = self.agentcore_client.list_api_key_credential_providers(maxResults=100)
            
            providers = response.get('credentialProviders', [])
            target_provider = None
            
            # Find the provider matching the prefix
            for provider in providers:
                if provider['name'].startswith(provider_name_prefix):
                    target_provider = provider
                    break
            
            if not target_provider:
                print(f"❌ Credential provider not found: {provider_name_prefix}")
                return None
            
            provider_name = target_provider['name']
            print(f"✅ Found provider: {provider_name}")
            
            # Step 2: Get credential provider details
            provider_response = self.agentcore_client.get_api_key_credential_provider(
                name=provider_name
            )
            print(f"   ARN: {provider_response['credentialProviderArn']}")
            
            # Step 3: Extract secret ARN
            secret_arn = provider_response['apiKeySecretArn']['secretArn']
            print(f"   Secret ARN: {secret_arn}")
            
            # Step 4: Retrieve API key from Secrets Manager
            print(f"🔐 Retrieving API key from Secrets Manager...")
            secret_response = self.secrets_client.get_secret_value(SecretId=secret_arn)
            
            # Parse secret value
            api_key = self._parse_secret_value(secret_response)
            
            if api_key:
                print(f"✅ Successfully retrieved API key")
                return api_key
            else:
                print(f"❌ Failed to parse API key from secret")
                return None
                
        except Exception as e:
            print(f"❌ Error retrieving API key: {e}")
            return None
    
    def _parse_secret_value(self, secret_response: Dict[str, Any]) -> Optional[str]:
        """Parse secret value from Secrets Manager response
        
        Args:
            secret_response: Response from get_secret_value
        
        Returns:
            Parsed API key string or None
        """
        if 'SecretString' in secret_response:
            secret_value = secret_response['SecretString']
            
            # Try to parse as JSON first
            try:
                secret_json = json.loads(secret_value)
                
                # Look for common API key field names
                api_key = (
                    secret_json.get('api_key') or 
                    secret_json.get('apiKey') or 
                    secret_json.get('api_key_value') or
                    secret_json.get('key')
                )
                
                if api_key:
                    return api_key
                
                # If no standard field found, return the whole JSON as string
                return secret_value
                
            except json.JSONDecodeError:
                # Not JSON, return as raw string
                return secret_value
        
        elif 'SecretBinary' in secret_response:
            # Binary secret
            return secret_response['SecretBinary'].decode('utf-8')
        
        return None
    
    def get_exchangerate_api_key(self) -> Optional[str]:
        """Convenience method to retrieve ExchangeRate API key
        
        Returns:
            ExchangeRate API key or None if not found
        """
        return self.get_api_key_by_provider_name('ExchangeRate-ApiKey')
    
    def list_all_credential_providers(self) -> list:
        """List all available credential providers
        
        Returns:
            List of credential provider names
        """
        try:
            response = self.agentcore_client.list_api_key_credential_providers(maxResults=100)
            providers = response.get('credentialProviders', [])
            
            provider_names = [p['name'] for p in providers]
            print(f"📋 Available credential providers ({len(provider_names)}):")
            for name in provider_names:
                print(f"  • {name}")
            
            return provider_names
            
        except Exception as e:
            print(f"❌ Error listing credential providers: {e}")
            return []


# Convenience functions for direct usage
def get_exchangerate_api_key(region: str = "us-east-1") -> Optional[str]:
    """Get ExchangeRate API key from credential provider
    
    Args:
        region: AWS region
    
    Returns:
        API key string or None
    """
    helper = IdentityHelper(region=region)
    return helper.get_exchangerate_api_key()


def get_api_key(provider_prefix: str, region: str = "us-east-1") -> Optional[str]:
    """Get API key from credential provider by name prefix
    
    Args:
        provider_prefix: Provider name prefix to search for
        region: AWS region
    
    Returns:
        API key string or None
    """
    helper = IdentityHelper(region=region)
    return helper.get_api_key_by_provider_name(provider_prefix)


if __name__ == "__main__":
    # Example usage
    helper = IdentityHelper()
    
    # List all providers
    print("=" * 60)
    helper.list_all_credential_providers()
    
    # Get ExchangeRate API key
    print("\n" + "=" * 60)
    api_key = helper.get_exchangerate_api_key()
    if api_key:
        print(f"✅ ExchangeRate API Key retrieved successfully")
