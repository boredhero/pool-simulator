"""Content-addressed Terms: navigation and markup do not change the agreement."""

import hashlib
import unicodedata
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
LEGACY_VERSION = "2026-10-08"
# Pinned to the agreement published under LEGACY_VERSION. Never update this
# when publishing new Terms: doing so would incorrectly grandfather old consent.
LEGACY_HASH = "479ae0a1caed40500d5d507212d7fae0ac3b36430d63284c0b8a9062bf0afbe7"


class TermsText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.main = 0
        self.skip = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag == "main":
            self.main += 1
        if tag in {"nav", "script", "style"}:
            self.skip += 1

    def handle_endtag(self, tag):
        if tag == "main":
            self.main -= 1
        if tag in {"nav", "script", "style"}:
            self.skip -= 1

    def handle_data(self, data):
        if self.main > 0 and not self.skip:
            self.parts.append(data)


def canonical_terms(html: str) -> str:
    parser = TermsText()
    parser.feed(html)
    text = " ".join(unicodedata.normalize("NFC", " ".join(parser.parts)).split())
    if not text:
        raise ValueError("Terms document has no agreement text")
    return text


def terms_path() -> Path:
    # Production serves the built document; source is the development fallback.
    built = ROOT / "frontend/dist/terms.html"
    return built if built.exists() else ROOT / "frontend/public/terms.html"


def terms_version() -> str:
    return hashlib.sha256(canonical_terms(terms_path().read_text()).encode()).hexdigest()
