-- ============================================================
-- 036_conversations_update_with_check.sql — WITH CHECK on
--                                            conversations_update
--                                            (current-state.md, ficha 1.10, rec. #4)
--
-- The problem
--
--   conversations_update (017_account_sharing.sql:416) is:
--     USING (is_account_member(account_id, 'agent'))
--   with no WITH CHECK. USING alone gates *which rows* an agent may
--   touch; it says nothing about the *values* written to those rows.
--   Nothing at the database level stops:
--
--     UPDATE conversations SET assigned_agent_id = '<any-uuid>'
--     WHERE id = '<conversation-in-my-account>';
--
--   Today this is mitigated only by the app layer: the inbox
--   (message-thread.tsx) populates the agent picker from
--   /api/account/members, which is account-scoped. That's a
--   client-side convention, not a structural barrier — any direct
--   PostgREST call (or a future bug in that endpoint) could assign
--   a conversation to an arbitrary user_id, including one outside
--   the account.
--
-- The fix
--
--   Add a WITH CHECK that requires assigned_agent_id to be either
--   NULL or a member of the same account_id — but ONLY when
--   assigned_agent_id is actually being changed by this UPDATE.
--
-- Why "only when changed" and not "always"
--
--   remove_account_member (018_account_member_rpcs.sql:127-201)
--   relocates a removed member to a fresh personal account but does
--   NOT clear assigned_agent_id on conversations that pointed to
--   them. So a conversation can legitimately end up with an
--   assigned_agent_id that is no longer an account member (an
--   "orphaned" assignment).
--
--   If the check re-validated membership on *every* UPDATE
--   regardless of whether assigned_agent_id changed, it would also
--   fire on unrelated updates to an orphaned conversation — e.g.
--   marking it read (unread_count -> 0, message-thread.tsx:432) or
--   changing status (message-thread.tsx:630), both written through
--   the RLS-scoped browser client. That would silently freeze the
--   conversation for any RLS-scoped write until someone manually
--   reassigns or unassigns it — a real regression, not a
--   hypothetical.
--
--   So the check only re-validates membership when the NEW
--   assigned_agent_id differs from the OLD one. Unrelated updates,
--   and updates that touch an already-orphaned conversation without
--   changing its assignee, pass through untouched.
--
-- How "only when changed" is implemented
--
--   The self-referencing subquery below
--     (SELECT c.assigned_agent_id FROM conversations c WHERE c.id = conversations.id)
--   is a standard Postgres RLS pattern for reading a row's
--   pre-UPDATE value from inside its own WITH CHECK: within a single
--   UPDATE command, a subquery against the same table sees the
--   command's starting snapshot, not the in-flight new value, so it
--   resolves to OLD.assigned_agent_id. This is documented Postgres
--   behavior (the standard recipe for "make this column immutable
--   via RLS"), not a hack specific to this schema — but it has not
--   been exercised against this database (no test environment
--   exists; see current-state.md). Validate manually (queries below)
--   before relying on it in production.
--
-- Callers checked (grep over `.from('conversations').update(`)
--
--   RLS-scoped (subject to this policy):
--     - message-thread.tsx:827  assign to a member from /api/account/members  -> must pass
--     - message-thread.tsx:827  unassign (assigned_agent_id: null)            -> must pass
--     - api/ai/autoreply/[id]/route.ts:68  "Take over" (assign_to_me = auth.uid()) -> must pass
--       (userId is the caller, who already passed requireRole('agent'), so
--       they are by construction an account member)
--     - api/ai/autoreply/[id]/route.ts:77  "Resume AI" (unassign)             -> must pass
--     - message-thread.tsx:432  mark as read (unread_count only)              -> untouched, assigned_agent_id unchanged
--     - message-thread.tsx:630  status change                                 -> untouched, assigned_agent_id unchanged
--
--   service_role (bypasses RLS entirely; no FORCE ROW LEVEL SECURITY
--   on conversations, confirmed via grep over supabase/migrations):
--     - automations/engine.ts, flows/engine.ts, ai/auto-reply.ts,
--       automations/meta-send.ts, flows/meta-send.ts,
--       whatsapp/send-message.ts, whatsapp/webhook/route.ts
--     Unaffected either way — these write as service_role.
--
--   No code path updates conversations.account_id (grep confirmed),
--   so repeating is_account_member(account_id, 'agent') in WITH
--   CHECK — required because WITH CHECK does not inherit USING —
--   has no observed caller to break; it only closes the same gap
--   for account_id that this migration closes for assigned_agent_id.
--
-- Membership helper
--
--   is_account_member(account_id, min_role) only checks auth.uid(),
--   so it can't validate an arbitrary assigned_agent_id. The EXISTS
--   subquery below mirrors its body (profiles.user_id / account_id
--   match) without the role-rank comparison, since assignment has
--   never been role-gated (any member could already be set as
--   assigned_agent_id before this migration) — this migration closes
--   the "not a member at all" hole, not a role-level restriction.
-- ============================================================

DROP POLICY IF EXISTS conversations_update ON conversations;

CREATE POLICY conversations_update ON conversations
  FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND (
      assigned_agent_id IS NULL
      OR assigned_agent_id IS NOT DISTINCT FROM (
        SELECT c.assigned_agent_id
        FROM conversations c
        WHERE c.id = conversations.id
      )
      OR EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.user_id = assigned_agent_id
          AND p.account_id = conversations.account_id
      )
    )
  );

-- ============================================================
-- Manual validation (no automated SQL test harness in this repo;
-- run against a staging/local copy before applying to prod):
--
--   1. Assign to a fellow account member -> succeeds:
--        UPDATE conversations SET assigned_agent_id = '<member-uuid>'
--        WHERE id = '<conv-in-my-account>';
--   2. Assign to a user outside the account -> must fail (42501):
--        UPDATE conversations SET assigned_agent_id = '<outsider-uuid>'
--        WHERE id = '<conv-in-my-account>';
--   3. Unassign -> succeeds:
--        UPDATE conversations SET assigned_agent_id = NULL
--        WHERE id = '<conv-in-my-account>';
--   4. Unrelated update on an ALREADY-orphaned conversation (assignee
--      no longer a member, assigned_agent_id untouched) -> succeeds:
--        -- setup: assign, then remove_account_member() on the assignee
--        UPDATE conversations SET unread_count = 0
--        WHERE id = '<orphaned-conv>';
--   5. service_role writes (webhook, automations, flows, ai/auto-reply)
--      -> unaffected, still bypass RLS entirely.
-- ============================================================

-- ============================================================
-- ROLLBACK
--
--   DROP POLICY IF EXISTS conversations_update ON conversations;
--   CREATE POLICY conversations_update ON conversations
--     FOR UPDATE USING (is_account_member(account_id, 'agent'));
-- ============================================================
