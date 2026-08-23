package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/tracium/api/internal/auth"
)

// AuthHandler handles account registration and login.
type AuthHandler struct {
	svc *auth.Service
}

// NewAuthHandler constructs an AuthHandler with the given auth service.
func NewAuthHandler(svc *auth.Service) *AuthHandler {
	return &AuthHandler{svc: svc}
}

type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type tokenResponse struct {
	Token string `json:"token"`
}

// Register handles POST /v1/auth/register.
func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	creds, ok := decodeCredentials(w, r)
	if !ok {
		return
	}

	token, err := h.svc.Register(r.Context(), creds.Email, creds.Password)
	if err != nil {
		if errors.Is(err, auth.ErrEmailTaken) {
			respondError(w, http.StatusConflict, "EMAIL_TAKEN", "an account with that email already exists")
			return
		}
		respondError(w, http.StatusInternalServerError, "INTERNAL", "could not create account")
		return
	}

	respondJSON(w, http.StatusCreated, tokenResponse{Token: token})
}

// Login handles POST /v1/auth/login.
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	creds, ok := decodeCredentials(w, r)
	if !ok {
		return
	}

	token, err := h.svc.Login(r.Context(), creds.Email, creds.Password)
	if err != nil {
		if errors.Is(err, auth.ErrInvalidCredentials) {
			respondError(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "invalid email or password")
			return
		}
		respondError(w, http.StatusInternalServerError, "INTERNAL", "could not sign in")
		return
	}

	respondJSON(w, http.StatusOK, tokenResponse{Token: token})
}

func decodeCredentials(w http.ResponseWriter, r *http.Request) (credentials, bool) {
	var creds credentials
	if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "request body must be valid JSON")
		return creds, false
	}

	creds.Email = strings.TrimSpace(creds.Email)
	if creds.Email == "" || creds.Password == "" {
		respondError(w, http.StatusBadRequest, "MISSING_FIELDS", "email and password are required")
		return creds, false
	}

	return creds, true
}
