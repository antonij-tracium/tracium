package auth

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"

	"github.com/tracium/api/extension"
	"github.com/tracium/api/internal/model"
)

// ErrInvalidCredentials is returned when an email/password pair does not match.
var ErrInvalidCredentials = errors.New("invalid credentials")

// Service ties account storage and token issuance together.
type Service struct {
	users     *UserStore
	tokens    *TokenIssuer
	lifecycle extension.AccountLifecycle
}

// NewService constructs the auth service. lifecycle is optional: when nil,
// registration issues a session token immediately and login is not gated on
// email confirmation. An embedding application (the hosted service) passes a
// lifecycle to require confirmation.
func NewService(users *UserStore, tokens *TokenIssuer, lifecycle extension.AccountLifecycle) *Service {
	return &Service{users: users, tokens: tokens, lifecycle: lifecycle}
}

// Authenticator exposes the token verifier for the auth middleware.
func (s *Service) Authenticator() *TokenIssuer { return s.tokens }

// RegisterResult reports the outcome of a registration. Token is empty when
// ConfirmationRequired is true — the account must confirm its email before it
// can sign in.
type RegisterResult struct {
	Token                string
	ConfirmationRequired bool
}

// Register creates a new account. Each account gets its own tenant and admin
// role. With no lifecycle configured it returns a signed token. When a lifecycle
// requires confirmation it runs the AfterRegister hook and withholds the token.
func (s *Service) Register(ctx context.Context, email, password string) (RegisterResult, error) {
	hash, err := hashPassword(password)
	if err != nil {
		return RegisterResult{}, err
	}

	user := model.User{
		ID:           uuid.NewString(),
		Email:        normalizeEmail(email),
		PasswordHash: hash,
		TenantID:     uuid.NewString(),
		Role:         "admin",
	}
	if err := s.users.Create(ctx, user); err != nil {
		return RegisterResult{}, err
	}

	if s.lifecycle != nil {
		outcome, err := s.lifecycle.AfterRegister(ctx, account(user))
		if err != nil {
			return RegisterResult{}, err
		}
		if outcome == extension.RequireConfirmation {
			return RegisterResult{ConfirmationRequired: true}, nil
		}
	}

	token, err := s.tokens.Issue(user.ID, user.TenantID, user.Role)
	if err != nil {
		return RegisterResult{}, err
	}
	return RegisterResult{Token: token}, nil
}

// Login verifies credentials and returns a signed token. When a lifecycle is
// configured it also enforces email confirmation, returning
// extension.ErrEmailUnverified for an unconfirmed account.
func (s *Service) Login(ctx context.Context, email, password string) (string, error) {
	user, err := s.users.ByEmail(ctx, normalizeEmail(email))
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			return "", ErrInvalidCredentials
		}
		return "", err
	}
	if !checkPassword(user.PasswordHash, password) {
		return "", ErrInvalidCredentials
	}

	if s.lifecycle != nil {
		if err := s.lifecycle.EnsureCanLogin(ctx, account(*user)); err != nil {
			return "", err
		}
	}

	return s.tokens.Issue(user.ID, user.TenantID, user.Role)
}

func account(u model.User) extension.Account {
	return extension.Account{ID: u.ID, Email: u.Email, TenantID: u.TenantID, Role: u.Role}
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}
