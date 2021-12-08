ARG BASE="16"
FROM koush/scrypted-common:${BASE}

WORKDIR /
RUN npx -y scrypted install-server
WORKDIR /server
CMD npm exec scrypted-serve
