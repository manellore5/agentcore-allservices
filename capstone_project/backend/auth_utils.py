"""
Authentication utilities for Cognito integration
"""
import boto3
import base64
import hashlib
import hmac
import requests

def reauthenticate_user(client_id, username="testuser", password="MyPassword123!"):
    """
    Authenticate user with Cognito and get access token
    """
    try:
        # Load cognito config
        import json
        with open('../notebooks/environments/cognito_config.json', 'r') as f:
            config = json.load(f)
        
        client_secret = config['client_info']['client_secret']
        
        # Calculate secret hash
        message = username + client_id
        secret_hash = base64.b64encode(
            hmac.new(
                client_secret.encode(),
                message.encode(),
                digestmod=hashlib.sha256
            ).digest()
        ).decode()
        
        # Authenticate with Cognito
        cognito_client = boto3.client('cognito-idp')
        
        response = cognito_client.initiate_auth(
            ClientId=client_id,
            AuthFlow='USER_PASSWORD_AUTH',
            AuthParameters={
                'USERNAME': username,
                'PASSWORD': password,
                'SECRET_HASH': secret_hash
            }
        )
        
        return response['AuthenticationResult']['AccessToken']
        
    except Exception as e:
        print(f"Authentication failed: {e}")
        return None