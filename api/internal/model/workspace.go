package model

// Workspace is a named environment owned by a user account.
type Workspace struct {
	ID      string `json:"id"`
	UserID  string `json:"-"`
	Name    string `json:"name"`
	Slug    string `json:"slug"`
	Env     string `json:"env"`
	Role    string `json:"role"`
	Members int    `json:"members"`
	Plan    string `json:"plan"`
}
