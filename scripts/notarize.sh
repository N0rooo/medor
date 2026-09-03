#!/bin/sh
# Notarisation du DMG de Médor.
# Prérequis (une seule fois) : xcrun notarytool store-credentials medor \
#   --apple-id VOTRE_EMAIL_APPLE --team-id HSAFDUBFHM --password MOT_DE_PASSE_APP
set -e
VERSION=$(python3 -c "import json;print(json.load(open('src-tauri/tauri.conf.json'))['version'])")
DMG="src-tauri/target/release/bundle/dmg/Médor_${VERSION}_aarch64.dmg"
xcrun notarytool submit "$DMG" --keychain-profile medor --wait
xcrun stapler staple "$DMG"
echo "✅ DMG notarisé et agrafé : $DMG"
