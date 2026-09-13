// Package clickhousespanexporter writes enriched Tracium LLM spans to ClickHouse
// using the existing tracium.spans schema. It reuses writer.ClickHouseWriter so
// the storage format stays identical to the legacy custom collector.
package clickhousespanexporter

import (
	"context"
	"fmt"
	"time"

	"github.com/tracium/collector/internal/writer"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/config/configretry"
	"go.opentelemetry.io/collector/exporter"
	"go.opentelemetry.io/collector/exporter/exporterbatcher"
	"go.opentelemetry.io/collector/exporter/exporterhelper"
)

var typeStr = component.MustNewType("clickhousespan")

// Config is set under exporters.clickhousespan in the collector config.
type Config struct {
	// DSN is the ClickHouse native DSN, e.g.
	// clickhouse://default:pass@clickhouse:9000/tracium
	DSN string `mapstructure:"dsn"`

	// QueueConfig and BackOffConfig expose the standard exporterhelper
	// sending_queue / retry_on_failure blocks. They must be declared here to be
	// settable at all: the collector unmarshals component config with
	// ErrorUnused, so a sending_queue block under an exporter that does not
	// declare one is not silently ignored — it fails startup with an unknown-
	// field error. Before these existed the factory hardcoded the upstream
	// defaults, which queue in memory with no StorageID, so any restart during a
	// downstream outage destroyed spans already ACKed to the client.
	QueueConfig   exporterhelper.QueueConfig `mapstructure:"sending_queue"`
	BackOffConfig configretry.BackOffConfig  `mapstructure:"retry_on_failure"`

	// BatchConfig batches spans INSIDE the exporter — after the durable
	// sending_queue, not before it. This replaces the standalone `batch`
	// processor, which sat in front of the queue: that processor buffered spans
	// in memory and returned success to the receiver (HTTP 200) the moment they
	// were buffered, so a crash or a full queue lost spans the client had already
	// been told were delivered. With batching here, every OTLP request is written
	// to the durable queue first — acknowledgement now means "persisted" — and
	// batching happens on the way out of the queue toward ClickHouse.
	BatchConfig exporterbatcher.Config `mapstructure:"batcher"`
}

// Validate implements component.ConfigValidator.
func (c *Config) Validate() error {
	if c.DSN == "" {
		return fmt.Errorf("clickhousespan: dsn must not be empty")
	}
	if err := c.QueueConfig.Validate(); err != nil {
		return fmt.Errorf("clickhousespan: sending_queue: %w", err)
	}
	if err := c.BackOffConfig.Validate(); err != nil {
		return fmt.Errorf("clickhousespan: retry_on_failure: %w", err)
	}
	if err := c.BatchConfig.Validate(); err != nil {
		return fmt.Errorf("clickhousespan: batcher: %w", err)
	}
	return nil
}

// NewFactory returns the factory for the ClickHouse span exporter. It writes
// both traces (real spans) and metrics (token-usage rows synthesised as
// source="metric" spans) into the same tracium.spans table.
func NewFactory() exporter.Factory {
	return exporter.NewFactory(
		typeStr,
		func() component.Config {
			return &Config{
				QueueConfig:   exporterhelper.NewDefaultQueueConfig(),
				BackOffConfig: configretry.NewDefaultBackOffConfig(),
				// Default batching mirrors the sizing the old `batch` processor
				// used (flush at 5k spans or 5s, split at 10k) so throughput to
				// ClickHouse is unchanged — but now downstream of the durable
				// queue. Operators override under exporters.clickhousespan.batcher.
				BatchConfig: exporterbatcher.Config{
					Enabled:       true,
					FlushTimeout:  5 * time.Second,
					MinSizeConfig: exporterbatcher.MinSizeConfig{MinSizeItems: 5000},
					MaxSizeConfig: exporterbatcher.MaxSizeConfig{MaxSizeItems: 10000},
				},
			}
		},
		exporter.WithTraces(createTracesExporter, component.StabilityLevelStable),
		exporter.WithMetrics(createMetricsExporter, component.StabilityLevelStable),
	)
}

func createTracesExporter(
	ctx context.Context,
	set exporter.Settings,
	cfg component.Config,
) (exporter.Traces, error) {
	c := cfg.(*Config)

	chWriter, err := writer.NewClickHouseWriter(c.DSN)
	if err != nil {
		return nil, fmt.Errorf("clickhousespan: %w", err)
	}
	exp := &chExporter{writer: chWriter}

	return exporterhelper.NewTraces(
		ctx, set, cfg,
		exp.pushTraces,
		// Let the collector own batching, queueing, and retry — the plumbing
		// the legacy collector hand-rolled is now upstream. These come from the
		// operator's config (see Config): hardcoding the defaults here made
		// sending_queue.storage unreachable, so the queue could never be durable.
		exporterhelper.WithQueue(c.QueueConfig),
		// Batcher runs after the queue, so spans are durably enqueued before they
		// are batched and sent — see Config.BatchConfig.
		exporterhelper.WithBatcher(c.BatchConfig),
		exporterhelper.WithRetry(c.BackOffConfig),
		exporterhelper.WithShutdown(func(context.Context) error { return chWriter.Close() }),
	)
}

func createMetricsExporter(
	ctx context.Context,
	set exporter.Settings,
	cfg component.Config,
) (exporter.Metrics, error) {
	c := cfg.(*Config)

	chWriter, err := writer.NewClickHouseWriter(c.DSN)
	if err != nil {
		return nil, fmt.Errorf("clickhousespan: %w", err)
	}
	exp := &chExporter{writer: chWriter}

	return exporterhelper.NewMetrics(
		ctx, set, cfg,
		exp.pushMetrics,
		exporterhelper.WithQueue(c.QueueConfig),
		// Batcher runs after the queue, so spans are durably enqueued before they
		// are batched and sent — see Config.BatchConfig.
		exporterhelper.WithBatcher(c.BatchConfig),
		exporterhelper.WithRetry(c.BackOffConfig),
		exporterhelper.WithShutdown(func(context.Context) error { return chWriter.Close() }),
	)
}
