./template/generate-dockerfile.sh
# docker buildx create --name mybuild
# docker buildx use mybuild

docker buildx build -f Dockerfile.opencv --tag koush/node-opencv:16     --platform linux/amd64,linux/arm64,linux/armhf .
docker buildx build -f Dockerfile.common --tag koush/scrypted-common:16 --platform linux/amd64,linux/arm64,linux/armhf .
docker buildx build -f Dockerfile        --tag koush/scrypted:16        --platform linux/amd64,linux/arm64,linux/armhf .
