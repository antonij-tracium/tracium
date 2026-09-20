package auth

import (
	"errors"
	"net/mail"
)

const (
	// MinPasswordLen is the minimum accepted password length in bytes.
	MinPasswordLen = 8
	// MaxPasswordLen matches bcrypt's 72-byte input limit. bcrypt silently
	// truncates anything longer, so a longer input would be hashed only on its
	// first 72 bytes — we reject it with a client error instead of either
	// hashing a prefix or letting bcrypt return an error that surfaces as a 500.
	MaxPasswordLen = 72
	// MaxEmailLen is the maximum accepted email length (RFC 5321 limit).
	MaxEmailLen = 254
)

// ErrInvalidEmail is returned when the email is not a syntactically valid address.
var ErrInvalidEmail = errors.New("Email must be a valid address")

// ErrPasswordTooShort is returned when the password is below MinPasswordLen.
var ErrPasswordTooShort = errors.New("Password is too short")

// ErrPasswordTooLong is returned when the password exceeds MaxPasswordLen.
var ErrPasswordTooLong = errors.New("Password is too long")

// ValidateCredentials enforces the format rules for registration and login
// input. It returns a specific sentinel error the handler maps to a 400 so that
// bad input never reaches bcrypt (which would 500 on an over-long password) or
// creates an account with an unusable identifier.
func ValidateCredentials(email, password string) error {
	if len(email) == 0 || len(email) > MaxEmailLen {
		return ErrInvalidEmail
	}
	// mail.ParseAddress also accepts display-name forms ("Name <a@b>"); require
	// the parsed address to equal the input so only bare addresses pass.
	addr, err := mail.ParseAddress(email)
	if err != nil || addr.Address != email {
		return ErrInvalidEmail
	}

	if len(password) < MinPasswordLen {
		return ErrPasswordTooShort
	}
	if len(password) > MaxPasswordLen {
		return ErrPasswordTooLong
	}
	return nil
}
