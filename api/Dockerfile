FROM golang:1.27-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o api ./cmd/api
# repair-rollup: operator tool to rebuild the daily rollups after deleting a bad
# span (materialized views do not retract on DELETE). Ships in the same image so
# it can be run in-cluster against ClickHouse's native port; see rollup-repair.md.
RUN CGO_ENABLED=0 go build -o repair-rollup ./cmd/repair-rollup
# reset-password: admin tool for self-hosted deployments with no email/token
# reset flow. Writes a new password hash directly to the users table; run it
# in-cluster against Postgres, e.g. `docker exec ... ./reset-password --email ...`.
RUN CGO_ENABLED=0 go build -o reset-password ./cmd/reset-password

FROM alpine:3.24
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /app/api .
COPY --from=builder /app/repair-rollup .
COPY --from=builder /app/reset-password .
EXPOSE 8090
ENTRYPOINT ["./api"]
