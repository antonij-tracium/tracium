package model

import "time"

// WorkspaceMember is one account's membership of a workspace, as listed back to
// the workspace's members.
type WorkspaceMember struct {
	UserID   string    `json:"user_id"`
	Email    string    `json:"email"`
	Role     string    `json:"role"`
	JoinedAt time.Time `json:"joined_at"`
}

// WorkspaceInvite is an open invitation for an email address to join a
// workspace. The link token is never held here: it is returned once, at
// creation (see CreatedInvite), and only its hash is stored.
type WorkspaceInvite struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspace_id"`
	Email       string    `json:"email"`
	Role        string    `json:"role"`
	InvitedBy   string    `json:"invited_by"`
	CreatedAt   time.Time `json:"created_at"`
	ExpiresAt   time.Time `json:"expires_at"`
}

// CreatedInvite is the response to creating an invite: the invite plus its
// plaintext link token, which the caller must capture now — it cannot be
// retrieved again.
type CreatedInvite struct {
	WorkspaceInvite
	Token string `json:"token"`
}

// InvitePreview is what the holder of an invite link may see before accepting:
// enough to decide whether to join, and which account to sign in with.
type InvitePreview struct {
	WorkspaceName  string    `json:"workspace_name"`
	InvitedByEmail string    `json:"invited_by_email"`
	Email          string    `json:"email"`
	ExpiresAt      time.Time `json:"expires_at"`
}
