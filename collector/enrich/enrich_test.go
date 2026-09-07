package enrich

import (
	"context"
	"errors"
	"strings"
	"testing"

	customerrors "github.com/tracium/collector/internal/errors"
	"github.com/tracium/collector/internal/pricing"
	"github.com/tracium/collector/pkg/spanmodel"
)

func validSpan() *spanmodel.Span {
	return &spanmodel.Span{
		TraceID:      "t1",
		SpanID:       "s1",
		StartTimeMs:  1,
		Model:        "  GPT-4o ",
		InputTokens:  1000,
		OutputTokens: 1000,
	}
}

func TestDefaultChain_HappyPath(t *testing.T) {
	chain := DefaultChain(pricing.NewStaticResolver(pricing.DefaultPrices()), nil, nil)
	span := validSpan()

	res, err := chain.Apply(context.Background(), span)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res != ResultKeep {
		t.Fatalf("got Result %v, want ResultKeep", res)
	}
	if span.ModelNormalized != "gpt-4o" {
		t.Errorf("ModelNormalized = %q, want %q", span.ModelNormalized, "gpt-4o")
	}
	// gpt-4o: 1000*0.0000025 + 1000*0.00001 = 0.0125
	if span.CostUSD != 0.0125 {
		t.Errorf("CostUSD = %v, want 0.0125", span.CostUSD)
	}
	if span.SchemaVersion != 1 {
		t.Errorf("SchemaVersion = %d, want 1", span.SchemaVersion)
	}
}

func TestValidate_DropsInvalidSpan(t *testing.T) {
	chain := DefaultChain(nil, nil, nil)
	span := validSpan()
	span.TraceID = "" // invalid

	res, err := chain.Apply(context.Background(), span)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res != ResultDrop {
		t.Fatalf("got Result %v, want ResultDrop", res)
	}
}

func TestPricing_ReportedCostIsIgnoredByDefault(t *testing.T) {
	chain := DefaultChain(pricing.NewStaticResolver(pricing.DefaultPrices()), nil, nil)
	span := validSpan()
	span.ReportedCostUSD = 1_000_000 // hostile client on an unauthenticated port

	if _, err := chain.Apply(context.Background(), span); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if span.CostUSD != 0.0125 {
		t.Errorf("CostUSD = %v, want the table-derived 0.0125", span.CostUSD)
	}
}

func TestPricing_ReportedCostUsedWhenTrusted(t *testing.T) {
	e := PricingEnricher{
		Resolver:          pricing.NewStaticResolver(pricing.DefaultPrices()),
		TrustReportedCost: true,
	}
	span := validSpan()
	span.ModelNormalized = "gpt-4o"
	span.ReportedCostUSD = 0.42

	if err := e.Enrich(context.Background(), span); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if span.CostUSD != 0.42 {
		t.Errorf("CostUSD = %v, want 0.42 (reported cost)", span.CostUSD)
	}
}

func TestValidate_DropsOutOfRangeTokenCounts(t *testing.T) {
	chain := DefaultChain(pricing.NewStaticResolver(pricing.DefaultPrices()), nil, nil)
	span := validSpan()
	span.InputTokens = 1 << 62 // ~$3.4 trillion at gpt-4o rates

	res, err := chain.Apply(context.Background(), span)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res != ResultDrop {
		t.Fatalf("got Result %v, want ResultDrop", res)
	}
}

func TestValidate_DropsEndBeforeStart(t *testing.T) {
	chain := DefaultChain(nil, nil, nil)
	span := validSpan()
	span.StartTimeMs = 1_700_000_060_000
	span.EndTimeMs = 1_700_000_000_000 // 60s of clock skew

	res, err := chain.Apply(context.Background(), span)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res != ResultDrop {
		t.Fatalf("got Result %v, want ResultDrop", res)
	}
}

func TestValidate_DropsOversizedModelName(t *testing.T) {
	chain := DefaultChain(nil, nil, nil)
	span := validSpan()
	span.Model = strings.Repeat("x", 100_000)

	res, err := chain.Apply(context.Background(), span)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res != ResultDrop {
		t.Fatalf("got Result %v, want ResultDrop", res)
	}
}

func TestUser_ControlCharactersAreStripped(t *testing.T) {
	chain := DefaultChain(nil, nil, nil)
	span := validSpan()
	span.UserID = "evil\x00user\nsecond-line"

	if _, err := chain.Apply(context.Background(), span); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if span.UserID != "evilusersecond-line" {
		t.Errorf("UserID = %q, want control characters removed", span.UserID)
	}
}

func TestPricing_CachedTokensReduceCost(t *testing.T) {
	chain := DefaultChain(pricing.NewStaticResolver(pricing.DefaultPrices()), nil, nil)
	span := validSpan()
	span.OutputTokens = 0
	span.CacheReadTokens = 800 // 800 of the 1000 input tokens came from cache

	if _, err := chain.Apply(context.Background(), span); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// gpt-4o: 200 regular input * 0.0000025 + 800 cached * 0.00000125
	want := 200*0.0000025 + 800*0.00000125
	if span.CostUSD != want {
		t.Errorf("CostUSD = %v, want %v", span.CostUSD, want)
	}
}

func TestPricing_UnknownModelKeepsSpanWithZeroCost(t *testing.T) {
	chain := DefaultChain(pricing.NewStaticResolver(pricing.DefaultPrices()), nil, nil)
	span := validSpan()
	span.Model = "some-unlisted-model"

	res, err := chain.Apply(context.Background(), span)
	if err != nil || res != ResultKeep {
		t.Fatalf("got (%v, %v), want (ResultKeep, nil)", res, err)
	}
	if span.CostUSD != 0 {
		t.Errorf("CostUSD = %v, want 0 for unpriced model", span.CostUSD)
	}
}

func TestFilter_DropsDisallowedModel(t *testing.T) {
	chain := DefaultChain(nil, nil, []string{"gpt-4o"})

	span := validSpan()
	span.Model = "claude-3-opus"
	res, _ := chain.Apply(context.Background(), span)
	if res != ResultDrop {
		t.Errorf("disallowed model: got %v, want ResultDrop", res)
	}

	allowed := validSpan() // normalizes to gpt-4o
	res, _ = chain.Apply(context.Background(), allowed)
	if res != ResultKeep {
		t.Errorf("allowed model: got %v, want ResultKeep", res)
	}
}

// retryUserResolver always fails, simulating a transient backend outage.
type retryUserResolver struct{}

func (retryUserResolver) Resolve(context.Context, string) (string, error) {
	return "", errors.New("postgres down")
}

func TestUser_RetryableErrorPropagates(t *testing.T) {
	chain := DefaultChain(nil, retryUserResolver{}, nil)
	span := validSpan()
	span.UserID = "api-key-123" // triggers a lookup

	res, err := chain.Apply(context.Background(), span)
	if res != ResultKeep {
		t.Fatalf("got Result %v, want ResultKeep (let the queue retry)", res)
	}
	if !customerrors.IsRetryable(err) {
		t.Fatalf("expected a retryable transient error, got %v", err)
	}
}
