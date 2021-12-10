ARG BASE="16"
FROM koush/scrypted-common:${BASE}

WORKDIR /
# cache bust
ADD "https://www.random.org/cgi-bin/randbyte?nbytes=10&format=h" skipcache
RUN npx -y scrypted install-server
WORKDIR /server
CMD npm exec scrypted-serve
