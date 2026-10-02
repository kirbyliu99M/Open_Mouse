"""Write published JSON with the repository's pinned Prettier formatter."""

import json
from pathlib import Path
import shutil
import subprocess


PRETTIER = Path(__file__).resolve().parents[2] / "node_modules/prettier/bin/prettier.cjs"


def write_pretty_json(path: Path, value: object) -> None:
    if not PRETTIER.is_file():
        raise RuntimeError("Run npm ci before generating published JSON")
    node = shutil.which("node")
    if node is None:
        raise RuntimeError("Node.js is required to format published JSON")
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    subprocess.run([node, str(PRETTIER), "--write", str(path)], check=True)
