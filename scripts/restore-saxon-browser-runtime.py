#!/usr/bin/env python3
"""Restore Saxonica's unmodified browser distribution from the previous ESM migration.

Run in the Maestro project root *after* extracting this patch.  The script
removes only the old app-module copy, and only after writing/validating the
browser script.  This is required because SaxonJS2.js is a classic-script
runtime and an ESM suffix can change the scope used by its internals.
"""
from pathlib import Path
import shutil

root = Path(__file__).resolve().parents[1]
source = root / 'src/vendor/saxon-browser-runtime.js'
dest = root / 'public/vendor/saxon-js/SaxonJS2.js'
license_src = root / 'src/vendor/SAXON-LICENSE.txt'
license_dest = dest.with_name('LICENSE.txt')
suffix = b'\nexport default SaxonJS;\n'
if dest.is_file():
    data = dest.read_bytes()
    if data.endswith(suffix):
        raise SystemExit('Existing public SaxonJS copy contains an ESM suffix; remove it and rerun.')
    if len(data) < 100_000 or b'SaxonJS' not in data:
        raise SystemExit('Unexpected public SaxonJS runtime; no files removed.')
    print(f'Existing standalone browser runtime verified: {dest}')
elif source.is_file():
    data = source.read_bytes()
    if data.endswith(suffix): data = data[:-len(suffix)]
    if len(data) < 100_000 or b'SaxonJS' not in data:
        raise SystemExit('Unexpected bundled SaxonJS runtime; no files removed.')
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix('.tmp')
    tmp.write_bytes(data)
    tmp.replace(dest)
    print(f'Restored official classic-script SaxonJS: {dest}')
else:
    raise SystemExit('No SaxonJS runtime found. Run node scripts/install-saxon-browser.mjs first, then rerun this script.')
if license_src.is_file():
    license_dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(license_src, license_dest)
# Remove only superseded module copies, after a valid standalone runtime exists.
if source.is_file(): source.unlink()
old_type = root / 'src/vendor/saxon-browser-runtime.d.ts'
if old_type.is_file(): old_type.unlink()
if license_src.is_file(): license_src.unlink()
print('SaxonJS remains browser-side; no server Record transformation or XML upload is introduced.')
