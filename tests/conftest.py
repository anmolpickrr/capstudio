import os
import pathlib
import sys
import tempfile

# Point the app at a throwaway data folder before it is imported.
os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="caption-panel-test-"))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
