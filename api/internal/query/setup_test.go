package query

import (
	"strings"
	"testing"
)

func TestSpanIssuesSQLCoversOnlySpanLevelChecks(t *testing.T) {
	for _, c := range setupChecks {
		want := c.cond != "" && !c.everySpan
		if got := strings.Contains(spanIssuesSQL, "'"+c.Code+"'"); got != want {
			t.Errorf("%s in spanIssuesSQL = %v, want %v", c.Code, got, want)
		}
		if setupIssueByCode[c.Code] != c.SetupIssue {
			t.Errorf("setupIssueByCode[%q] does not resolve to its check", c.Code)
		}
		if (c.cond == "") == (c.agg == "") {
			t.Errorf("%s must define exactly one of cond and agg", c.Code)
		}
	}
}
