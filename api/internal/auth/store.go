package auth

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tracium/api/internal/model"
)

var (
	// ErrEmailTaken is returned when registering an email that already exists.
	ErrEmailTaken = errors.New("email already registered")
	// ErrUserNotFound is returned when no user matches the lookup.
	ErrUserNotFound = errors.New("user not found")
)

// UserStore persists accounts in Postgres.
type UserStore struct {
	pool *pgxpool.Pool
}

// NewUserStore connects to Postgres and ensures the users table exists.
func NewUserStore(ctx context.Context, dsn string) (*UserStore, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("postgres: connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("postgres: ping: %w", err)
	}

	store := &UserStore{pool: pool}
	if err := store.ensureSchema(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return store, nil
}

func (s *UserStore) ensureSchema(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS users (
			id            UUID PRIMARY KEY,
			email         TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			tenant_id     TEXT NOT NULL,
			role          TEXT NOT NULL,
			created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	if err != nil {
		return fmt.Errorf("postgres: ensure users schema: %w", err)
	}
	return nil
}

// Create inserts a new user, returning ErrEmailTaken on a duplicate email.
func (s *UserStore) Create(ctx context.Context, u model.User) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO users (id, email, password_hash, tenant_id, role) VALUES ($1, $2, $3, $4, $5)`,
		u.ID, u.Email, u.PasswordHash, u.TenantID, u.Role,
	)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return ErrEmailTaken
		}
		return fmt.Errorf("postgres: insert user: %w", err)
	}
	return nil
}

// ByEmail returns the user with the given email, or ErrUserNotFound.
func (s *UserStore) ByEmail(ctx context.Context, email string) (*model.User, error) {
	var u model.User
	err := s.pool.QueryRow(ctx,
		`SELECT id, email, password_hash, tenant_id, role FROM users WHERE email = $1`, email,
	).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.TenantID, &u.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("postgres: query user: %w", err)
	}
	return &u, nil
}

// Ping verifies the Postgres connection is alive. Used by the readiness probe.
func (s *UserStore) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

// Close releases the underlying connection pool.
func (s *UserStore) Close() {
	s.pool.Close()
}
