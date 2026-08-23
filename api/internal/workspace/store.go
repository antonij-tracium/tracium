package workspace

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tracium/api/internal/model"
)

// Store is the data access interface for workspaces. Handlers depend on this
// interface, never on a concrete database type.
type Store interface {
	List(ctx context.Context, userID string) ([]model.Workspace, error)
	Create(ctx context.Context, ws model.Workspace) error
	// Delete removes the workspace owned by userID. It returns ErrNotFound when
	// no such workspace exists for that user.
	Delete(ctx context.Context, id, userID string) error
}

// ErrNotFound is the sentinel error returned when a workspace does not exist for
// the requesting user. Handlers check for this specifically to return 404 vs 500.
// It is deliberately also returned when the workspace exists but belongs to
// another user — never reveal another user's workspaces.
var ErrNotFound = errors.New("workspace not found")

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
			plan       TEXT        NOT NULL DEFAULT 'Free',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	if err != nil {
		return fmt.Errorf("workspace store: ensure schema: %w", err)
	}
	return nil
}

// List returns all workspaces belonging to the given user, ordered by creation time.
func (s *PostgresStore) List(ctx context.Context, userID string) ([]model.Workspace, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, name, slug, env, role, members, plan
		   FROM workspaces
		  WHERE user_id = $1
		  ORDER BY created_at`, userID)
	if err != nil {
		return nil, fmt.Errorf("workspace store: list: %w", err)
	}
	defer rows.Close()

	var workspaces []model.Workspace
	for rows.Next() {
		var ws model.Workspace
		if err := rows.Scan(&ws.ID, &ws.Name, &ws.Slug, &ws.Env, &ws.Role, &ws.Members, &ws.Plan); err != nil {
			return nil, fmt.Errorf("workspace store: scan: %w", err)
		}
		workspaces = append(workspaces, ws)
	}
	return workspaces, rows.Err()
}

// Create inserts a new workspace.
func (s *PostgresStore) Create(ctx context.Context, ws model.Workspace) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO workspaces (id, user_id, name, slug, env, role, members, plan)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		ws.ID, ws.UserID, ws.Name, ws.Slug, ws.Env, ws.Role, ws.Members, ws.Plan)
	if err != nil {
		return fmt.Errorf("workspace store: create: %w", err)
	}
	return nil
}

// Delete removes a workspace by ID, scoped to the owning user. It returns
// ErrNotFound when no row matched — either the workspace does not exist or it
// belongs to another user; the two cases are deliberately indistinguishable.
func (s *PostgresStore) Delete(ctx context.Context, id, userID string) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM workspaces WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return fmt.Errorf("workspace store: delete: %w", err)
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
