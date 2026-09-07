package workspace

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tracium/api/internal/model"
)

// Roles a member can hold in a workspace.
const (
	RoleOwner  = "owner"
	RoleMember = "member"
)

// Store is the data access interface for workspaces. Handlers depend on this
// interface, never on a concrete database type.
type Store interface {
	// List returns every workspace the user can access (any workspace they are a
	// member of), with the user's own role in each.
	List(ctx context.Context, userID string) ([]model.Workspace, error)
	// Create inserts a workspace and makes its creator (ws.UserID) the owner
	// member in one transaction.
	Create(ctx context.Context, ws model.Workspace) error
	// Delete removes the workspace, allowed only for its owner. Returns
	// ErrNotFound when no workspace with that id is owned by userID.
	Delete(ctx context.Context, id, userID string) error
	// AllowedIDs returns the ids of every workspace the user is a member of. It
	// is the access-control primitive the data handlers scope reads to.
	AllowedIDs(ctx context.Context, userID string) ([]string, error)
	// IsOwner reports whether userID owns the workspace. Used to gate member
	// management.
	IsOwner(ctx context.Context, workspaceID, userID string) (bool, error)
	// AddMember grants a user access to a workspace with the given role. Adding a
	// member who already exists is a no-op (their role is left unchanged).
	AddMember(ctx context.Context, workspaceID, userID, role string) error
	// RemoveMember revokes a user's access. Removing the owner is refused with
	// ErrCannotRemoveOwner.
	RemoveMember(ctx context.Context, workspaceID, userID string) error
}

// ErrNotFound is the sentinel error returned when a workspace does not exist for
// the requesting user. Handlers check for this specifically to return 404 vs 500.
// It is deliberately also returned when the workspace exists but belongs to
// another user — never reveal another user's workspaces.
var ErrNotFound = errors.New("workspace not found")

// ErrCannotRemoveOwner is returned when a request tries to remove the owner from
// a workspace's members. The owner is removed only by deleting the workspace.
var ErrCannotRemoveOwner = errors.New("cannot remove the workspace owner")

// PostgresStore persists workspaces in Postgres, keyed by user ID.
type PostgresStore struct {
	pool *pgxpool.Pool
}

// NewStore connects to Postgres and ensures the workspaces table exists.
func NewStore(ctx context.Context, dsn string) (*PostgresStore, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("workspace store: connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("workspace store: ping: %w", err)
	}

	s := &PostgresStore{pool: pool}
	if err := s.ensureSchema(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return s, nil
}

func (s *PostgresStore) ensureSchema(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS workspaces (
			id         TEXT        PRIMARY KEY,
			user_id    TEXT        NOT NULL,
			name       TEXT        NOT NULL,
			slug       TEXT        NOT NULL,
			env        TEXT        NOT NULL,
			role       TEXT        NOT NULL,
			members    INT         NOT NULL DEFAULT 1,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	if err != nil {
		return fmt.Errorf("workspace store: ensure schema: %w", err)
	}

	// workspace_members maps accounts to the workspaces they can access. A
	// workspace's creator is added here as 'owner'; further members are 'member'.
	// This is the access boundary the data handlers enforce: an account may read
	// only the workspaces it has a row for here.
	_, err = s.pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS workspace_members (
			workspace_id TEXT        NOT NULL,
			user_id      TEXT        NOT NULL,
			role         TEXT        NOT NULL,
			created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			PRIMARY KEY (workspace_id, user_id)
		)
	`)
	if err != nil {
		return fmt.Errorf("workspace store: ensure members schema: %w", err)
	}
	// Accounts created before membership-based access retain ownership. Never
	// infer telemetry ownership from business user/tenant labels.
	_, err = s.pool.Exec(ctx, `
        INSERT INTO workspace_members (workspace_id, user_id, role)
        SELECT id, user_id, 'owner' FROM workspaces
        ON CONFLICT (workspace_id, user_id) DO NOTHING
    `)
	if err != nil {
		return fmt.Errorf("workspace store: backfill owners: %w", err)
	}
	return nil
}

// List returns every workspace the user is a member of, ordered by creation
// time. Role is the user's own role in each workspace; members is that
// workspace's total member count.
func (s *PostgresStore) List(ctx context.Context, userID string) ([]model.Workspace, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT w.id, w.name, w.slug, w.env, wm.role,
		        (SELECT count(*) FROM workspace_members m WHERE m.workspace_id = w.id) AS members
		   FROM workspaces w
		   JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = $1
		  ORDER BY w.created_at`, userID)
	if err != nil {
		return nil, fmt.Errorf("workspace store: list: %w", err)
	}
	defer rows.Close()

	var workspaces []model.Workspace
	for rows.Next() {
		var ws model.Workspace
		if err := rows.Scan(&ws.ID, &ws.Name, &ws.Slug, &ws.Env, &ws.Role, &ws.Members); err != nil {
			return nil, fmt.Errorf("workspace store: scan: %w", err)
		}
		workspaces = append(workspaces, ws)
	}
	return workspaces, rows.Err()
}

// Create inserts a workspace and its owner membership in one transaction, so a
// workspace can never exist without an owner able to see it.
func (s *PostgresStore) Create(ctx context.Context, ws model.Workspace) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("workspace store: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after a successful Commit

	if _, err := tx.Exec(ctx,
		`INSERT INTO workspaces (id, user_id, name, slug, env, role, members)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		ws.ID, ws.UserID, ws.Name, ws.Slug, ws.Env, ws.Role, ws.Members); err != nil {
		return fmt.Errorf("workspace store: create: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)`,
		ws.ID, ws.UserID, RoleOwner); err != nil {
		return fmt.Errorf("workspace store: create owner membership: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("workspace store: commit: %w", err)
	}
	return nil
}

// Delete removes a workspace and all its memberships, allowed only for the
// owner. Returns ErrNotFound when no workspace with that id is owned by userID —
// which also covers "belongs to someone else", so it never reveals another
// account's workspace.
func (s *PostgresStore) Delete(ctx context.Context, id, userID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("workspace store: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after a successful Commit

	tag, err := tx.Exec(ctx,
		`DELETE FROM workspaces WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return fmt.Errorf("workspace store: delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM workspace_members WHERE workspace_id = $1`, id); err != nil {
		return fmt.Errorf("workspace store: delete members: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("workspace store: commit: %w", err)
	}
	return nil
}

// AllowedIDs returns the ids of every workspace the user can access.
func (s *PostgresStore) AllowedIDs(ctx context.Context, userID string) ([]string, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT workspace_id FROM workspace_members WHERE user_id = $1`, userID)
	if err != nil {
		return nil, fmt.Errorf("workspace store: allowed ids: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("workspace store: scan id: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// IsOwner reports whether userID owns the workspace.
func (s *PostgresStore) IsOwner(ctx context.Context, workspaceID, userID string) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM workspaces WHERE id = $1 AND user_id = $2)`,
		workspaceID, userID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("workspace store: is owner: %w", err)
	}
	return exists, nil
}

// AddMember grants a user access to a workspace. Re-adding an existing member is
// a no-op (ON CONFLICT), so it is safe to call from an idempotent seeder.
func (s *PostgresStore) AddMember(ctx context.Context, workspaceID, userID, role string) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)
		 ON CONFLICT (workspace_id, user_id) DO NOTHING`,
		workspaceID, userID, role)
	if err != nil {
		return fmt.Errorf("workspace store: add member: %w", err)
	}
	return nil
}

// RemoveMember revokes a user's access, refusing to remove the owner.
func (s *PostgresStore) RemoveMember(ctx context.Context, workspaceID, userID string) error {
	owner, err := s.IsOwner(ctx, workspaceID, userID)
	if err != nil {
		return err
	}
	if owner {
		return ErrCannotRemoveOwner
	}
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
		workspaceID, userID)
	if err != nil {
		return fmt.Errorf("workspace store: remove member: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Close releases the underlying connection pool.
func (s *PostgresStore) Close() {
	s.pool.Close()
}
