# Builds the Tracium OSS collector as a generic OpenTelemetry Collector
# distribution assembled by the OpenTelemetry Collector Builder (OCB).
#
# Network access is required at build time to download the collector framework
# and contrib components referenced by builder/oss.builder.yaml.

FROM golang:1.27-alpine AS builder
RUN apk --no-cache add ca-certificates git
WORKDIR /src

# Pin the builder to the same core version as the manifest's otelcol_version.
ARG OCB_VERSION=v0.116.0
RUN for attempt in 1 2 3 4 5; do \
      go install go.opentelemetry.io/collector/cmd/builder@${OCB_VERSION} && break; \
      echo "go install builder attempt ${attempt} failed; retrying in $((attempt * 5))s"; \
      sleep $((attempt * 5)); \
    done; \
    command -v builder

# Copy the whole collector source: the manifest references the local Tracium
# component modules via relative `path:` entries.
COPY . .

# The OCB pulls the full collector dependency graph from the Go module proxy at
# build time. proxy.golang.org intermittently resets HTTP/2 streams on busy CI
# runners, which would otherwise fail the whole image build. Retry so a transient
# reset recovers — the module cache from earlier attempts persists within this
# layer, so each retry resumes the downloads rather than starting over.
RUN for attempt in 1 2 3 4 5; do \
      builder --config builder/oss.builder.yaml && break; \
      echo "builder attempt ${attempt} failed; retrying in $((attempt * 5))s"; \
      sleep $((attempt * 5)); \
    done; \
    test -x _build/tracium-collector

FROM alpine:3.22
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /src/_build/tracium-collector /app/tracium-collector
COPY config/collector.yaml /etc/tracium/collector.yaml
EXPOSE 4317 4318 8080
ENTRYPOINT ["/app/tracium-collector"]
CMD ["--config", "/etc/tracium/collector.yaml"]
