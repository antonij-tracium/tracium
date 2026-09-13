package traciumprocessor

import (
	"context"
	"strings"

	"github.com/tracium/collector/internal/ingest"
	"github.com/tracium/collector/internal/pricing"
	"github.com/tracium/collector/internal/user"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.uber.org/zap"
)

// metricsProcessor enriches OpenLLMetry's gen_ai.client.token.usage data points
// with the same user resolution, model normalisation, and pricing the traces
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
	user    user.Resolver
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

// processMetrics resolves user/model/cost for every token-usage data point.
// Non-token-usage metrics are passed through untouched; the exporter ignores
// them. Cumulative token-usage metrics are rejected (see rejectCumulative). A
// retryable user-lookup failure fails the batch so the collector retries it.
func (p *metricsProcessor) processMetrics(ctx context.Context, md pmetric.Metrics) (pmetric.Metrics, error) {
	var retryErr error

	// Resolve the ingest key's workspace once for the whole request, exactly as the
	// traces path does. When no verified key authenticated the request, every
	// token-usage point is dropped below — the same fail-closed backstop that keeps
	// keyless spans out, so keyless usage is never priced or stored even if the
	// receiver's authenticator is absent.
	scope := ingestScope(ctx)

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
				if !scope.authenticated {
					p.rejectUnauthenticated(m, numDataPoints(m))
					return true
				}
				if temporality(m) == pmetric.AggregationTemporalityCumulative {
					p.rejectCumulative(m, numDataPoints(m))
					return true
				}
				p.boundAndEnrich(ctx, m, resourceAttrs, &retryErr)
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

// rejectUnauthenticated drops a token-usage metric that arrived without a
// verified ingest key and says so. It mirrors the traces path's keyless-span
// backstop: the receiver's traciumauth authenticator normally rejects such a
// request with 401 first, so reaching here means that authenticator is absent or
// misconfigured — in which case the workspace is unknown and the usage must not
// be priced or stored.
func (p *metricsProcessor) rejectUnauthenticated(m pmetric.Metric, points int) {
	p.logger.Warn("dropped token-usage metric: ingest requires a verified API key",
		zap.String("metric", m.Name()),
		zap.Int("dropped_data_points", points),
	)
}

// usagePoint is one token-usage data point reduced to what enrichment needs:
// its attribute map (mutated in place) and the token total for the interval.
type usagePoint struct {
	attrs  pcommon.Map
	tokens int64
}

// numDataPoints counts the token-usage data points on a metric (for logging).
func numDataPoints(m pmetric.Metric) int {
	switch m.Type() {
	case pmetric.MetricTypeHistogram:
		return m.Histogram().DataPoints().Len()
	case pmetric.MetricTypeSum:
		return m.Sum().DataPoints().Len()
	default:
		return 0
	}
}

// boundAndEnrich enforces the ingest token bound on every data point and
// enriches those that pass. Points whose token count is out of range are dropped
// (removed from the metric) rather than priced: the metrics path shares the OTLP
// receivers with spans and must apply the same ceiling the span chain does, or a
// single point claiming 1e15 tokens would be priced at billions and corrupt every
// sum(cost_usd) aggregate. Identifier sanitization happens in enrichPoint.
func (p *metricsProcessor) boundAndEnrich(
	ctx context.Context,
	m pmetric.Metric,
	resourceAttrs pcommon.Map,
	retryErr *error,
) {
	switch m.Type() {
	case pmetric.MetricTypeHistogram:
		m.Histogram().DataPoints().RemoveIf(func(dp pmetric.HistogramDataPoint) bool {
			return p.boundPoint(ctx, m.Name(), usagePoint{attrs: dp.Attributes(), tokens: int64(dp.Sum())}, resourceAttrs, retryErr)
		})
	case pmetric.MetricTypeSum:
		m.Sum().DataPoints().RemoveIf(func(dp pmetric.NumberDataPoint) bool {
			return p.boundPoint(ctx, m.Name(), usagePoint{attrs: dp.Attributes(), tokens: dataPointValue(dp)}, resourceAttrs, retryErr)
		})
	}
}

// boundPoint reports whether a data point should be dropped. A token count
// outside the accepted range is rejected loudly and dropped; otherwise the point
// is enriched in place and kept.
func (p *metricsProcessor) boundPoint(
	ctx context.Context,
	metricName string,
	pt usagePoint,
	resourceAttrs pcommon.Map,
	retryErr *error,
) bool {
	if !ingest.TokensInRange(pt.tokens) {
		p.logger.Warn("dropped token-usage data point: token count out of range",
			zap.String("metric", metricName),
			zap.Int64("tokens", pt.tokens),
			zap.Int64("limit", ingest.MaxTokensPerCall),
		)
		return true
	}
	p.enrichPoint(ctx, pt, resourceAttrs, retryErr)
	return false
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
	// Sanitize and length-cap the client-controlled identifiers, matching the
	// span chain (NormalizeModelEnricher / UserEnricher): both feed
	// LowCardinality grouping columns downstream.
	modelNormalized := ingest.SanitizeIdentifier(strings.ToLower(strings.TrimSpace(metricModel(attrs))), ingest.MaxModelNameBytes)
	userID := ingest.SanitizeIdentifier(resolveUser(ctx, p.user, metricUser(attrs, resourceAttrs), retryErr), ingest.MaxUserIDBytes)

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
	if userID != "" {
		attrs.PutStr(attrUserID, userID)
	}
	// The ingest key decides the workspace for metrics exactly as for spans: stamp
	// the verified key's workspace onto the point (the exporter reads workspace_id
	// from the point, not the resource), overriding anything the sender set. Empty
	// only when no key authenticated the request — which the receiver's traciumauth
	// authenticator rejects before the pipeline runs.
	if ws := ingestScope(ctx).workspace; ws != "" {
		attrs.PutStr(attrWorkspaceID, ws)
	}
}

// resolveUser applies the user resolver, mirroring UserEnricher: a nil
// resolver or empty user is a no-op; a retryable failure is surfaced.
func resolveUser(ctx context.Context, r user.Resolver, raw string, retryErr *error) string {
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

// metricUser reads the user from the data point, falling back to the
// resource — the same precedence spans use.
func metricUser(attrs, resourceAttrs pcommon.Map) string {
	if v, ok := attrs.Get(attrUserID); ok && v.AsString() != "" {
		return v.AsString()
	}
	if v, ok := resourceAttrs.Get(attrUserID); ok {
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
