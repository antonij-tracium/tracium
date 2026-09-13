FROM alpine:3.24
RUN apk add --no-cache bash curl postgresql-client
COPY run-migrations.sh /usr/local/bin/run-migrations.sh
RUN chmod +x /usr/local/bin/run-migrations.sh
ENV MIGRATIONS_DIR=/migrations
CMD ["/usr/local/bin/run-migrations.sh"]
