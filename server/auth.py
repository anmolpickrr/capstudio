"""Google sign-in, limited to company email domains.

Configuration (environment variables / Hugging Face Space secrets):
  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET  OAuth client from Google Cloud
  ALLOWED_EMAIL_DOMAINS                   e.g. "pickrr.com,shiprocket.com"
  ALLOWED_EMAILS                          optional extra individual addresses
  SESSION_SECRET                          signs the login cookie (random if unset,
                                          which signs everyone out on restart)
  PUBLIC_URL                              e.g. https://team-caption-panel.hf.space
                                          (defaults to the Space's own address)
  AUTH_DISABLED=1                         no sign-in (local development, tests, or an open site)
"""
from __future__ import annotations

import hashlib
import logging
import os
import secrets
import urllib.parse

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, RedirectResponse

log = logging.getLogger("captions.auth")

GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo"

# Reachable without signing in.
PUBLIC_PREFIXES = ("/login", "/auth/", "/api/health", "/css/", "/favicon", "/logo.svg", "/fonts/", "/premiere/")

router = APIRouter()
# A stable secret keeps people signed in across restarts. Derived from the Google
# client secret when not set explicitly; random (sign-out on restart) otherwise.
SESSION_SECRET = (os.environ.get("SESSION_SECRET")
                  or (hashlib.sha256(b"caption-panel-session:" + os.environ["GOOGLE_CLIENT_SECRET"].encode()).hexdigest()
                      if os.environ.get("GOOGLE_CLIENT_SECRET") else secrets.token_urlsafe(32)))


def disabled() -> bool:
    return os.environ.get("AUTH_DISABLED") == "1"


def configured() -> bool:
    # A placeholder (e.g. "later", typed while setting up the host) counts as not set up.
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
    return client_id.endswith(".apps.googleusercontent.com") and bool(os.environ.get("GOOGLE_CLIENT_SECRET"))


def allowed_domains() -> list[str]:
    return [d.strip().lower().lstrip("@") for d in os.environ.get("ALLOWED_EMAIL_DOMAINS", "").split(",")
            if d.strip()]


def is_allowed(email: str) -> bool:
    email = email.lower()
    extra = {e.strip().lower() for e in os.environ.get("ALLOWED_EMAILS", "").split(",") if e.strip()}
    return email in extra or email.rsplit("@", 1)[-1] in allowed_domains()


def public_url(request: Request) -> str:
    if os.environ.get("PUBLIC_URL"):
        return os.environ["PUBLIC_URL"].rstrip("/")
    if os.environ.get("RENDER_EXTERNAL_URL"):  # set by Render
        return os.environ["RENDER_EXTERNAL_URL"].rstrip("/")
    if os.environ.get("SPACE_HOST"):  # set by Hugging Face Spaces
        return f"https://{os.environ['SPACE_HOST']}"
    return str(request.base_url).rstrip("/")


def current_user(request: Request) -> dict | None:
    if disabled():
        return {"email": "local@localhost", "name": "Local user", "picture": None}
    return request.session.get("user")


def is_public(path: str) -> bool:
    return path in ("/login", "/login.html") or path.startswith(PUBLIC_PREFIXES)


async def guard(request: Request, call_next):
    """Middleware: everything except the login flow needs a signed-in user."""
    if disabled() or is_public(request.url.path) or current_user(request):
        return await call_next(request)
    if request.url.path.startswith("/api/"):
        return JSONResponse({"detail": "Please sign in again."}, status_code=401)
    return RedirectResponse("/login")


def _login_redirect(error: str) -> RedirectResponse:
    return RedirectResponse("/login?" + urllib.parse.urlencode({"error": error}))


@router.get("/auth/status")
def auth_status():
    return {"configured": configured() or disabled(), "domains": allowed_domains()}


@router.get("/auth/login")
def login(request: Request):
    if not configured():
        return _login_redirect("not_configured")
    state = secrets.token_urlsafe(24)
    request.session["oauth_state"] = state
    params = {
        "client_id": os.environ["GOOGLE_CLIENT_ID"],
        "redirect_uri": public_url(request) + "/auth/callback",
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "prompt": "select_account",
    }
    domains = allowed_domains()
    if len(domains) == 1:
        params["hd"] = domains[0]  # pre-selects the company account
    return RedirectResponse(f"{GOOGLE_AUTH}?{urllib.parse.urlencode(params)}")


@router.get("/auth/callback")
def callback(request: Request, code: str = "", state: str = "", error: str = ""):
    expected = request.session.pop("oauth_state", None)
    if error:
        return _login_redirect("cancelled")
    if not code or not expected or not secrets.compare_digest(state, expected):
        return _login_redirect("expired")
    try:
        token = httpx.post(GOOGLE_TOKEN, data={
            "code": code,
            "client_id": os.environ["GOOGLE_CLIENT_ID"],
            "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
            "redirect_uri": public_url(request) + "/auth/callback",
            "grant_type": "authorization_code",
        }, timeout=20)
        token.raise_for_status()
        info = httpx.get(GOOGLE_USERINFO, headers={
            "Authorization": f"Bearer {token.json()['access_token']}"}, timeout=20)
        info.raise_for_status()
        user = info.json()
    except (httpx.HTTPError, KeyError, ValueError):
        log.exception("Google sign-in failed")
        return _login_redirect("google_error")
    email = user.get("email", "")
    if not user.get("email_verified") or not is_allowed(email):
        log.info("sign-in refused for a non-company account")
        return _login_redirect("not_allowed")
    request.session["user"] = {"email": email, "name": user.get("name") or email,
                               "picture": user.get("picture")}
    log.info("user signed in")
    return RedirectResponse("/")


@router.get("/auth/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/login")


@router.get("/api/me")
def me(request: Request):
    return current_user(request)
