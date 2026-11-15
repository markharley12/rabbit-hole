#!/usr/bin/env bash
# Render public/icon.svg to the PNGs the web manifest and iOS need.
# The PNGs are committed, so this only needs running when the icon changes.
# Headless Chrome, because it renders SVG exactly as a browser will.
# (From TreeQuiz's script of the same name.)
set -euo pipefail
cd "$(dirname "$0")/.."
chrome=$(command -v google-chrome || command -v chromium || command -v chromium-browser)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cp public/icon.svg "$tmp/icon.svg"
printf '<!doctype html><html><body style="margin:0"><img src="icon.svg" style="display:block;width:100vw;height:100vh"></body></html>' > "$tmp/icon.html"

render() {  # size output
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --no-first-run --user-data-dir="$tmp/profile" --window-size="$1,$1" --screenshot="$PWD/$2" "file://$tmp/icon.html" 2>/dev/null
}
render 192 public/icon-192.png
render 512 public/icon-512.png
render 512 public/icon-maskable-512.png   # same art: it already keeps to the safe zone
render 180 public/apple-touch-icon.png
echo "rendered: $(ls public/*.png | tr '\n' ' ')"
