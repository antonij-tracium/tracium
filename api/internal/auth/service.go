package auth

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"

	"github.com/tracium/api/internal/model"
)

// ErrInvalidCredentials is returned when an email/password pair does not match.
var ErrInvalidCredentials = errors.New("invalid credentials")

// Service ties account storage and token issuance together.
type Service struct {
	users  *UserStore
	tokens *TokenIssuer
}

func NewService(users *UserStore, tokens *TokenIssuer) *Service {
	return &Service{users: users, tokens: tokens}
}

// Authenticator exposes the token verifier for the auth middleware.
func (s *Service) Authenticator() *TokenIssuer { return s.tokens }

// Register creates a new account and returns a signed token.
// Each account gets its own tenant and admin role.
func (s *Service) Register(ctx context.Context, email, password string) (string, error) {
	hash, err := hashPassword(password)
	if err != nil {
		return "", err
	}

	user := model.User{
		ID:           uuid.NewString(),
		Email:        normalizeEmail(email),
		PasswordHash: hash,
		TenantID:     uuid.NewString(),
		Role:         "admin",
	}
	if err := s.users.Create(ctx, user); err != nil {
		return "", err
	}

	return s.tokens.Issue(user.ID, user.TenantID, user.Role)
}

// Login verifies credentials and returns a signed token.
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

	return s.tokens.Issue(user.ID, user.TenantID, user.Role)
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}
