package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/tracium/api/internal/model"
)

const tokenTTL = 24 * time.Hour

// TokenIssuer signs and validates the bearer tokens returned by login/register.
// It also implements middleware.Authenticator so protected routes can verify them.
type TokenIssuer struct {
	secret []byte
}

func NewTokenIssuer(secret string) *TokenIssuer {
	return &TokenIssuer{secret: []byte(secret)}
}

// Issue returns a signed JWT carrying the identity of the authenticated user.
func (t *TokenIssuer) Issue(userID, tenantID, role string) (string, error) {
	now := time.Now()
	claims := jwt.MapClaims{
		"sub":       userID,
		"tenant_id": tenantID,
		"role":      role,
		"iat":       now.Unix(),
		"exp":       now.Add(tokenTTL).Unix(),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(t.secret)
}

// Authenticate validates a token string and returns the embedded Principal.
func (t *TokenIssuer) Authenticate(_ context.Context, tokenString string) (*model.Principal, error) {
	parsed, err := jwt.Parse(tokenString, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return t.secret, nil
	})
	if err != nil || !parsed.Valid {
		return nil, fmt.Errorf("invalid token: %w", err)
	}

	claims, ok := parsed.Claims.(jwt.MapClaims)
	if !ok {
		return nil, fmt.Errorf("invalid token claims")
	}

	userID, _ := claims["sub"].(string)
	tenantID, _ := claims["tenant_id"].(string)
	if tenantID == "" {
		return nil, fmt.Errorf("token missing tenant_id")
	}
	role, _ := claims["role"].(string)

	return &model.Principal{UserID: userID, TenantID: tenantID, Role: role}, nil
}
