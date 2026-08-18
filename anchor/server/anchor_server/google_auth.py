"""One-time Google OAuth bootstrap: writes the refresh token used by
gcal.py / people.py. Run on the server; it prints a URL to open anywhere.

    /opt/anchor/venv/bin/python -m anchor_server.google_auth
"""

from __future__ import annotations

from . import config
from .gcal import SCOPES


def main() -> None:
    from google_auth_oauthlib.flow import InstalledAppFlow

    scopes = list(SCOPES)
    if config.GMAIL_ENABLED:
        from .gmail_ingest import GMAIL_SCOPE

        scopes.append(GMAIL_SCOPE)
    flow = InstalledAppFlow.from_client_secrets_file(config.GOOGLE_CLIENT_SECRETS, scopes)
    # Console-style flow: server has no browser. Opens a local port; if you
    # are ssh'd in, forward it: ssh -L 8399:localhost:8399 <server>
    creds = flow.run_local_server(port=8399, open_browser=False)
    with open(config.GOOGLE_TOKEN_PATH, "w") as f:
        f.write(creds.to_json())
    print(f"Wrote {config.GOOGLE_TOKEN_PATH}. Calendar + People access is ready.")


if __name__ == "__main__":
    main()
