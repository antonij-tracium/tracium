package traciumprocessor

import (
	"context"
	"strings"

	"github.com/tracium/collector/internal/pricing"
	"github.com/tracium/collector/internal/tenant"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.uber.org/zap"
)

// metricsProcessor enriches OpenLLMetry's gen_ai.client.token.usage data points
// with the same tenant resolution, model normalisation, and pricing the traces
// chain applies to spans. It stays in pmetric form and stamps the results as
// data-point attributes; the clickhousespan exporter turns each enriched data
// point into a synthetic span row (source="metric").
//
// Cost is computed per data point. The static price table is linear in tokens
// (cost = inputTokens*inRate + outputTokens*outRate), so pricing an input-only
// and an output-only point separately and summing downstream yields exactly the
// same total as pricing them together — no need to correlate the two points.
type metricsProcessor struct {
	logger  *zap.Logger
	pricing pricing.Resolver
	tenant  tenant.Resolver
}

// Metric and attribute keys for the token-usage instrument. Duplicated from the
// exporter (same convention as the traces path) so each component stays
// independently usable.
const (
	metricTokenUsage = "gen_ai.client.token.usage"

	// attrTokenType distinguishes the input vs output data points.
	attrTokenType = "gen_ai.token.type"
	// OpenLLMetry uses llm.response.model on metric points; gen_ai.* are the
	// semconv equivalents, checked as fallbacks.
	attrMetricModelResponse = "gen_ai.response.model"
	attrMetricModelLegacy   = "llm.response.model"
	attrMetricModelRequest  = "gen_ai.request.model"
)

// processMetrics resolves tenant/model/cost for every token-usage data point.
// Non-token-usage metrics are passed through untouched; the exporter ignores
// them. Cumulative token-usage metrics are rejected (see rejectCumulative). A
// retryable tenant-lookup failure fails the batch so the collector retries it.
func (p *metricsProcessor) processMetrics(ctx context.Context, md pmetric.Metrics) (pmetric.Metrics, error) {
	var retryErr error

	rms := md.ResourceMetrics()
	for i := 0; i < rms.Len(); i++ {
		rm := rms.At(i)
		resourceAttrs := rm.Resource().Attributes()
		sms := rm.ScopeMetrics()
		for j := 0; j < sms.Len(); j++ {
			sms.At(j).Metrics().RemoveIf(func(m pmetric.Metric) bool {
				if m.Name() != metricTokenUsage {
					return false
				}
				points := tokenUsagePoints(m)
				if temporality(m) == pmetric.AggregationTemporalityCumulative {
					p.rejectCumulative(m, len(points))
					return true
				}
				for _, pt := range points {
					p.enrichPoint(ctx, pt, resourceAttrs, &retryErr)
				}
				return false
			})
		}
	}

	if retryErr != nil {
		return md, retryErr
	}
	return md, nil
}

// temporality reports how a metric's data points are aggregated. Types that
// carry no temporality (gauge, summary) report unspecified.
func temporality(m pmetric.Metric) pmetric.AggregationTemporality {
	switch m.Type() {
	case pmetric.MetricTypeHistogram:
		return m.Histogram().AggregationTemporality()
	case pmetric.MetricTypeSum:
		return m.Sum().AggregationTemporality()
	case pmetric.MetricTypeExponentialHistogram:
		return m.ExponentialHistogram().AggregationTemporality()
	default:
		return pmetric.AggregationTemporalityUnspecified
	}
}

// rejectCumulative drops a cumulative token-usage metric and says so loudly.
//
// Downstream, every token-usage point is stored as its own row and the query
// layer sums those rows, which is only correct for DELTA points (per-interval
// increments). A CUMULATIVE point is a running total, so summing N exports of
// the same series yields (N+1)/2 times the real usage — 1440 exports a day
// means ~720x the real tokens and cost.
//
// We reject rather than convert. Converting means keeping the previous value
// per series in memory, which is wrong in exactly the deployments that matter:
// the state is lost on every collector restart and is per-instance, so any
// horizontally scaled collector splits a series across replicas and
// under/over-counts anyway. A rejected export is a visible, bounded gap; a
// silently mis-summed one is an unbounded, invisible cost error. Clients fix
// this on their side in one line by exporting DELTA temporality (see
// examples/openai_to_tracium.py).
//
// Unspecified temporality is treated as delta: it means the client never set
// the field, and delta is the only reading under which per-point rows sum
// correctly.
func (p *metricsProcessor) rejectCumulative(m pmetric.Metric, points int) {
	p.logger.Warn("dropped cumulative token-usage metric: only DELTA temporality can be summed correctly",
		zap.String("metric", m.Name()),
		zap.String("temporality", "cumulative"),
		zap.Int("dropped_data_points", points),
		zap.String("fix", "configure the OTel SDK metric exporter for DELTA temporality on sum/histogram instruments"),
	)
}

// usagePoint is one token-usage data point reduced to what enrichment needs:
// its attribute map (mutated in place) and the token total for the interval.
type usagePoint struct {
	attrs  pcommon.Map
	tokens int64
}

// tokenUsagePoints returns the histogram (OpenLLMetry's shape) or sum data
// points of a token-usage metric, whichever it carries.
func tokenUsagePoints(m pmetric.Metric) []usagePoint {
	var points []usagePoint
	switch m.Type() {
	case pmetric.MetricTypeHistogram:
		dps := m.Histogram().DataPoints()
		for i := 0; i < dps.Len(); i++ {
			dp := dps.At(i)
			points = append(points, usagePoint{attrs: dp.Attributes(), tokens: int64(dp.Sum())})
		}
	case pmetric.MetricTypeSum:
		dps := m.Sum().DataPoints()
		for i := 0; i < dps.Len(); i++ {
			dp := dps.At(i)
			points = append(points, usagePoint{attrs: dp.Attributes(), tokens: dataPointValue(dp)})
		}
	}
	return points
}

// dataPointValue reads a numeric sum data point as int64 regardless of whether
// it carries an int or double value.
func dataPointValue(dp pmetric.NumberDataPoint) int64 {
	switch dp.ValueType() {
	case pmetric.NumberDataPointValueTypeInt:
		return dp.IntValue()
	case pmetric.NumberDataPointValueTypeDouble:
		return int64(dp.DoubleValue())
	default:
		return 0
	}
}

// enrichPoint stamps tracium.* attributes onto a single token-usage point.
func (p *metricsProcessor) enrichPoint(
	ctx context.Context,
	pt usagePoint,
	resourceAttrs pcommon.Map,
	retryErr *error,
) {
	attrs := pt.attrs
	modelNormalized := strings.ToLower(strings.TrimSpace(metricModel(attrs)))
	tenantID := resolveTenant(ctx, p.tenant, metricTenant(attrs, resourceAttrs), retryErr)

	// Price the point as input-only or output-only depending on its type.
	var cost float64
	if p.pricing != nil && modelNormalized != "" {
		var u pricing.Usage
		if isOutputToken(attrs) {
			u.Output = pt.tokens
		} else {
			u.Input = pt.tokens
		}
		if c, err := p.pricing.Resolve(ctx, modelNormalized, u); err == nil {
			cost = c
		}
	}

	attrs.PutDouble(attrCostUSD, cost)
	attrs.PutStr(attrModelNormalized, modelNormalized)
	if tenantID != "" {
		attrs.PutStr(attrTenantID, tenantID)
	}
}

// resolveTenant applies the tenant resolver, mirroring TenantEnricher: a nil
// resolver or empty tenant is a no-op; a retryable failure is surfaced.
func resolveTenant(ctx context.Context, r tenant.Resolver, raw string, retryErr *error) string {
	if r == nil || raw == "" {
		return raw
	}
	resolved, err := r.Resolve(ctx, raw)
	if err != nil {
		*retryErr = err
		return raw
	}
	return resolved
}

// metricModel reads the model name from the data point, trying the semconv key
// first and OpenLLMetry's legacy key as a fallback.
func metricModel(attrs pcommon.Map) string {
	for _, key := range []string{attrMetricModelResponse, attrMetricModelLegacy, attrMetricModelRequest} {
		if v, ok := attrs.Get(key); ok && v.AsString() != "" {
			return v.AsString()
		}
	}
	return ""
}

// metricTenant reads the tenant from the data point, falling back to the
// resource — the same precedence spans use.
func metricTenant(attrs, resourceAttrs pcommon.Map) string {
	if v, ok := attrs.Get(attrTenantID); ok && v.AsString() != "" {
		return v.AsString()
	}
	if v, ok := resourceAttrs.Get(attrTenantID); ok {
		return v.AsString()
	}
	return ""
}

// isOutputToken reports whether a token-usage point measures output (completion)
// tokens. Anything else (input, missing) is treated as input.
func isOutputToken(attrs pcommon.Map) bool {
	if v, ok := attrs.Get(attrTokenType); ok {
		return strings.EqualFold(v.AsString(), "output")
	}
	return false
}
