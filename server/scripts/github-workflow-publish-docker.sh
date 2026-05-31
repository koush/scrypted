cd $(dirname $0)
if [ -z "$1" ]
then
    echo "Docker tag not specified"
    exit 1
fi
gh workflow run docker.yml -f tag=$1
