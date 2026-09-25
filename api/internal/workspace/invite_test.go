package workspace

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tracium/api/internal/model"
)

// newTestStore uses a throwaway schema so it can share TEST_POSTGRES_DSN with other packages.
func newTestStore(t *testing.T) *PostgresStore {
	t.Helper()
	dsn := os.Getenv("TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("TEST_POSTGRES_DSN not set")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	schema := fmt.Sprintf("invite_test_%d", time.Now().UnixNano())
	if _, err := admin.Exec(ctx, `CREATE SCHEMA `+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = admin.Exec(context.Background(), `DROP SCHEMA `+schema+` CASCADE`) })

	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	s, err := NewStore(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return s
}

func addUser(t *testing.T, s *PostgresStore, email string) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := s.pool.Exec(context.Background(),
		`INSERT INTO users (id, email, password_hash, tenant_id, role) VALUES ($1, $2, 'x', 't', 'admin')`,
		id, email); err != nil {
		t.Fatal(err)
	}
	return id
}

func newInvite(workspaceID, email, by string, expires time.Time) *model.WorkspaceInvite {
	return &model.WorkspaceInvite{ID: uuid.NewString(), WorkspaceID: workspaceID, Email: email, Role: RoleMember, InvitedBy: by, ExpiresAt: expires}
}

func TestInviteLifecycle(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	owner := addUser(t, s, "owner@example.com")
	invitee := addUser(t, s, "bob@example.com")
	other := addUser(t, s, "eve@example.com")
	if err := s.Create(ctx, model.Workspace{ID: "ws-1", UserID: owner, Name: "Prod", Slug: "prod", Env: "production", Role: "Owner", Members: 1}); err != nil {
		t.Fatal(err)
	}
	week := time.Now().Add(InviteTTL)

	if err := s.CreateInvite(ctx, newInvite("ws-1", "owner@example.com", owner, week), "h-owner"); !errors.Is(err, ErrAlreadyMember) {
		t.Fatalf("invite owner: err = %v, want ErrAlreadyMember", err)
	}

	first := newInvite("ws-1", "bob@example.com", owner, week)
	if err := s.CreateInvite(ctx, first, "h1"); err != nil {
		t.Fatal(err)
	}
	if first.CreatedAt.IsZero() {
		t.Error("CreatedAt not filled")
	}
	// Re-inviting replaces the open invite; the old link stops working.
	second := newInvite("ws-1", "bob@example.com", owner, week)
	if err := s.CreateInvite(ctx, second, "h2"); err != nil {
		t.Fatalf("re-invite: %v", err)
	}
	if _, err := s.PreviewInvite(ctx, "h1"); !errors.Is(err, ErrInviteClosed) {
		t.Errorf("old link preview: err = %v, want ErrInviteClosed", err)
	}
	if open, err := s.HasOpenInvite(ctx, "ws-1", "bob@example.com"); err != nil || !open {
		t.Errorf("open invite: %v, %v", open, err)
	}
	if open, err := s.HasOpenInvite(ctx, "ws-1", "nobody@example.com"); err != nil || open {
		t.Errorf("no invite: %v, %v", open, err)
	}
	invites, err := s.ListInvites(ctx, "ws-1")
	if err != nil || len(invites) != 1 || invites[0].ID != second.ID {
		t.Fatalf("list = %+v, %v; want only the second invite", invites, err)
	}

	p, err := s.PreviewInvite(ctx, "h2")
	if err != nil {
		t.Fatal(err)
	}
	if p.WorkspaceName != "Prod" || p.InvitedByEmail != "owner@example.com" || p.Email != "bob@example.com" {
		t.Errorf("preview = %+v", p)
	}
	if _, err := s.PreviewInvite(ctx, "nope"); !errors.Is(err, ErrInviteNotFound) {
		t.Errorf("unknown preview: err = %v, want ErrInviteNotFound", err)
	}

	if _, err := s.AcceptInvite(ctx, "h2", other, nil); !errors.Is(err, ErrInviteEmailMismatch) {
		t.Fatalf("wrong account: err = %v, want ErrInviteEmailMismatch", err)
	}
	if _, err := s.AcceptInvite(ctx, "h2", uuid.NewString(), nil); !errors.Is(err, ErrInviteEmailMismatch) {
		t.Fatalf("unknown account: err = %v, want ErrInviteEmailMismatch", err)
	}
	full := errors.New("workspace full")
	var checked string
	if _, err := s.AcceptInvite(ctx, "h2", invitee, func(_ context.Context, ws string) error { checked = ws; return full }); !errors.Is(err, full) || checked != "ws-1" {
		t.Fatalf("denied accept: err = %v, checked %q", err, checked)
	}
	if ids, _ := s.AllowedIDs(ctx, invitee); len(ids) != 0 {
		t.Fatalf("denied accept still joined: %v", ids)
	}
	ws, err := s.AcceptInvite(ctx, "h2", invitee, func(context.Context, string) error { return nil })
	if err != nil || ws != "ws-1" {
		t.Fatalf("accept = %q, %v", ws, err)
	}
	if _, err := s.AcceptInvite(ctx, "h2", invitee, nil); !errors.Is(err, ErrInviteClosed) {
		t.Errorf("reuse: err = %v, want ErrInviteClosed", err)
	}

	ids, err := s.AllowedIDs(ctx, invitee)
	if err != nil || len(ids) != 1 || ids[0] != "ws-1" {
		t.Errorf("invitee access = %v, %v", ids, err)
	}
	members, err := s.ListMembers(ctx, "ws-1")
	if err != nil || len(members) != 2 {
		t.Fatalf("members = %+v, %v", members, err)
	}
	if members[0].Email != "owner@example.com" || members[0].Role != RoleOwner || members[1].Email != "bob@example.com" || members[1].Role != RoleMember {
		t.Errorf("members = %+v", members)
	}
	if invites, _ := s.ListInvites(ctx, "ws-1"); len(invites) != 0 {
		t.Errorf("accepted invite still listed: %+v", invites)
	}
	if err := s.CreateInvite(ctx, newInvite("ws-1", "bob@example.com", owner, week), "h3"); !errors.Is(err, ErrAlreadyMember) {
		t.Errorf("invite member: err = %v, want ErrAlreadyMember", err)
	}
}

func TestInviteRevokeExpireAndCascade(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	owner := addUser(t, s, "owner@example.com")
	bob := addUser(t, s, "bob@example.com")
	if err := s.Create(ctx, model.Workspace{ID: "ws-1", UserID: owner, Name: "Prod", Slug: "prod", Env: "production", Role: "Owner", Members: 1}); err != nil {
		t.Fatal(err)
	}

	inv := newInvite("ws-1", "bob@example.com", owner, time.Now().Add(InviteTTL))
	if err := s.CreateInvite(ctx, inv, "h1"); err != nil {
		t.Fatal(err)
	}
	if err := s.RevokeInvite(ctx, "ws-other", inv.ID); !errors.Is(err, ErrInviteNotFound) {
		t.Errorf("revoke from another workspace: err = %v, want ErrInviteNotFound", err)
	}
	if err := s.RevokeInvite(ctx, "ws-1", "not-a-uuid"); !errors.Is(err, ErrInviteNotFound) {
		t.Errorf("revoke malformed id: err = %v, want ErrInviteNotFound", err)
	}
	if err := s.RevokeInvite(ctx, "ws-1", inv.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.RevokeInvite(ctx, "ws-1", inv.ID); !errors.Is(err, ErrInviteNotFound) {
		t.Errorf("second revoke: err = %v, want ErrInviteNotFound", err)
	}
	if _, err := s.AcceptInvite(ctx, "h1", bob, nil); !errors.Is(err, ErrInviteClosed) {
		t.Errorf("accept revoked: err = %v, want ErrInviteClosed", err)
	}

	expired := newInvite("ws-1", "bob@example.com", owner, time.Now().Add(-time.Minute))
	if err := s.CreateInvite(ctx, expired, "h2"); err != nil {
		t.Fatal(err)
	}
	if invites, _ := s.ListInvites(ctx, "ws-1"); len(invites) != 0 {
		t.Errorf("expired invite listed: %+v", invites)
	}
	if _, err := s.AcceptInvite(ctx, "h2", bob, nil); !errors.Is(err, ErrInviteClosed) {
		t.Errorf("accept expired: err = %v, want ErrInviteClosed", err)
	}

	open := newInvite("ws-1", "carol@example.com", owner, time.Now().Add(InviteTTL))
	if err := s.CreateInvite(ctx, open, "h3"); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(ctx, "ws-1", owner); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PreviewInvite(ctx, "h3"); !errors.Is(err, ErrInviteNotFound) {
		t.Errorf("invite outlived its workspace: err = %v", err)
	}
}
