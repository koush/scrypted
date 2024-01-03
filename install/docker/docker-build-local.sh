./template/generate-dockerfile.sh

docker build -t ghcr.io/koush/scrypted-common -f Dockerfile.full . && \
docker build -t ghcr.io/koush/scrypted  -f Dockerfile.local .
