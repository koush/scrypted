#!/usr/bin/env bash
# run as privileged so all the devices can be detected and only the necessary ones passed through.

docker run --rm \
  --privileged \
  -v "$(pwd):/app" \
  -w /app \
  python:3.12-slim \
  sh -c "pip install -q --root-user-action=ignore ruamel.yaml && python docker-compose-setup.py"
