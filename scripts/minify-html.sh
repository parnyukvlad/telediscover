#!/bin/bash
set -e

mkdir -p apps/onlydate-dist/photochoose

echo "Minifying apps/onlydate/index.html …"
npx html-minifier-terser \
  --collapse-whitespace \
  --remove-comments \
  --minify-js true \
  --minify-css true \
  apps/onlydate/index.html \
  -o apps/onlydate-dist/index.html

echo "Minifying apps/onlydate/photochoose/index.html …"
npx html-minifier-terser \
  --collapse-whitespace \
  --remove-comments \
  --minify-js true \
  --minify-css true \
  apps/onlydate/photochoose/index.html \
  -o apps/onlydate-dist/photochoose/index.html

echo "Minification complete."
echo "Source index.html:          $(wc -c < apps/onlydate/index.html) bytes"
echo "Minified index.html:        $(wc -c < apps/onlydate-dist/index.html) bytes"
echo "Source photochoose:         $(wc -c < apps/onlydate/photochoose/index.html) bytes"
echo "Minified photochoose:       $(wc -c < apps/onlydate-dist/photochoose/index.html) bytes"
