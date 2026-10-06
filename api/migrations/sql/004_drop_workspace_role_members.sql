-- A member's role and the member count come from workspace_members.
ALTER TABLE workspaces DROP COLUMN IF EXISTS role, DROP COLUMN IF EXISTS members;
