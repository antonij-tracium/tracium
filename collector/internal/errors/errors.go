package errors

import "fmt"

// ---------------------------------------------------------------------------
// SpanError — permanent, unrecoverable problems with a single span.
// Spans that produce a SpanError are sent to the dead-letter store.
// ---------------------------------------------------------------------------

// SpanErrorCode identifies what went wrong with a span.
type SpanErrorCode string

const (
	ErrMissingTraceID   SpanErrorCode = "missing_trace_id"
	ErrMissingSpanID    SpanErrorCode = "missing_span_id"
	ErrInvalidTimestamp SpanErrorCode = "invalid_timestamp"
	ErrUnknownModel     SpanErrorCode = "unknown_model"
	ErrMalformedPayload SpanErrorCode = "malformed_payload"
	// ErrTokenCountOutOfRange marks a usage count no real call could produce.
	ErrTokenCountOutOfRange SpanErrorCode = "token_count_out_of_range"
	// ErrFieldTooLong marks a client-controlled string past its ingest cap.
	ErrFieldTooLong SpanErrorCode = "field_too_long"
)

// SpanError represents a permanent validation or parsing failure for one span.
type SpanError struct {
	Code    SpanErrorCode
	Message string
	Cause   error
}

func (e *SpanError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("span error [%s]: %s: %v", e.Code, e.Message, e.Cause)
	}
	return fmt.Sprintf("span error [%s]: %s", e.Code, e.Message)
}

func (e *SpanError) Unwrap() error { return e.Cause }

// ---------------------------------------------------------------------------
// TransientError — temporary infrastructure failures.
// Retryable errors may be retried by the pipeline; non-retryable errors cause
// the span to be dropped silently.
// ---------------------------------------------------------------------------

// TransientErrorCode identifies the nature of a transient failure.
type TransientErrorCode string

const (
	ErrDatabaseUnavailable TransientErrorCode = "database_unavailable"
	ErrPricingUnavailable  TransientErrorCode = "pricing_unavailable"
	ErrUserLookupFailed  TransientErrorCode = "user_lookup_failed"
	ErrWriteTimeout        TransientErrorCode = "write_timeout"
)

// TransientError represents a temporary infrastructure failure.
type TransientError struct {
	Code      TransientErrorCode
	Message   string
	Cause     error
	Retryable bool
}

func (e *TransientError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("transient error [%s] (retryable=%v): %s: %v", e.Code, e.Retryable, e.Message, e.Cause)
	}
	return fmt.Sprintf("transient error [%s] (retryable=%v): %s", e.Code, e.Retryable, e.Message)
}

func (e *TransientError) Unwrap() error { return e.Cause }

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

// InvalidSpan creates a SpanError with no cause.
func InvalidSpan(code SpanErrorCode, msg string) *SpanError {
	return &SpanError{Code: code, Message: msg}
}

// InvalidSpanf creates a SpanError with a formatted message.
func InvalidSpanf(code SpanErrorCode, format string, args ...any) *SpanError {
	return &SpanError{Code: code, Message: fmt.Sprintf(format, args...)}
}

// InvalidSpanWrap creates a SpanError that wraps a cause.
func InvalidSpanWrap(code SpanErrorCode, msg string, err error) *SpanError {
	return &SpanError{Code: code, Message: msg, Cause: err}
}

// Transient creates a TransientError with no cause.
func Transient(code TransientErrorCode, msg string, retryable bool) *TransientError {
	return &TransientError{Code: code, Message: msg, Retryable: retryable}
}

// TransientWrap creates a TransientError that wraps a cause.
func TransientWrap(code TransientErrorCode, msg string, err error, retryable bool) *TransientError {
	return &TransientError{Code: code, Message: msg, Cause: err, Retryable: retryable}
}

// ---------------------------------------------------------------------------
// Inspectors
// ---------------------------------------------------------------------------

// IsSpanError reports whether err (or any in its chain) is a *SpanError.
func IsSpanError(err error) bool {
	if err == nil {
		return false
	}
	_, ok := unwrapAs[*SpanError](err)
	return ok
}

// IsTransient reports whether err (or any in its chain) is a *TransientError.
func IsTransient(err error) bool {
	if err == nil {
		return false
	}
	_, ok := unwrapAs[*TransientError](err)
	return ok
}

// IsRetryable reports whether err is a retryable TransientError.
func IsRetryable(err error) bool {
	if err == nil {
		return false
	}
	te, ok := unwrapAs[*TransientError](err)
	if !ok {
		return false
	}
	return te.Retryable
}

// SpanErrorCode_ returns the SpanErrorCode for a SpanError, or "" if err is
// not a SpanError.
func SpanErrorCode_(err error) SpanErrorCode {
	if err == nil {
		return ""
	}
	se, ok := unwrapAs[*SpanError](err)
	if !ok {
		return ""
	}
	return se.Code
}

// unwrapAs walks the error chain looking for a value assignable to *T.
func unwrapAs[T error](err error) (T, bool) {
	for err != nil {
		if v, ok := err.(T); ok {
			return v, true
		}
		type unwrapper interface{ Unwrap() error }
		u, ok := err.(unwrapper)
		if !ok {
			break
		}
		err = u.Unwrap()
	}
	var zero T
	return zero, false
}
