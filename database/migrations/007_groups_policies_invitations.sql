-- PEP ERP — Migration 007 (Blueprint Phase 0, items 10 and identity):
--   1. groups: the group → entity hierarchy (consolidation in Phase 8 builds on it)
--   2. approval_policies: effective-dated approval thresholds per document type (enforced from
--      Phase 2/3 by each module; journals keep their existing single-approver workflow until then)
--   3. user_invitations: who invited whom, with which roles, and whether the invitation was accepted
-- All three are append-only or status-only in the way the ledger is: changes are new rows or
-- audited status moves, never silent edits.

-- ── 1. Groups ─────────────────────────────────────────────────────────────────
CREATE TABLE groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]{2,20}$'),
  name        text NOT NULL,
  reporting_currency char(3) NOT NULL DEFAULT 'GHS',
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE entities ADD COLUMN group_id uuid REFERENCES groups(id);
CREATE INDEX entities_group ON entities (group_id);

-- ── 2. Approval policies ──────────────────────────────────────────────────────
CREATE TABLE approval_policies (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id          uuid NOT NULL REFERENCES entities(id),
  document_type      text NOT NULL CHECK (document_type IN
                       ('journal','bill','payment','payout_detail_change','refund','role_change','contract')),
  threshold          numeric(20,2) NOT NULL CHECK (threshold >= 0),   -- amounts above this need approvals_required
  approvals_required smallint NOT NULL CHECK (approvals_required BETWEEN 1 AND 3),
  effective_from     date NOT NULL,
  reason             text NOT NULL CHECK (length(trim(reason)) > 0),
  created_by         uuid NOT NULL REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, document_type, threshold, effective_from)
);
CREATE INDEX approval_policies_lookup ON approval_policies (entity_id, document_type, effective_from DESC);

CREATE FUNCTION trg_policy_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'APPROVAL_POLICY_APPEND_ONLY: add a new effective-dated policy instead' USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER approval_policy_append_only BEFORE UPDATE OR DELETE ON approval_policies
  FOR EACH ROW EXECUTE FUNCTION trg_policy_append_only();

-- Policy in force for a document type, amount and date: the tier with the highest threshold
-- below the amount, from the latest effective date on or before the document date.
CREATE FUNCTION approvals_required(p_entity uuid, p_type text, p_amount numeric, p_on date)
RETURNS smallint LANGUAGE sql STABLE SET search_path = public AS $$
  WITH latest AS (
    SELECT max(effective_from) AS d FROM approval_policies
     WHERE entity_id = p_entity AND document_type = p_type AND effective_from <= p_on)
  SELECT coalesce((
    SELECT approvals_required FROM approval_policies, latest
     WHERE entity_id = p_entity AND document_type = p_type AND effective_from = latest.d
       AND p_amount > threshold
     ORDER BY threshold DESC LIMIT 1), 1::smallint)
$$;

-- ── 3. Invitations ────────────────────────────────────────────────────────────
CREATE TABLE user_invitations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid NOT NULL REFERENCES entities(id),
  user_id       uuid NOT NULL REFERENCES users(id),
  email         text NOT NULL CHECK (email = lower(email)),
  roles         text[] NOT NULL CHECK (cardinality(roles) > 0),
  invited_by    uuid NOT NULL REFERENCES users(id),
  auth_user_id  uuid,
  status        text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','accepted','revoked')),
  sent_at       timestamptz NOT NULL DEFAULT now(),
  accepted_at   timestamptz,
  CHECK (invited_by <> user_id)          -- no one invites themselves (segregation of duties)
);
CREATE INDEX user_invitations_entity ON user_invitations (entity_id, sent_at DESC);

-- ── Permissions ───────────────────────────────────────────────────────────────
INSERT INTO role_permissions (role_code, permission) VALUES
  ('controller', 'policies.manage'), ('controller', 'policies.read'),
  ('finance_admin', 'policies.read'), ('approver', 'policies.read'), ('auditor', 'policies.read'),
  ('auditor', 'users.read'), ('controller', 'users.read');
-- system_admin already holds users.manage (invite, assign roles) and has no financial authority.

-- ── Privileges and RLS (same pattern as 005) ──────────────────────────────────
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_invitations ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON groups TO pep_app;
GRANT SELECT, INSERT ON approval_policies TO pep_app;              -- append-only
GRANT SELECT, INSERT, UPDATE ON user_invitations TO pep_app;       -- status moves only
GRANT EXECUTE ON FUNCTION approvals_required(uuid, text, numeric, date) TO pep_app;
CREATE POLICY pep_app_all ON groups FOR ALL TO pep_app USING (true) WITH CHECK (true);
CREATE POLICY pep_app_all ON approval_policies FOR ALL TO pep_app USING (true) WITH CHECK (true);
CREATE POLICY pep_app_all ON user_invitations FOR ALL TO pep_app USING (true) WITH CHECK (true);

GRANT SELECT ON groups, approval_policies TO authenticated;
GRANT SELECT (id, entity_id, user_id, email, roles, invited_by, status, sent_at, accepted_at) ON user_invitations TO authenticated;
CREATE POLICY auth_read ON groups FOR SELECT TO authenticated
  USING (id IN (SELECT group_id FROM entities WHERE id = ANY ((SELECT private.entities_with('entity.read'))::uuid[])));
CREATE POLICY auth_read ON approval_policies FOR SELECT TO authenticated
  USING (entity_id = ANY ((SELECT private.entities_with('policies.read'))::uuid[]));
CREATE POLICY auth_read ON user_invitations FOR SELECT TO authenticated
  USING (entity_id = ANY ((SELECT private.entities_with('users.manage'))::uuid[]));

REVOKE ALL ON groups, approval_policies, user_invitations FROM anon;
