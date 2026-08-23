package errors

import (
	"fmt"
	"net/http"
)

// APIError is a typed error that carries an HTTP status code and a machine-readable code.
type APIError struct {
	Code       string
	Message    string
	HTTPStatus int
}

func (e *APIError) Error() string {
	return fmt.Sprintf("[%s] %s (HTTP %d)", e.Code, e.Message, e.HTTPStatus)
}

// NewAPIError constructs a new APIError.
func NewAPIError(code, message string, status int) *APIError {
	return &APIError{Code: code, Message: message, HTTPStatus: status}
}

// Common pre-built API errors.
var (
	ErrNotFound     = NewAPIError("NOT_FOUND", "the requested resource was not found", http.StatusNotFound)
	ErrUnauthorized = NewAPIError("UNAUTHORIZED", "authentication is required", http.StatusUnauthorized)
	ErrForbidden    = NewAPIError("FORBIDDEN", "you do not have permission to access this resource", http.StatusForbidden)
	ErrBadRequest   = NewAPIError("BAD_REQUEST", "the request was malformed or invalid", http.StatusBadRequest)
	ErrInternal     = NewAPIError("INTERNAL", "an internal server error occurred", http.StatusInternalServerError)
)
