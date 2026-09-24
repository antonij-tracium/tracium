package model

import "time"

// WorkspaceMember is an account's membership of a workspace.
type WorkspaceMember struct {
	UserID   string    `json:"user_id"`
	Email    string    `json:"email"`
	Role     string    `json:"role"`
	JoinedAt time.Time `json:"joined_at"`
}

// WorkspaceInvite is an open invitation for an email address to join a workspace.
type WorkspaceInvite struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspace_id"`
	Email       string    `json:"email"`
	Role        string    `json:"role"`
	InvitedBy   string    `json:"invited_by"`
	CreatedAt   time.Time `json:"created_at"`
	ExpiresAt   time.Time `json:"expires_at"`
}

// CreatedInvite carries the link token, which is returned only at creation.
type CreatedInvite struct {
	WorkspaceInvite
	Token string `json:"token"`
}

// InvitePreview is what an invite link's holder sees before accepting.
type InvitePreview struct {
	WorkspaceName  string    `json:"workspace_name"`
	InvitedByEmail string    `json:"invited_by_email"`
	Email          string    `json:"email"`
	ExpiresAt      time.Time `json:"expires_at"`
}
