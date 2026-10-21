"""Check the standalone site's build and GitHub download contract."""

from html.parser import HTMLParser
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from urllib.parse import urlsplit


SITE = Path(__file__).resolve().parents[1]
SOURCE = SITE / ".source"
SPEC = importlib.util.spec_from_file_location("site_render", SITE / "render.py")
RENDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RENDER)


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts = []
        self.downloads = []
        self.repository = None
        self.elements = []
        self.ancestors = []

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        self.elements.append((tag, attrs, self.ancestors.copy()))
        if tag == "script":
            self.scripts.append(attrs)
        if tag == "a" and "data-release-asset" in attrs:
            self.downloads.append(attrs["data-release-asset"])
        if tag == "a" and attrs.get("class") == "github":
            self.repository = attrs["href"]
        if tag not in {"meta", "link", "img", "input", "br"}:
            self.ancestors.append((tag, attrs))

    def handle_endtag(self, tag):
        """Track enclosing regions so tests can check reading and grouping order."""
        for index in range(len(self.ancestors) - 1, -1, -1):
            if self.ancestors[index][0] == tag:
                del self.ancestors[index:]
                break


class RenderTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.repository = self.root / "source"
        self.output = self.root / "candidate"
        self.config = json.loads((SOURCE / RENDER.INPUTS["release_manifest"]).read_text())
        self.config["repository"] = "fixture/download-contract"
        self.config["website"] = "https://unrelated-site.invalid"
        self.config["install_script"] = "fixture-" + self.config["install_script"]
        self.config["assets"] = {
            platform: {arch: "fixture-" + name for arch, name in arches.items()}
            for platform, arches in self.config["assets"].items()
        }
        self.config["manual_assets"] = {
            platform: {arch: "fixture-" + name for arch, name in arches.items()}
            for platform, arches in self.config["manual_assets"].items()
        }
        for path in (RENDER.INPUTS["icon"], RENDER.INPUTS["title"], RENDER.INPUTS["discord_mark"]):
            target = self.repository / path
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(SOURCE / path, target)
        manifest = self.repository / RENDER.INPUTS["release_manifest"]
        manifest.parent.mkdir(parents=True, exist_ok=True)
        manifest.write_text(json.dumps(self.config))
        contract = self.repository / RENDER.INPUTS["api_contract"]
        contract.parent.mkdir(parents=True, exist_ok=True)
        contract.write_text(json.dumps({"constants": [{
            "rust_name": "CINNABAR_API_BASE_URL", "value": "https://fixture-api.invalid/",
        }]}))

    def config_from_output(self):
        script = (self.output / "downloads.js").read_text()
        return json.loads(script.removeprefix("window.CINNABAR_DOWNLOADS = ").removesuffix(";\n"))

    def test_discord_mark_uses_shared_client_branding(self):
        (self.repository / RENDER.INPUTS["discord_mark"]).write_text("M0 0L1 1Z\n")
        RENDER.build(self.repository, self.output)
        self.assertIn('<path d="M0 0L1 1Z"', (self.output / "index.html").read_text())

    def test_download_guidance_and_player_activity_stay_grouped(self):
        """Keep social navigation separate and presence inside its history region."""
        RENDER.build(self.repository, self.output)
        page = Page()
        page.feed((self.output / "index.html").read_text())
        positions = {}
        for index, (tag, attrs, ancestors) in enumerate(page.elements):
            if attrs.get("class") in {"github", "discord"}:
                self.assertIn("header", [parent for parent, _ in ancestors])
                self.assertNotIn("main", [parent for parent, _ in ancestors])
            key = attrs.get("id") or attrs.get("class")
            if key in {"download", "disclaimer", "online-count", "history-plot"}:
                positions[key] = index
                if key in {"download", "disclaimer"}:
                    self.assertTrue(any(parent.get("class") == "hero" for _, parent in ancestors))
                else:
                    self.assertTrue(any(parent.get("aria-labelledby") == "history-title"
                                        for _, parent in ancestors))
        self.assertEqual(sorted(positions, key=positions.get),
                         ["download", "disclaimer", "online-count", "history-plot"])

    def test_build_requires_only_artwork_and_manifest_and_redirects_to_release_assets(self):
        RENDER.build(self.repository, self.output)
        config = self.config_from_output()
        self.assertEqual(config["online_count_url"], "https://fixture-api.invalid/v1/presence/count")
        self.assertEqual(config["online_history_url"], "https://fixture-api.invalid/v1/presence/history")
        self.assertEqual(config["assets"], self.config["assets"])
        self.assertEqual(config["manual_assets"], self.config["manual_assets"])
        release = urlsplit(config["release_url"])
        self.assertEqual(release.scheme, "https")
        self.assertEqual(release.path, f'/{self.config["repository"]}/releases/latest')
        self.assertEqual(config["download_base"], config["release_url"] + "/download/")
        self.assertEqual(config["install_command"],
                         f'curl -fsSL {config["download_base"]}{self.config["install_script"]} | sh')
        self.assertNotIn(self.config["website"], config["install_command"])
        self.assertEqual(config["nightly_base"],
                         f'https://github.com/{self.config["repository"]}/releases/download/nightly/')
        self.assertEqual(config["nightly_install_command"], config["install_command"] + " -s -- --channel nightly")
        self.assertEqual({path.name for path in self.output.iterdir()}, {
            "index.html", "downloads.js", "app.js", "presence.js", "history.js", "title.png", "texture.svg",
        })
        self.assertFalse((self.output / self.config["install_script"]).exists())

    def test_rendered_page_assets_and_mac_first_open_guidance_are_complete(self):
        RENDER.build(self.repository, self.output)
        html = (self.output / "index.html").read_text()
        self.assertNotIn("@@", html)
        page = Page()
        page.feed(html)
        config = self.config_from_output()
        self.assertEqual(page.repository + "/releases/latest", config["release_url"])
        self.assertEqual([script["src"] for script in page.scripts],
                         ["/downloads.js", "/app.js", "/presence.js", "/history.js"])
        for script in page.scripts:
            self.assertIn("defer", script)
            self.assertTrue((self.output / script["src"].lstrip("/")).is_file())
        for selection in page.downloads:
            platform, architecture = selection.split("/")
            assets = {**config["assets"], **config["manual_assets"]}
            self.assertIn(architecture, assets[platform])
        self.assertIn("android/arm64", page.downloads)
        self.assertIn('aria-haspopup="menu"', html)
        self.assertEqual(html.count('role="menuitemradio"'), 2)
        self.assertIn("Nightly (Unstable)", html)
        self.assertIn("Built daily from dev and may break.", html)
        self.assertIn("If macOS blocks the first launch", html)
        self.assertIn('class="first-open"', html)
        self.assertEqual((self.output / "title.png").read_bytes(),
                         (self.repository / RENDER.INPUTS["title"]).read_bytes())


if __name__ == "__main__":
    unittest.main()
