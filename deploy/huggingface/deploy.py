"""Publishes the app to a Hugging Face Space. Run by GitHub Actions on every push.

Reads (GitHub repository secrets, passed in as environment variables):
  HF_TOKEN                     Hugging Face access token with "write" permission (required)
  GROQ_API_KEY                 caption engine key
  GOOGLE_CLIENT_ID / _SECRET   Google sign-in
  HF_SPACE                     optional "owner/name"; defaults to <your username>/caption-panel

Creates the Space if needed, copies the keys into the Space's secrets, uploads
the app, and writes the site address and remaining setup steps to the run summary.
"""
from __future__ import annotations

import os
import pathlib
import re
import shutil
import sys
import tempfile

from huggingface_hub import HfApi

ROOT = pathlib.Path(__file__).resolve().parents[2]
SECRETS = ("GROQ_API_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SESSION_SECRET")


def summary(text: str) -> None:
    print(text)
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(text + "\n")


def build_folder(dest: pathlib.Path) -> None:
    for item in ("server", "static", "fonts", "scripts", "requirements.txt"):
        src = ROOT / item
        if src.is_dir():
            shutil.copytree(src, dest / item, ignore=shutil.ignore_patterns("__pycache__"))
        else:
            shutil.copy2(src, dest / item)
    shutil.copy2(ROOT / "deploy/huggingface/Dockerfile", dest / "Dockerfile")
    shutil.copy2(ROOT / "deploy/huggingface/README.md", dest / "README.md")


def space_host(api: HfApi, space: str) -> str:
    host = getattr(api.space_info(space), "host", None)
    if host:
        return host.removeprefix("https://")
    return re.sub(r"[^a-z0-9]+", "-", space.lower()) + ".hf.space"


def explain(err: Exception) -> str:
    """A plain-English reason for a failed deploy (shown on the run's page)."""
    status = getattr(getattr(err, "response", None), "status_code", None)
    detail = str(err).splitlines()[0][:300] if str(err) else type(err).__name__
    if status == 401:
        return ("Hugging Face rejected the HF_TOKEN secret (it's invalid or was deleted). "
                "Create a new token with the Write role at huggingface.co/settings/tokens "
                "and replace the HF_TOKEN secret in GitHub.")
    if status == 403:
        return ("The HF_TOKEN secret doesn't have permission to create or update the Space. "
                "Create a new token with the Write role (not Read or Fine-grained) at "
                "huggingface.co/settings/tokens and replace the HF_TOKEN secret in GitHub. "
                f"Details: {detail}")
    if status == 409:
        return f"A Space with this name already exists under another account. Details: {detail}"
    return f"Deploy failed: {detail}"


def main() -> int:
    try:
        return deploy()
    except Exception as err:  # report clearly instead of a bare traceback
        import traceback
        traceback.print_exc()
        message = explain(err)
        print(f"::error title=Deploy to Hugging Face failed::{message}")
        summary(f"## ❌ Not deployed\n\n{message}")
        return 1


def deploy() -> int:
    token = os.environ.get("HF_TOKEN")
    if not token:
        # Not set up yet: finish quietly instead of failing every push.
        summary("⏸️ **Not deployed yet:** the `HF_TOKEN` secret hasn't been added. "
                "Add it in GitHub → Settings → Secrets and variables → Actions, then re-run this workflow.")
        return 0
    api = HfApi(token=token)
    space = os.environ.get("HF_SPACE") or f"{api.whoami()['name']}/caption-panel"
    api.create_repo(space, repo_type="space", space_sdk="docker", private=False, exist_ok=True)

    missing = []
    for key in SECRETS:
        if os.environ.get(key):
            api.add_space_secret(space, key, os.environ[key])
        elif key != "SESSION_SECRET":
            missing.append(key)

    with tempfile.TemporaryDirectory() as tmp:
        folder = pathlib.Path(tmp)
        build_folder(folder)
        api.upload_folder(folder_path=str(folder), repo_id=space, repo_type="space",
                          commit_message=f"Deploy {os.environ.get('GITHUB_SHA', 'local')[:7]}",
                          delete_patterns=["*"])

    host = space_host(api, space)
    summary(f"## ✅ Deployed to Hugging Face\n\n"
            f"- **Website for your team:** https://{host}\n"
            f"- Build progress & logs: https://huggingface.co/spaces/{space}\n"
            f"- Google sign-in *Authorized redirect URI*: `https://{host}/auth/callback`\n"
            f"- The first build takes about 10 minutes.\n")
    if missing:
        summary("⚠️ Still missing (add as GitHub secrets, then re-run this workflow): "
                + ", ".join(f"`{m}`" for m in missing))
    return 0


if __name__ == "__main__":
    sys.exit(main())
