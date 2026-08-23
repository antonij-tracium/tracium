package model

// ErrorResponse is the standard JSON shape for all API errors.
// Code is machine-readable (SCREAMING_SNAKE_CASE).
// Message is human-readable, suitable for display.
type ErrorResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
