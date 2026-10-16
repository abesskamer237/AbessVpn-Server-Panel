FROM ghcr.io/xtls/xray-core:26.7.28 AS xray-core

FROM alpine:3.22
RUN apk add --no-cache ca-certificates jq
COPY --from=xray-core /usr/local/bin/xray /usr/local/bin/xray
COPY watch-config.sh /usr/local/bin/watch-config.sh
RUN chmod 0755 /usr/local/bin/xray /usr/local/bin/watch-config.sh
EXPOSE 10000
ENTRYPOINT ["/usr/local/bin/watch-config.sh"]
