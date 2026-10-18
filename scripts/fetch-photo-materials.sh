#!/usr/bin/env bash
# Downloads the photo textures listed in apps/editor/lib/photo-materials.json
# from ambientCG (CC0) into apps/editor/public/material/photo/<asset>/ as
# color/normal/roughness JPGs plus a 256 px thumbnail. Needs curl, unzip, jq
# and ImageMagick. Run before the image build; the files are not committed.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
manifest="$root/apps/editor/lib/photo-materials.json"
out="$root/apps/editor/public/material/photo"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
convert_cmd="$(command -v magick || command -v convert)"

for asset in $(jq -r '.materials[].asset' "$manifest"); do
  slug="$(echo "$asset" | tr '[:upper:]' '[:lower:]')"
  dir="$out/$slug"
  if [[ -f "$dir/thumb.jpg" ]]; then continue; fi
  echo "$asset"
  curl -fsSL --retry 4 -o "$tmp/$asset.zip" "https://ambientcg.com/get?file=${asset}_1K-JPG.zip"
  unzip -oq "$tmp/$asset.zip" "${asset}_1K-JPG_Color.jpg" "${asset}_1K-JPG_NormalGL.jpg" "${asset}_1K-JPG_Roughness.jpg" -d "$tmp/$asset"
  mkdir -p "$dir"
  mv "$tmp/$asset/${asset}_1K-JPG_Color.jpg" "$dir/color.jpg"
  mv "$tmp/$asset/${asset}_1K-JPG_NormalGL.jpg" "$dir/normal.jpg"
  mv "$tmp/$asset/${asset}_1K-JPG_Roughness.jpg" "$dir/roughness.jpg"
  "$convert_cmd" "$dir/color.jpg" -resize 256x256 -quality 82 "$dir/thumb.jpg"
done
