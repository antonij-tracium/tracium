package model

// User is a registered account. PasswordHash is never serialized to clients.
type User struct {
	ID           string
	Email        string
	PasswordHash string
	TenantID     string
	Role         string
}
