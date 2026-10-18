"""The Hugging Face deploy script, against a stand-in for the Hugging Face API."""
import importlib.util
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("deploy", ROOT / "deploy/huggingface/deploy.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class FakeApi:
    def __init__(self, token):
        self.calls, self.uploaded = [], set()

    def whoami(self):
        return {"name": "anmolpickrr"}

    def create_repo(self, repo_id, **kw):
        self.calls.append(("create", repo_id, kw["space_sdk"]))

    def add_space_secret(self, repo_id, key, value):
        self.calls.append(("secret", key))

    def upload_folder(self, folder_path, repo_id, **kw):
        self.uploaded = {str(p.relative_to(folder_path)) for p in pathlib.Path(folder_path).rglob("*")
                         if p.is_file()}

    def space_info(self, repo_id):
        return type("Info", (), {"host": "https://anmolpickrr-caption-panel.hf.space"})()


def test_deploy_creates_space_sets_secrets_and_uploads(monkeypatch, tmp_path):
    api = FakeApi("t")
    monkeypatch.setattr(deploy, "HfApi", lambda token: api)
    monkeypatch.setenv("HF_TOKEN", "t")
    monkeypatch.setenv("GROQ_API_KEY", "g")
    monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
    monkeypatch.delenv("HF_SPACE", raising=False)
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))

    assert deploy.main() == 0
    assert ("create", "anmolpickrr/caption-panel", "docker") in api.calls
    assert ("secret", "GROQ_API_KEY") in api.calls
    assert {"Dockerfile", "README.md", "requirements.txt", "server/main.py", "static/index.html",
            "static/login.html", "scripts/fetch_fonts.py"} <= api.uploaded
    assert "fonts/families.json" in api.uploaded and any(p.endswith(".ttf") for p in api.uploaded)
    assert "static/js/app/showcase.js" in api.uploaded
    text = summary.read_text()
    assert "https://anmolpickrr-caption-panel.hf.space/auth/callback" in text
    assert "GOOGLE_CLIENT_ID" in text  # reported as still missing


def test_missing_token_skips_quietly(monkeypatch, tmp_path):
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(tmp_path / "s.md"))
    assert deploy.main() == 0
    assert "HF_TOKEN" in (tmp_path / "s.md").read_text()
