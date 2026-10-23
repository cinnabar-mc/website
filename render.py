#!/usr/bin/env python3
"""Render the standalone site using Cinnabar's original artwork and release filenames."""

import argparse
import json
from pathlib import Path
import random
import shutil
from urllib.parse import quote
import xml.etree.ElementTree as ET

from source import CHECKOUT, load_config


HERE = Path(__file__).resolve().parent
INPUTS = load_config()["inputs"]

SITE_URL = "https://cinnabar.gg/"
SITE_TITLE = "Cinnabar — Minecraft Bedrock Client"
SITE_DESCRIPTION = (
    "A fast, independent Minecraft: Bedrock Edition client built from scratch in Rust."
)
DISCORD_URL = "https://discord.gg/F8gUKvuaAj"


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
    social_icon_url = SITE_URL + "icon.png"
    component_embed = {
        "component": {
            "accent_color": int(red.removeprefix("#"), 16),
            "components": [
                {
                    "accessory": {
                        "description": "Cinnabar",
                        "media": {"url": social_icon_url},
                        "type": 11,
                    },
                    "components": [{
                        "content": (
                            f"# [Cinnabar]({SITE_URL})\n"
                            f"{SITE_DESCRIPTION}"
                        ),
                        "type": 10,
                    }],
                    "type": 9,
                },
                {"content": "-# A familiar world. A new client.", "type": 10},
                {"spacing": 1, "type": 14},
                {
                    "components": [
                        {
                            "label": "Download",
                            "style": 5,
                            "type": 2,
                            "url": config["release_url"],
                        },
                        {
                            "label": "GitHub",
                            "style": 5,
                            "type": 2,
                            "url": repository_url,
                        },
                        {
                            "label": "Discord",
                            "style": 5,
                            "type": 2,
                            "url": DISCORD_URL,
                        },
                    ],
                    "type": 1,
                },
            ],
            "type": 17,
        }
    }
    page = (HERE / "index.html.in").read_text()
    page = page.replace("@@DISCORD_MARK@@", (repository / INPUTS["discord_mark"]).read_text().strip())
    page = page.replace("@@RED@@", red)
    page = page.replace("@@FAVICON@@", "data:image/svg+xml," + quote(icon, safe=""))
    page = page.replace("@@REPOSITORY_URL@@", repository_url)
    page = page.replace("@@SITE_URL@@", SITE_URL)
    page = page.replace("@@SOCIAL_ICON_URL@@", social_icon_url)
    page = page.replace("@@SOCIAL_TITLE@@", SITE_TITLE)
    page = page.replace("@@SOCIAL_DESCRIPTION@@", SITE_DESCRIPTION)
    page = page.replace("@@DISCORD_URL@@", DISCORD_URL)
    page = page.replace(
        "@@COMPONENT_EMBED@@",
        json.dumps(component_embed, separators=(",", ":")).replace("</", "<\\/"),
    )
    output.mkdir(parents=True, exist_ok=True)
    (output / "index.html").write_text(page)
    (output / "downloads.js").write_text("window.CINNABAR_DOWNLOADS = " + json.dumps(config) + ";\n")
    shutil.copyfile(HERE / "app.js", output / "app.js")
    shutil.copyfile(HERE / "presence.js", output / "presence.js")
    shutil.copyfile(HERE / "history.js", output / "history.js")
    shutil.copyfile(repository / INPUTS["title"], output / "title.png")
    shutil.copyfile(repository / INPUTS["social_icon"], output / "icon.png")
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
    args = parser.parse_args()
    build(args.source, args.output)
