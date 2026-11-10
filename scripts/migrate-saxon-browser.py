#!/usr/bin/env python3
"""Migrate the existing Saxonica browser runtime into Maestro's bundled module.

Run once from project root: python scripts/migrate-saxon-browser.py
Uses the existing official SaxonJS2.js installed by the earlier installer.
Does not download or modify any native browser XSLT functionality.
"""
from pathlib import Path
import shutil

root = Path(__file__).resolve().parents[1]
source = root / "public/vendor/saxon-js/SaxonJS2.js"
target = root / "src/vendor/saxon-browser-runtime.js"
if not source.is_file():
    raise SystemExit(f"Missing {source}. Run node scripts/install-saxon-browser.mjs first, then rerun migration.")
body = source.read_bytes()
if len(body) < 100000 or b"SaxonJS" not in body:
    raise SystemExit("Unexpected SaxonJS browser runtime; nothing was removed.")
target.parent.mkdir(parents=True, exist_ok=True)
# Saxonica's standalone browser distribution declares the SaxonJS variable.
# Add an ESM export so Turbopack can include it in Maestro's browser chunk.
# The official distribution and copyright notices are kept intact.
tmp = target.with_suffix(".tmp")
tmp.write_bytes(body + b"\nexport default SaxonJS;\n")
tmp.replace(target)
# Delete the obsolete separately served runtime only after successful copy.
source.unlink()
license_file = source.with_name("LICENSE.txt")
if license_file.exists():
    license_target = target.with_name("SAXON-LICENSE.txt")
    shutil.copyfile(license_file, license_target)
    license_file.unlink()
if not any(source.parent.iterdir()):
    source.parent.rmdir()
if source.parent.parent.exists() and not any(source.parent.parent.iterdir()):
    source.parent.parent.rmdir()
print(f"Bundled SaxonJS source installed: {target}")
print("Removed obsolete public/vendor/saxon-js runtime. Rebuild Maestro.")
