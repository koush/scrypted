./template/generate-dockerfile.sh

docker build -t koush/scrypted-common -f Dockerfile.full . && \
docker build -t koush/scrypted  -f Dockerfile.local .
