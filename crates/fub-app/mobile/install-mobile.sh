#!/usr/bin/env bash
# Fuse reviewed native templates into a generated Tauri project. No SDK/build/signing.
# Usage: install-mobile.sh [--gen path/to/gen] [--check]
# iOS additionally requires --ios-share-dir path/to/ShareExtension and
# --ios-widget-dir path/to/WidgetExtension, both Xcode target directories
# already registered in the generated project. No app target @main pollution.
set -euo pipefail

GEN="crates/fub-app/gen"
CHECK=0
SHARE_TARGET=""
WIDGET_TARGET=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --gen) [ "$#" -ge 2 ] || { echo 'missing --gen directory' >&2; exit 64; }; GEN="$2"; shift 2 ;;
    --ios-share-dir) [ "$#" -ge 2 ] || { echo 'missing --ios-share-dir' >&2; exit 64; }; SHARE_TARGET="$2"; shift 2 ;;
    --ios-widget-dir) [ "$#" -ge 2 ] || { echo 'missing --ios-widget-dir' >&2; exit 64; }; WIDGET_TARGET="$2"; shift 2 ;;
    --check) CHECK=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 64 ;;
  esac
done

python3 - "$(dirname "$0")" "$GEN" "$CHECK" "$SHARE_TARGET" "$WIDGET_TARGET" <<'PY'
from pathlib import Path
import plistlib
import re
import shutil
import sys
import xml.etree.ElementTree as ET

source, gen, check = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve(), sys.argv[3] == '1'
share_target, widget_target = sys.argv[4], sys.argv[5]
android, ios = gen / 'android', gen / 'ios'

def fail(message):
    raise SystemExit(f'install-mobile.sh: {message}')

if not android.is_dir() and not ios.is_dir():
    fail('gen/android o gen/ios assente: prima cargo tauri android/ios init; nessuna fusione')

copies = []
patches = []

def copy(src, dst):
    original = source / src
    if not original.is_file():
        fail(f'template assente: {original}')
    if original.suffix == '.xml':
        try:
            ET.parse(original)
        except ET.ParseError as error:
            fail(f'template XML non valido: {original}: {error}')
    copies.append((original, dst))

def patch(dst, data):
    patches.append((dst, data))

if android.is_dir():
    root = android / 'app/src/main'
    manifest = root / 'AndroidManifest.xml'
    if not manifest.is_file():
        fail(f'manifest generato assente: {manifest}')
    original = manifest.read_text(encoding='utf-8')
    snippet = (source / 'AndroidManifest.snippet.xml').read_text(encoding='utf-8')
    try:
        tree = ET.fromstring(original)
        fragment = ET.fromstring(snippet.replace('<manifest>', '<manifest xmlns:android="http://schemas.android.com/apk/res/android">', 1))
    except ET.ParseError as error:
        fail(f'AndroidManifest non valido: {error}')
    apps = tree.findall('application')
    activities = apps[0].findall('activity') if len(apps) == 1 else []
    if len(activities) != 1 or len(fragment.findall('application/activity')) != 1:
        fail('manifest ambiguo: occorre una application e una activity')
    marker = 'android:scheme="fub"'
    if marker not in original:
        insertion = snippet.split('<activity>', 1)[1].split('</activity>', 1)[0]
        if original.count('</activity>') != 1 or original.count('</application>') != 1:
            fail('manifest non ha i punti di fusione attesi')
        receiver = snippet.split('<receiver', 1)[1].split('</receiver>', 1)[0]
        updated = original.replace('</activity>', insertion + '\n</activity>', 1)
        updated = updated.replace('</application>', '<receiver' + receiver + '</receiver>\n</application>', 1)
        try:
            ET.fromstring(updated)
        except ET.ParseError as error:
            fail(f'fusione manifest non valida: {error}')
        patch(manifest, updated)
    elif not all(value in original for value in ('android.intent.action.SEND', 'android.app.shortcuts', 'FubWidgetProvider')):
        fail('manifest parzialmente fuso: intervento manuale richiesto')
    for src, dst in (
        ('FubTreeAccess.kt', 'java/dev/fub/app/FubTreeAccess.kt'),
        ('ShareBridge.kt', 'java/dev/fub/app/ShareBridge.kt'),
        ('FubWidgetProvider.kt', 'java/dev/fub/app/FubWidgetProvider.kt'),
        ('fub-widget-info.xml', 'res/xml/fub_widget_info.xml'),
        ('fub-widget-layout.xml', 'res/layout/fub_widget.xml'),
        ('shortcuts.xml', 'res/xml/shortcuts.xml'),
        ('fub-shortcut-labels.xml', 'res/values/fub_shortcut_labels.xml'),
    ):
        copy(src, root / dst)

if ios.is_dir():
    sources = ios / 'Sources'
    if not share_target or not widget_target:
        fail('iOS: indica --ios-share-dir e --ios-widget-dir dei target extension Xcode, prima di fondere')
    share, widget = Path(share_target).resolve(), Path(widget_target).resolve()
    if not share.is_dir() or not widget.is_dir() or share == widget or ios not in share.parents or ios not in widget.parents:
        fail('iOS: target extension assenti o fuori da gen/ios')
    projects = list(ios.rglob('project.pbxproj'))
    if len(projects) != 1:
        fail('iOS: project.pbxproj assente/ambiguo; crea i target Share e Widget Extension')
    project = projects[0].read_text(encoding='utf-8')
    if 'com.apple.product-type.app-extension' not in project or share.name not in project or widget.name not in project:
        fail('iOS: Share e Widget Extension non registrate nel progetto Xcode')
    if 'PBXFileSystemSynchronizedRootGroup' not in project and not all(
        name in project for name in ('FubTreeAccess.swift', 'ShareViewController.swift', 'FubWidget.swift')
    ):
        fail('iOS: registra esplicitamente i tre Swift nei target Xcode prima della fusione')
    apps = [p for p in sources.iterdir() if p.is_dir() and p not in (share, widget)] if sources.is_dir() else []
    plists = [p for p in ios.rglob('Info.plist') if 'Pods' not in p.parts and share not in p.parents and widget not in p.parents]
    entitlements = [p for p in ios.rglob('*.entitlements') if share not in p.parents and widget not in p.parents]
    if len(apps) != 1 or len(plists) != 1 or len(entitlements) != 1:
        fail('iOS ambiguo: occorre un Sources/<App>, un Info.plist e un .entitlements per la app')
    copy('FubTreeAccess.swift', apps[0] / 'FubTreeAccess.swift')
    copy('ShareViewController.swift', share / 'ShareViewController.swift')
    copy('FubWidget.swift', widget / 'FubWidget.swift')
    for src, dst in (('Info.plist.snippet.plist', plists[0]), ('Fub.entitlements', entitlements[0])):
        template = source / src
        if not template.is_file():
            fail(f'template assente: {template}')
        raw, add = dst.read_text(encoding='utf-8'), template.read_text(encoding='utf-8')
        try:
            existing, fragment = plistlib.loads(raw.encode()), plistlib.loads(add.encode())
        except (ValueError, TypeError) as error:
            fail(f'plist non valido: {error}')
        if not isinstance(existing, dict) or not isinstance(fragment, dict):
            fail('plist senza dizionario principale')
        present = set(existing).intersection(fragment)
        if present and any(existing[key] != fragment[key] for key in present):
            fail(f'plist {dst} in conflitto su {sorted(present)}')
        if present and len(present) != len(fragment):
            fail(f'plist {dst} parzialmente fuso')
        if not present:
            match = re.search(r'</dict>\s*</plist>\s*$', raw)
            block = re.search(r'<dict>(.*)</dict>\s*</plist>\s*$', add, re.S)
            if not match or not block:
                fail(f'plist {dst} senza punto di fusione sicuro')
            updated = raw[:match.start()] + block.group(1) + '\n' + raw[match.start():]
            try:
                merged = plistlib.loads(updated.encode())
            except (ValueError, TypeError) as error:
                fail(f'fusione plist non valida: {error}')
            if any(merged.get(key) != value for key, value in fragment.items()):
                fail('fusione plist non conserva i valori del template')
            patch(dst, updated)

# Preflight every source, destination and patch BEFORE writing anything.
for src, dst in copies:
    if check:
        if not dst.is_file() or dst.read_bytes() != src.read_bytes():
            fail(f'manca/diverso in gen/: {dst}')
    elif dst.exists() and dst.read_bytes() != src.read_bytes():
        fail(f'file nativo già diverso: {dst}; nessuna sovrascrittura silenziosa')
for dst, _ in patches:
    if check:
        fail(f'fusione non presente: {dst}')
if check:
    print('install-mobile.sh: gen/ verificato, nessuna scrittura')
    raise SystemExit(0)
for src, dst in copies:
    if not dst.exists():
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
for dst, data in patches:
    dst.write_text(data, encoding='utf-8')
print('install-mobile.sh: template fusi dopo preflight; nessuna build/firma')
PY
