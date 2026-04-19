#!/usr/bin/env python3
"""
OAuth2 Callback Server for Google Drive Integration
Handles OAuth2 3-legged authentication flow with AgentCore Identity
"""

import time
import uvicorn
import logging
import argparse
import requests

from datetime import timedelta
from fastapi import FastAPI, HTTPException, status
from fastapi.responses import HTMLResponse
from bedrock_agentcore.services.identity import IdentityClient, UserTokenIdentifier

# Configuration constants
OAUTH2_CALLBACK_SERVER_PORT = 9090
PING_ENDPOINT = "/ping"
OAUTH2_CALLBACK_ENDPOINT = "/oauth2/callback"
USER_IDENTIFIER_ENDPOINT = "/userIdentifier/token"

logger = logging.getLogger(__name__)

class OAuth2CallbackServer:
    def __init__(self, region: str):
        self.identity_client = IdentityClient(region=region)
        self.user_token_identifier = None
        self.app = FastAPI()
        self._setup_routes()

    def _setup_routes(self):
        @self.app.post(USER_IDENTIFIER_ENDPOINT)
        async def _store_user_token(user_token_identifier_value: UserTokenIdentifier):
            self.user_token_identifier = user_token_identifier_value

        @self.app.get(PING_ENDPOINT)
        async def _handle_ping():
            return {"status": "success"}

        @self.app.get(OAUTH2_CALLBACK_ENDPOINT)
        async def _handle_oauth2_callback(session_id: str):
            if not session_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Missing session_id query parameter",
                )

            if not self.user_token_identifier:
                logger.error("No configured user token identifier")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Internal Server Error",
                )

            self.identity_client.complete_resource_token_auth(
                session_uri=session_id, user_identifier=self.user_token_identifier
            )

            html_content = """
            <!DOCTYPE html>
            <html>
            <head>
                <title>OAuth2 Success</title>
                <style>
                    body {
                        margin: 0; padding: 0; height: 100vh;
                        display: flex; justify-content: center; align-items: center;
                        font-family: Arial, sans-serif; background-color: #f5f5f5;
                    }
                    .container {
                        text-align: center; padding: 2rem; background-color: white;
                        border-radius: 8px; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
                    }
                    h1 { color: #28a745; margin: 0; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>✅ Google Drive OAuth2 Authorization Successful!</h1>
                    <p>You can now close this window and return to the application.</p>
                </div>
            </body>
            </html>
            """
            return HTMLResponse(content=html_content, status_code=200)

    def get_app(self) -> FastAPI:
        return self.app

def get_oauth2_callback_url() -> str:
    return f"http://localhost:{OAUTH2_CALLBACK_SERVER_PORT}{OAUTH2_CALLBACK_ENDPOINT}"

def store_token_in_oauth2_callback_server(user_token_value: str):
    if user_token_value:
        requests.post(
            f"http://localhost:{OAUTH2_CALLBACK_SERVER_PORT}{USER_IDENTIFIER_ENDPOINT}",
            json={"user_token": user_token_value},
            timeout=2,
        )

def wait_for_oauth2_server_to_be_ready(duration: timedelta = timedelta(seconds=40)) -> bool:
    timeout_in_seconds = duration.seconds
    start_time = time.time()
    
    while time.time() - start_time < timeout_in_seconds:
        try:
            response = requests.get(
                f"http://localhost:{OAUTH2_CALLBACK_SERVER_PORT}{PING_ENDPOINT}",
                timeout=2,
            )
            if response.status_code == status.HTTP_200_OK:
                return True
        except requests.exceptions.RequestException:
            pass
        time.sleep(2)
    
    return False

def main():
    parser = argparse.ArgumentParser(description="OAuth2 Callback Server")
    parser.add_argument("-r", "--region", type=str, required=True, help="AWS Region")
    args = parser.parse_args()
    
    oauth2_callback_server = OAuth2CallbackServer(region=args.region)
    uvicorn.run(
        oauth2_callback_server.get_app(),
        host="127.0.0.1",
        port=OAUTH2_CALLBACK_SERVER_PORT,
    )

if __name__ == "__main__":
    main()
