#!/usr/bin/env python3
"""Render the standalone site using Cinnabar's original artwork and release filenames."""

import argparse
import json
import os
from pathlib import Path
import random
import shutil
import subprocess
import tempfile
from urllib.parse import quote
import xml.etree.ElementTree as ET

from source import CHECKOUT, load_config
from mdbook import binary


HERE = Path(__file__).resolve().parent
INPUTS = load_config()["inputs"]


def build_book(repository, output, red, header):
    """Build the pinned book with site-owned styling without changing its source."""
    book = repository / INPUTS["modding"]
    if not (book / "book.toml").is_file():
        raise FileNotFoundError("The pinned client inputs must contain docs/modding/book.toml")
    executable = binary()
    destination = output.resolve() / "docs" / "modding"
    with tempfile.TemporaryDirectory() as temporary:
        staged = Path(temporary) / "book"
        shutil.copytree(book, staged)
        theme = staged / "theme"
        shutil.copytree(HERE / "docs-theme", theme, dirs_exist_ok=True)
        shutil.copyfile(repository / INPUTS["icon"], theme / "favicon.svg")
        stylesheet = theme / "cinnabar.css"
        stylesheet.write_text((HERE / "site-header.css").read_text()
                              + stylesheet.read_text().replace("@@RED@@", red))
        (theme / "header.hbs").write_text(header.replace("@@DOCS_CURRENT@@", ' aria-current="page"'))
        environment = dict(os.environ, **{
            "MDBOOK_OUTPUT__HTML__THEME": "theme",
            "MDBOOK_OUTPUT__HTML__ADDITIONAL_CSS": '["theme/cinnabar.css"]',
            "MDBOOK_OUTPUT__HTML__DEFAULT_THEME": "navy",
            "MDBOOK_OUTPUT__HTML__PREFERRED_DARK_THEME": "navy",
            "MDBOOK_OUTPUT__HTML__NO_SECTION_LABEL": "true",
            "MDBOOK_OUTPUT__HTML__PRINT": '{"enable":false}',
            "MDBOOK_OUTPUT__HTML__SITE_URL": "/docs/modding/",
        })
        if destination.exists():
            shutil.rmtree(destination)
        subprocess.run([str(executable), "build", str(staged), "--dest-dir", str(destination)],
                       env=environment, check=True)


def build(repository, output):
    """Render site files from the declared inputs in a client checkout."""
    config = json.loads((repository / INPUTS["release_manifest"]).read_text())
    repository_url = "https://github.com/" + config["repository"]
    config["release_url"] = repository_url + "/releases/latest"
    config["download_base"] = config["release_url"] + "/download/"
    config["install_command"] = (
        f'curl -fsSL {config["download_base"]}{config["install_script"]} | sh'
    )
    config["nightly_base"] = repository_url + "/releases/download/nightly/"
    config["nightly_install_command"] = config["install_command"] + " -s -- --channel nightly"
    contract = json.loads((repository / INPUTS["api_contract"]).read_text())
    api_origin = next(value["value"] for value in contract["constants"]
                      if value["rust_name"] == "CINNABAR_API_BASE_URL")
    config["online_count_url"] = api_origin.rstrip("/") + "/v1/presence/count"
    config["online_history_url"] = api_origin.rstrip("/") + "/v1/presence/history"
    icon = (repository / INPUTS["icon"]).read_text()
    red = ET.fromstring(icon).find("{http://www.w3.org/2000/svg}rect").attrib["fill"]
    header = (HERE / "site-header.html.in").read_text()
    header = header.replace("@@DISCORD_MARK@@", (repository / INPUTS["discord_mark"]).read_text().strip())
    header = header.replace("@@FAVICON@@", "data:image/svg+xml," + quote(icon, safe=""))
    header = header.replace("@@REPOSITORY_URL@@", repository_url)
    page = (HERE / "index.html.in").read_text()
    page = page.replace("@@SITE_HEADER@@", header.replace("@@DOCS_CURRENT@@", ""))
    page = page.replace("@@SITE_HEADER_STYLES@@", (HERE / "site-header.css").read_text())
    page = page.replace("@@RED@@", red)
    page = page.replace("@@FAVICON@@", "data:image/svg+xml," + quote(icon, safe=""))
    output.mkdir(parents=True, exist_ok=True)
    (output / "index.html").write_text(page)
    (output / "downloads.js").write_text("window.CINNABAR_DOWNLOADS = " + json.dumps(config) + ";\n")
    shutil.copyfile(HERE / "app.js", output / "app.js")
    shutil.copyfile(HERE / "presence.js", output / "presence.js")
    shutil.copyfile(HERE / "history.js", output / "history.js")
    shutil.copyfile(repository / INPUTS["title"], output / "title.png")
    rng = random.Random(27)
    colors = ["#1c221d", "#202620", "#242a23", "#262d25", "#1f251f"]
    pixels = "".join(
        f'<rect x="{x}" y="{y}" width="16" height="16" fill="{rng.choice(colors)}"/>'
        for y in range(0, 256, 16) for x in range(0, 256, 16)
    )
    (output / "texture.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">' + pixels + "</svg>"
    )
    build_book(repository, output, red, header)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=CHECKOUT)
    parser.add_argument("--output", type=Path, default=HERE / "dist")
    args = parser.parse_args()
    build(args.source, args.output)
