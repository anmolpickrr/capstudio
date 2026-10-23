#!/bin/bash
# Installs the Capstudio panel for Premiere Pro on a Mac. No admin rights needed.
#   curl -fsSL __SITE__/premiere/install.sh | bash
set -euo pipefail
SITE='__SITE__'
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.fastrr.capstudio"
TMP="$(mktemp -d)"
echo 'Downloading the Capstudio panel...'
curl -fsSL "$SITE/premiere/capstudio-premiere.zip" -o "$TMP/panel.zip"
rm -rf "$DEST"
mkdir -p "$DEST"
unzip -q "$TMP/panel.zip" -d "$DEST"
rm -rf "$TMP"
# Premiere only loads panels that aren't from Adobe's store once this is switched on.
for v in 9 10 11 12 13 14; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done
echo
echo 'Capstudio is installed. Restart Premiere Pro, then open Window > Extensions > Capstudio.'
