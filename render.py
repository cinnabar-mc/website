#!/usr/bin/env python3
"""Render the standalone site using Cinnabar's original artwork and release filenames."""

import argparse
import json
from pathlib import Path
import random
import re
import subprocess
import shutil
from urllib.parse import quote
import xml.etree.ElementTree as ET

from source import CHECKOUT, load_config


HERE = Path(__file__).resolve().parent
INPUTS = load_config()["inputs"]


def capability_descriptors(text):
    """Extract the pinned client's declarative fields, failing on unsupported types."""
    body = text.split("grants! {", 1)[1].split("\n}", 1)[0]
    pattern = r'(?:\s*///[^\n]*\n)+\s*#\[permission\(("(?:[^"\\]|\\.)*"), (true|false)\)\]\s*pub (\w+): ([^,]+),'
    result = []
    for match in re.finditer(pattern, body):
        label, sensitive, name, kind = match.groups()
        if kind not in {"bool", "Vec<String>"}:
            raise ValueError("unsupported grant type: " + kind)
        docs = " ".join(re.findall(r'///\s*(.*)', match.group(0)))
        result.append({"name": name, "label": json.loads(label), "description": docs,
                       "sensitive": sensitive == "true", "type": "commands" if kind == "Vec<String>" else "boolean"})
    if not result or len(result) != len(re.findall(r'pub \w+:', body)):
        raise ValueError("client capability declarations changed; update the extractor")
    return result


def build(repository, output, marketplace_backend="http"):
    """Render site files from the declared inputs in a client checkout."""
    config = json.loads((repository / INPUTS["release_manifest"]).read_text(encoding="utf-8"))
    repository_url = "https://github.com/" + config["repository"]
    config["release_url"] = repository_url + "/releases/latest"
    config["download_base"] = config["release_url"] + "/download/"
    config["install_command"] = (
        f'curl -fsSL {config["download_base"]}{config["install_script"]} | sh'
    )
    config["nightly_base"] = repository_url + "/releases/download/nightly/"
    config["nightly_install_command"] = config["install_command"] + " -s -- --channel nightly"
    contract = json.loads((repository / INPUTS["api_contract"]).read_text(encoding="utf-8"))
    api_origin = next(value["value"] for value in contract["constants"]
                      if value["rust_name"] == "CINNABAR_API_BASE_URL")
    config["online_count_url"] = api_origin.rstrip("/") + "/v1/presence/count"
    config["online_history_url"] = api_origin.rstrip("/") + "/v1/presence/history"
    if marketplace_backend not in {"http", "mock"}:
        raise ValueError("marketplace backend must be http or mock")
    config["marketplace"] = {"api_url": api_origin.rstrip("/") + "/v1", "backend": marketplace_backend}
    capabilities = capability_descriptors((repository / INPUTS["mod_grants"]).read_text(encoding="utf-8"))
    icon = (repository / INPUTS["icon"]).read_text(encoding="utf-8")
    red = ET.fromstring(icon).find("{http://www.w3.org/2000/svg}rect").attrib["fill"]
    replacements = {
        "@@DISCORD_MARK@@": (repository / INPUTS["discord_mark"]).read_text(encoding="utf-8").strip(),
        "@@RED@@": red,
        "@@FAVICON@@": "data:image/svg+xml," + quote(icon, safe=""),
        "@@REPOSITORY_URL@@": repository_url,
    }
    output.mkdir(parents=True, exist_ok=True)
    header = (HERE / "site-header.html.in").read_text(encoding="utf-8")
    for template, target in (("index.html.in", "index.html"), ("mods.html.in", "mods/index.html")):
        page = (HERE / template).read_text(encoding="utf-8").replace("@@SITE_HEADER@@", header)
        page = page.replace("@@MARKETPLACE_CURRENT@@", ' aria-current="page"' if target.startswith("mods/") else "")
        for marker, value in replacements.items():
            page = page.replace(marker, value)
        destination = output / target
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(page, encoding="utf-8")
    for stylesheet in ("site.css", "marketplace.css"):
        (output / stylesheet).write_text((HERE / stylesheet).read_text(encoding="utf-8").replace("@@RED@@", red), encoding="utf-8")
    serialized = json.dumps(capabilities, ensure_ascii=True)
    (output / "marketplace-capabilities.js").write_text(
        '(function(data){if(typeof module!=="undefined"&&module.exports)module.exports=data;'
        'else window.CinnabarCapabilities=data;})(' + serialized + ');\n', encoding="utf-8")
    # Both route spellings serve the same hash application, preserving existing preview links.
    (output / "marketplace").mkdir(exist_ok=True)
    shutil.copyfile(output / "mods/index.html", output / "marketplace/index.html")
    for script in ("marketplace-core.js", "marketplace-mock.js", "marketplace-http.js",
                   "marketplace-content.js", "marketplace-validation.js", "marketplace.js"):
        shutil.copyfile(HERE / script, output / script)
    subprocess.run(["node", str(HERE / "build-validator.mjs"), str(output / "validator")], check=True)
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


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=CHECKOUT)
    parser.add_argument("--output", type=Path, default=HERE / "dist")
    parser.add_argument("--marketplace-backend", choices=("http", "mock"), default="http",
                        help="use mock only for an explicitly labelled local preview")
    args = parser.parse_args()
    build(args.source, args.output, args.marketplace_backend)
