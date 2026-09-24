package workspace

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/tracium/api/internal/model"
)

// InviteTTL is how long an invite link stays valid after it is created.
const InviteTTL = 7 * 24 * time.Hour

// inviteTokenPrefix marks invite links' tokens so they are recognisable, and
// distinct from ingest keys (trc_) if one is pasted in the wrong place.
const inviteTokenPrefix = "trci_"

// inviteSecretBytes is the entropy behind each invite token (256 bits).
const inviteSecretBytes = 32

var (
	// ErrInviteNotFound is returned when no invite matches a token or id.
	ErrInviteNotFound = errors.New("invite not found")
	// ErrInviteClosed is returned when an invite exists but no longer admits
	// anyone: it was accepted, revoked, or has expired.
	ErrInviteClosed = errors.New("invite is no longer valid")
	// ErrInviteEmailMismatch is returned when the accepting account's email is
	// not the address the invite was issued to.
	ErrInviteEmailMismatch = errors.New("invite was issued to a different email")
	// ErrAlreadyMember is returned when inviting an email whose account is
	// already a member of the workspace.
	ErrAlreadyMember = errors.New("already a member")
)

// InviteStore persists workspace invitations. Tokens cross this boundary only as
// hashes (see HashInviteToken); the plaintext never reaches the database.
type InviteStore interface {
	// CreateInvite stores an open invite. Any existing open invite for the same
	// workspace and email is revoked in the same transaction, so only the newest
	// link works. It fills inv's CreatedAt, and returns ErrAlreadyMember when an
	// account with that email already belongs to the workspace.
	CreateInvite(ctx context.Context, inv *model.WorkspaceInvite, tokenHash string) error
	// ListInvites returns the workspace's open, unexpired invites.
	ListInvites(ctx context.Context, workspaceID string) ([]model.WorkspaceInvite, error)
	// RevokeInvite closes an open invite in the workspace, or returns
	// ErrInviteNotFound.
	RevokeInvite(ctx context.Context, workspaceID, inviteID string) error
	// PreviewInvite describes the invite behind a token hash. It returns
	// ErrInviteNotFound for an unknown token and ErrInviteClosed for one that
	// can no longer be accepted.
	PreviewInvite(ctx context.Context, tokenHash string) (*model.InvitePreview, error)
	// AcceptInvite adds the account to the invite's workspace as a member and
	// closes the invite, atomically. email must be the account's own (stored,
	// normalized) email; it must equal the invited address. Returns the joined
	// workspace's id.
	AcceptInvite(ctx context.Context, tokenHash, userID, email string) (string, error)
}

// NewInviteToken mints a fresh invite token and its storable hash. An RNG
// failure is surfaced — a guessable link must never be issued.
func NewInviteToken() (token, hash string, err error) {
	buf := make([]byte, inviteSecretBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", "", fmt.Errorf("workspace: read random: %w", err)
	}
	token = inviteTokenPrefix + hex.EncodeToString(buf)
	return token, HashInviteToken(token), nil
}

// HashInviteToken derives the stored lookup hash for an invite token. A plain
// SHA-256 is enough because the token is already high-entropy.
func HashInviteToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// LooksLikeInviteToken reports whether a string is shaped like an invite token,
// so malformed input can be rejected before touching the database.
func LooksLikeInviteToken(token string) bool {
	return strings.HasPrefix(token, inviteTokenPrefix) &&
		len(token) == len(inviteTokenPrefix)+hex.EncodedLen(inviteSecretBytes)
}

// ListMembers returns the workspace's members with their emails, oldest first.
func (s *PostgresStore) ListMembers(ctx context.Context, workspaceID string) ([]model.WorkspaceMember, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT m.user_id, u.email, m.role, m.created_at
		   FROM workspace_members m
		   JOIN users u ON u.id::text = m.user_id
		  WHERE m.workspace_id = $1
		  ORDER BY m.created_at, u.email`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("workspace store: list members: %w", err)
	}
	defer rows.Close()

	var members []model.WorkspaceMember
	for rows.Next() {
		var m model.WorkspaceMember
		if err := rows.Scan(&m.UserID, &m.Email, &m.Role, &m.JoinedAt); err != nil {
			return nil, fmt.Errorf("workspace store: scan member: %w", err)
		}
		members = append(members, m)
	}
	return members, rows.Err()
}

// CreateInvite stores an open invite, replacing any open one for the same email.
func (s *PostgresStore) CreateInvite(ctx context.Context, inv *model.WorkspaceInvite, tokenHash string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("workspace store: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after a successful Commit

	var member bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS (
		   SELECT 1 FROM workspace_members m JOIN users u ON u.id::text = m.user_id
		    WHERE m.workspace_id = $1 AND u.email = $2)`,
		inv.WorkspaceID, inv.Email).Scan(&member); err != nil {
		return fmt.Errorf("workspace store: check member: %w", err)
	}
	if member {
		return ErrAlreadyMember
	}

	if _, err := tx.Exec(ctx,
		`UPDATE workspace_invites SET revoked_at = NOW()
		  WHERE workspace_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
		inv.WorkspaceID, inv.Email); err != nil {
		return fmt.Errorf("workspace store: replace invite: %w", err)
	}
	if err := tx.QueryRow(ctx,
		`INSERT INTO workspace_invites (id, workspace_id, email, role, token_hash, invited_by, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING created_at`,
		inv.ID, inv.WorkspaceID, inv.Email, inv.Role, tokenHash, inv.InvitedBy, inv.ExpiresAt,
	).Scan(&inv.CreatedAt); err != nil {
		return fmt.Errorf("workspace store: create invite: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("workspace store: commit: %w", err)
	}
	return nil
}

// ListInvites returns the workspace's open, unexpired invites, newest first.
func (s *PostgresStore) ListInvites(ctx context.Context, workspaceID string) ([]model.WorkspaceInvite, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, workspace_id, email, role, invited_by, created_at, expires_at
		   FROM workspace_invites
		  WHERE workspace_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
		  ORDER BY created_at DESC`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("workspace store: list invites: %w", err)
	}
	defer rows.Close()

	var invites []model.WorkspaceInvite
	for rows.Next() {
		var inv model.WorkspaceInvite
		if err := rows.Scan(&inv.ID, &inv.WorkspaceID, &inv.Email, &inv.Role, &inv.InvitedBy, &inv.CreatedAt, &inv.ExpiresAt); err != nil {
			return nil, fmt.Errorf("workspace store: scan invite: %w", err)
		}
		invites = append(invites, inv)
	}
	return invites, rows.Err()
}

// RevokeInvite closes an open invite belonging to the workspace.
func (s *PostgresStore) RevokeInvite(ctx context.Context, workspaceID, inviteID string) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE workspace_invites SET revoked_at = NOW()
		  WHERE id::text = $1 AND workspace_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
		inviteID, workspaceID)
	if err != nil {
		return fmt.Errorf("workspace store: revoke invite: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrInviteNotFound
	}
	return nil
}

// PreviewInvite describes the invite behind a token hash.
func (s *PostgresStore) PreviewInvite(ctx context.Context, tokenHash string) (*model.InvitePreview, error) {
	var (
		p                            model.InvitePreview
		accepted, revoked, isExpired bool
	)
	err := s.pool.QueryRow(ctx,
		`SELECT w.name, COALESCE(u.email, ''), i.email, i.expires_at,
		        i.accepted_at IS NOT NULL, i.revoked_at IS NOT NULL, i.expires_at <= NOW()
		   FROM workspace_invites i
		   JOIN workspaces w ON w.id = i.workspace_id
		   LEFT JOIN users u ON u.id::text = i.invited_by
		  WHERE i.token_hash = $1`, tokenHash,
	).Scan(&p.WorkspaceName, &p.InvitedByEmail, &p.Email, &p.ExpiresAt, &accepted, &revoked, &isExpired)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrInviteNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("workspace store: preview invite: %w", err)
	}
	if accepted || revoked || isExpired {
		return nil, ErrInviteClosed
	}
	return &p, nil
}

// AcceptInvite joins the account to the invite's workspace and closes the
// invite. The row is locked for the transaction so two concurrent accepts of the
// same link cannot both succeed.
func (s *PostgresStore) AcceptInvite(ctx context.Context, tokenHash, userID, email string) (string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("workspace store: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after a successful Commit

	var (
		id, workspaceID, invited, role string
		open                           bool
	)
	err = tx.QueryRow(ctx,
		`SELECT id::text, workspace_id, email, role,
		        accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
		   FROM workspace_invites
		  WHERE token_hash = $1
		    FOR UPDATE`, tokenHash,
	).Scan(&id, &workspaceID, &invited, &role, &open)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrInviteNotFound
	}
	if err != nil {
		return "", fmt.Errorf("workspace store: load invite: %w", err)
	}
	if !open {
		return "", ErrInviteClosed
	}
	if !strings.EqualFold(invited, email) {
		return "", ErrInviteEmailMismatch
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)
		 ON CONFLICT (workspace_id, user_id) DO NOTHING`,
		workspaceID, userID, role); err != nil {
		return "", fmt.Errorf("workspace store: add member: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE workspace_invites SET accepted_at = NOW(), accepted_by = $2 WHERE id::text = $1`,
		id, userID); err != nil {
		return "", fmt.Errorf("workspace store: close invite: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("workspace store: commit: %w", err)
	}
	return workspaceID, nil
}
