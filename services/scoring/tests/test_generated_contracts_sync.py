"""Confirms contracts_gen.py is in sync with the committed OpenAPI contract.

Regenerates the Pydantic models via datamodel-code-generator and asserts the
committed file is byte-identical — the frozen-boundary drift check.
"""

import subprocess
from pathlib import Path

SCORING_DIR = Path(__file__).resolve().parents[1]
GEN = SCORING_DIR / "src" / "scoring" / "contracts_gen.py"
OPENAPI = SCORING_DIR.parents[1] / "packages" / "contracts" / "openapi.json"  # repo root


def test_generated_models_exist_and_match_openapi(tmp_path: Path) -> None:
    assert OPENAPI.exists(), f"missing {OPENAPI} — run 'npm run contracts:openapi'"
    assert GEN.exists(), f"missing {GEN} — run 'npm run contracts:pydantic'"

    out = tmp_path / "contracts_gen.py"
    # Invoke the exact same CLI as scripts/gen-pydantic.sh so the comparison is
    # apples-to-apples (the `-m` module entry point formats differently).
    subprocess.run(
        [
            "uv",
            "run",
            "datamodel-codegen",
            "--input",
            str(OPENAPI),
            "--input-file-type",
            "openapi",
            "--output",
            str(out),
            "--output-model-type",
            "pydantic_v2.BaseModel",
            "--target-python-version",
            "3.12",
            "--use-schema-description",
            "--formatters",
            "builtin",
            "--disable-timestamp",
        ],
        check=True,
        cwd=SCORING_DIR,
    )
    assert out.read_text() == GEN.read_text(), (
        "contracts_gen.py drifted from openapi.json — run 'npm run contracts:pydantic'"
    )
