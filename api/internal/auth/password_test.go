package auth

import "testing"

func TestHashPasswordRoundTrip(t *testing.T) {
	hash, err := HashPassword("correcthorse")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if !checkPassword(hash, "correcthorse") {
		t.Fatal("checkPassword: expected match")
	}
	if checkPassword(hash, "wrong-password") {
		t.Fatal("checkPassword: expected mismatch")
	}
}
