#!/bin/bash

# Get the list of changed directories in /plugins
changed_dirs=$(git diff --name-only HEAD^ HEAD /plugins | awk -F/ '{print $2}' | uniq)

# Loop through each changed directory
for dir in $changed_dirs; do
    cd "/plugins/$dir" || continue

    # Run npm install
    npm install

    # Run npm run build
    npm run build

    cd - >/dev/null || continue
done
