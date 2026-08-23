package clickhousespanexporter

import (
	"context"

	"github.com/tracium/collector/pkg/spanmodel"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/pmetric"
)

// Token-usage instrument and the attributes the tracium metrics processor
// stamps onto its data points. Duplicated here (same convention as the traces
// path) so the exporter stays independently usable. Note the tenant key is the
// dotted tracium.tenant.id the processor writes, distinct from the legacy
// underscore key fromOTLP reads for spans.
const (
	metricTokenUsage     = "gen_ai.client.token.usage"
	attrMetricTokenType  = "gen_ai.token.type"
	attrMetricModel      = "gen_ai.response.model"
	attrMetricModelAlt   = "llm.response.model"
	attrMetricTenantID   = "tracium.tenant.id"
	attrMetricCostUSD    = "tracium.cost_usd"
	attrMetricNormalized = "tracium.model_normalized"
)

// pushMetrics turns each enriched gen_ai.client.token.usage data point into a
// synthetic span row (source="metric") and writes them in one batch to the same
// tracium.spans table as real spans. Each data point measures either input or
// output tokens (per gen_ai.token.type); cost was priced accordingly upstream,
// so summing rows downstream yields correct per-window totals. Non-token-usage
// metrics are ignored.
func (e *chExporter) pushMetrics(ctx context.Context, md pmetric.Metrics) error {
	var rows []*spanmodel.Span

	rms := md.ResourceMetrics()
	for i := 0; i < rms.Len(); i++ {
		sms := rms.At(i).ScopeMetrics()
		for j := 0; j < sms.Len(); j++ {
			metrics := sms.At(j).Metrics()
			for k := 0; k < metrics.Len(); k++ {
				m := metrics.At(k)
				if m.Name() != metricTokenUsage || isCumulative(m) {
					continue
				}
				rows = append(rows, usageRows(m)...)
			}
		}
	}

	return e.writer.WriteBatch(ctx, rows)
}

// isCumulative reports whether a metric's points are running totals rather than
// per-interval increments. Each point becomes its own row and the query layer
// sums rows, so a cumulative series double-counts every earlier interval —
// (N+1)/2 times the real usage after N exports.
//
// The tracium processor already drops these upstream and logs why (that is
// where the rejection is made visible); this is the same guard for a pipeline
// that runs the exporter without it, so no configuration can turn a cumulative
// export into inflated cost. Unspecified temporality is treated as delta: the
// client never set the field, and delta is the only reading under which
// per-point rows sum correctly.
func isCumulative(m pmetric.Metric) bool {
	switch m.Type() {
	case pmetric.MetricTypeHistogram:
		return m.Histogram().AggregationTemporality() == pmetric.AggregationTemporalityCumulative
	case pmetric.MetricTypeSum:
		return m.Sum().AggregationTemporality() == pmetric.AggregationTemporalityCumulative
	case pmetric.MetricTypeExponentialHistogram:
		return m.ExponentialHistogram().AggregationTemporality() == pmetric.AggregationTemporalityCumulative
	default:
		return false
	}
}

// usageRows builds one synthetic span per data point of a token-usage metric,
// handling both the histogram (OpenLLMetry) and sum shapes.
func usageRows(m pmetric.Metric) []*spanmodel.Span {
	var rows []*spanmodel.Span
	switch m.Type() {
	case pmetric.MetricTypeHistogram:
		dps := m.Histogram().DataPoints()
		for i := 0; i < dps.Len(); i++ {
			dp := dps.At(i)
			rows = append(rows, usageRow(dp.Attributes(), int64(dp.Sum()), dp.Timestamp()))
		}
	case pmetric.MetricTypeSum:
		dps := m.Sum().DataPoints()
		for i := 0; i < dps.Len(); i++ {
			dp := dps.At(i)
			rows = append(rows, usageRow(dp.Attributes(), numberValue(dp), dp.Timestamp()))
		}
	}
	return rows
}

// usageRow assembles the synthetic span for one token-usage data point. Input
// vs output tokens land in the matching field so the query layer can sum each
// independently. trace/span IDs and name are left empty — metric rows are
// aggregates, never shown as individual traces (source-aware queries exclude
// them from trace-shaped aggregates).
func usageRow(attrs pcommon.Map, tokens int64, ts pcommon.Timestamp) *spanmodel.Span {
	bucketMs := ts.AsTime().UnixMilli()
	model := metricStr(attrs, attrMetricModel)
	if model == "" {
		model = metricStr(attrs, attrMetricModelAlt)
	}

	span := &spanmodel.Span{
		Source:          "metric",
		StartTimeMs:     bucketMs,
		EndTimeMs:       bucketMs,
		Model:           model,
		ModelNormalized: metricStr(attrs, attrMetricNormalized),
		CostUSD:         metricFloat(attrs, attrMetricCostUSD),
		TenantID:        metricStr(attrs, attrMetricTenantID),
		SchemaVersion:   1,
	}
	if isOutputTokenType(attrs) {
		span.OutputTokens = tokens
	} else {
		span.InputTokens = tokens
	}
	return span
}

func numberValue(dp pmetric.NumberDataPoint) int64 {
	switch dp.ValueType() {
	case pmetric.NumberDataPointValueTypeInt:
		return dp.IntValue()
	case pmetric.NumberDataPointValueTypeDouble:
		return int64(dp.DoubleValue())
	default:
		return 0
	}
}

func isOutputTokenType(attrs pcommon.Map) bool {
	if v, ok := attrs.Get(attrMetricTokenType); ok {
		return v.AsString() == "output"
	}
	return false
}

func metricStr(attrs pcommon.Map, key string) string {
	if v, ok := attrs.Get(key); ok {
		return v.AsString()
	}
	return ""
}

func metricFloat(attrs pcommon.Map, key string) float64 {
	if v, ok := attrs.Get(key); ok {
		return v.Double()
	}
	return 0
}
