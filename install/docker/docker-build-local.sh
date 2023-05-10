./template/generate-dockerfile.sh

docker build -t koush/scrypted-common -f Dockerfile.common . && \
docker build -t koush/scrypted  -f Dockerfile.local .
