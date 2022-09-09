cd $(dirname $0)
gh workflow run docker.yml -f package_version=$(node print-package-json-version.js)
