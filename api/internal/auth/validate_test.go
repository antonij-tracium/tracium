package auth

import (
	"errors"
	"strings"
	"testing"
)

func TestValidateCredentials(t *testing.T) {
	cases := []struct {
		name     string
		email    string
		password string
		want     error
	}{
		{"valid", "user@example.com", "correcthorse", nil},
		{"empty email", "", "correcthorse", ErrInvalidEmail},
		{"garbage email", "not-an-email", "correcthorse", ErrInvalidEmail},
		{"display-name form rejected", "User <user@example.com>", "correcthorse", ErrInvalidEmail},
		{"email too long", strings.Repeat("a", 250) + "@x.com", "correcthorse", ErrInvalidEmail},
		{"password too short", "user@example.com", "short", ErrPasswordTooShort},
		{"password at min", "user@example.com", "12345678", nil},
		{"password too long", "user@example.com", strings.Repeat("x", 73), ErrPasswordTooLong},
		{"password at max", "user@example.com", strings.Repeat("x", 72), nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ValidateCredentials(tc.email, tc.password)
			if !errors.Is(got, tc.want) {
				t.Fatalf("ValidateCredentials(%q, len=%d) = %v, want %v", tc.email, len(tc.password), got, tc.want)
			}
		})
	}
}
