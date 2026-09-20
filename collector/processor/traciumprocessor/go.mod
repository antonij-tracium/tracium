module github.com/tracium/collector/processor/traciumprocessor

go 1.22.0

// The Tracium domain logic (enrich, pricing, tenant, spanmodel) lives in the
// parent module and is consumed here behind the enrich.Enricher seam.
require github.com/tracium/collector v0.0.0

replace github.com/tracium/collector => ../../

// Collector framework deps are resolved at build time by the OCB builder.
// Versions MUST match the collector core version pinned in builder/*.builder.yaml.
require (
	go.opentelemetry.io/collector/client v1.22.0
	go.opentelemetry.io/collector/component v0.116.0
	go.opentelemetry.io/collector/consumer v1.22.0
	go.opentelemetry.io/collector/pdata v1.22.0
	go.opentelemetry.io/collector/processor v0.116.0
	go.uber.org/zap v1.28.0
)

require (
	go.opentelemetry.io/otel v1.32.0
	go.opentelemetry.io/otel/metric v1.32.0
)

require (
	github.com/gogo/protobuf v1.3.2 // indirect
	github.com/json-iterator/go v1.1.12 // indirect
	github.com/modern-go/concurrent v0.0.0-20180306012644-bacd9c7ef1dd // indirect
	github.com/modern-go/reflect2 v1.0.2 // indirect
	go.opentelemetry.io/collector/config/configtelemetry v0.116.0 // indirect
	go.opentelemetry.io/collector/pipeline v0.116.0 // indirect
	go.opentelemetry.io/otel/trace v1.32.0 // indirect
	go.uber.org/multierr v1.11.0 // indirect
	golang.org/x/net v0.29.0 // indirect
	golang.org/x/sys v0.27.0 // indirect
	golang.org/x/text v0.18.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20240903143218-8af14fe29dc1 // indirect
	google.golang.org/grpc v1.68.1 // indirect
	google.golang.org/protobuf v1.35.2 // indirect
)
