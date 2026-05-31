#!/bin/bash
set -e

bash npm-install.sh

# Upgrade pip in the portable Python installed by server/bin/postinstall
# Filter to ELF binaries only — avoids picking up macOS Mach-O binaries from host node_modules
PYTHON=$(find server/node_modules/py -name 'python' -type f 2>/dev/null | while IFS= read -r f; do
    file "$f" 2>/dev/null | grep -q 'ELF' && { echo "$f"; break; }
done)
if [ -n "$PYTHON" ]; then
    "$PYTHON" -m pip install --upgrade pip
fi
