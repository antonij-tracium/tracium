# Builds the Tracium OSS collector as a generic OpenTelemetry Collector
# distribution assembled by the OpenTelemetry Collector Builder (OCB).
#
# Network access is required at build time to download the collector framework
# and contrib components referenced by builder/oss.builder.yaml.

FROM golang:1.22-alpine AS builder
RUN apk --no-cache add ca-certificates git
WORKDIR /src

# Pin the builder to the same core version as the manifest's otelcol_version.
ARG OCB_VERSION=v0.116.0
RUN go install go.opentelemetry.io/collector/cmd/builder@${OCB_VERSION}

# Copy the whole collector source: the manifest references the local Tracium
# component modules via relative `path:` entries.
COPY . .
RUN builder --config builder/oss.builder.yaml

FROM alpine:3.19
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /src/_build/tracium-collector /app/tracium-collector
COPY config/collector.yaml /etc/tracium/collector.yaml
EXPOSE 4317 4318 8080
ENTRYPOINT ["/app/tracium-collector"]
CMD ["--config", "/etc/tracium/collector.yaml"]
