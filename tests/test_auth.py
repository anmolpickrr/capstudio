"""Google sign-in: only company accounts get in, and only to their own jobs."""
import urllib.parse

import httpx
import pytest
from fastapi.testclient import TestClient

from server import auth, main


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("AUTH_DISABLED", raising=False)
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "cid.apps.googleusercontent.com")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "secret")
    monkeypatch.setenv("ALLOWED_EMAIL_DOMAINS", "pickrr.com, shiprocket.com")
    monkeypatch.setenv("PUBLIC_URL", "https://captions.example")
    with TestClient(main.app, base_url="https://captions.example") as c:
        yield c


def sign_in(client, monkeypatch, email, verified=True):
    r = client.get("/auth/login", follow_redirects=False)
    google = urllib.parse.urlparse(r.headers["location"])
    params = urllib.parse.parse_qs(google.query)
    assert google.netloc == "accounts.google.com"
    assert params["redirect_uri"] == ["https://captions.example/auth/callback"]
    monkeypatch.setattr(auth.httpx, "post", lambda url, **kw: httpx.Response(
        200, json={"access_token": "t"}, request=httpx.Request("POST", url)))
    monkeypatch.setattr(auth.httpx, "get", lambda url, **kw: httpx.Response(
        200, json={"email": email, "email_verified": verified, "name": "Test"},
        request=httpx.Request("GET", url)))
    return client.get(f"/auth/callback?code=abc&state={params['state'][0]}", follow_redirects=False)


def test_signed_out_users_are_sent_to_login(client):
    assert client.get("/", follow_redirects=False).headers["location"] == "/login"
    assert client.get("/api/config").status_code == 401
    assert client.get("/login").status_code == 200
    assert client.get("/api/health").status_code == 200


@pytest.mark.parametrize("email", ["anmol@pickrr.com", "someone@Shiprocket.com"])
def test_company_accounts_can_sign_in(client, monkeypatch, email):
    r = sign_in(client, monkeypatch, email)
    assert r.headers["location"] == "/"
    assert client.get("/api/me").json()["email"] == email
    assert client.get("/api/config").status_code == 200


@pytest.mark.parametrize("email,verified", [("someone@gmail.com", True), ("x@pickrr.com.evil.io", True),
                                            ("anmol@pickrr.com", False)])
def test_other_accounts_are_refused(client, monkeypatch, email, verified):
    r = sign_in(client, monkeypatch, email, verified)
    assert "error=not_allowed" in r.headers["location"]
    assert client.get("/api/config").status_code == 401


def test_forged_state_is_rejected(client):
    r = client.get("/auth/callback?code=abc&state=forged", follow_redirects=False)
    assert "error=expired" in r.headers["location"]


def test_logout(client, monkeypatch):
    sign_in(client, monkeypatch, "anmol@pickrr.com")
    client.get("/auth/logout", follow_redirects=False)
    assert client.get("/api/config").status_code == 401


def test_jobs_are_private_to_their_owner(client, monkeypatch, tmp_path):
    job = main.Job(id="d" * 32, dir=tmp_path, name="v.mp4", source=tmp_path / "v.mp4", owner="a@pickrr.com")
    main.jobs[job.id] = job
    try:
        sign_in(client, monkeypatch, "b@pickrr.com")
        assert client.get(f"/api/jobs/{job.id}").status_code == 404
        client.get("/auth/logout")
        sign_in(client, monkeypatch, "a@pickrr.com")
        assert client.get(f"/api/jobs/{job.id}").status_code == 200
    finally:
        main.jobs.pop(job.id, None)


@pytest.mark.parametrize("client_id", [None, "later"])
def test_unconfigured_sign_in_explains_itself(client, monkeypatch, client_id):
    if client_id is None:
        monkeypatch.delenv("GOOGLE_CLIENT_ID")
    else:  # a placeholder typed during setup
        monkeypatch.setenv("GOOGLE_CLIENT_ID", client_id)
    r = client.get("/auth/login", follow_redirects=False)
    assert "error=not_configured" in r.headers["location"]
    assert client.get("/auth/status").json()["configured"] is False
