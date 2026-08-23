package model

// Principal represents the authenticated identity for an incoming request.
// It is set in context by the auth middleware and consumed by handlers.
type Principal struct {
	UserID   string
	TenantID string
	Role     string
}
