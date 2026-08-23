package writer

import (
	"context"
	"fmt"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/tracium/collector/pkg/spanmodel"
)

// ClickHouseWriter writes span batches to ClickHouse using the native protocol.
type ClickHouseWriter struct {
	conn clickhouse.Conn
}

// NewClickHouseWriter opens a connection to ClickHouse using the native
// interface and verifies it with a ping.
func NewClickHouseWriter(dsn string) (*ClickHouseWriter, error) {
	opts, err := clickhouse.ParseDSN(dsn)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: parse DSN: %w", err)
	}

	conn, err := clickhouse.Open(opts)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: open connection: %w", err)
	}

	if err := conn.Ping(context.Background()); err != nil {
		return nil, fmt.Errorf("clickhouse: ping failed: %w", err)
	}

	return &ClickHouseWriter{conn: conn}, nil
}

const insertQuery = `INSERT INTO tracium.spans (
	trace_id, span_id, parent_span_id, name,
	start_time_ms, end_time_ms, duration_ms,
	model, model_normalized,
	input_tokens, output_tokens, cost_usd,
	tenant_id, finish_reason,
	output_tokens_derived, unmetered,
	error_type, error_message,
	schema_version,
	input, output, available_tools,
	source,
	agent_name,
	kind,
	attributes
)`

// WriteBatch inserts all spans in a single ClickHouse batch operation.
func (w *ClickHouseWriter) WriteBatch(ctx context.Context, spans []*spanmodel.Span) error {
	if len(spans) == 0 {
		return nil
	}

	batch, err := w.conn.PrepareBatch(ctx, insertQuery)
	if err != nil {
		return fmt.Errorf("clickhouse: prepare batch: %w", err)
	}

	for _, s := range spans {
		source := s.Source
		if source == "" {
			source = "span"
		}
		attributes := s.Attributes
		if attributes == nil {
			attributes = map[string]string{}
		}
		if err := batch.Append(
			s.TraceID,
			s.SpanID,
			s.ParentSpanID,
			s.Name,
			s.StartTimeMs,
			s.EndTimeMs,
			s.DurationMs,
			s.Model,
			s.ModelNormalized,
			s.InputTokens,
			s.OutputTokens,
			s.CostUSD,
			s.TenantID,
			s.FinishReason,
			boolToUInt8(s.OutputTokensDerived),
			boolToUInt8(s.Unmetered),
			s.ErrorType,
			s.ErrorMessage,
			int32(s.SchemaVersion),
			s.Input,
			s.Output,
			s.AvailableTools,
			source,
			s.AgentName,
			s.Kind,
			attributes,
		); err != nil {
			return fmt.Errorf("clickhouse: append row for span %s: %w", s.SpanID, err)
		}
	}

	if err := batch.Send(); err != nil {
		return fmt.Errorf("clickhouse: send batch: %w", err)
	}
	return nil
}

// Close releases the ClickHouse connection.
func (w *ClickHouseWriter) Close() error {
	return w.conn.Close()
}

// boolToUInt8 maps a Go bool onto the UInt8 ClickHouse uses for boolean columns.
func boolToUInt8(b bool) uint8 {
	if b {
		return 1
	}
	return 0
}
