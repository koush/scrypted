cd $(dirname $0)
if [ -z "$1" ]
then
    echo "Docker tag not specified"
    exit 1
fi
gh workflow run docker.yml -f package_version=$(node print-package-json-version.js) -f docker_tag=$1
