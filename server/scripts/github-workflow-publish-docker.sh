cd $(dirname $0)
gh workflow run docker.yml -f PACKAGE_JSON_VERSION=$(node print-package-json-version.js)
