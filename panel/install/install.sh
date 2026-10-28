#!/bin/bash
# Installs the Capstudio panel for Premiere Pro and After Effects on a Mac. No admin rights needed.
#   curl -fsSL __SITE__/panel/install.sh | bash
set -euo pipefail
SITE='__SITE__'
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.fastrr.capstudio"
TMP="$(mktemp -d)"
echo 'Downloading the Capstudio panel...'
curl -fsSL "$SITE/panel/capstudio-panel.zip" -o "$TMP/panel.zip"
rm -rf "$DEST"
mkdir -p "$DEST"
unzip -q "$TMP/panel.zip" -d "$DEST"
rm -rf "$TMP"
# Premiere only loads panels that aren't from Adobe's store once this is switched on.
for v in 9 10 11 12 13 14 15 16; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done
# macOS caches app settings; refresh them so Premiere and After Effects see the change
killall cfprefsd 2>/dev/null || true
echo
echo 'Capstudio is installed. Restart Premiere Pro or After Effects, then open Window > Extensions > Capstudio.'
