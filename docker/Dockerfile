ARG BASE="16"
FROM koush/scrypted-common:${BASE}

WORKDIR /
RUN npx -y scrypted install-server && \
    npx -y scrypted create-run-server-script /scrypted-serve.sh && \
    chmod +x /scrypted-serve.sh

RUN mkdir -p /server

CMD /scrypted-serve.sh
