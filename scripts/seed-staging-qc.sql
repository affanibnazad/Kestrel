-- STAGING ONLY (xjqtgvhnbyepfinqonzm): seed-staging-qc.sql
-- Seed sample data for STAGING test user: staging-test@kestrelleads.com (team 36d85765-d04c-487a-a515-dc062bd3123a)

BEGIN;

-- 1. Access Code & Access Grant (30 days of free Pro access)
INSERT INTO public.access_codes (code, label, plan, days, max_uses, created_by)
VALUES (
  'QC-FREE-ACCESS-2026',
  'QC Free Access Staging Code',
  'pro',
  30,
  100,
  '6e25520a-5a9a-4b30-8f80-bc0b149f22ad'
) ON CONFLICT (code) DO UPDATE SET days = 30, revoked_at = null;

INSERT INTO public.access_grants (id, team_id, code, plan, starts_at, ends_at, claimed_by)
VALUES (
  'c0000000-0000-0000-0000-000000000001',
  '36d85765-d04c-487a-a515-dc062bd3123a',
  'QC-FREE-ACCESS-2026',
  'pro',
  now(),
  now() + interval '30 days',
  '6e25520a-5a9a-4b30-8f80-bc0b149f22ad'
) ON CONFLICT (team_id, code) DO UPDATE SET ends_at = now() + interval '30 days', revoked_at = null;

-- 2. Campaign Leads & Mail Replies (Look up campaigns and mailbox dynamically)
DO $$
DECLARE
  v_team_id   uuid := '36d85765-d04c-487a-a515-dc062bd3123a';
  v_camp_ny   uuid;
  v_camp_lon  uuid;
  v_mailbox   uuid;
  v_lead_1    uuid := 'e0000000-0000-0000-0000-000000000001';
  v_lead_2    uuid := 'e0000000-0000-0000-0000-000000000002';
  v_reply_1   uuid := 'f0000000-0000-0000-0000-000000000001';
  v_reply_2   uuid := 'f0000000-0000-0000-0000-000000000002';
BEGIN
  -- Look up campaigns by team_id and name
  SELECT id INTO v_camp_ny FROM public.campaigns
  WHERE team_id = v_team_id AND name = 'Batch 003 – Default offer Good leads for agencies in NY'
  LIMIT 1;

  SELECT id INTO v_camp_lon FROM public.campaigns
  WHERE team_id = v_team_id AND name = 'London Video Production Studios Q4'
  LIMIT 1;

  -- Look up mailbox: prefer 'outreach@kestrelleads.com', or fallback to any mailbox belonging to this team
  SELECT id INTO v_mailbox FROM public.mailboxes
  WHERE team_id = v_team_id AND email = 'outreach@kestrelleads.com'
  LIMIT 1;

  IF v_mailbox IS NULL THEN
    SELECT id INTO v_mailbox FROM public.mailboxes
    WHERE team_id = v_team_id
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_camp_ny IS NULL OR v_camp_lon IS NULL THEN
    RAISE EXCEPTION 'Campaigns not found for team %. Run scripts/seed-staging-qc.mjs first.', v_team_id;
  END IF;

  -- 2a. Insert Campaign Leads (includes required opt-out line to satisfy email_steps_problem trigger)
  INSERT INTO public.campaign_leads (
    id, campaign_id, team_id, mailbox_id, to_email, lead_name, status, first_sent_at, steps
  ) VALUES (
    v_lead_1,
    v_camp_ny,
    v_team_id,
    v_mailbox,
    'sarah.connor@cyberdyne.test',
    'Sarah Connor',
    'replied',
    now() - interval '2 days',
    '[{"day": 0, "subject": "Video production for Cyberdyne", "body": "Hi Sarah, quick question regarding video production for Cyberdyne.\n\nNot interested? Just reply no."}]'::jsonb
  ) ON CONFLICT (id) DO UPDATE SET
    campaign_id = excluded.campaign_id,
    mailbox_id = excluded.mailbox_id,
    status = excluded.status,
    first_sent_at = excluded.first_sent_at;

  INSERT INTO public.campaign_leads (
    id, campaign_id, team_id, mailbox_id, to_email, lead_name, status, first_sent_at, steps
  ) VALUES (
    v_lead_2,
    v_camp_lon,
    v_team_id,
    v_mailbox,
    'marcus.wright@resistance.test',
    'Marcus Wright',
    'replied',
    now() - interval '1 day',
    '[{"day": 0, "subject": "Content strategy for Q4", "body": "Hey Marcus, loved your recent release.\n\nNot interested? Just reply no."}]'::jsonb
  ) ON CONFLICT (id) DO UPDATE SET
    campaign_id = excluded.campaign_id,
    mailbox_id = excluded.mailbox_id,
    status = excluded.status,
    first_sent_at = excluded.first_sent_at;

  -- Guard: ensure campaign_leads were inserted and not silently skipped by trigger
  IF (SELECT count(*) FROM public.campaign_leads WHERE id IN (v_lead_1, v_lead_2)) < 2 THEN
    RAISE EXCEPTION 'campaign_leads were skipped by a trigger';
  END IF;

  -- 2b. Insert Mail Replies
  INSERT INTO public.mail_replies (
    id, team_id, mailbox_id, campaign_id, campaign_lead_id, kind, from_email, lead_email, subject, snippet, body, received_at, handled, ai_label
  ) VALUES (
    v_reply_1,
    v_team_id,
    v_mailbox,
    v_camp_ny,
    v_lead_1,
    'reply',
    'sarah.connor@cyberdyne.test',
    'sarah.connor@cyberdyne.test',
    'Re: Video production for Cyberdyne',
    'Yes, we are currently reviewing video production proposals for next month. Can you send over a deck?',
    'Yes, we are currently reviewing video production proposals for next month. Can you send over a deck?' || E'\n\n' || 'Best,' || E'\n' || 'Sarah Connor' || E'\n' || 'Cyberdyne Systems',
    now() - interval '1 day',
    false,
    'interested'
  ) ON CONFLICT (id) DO UPDATE SET
    mailbox_id = excluded.mailbox_id,
    campaign_id = excluded.campaign_id,
    snippet = excluded.snippet,
    body = excluded.body,
    received_at = excluded.received_at;

  INSERT INTO public.mail_replies (
    id, team_id, mailbox_id, campaign_id, campaign_lead_id, kind, from_email, lead_email, subject, snippet, body, received_at, handled, ai_label
  ) VALUES (
    v_reply_2,
    v_team_id,
    v_mailbox,
    v_camp_lon,
    v_lead_2,
    'reply',
    'marcus.wright@resistance.test',
    'marcus.wright@resistance.test',
    'Re: Content strategy for Q4',
    'Thanks for reaching out. Let us set up a call next Tuesday at 2pm GMT.',
    'Thanks for reaching out. Let us set up a call next Tuesday at 2pm GMT.' || E'\n\n' || 'Cheers,' || E'\n' || 'Marcus',
    now() - interval '4 hours',
    false,
    'meeting'
  ) ON CONFLICT (id) DO UPDATE SET
    mailbox_id = excluded.mailbox_id,
    campaign_id = excluded.campaign_id,
    snippet = excluded.snippet,
    body = excluded.body,
    received_at = excluded.received_at;
END $$;

COMMIT;

-- 3. Verification Summary for team 36d85765-d04c-487a-a515-dc062bd3123a
SELECT 
  '36d85765-d04c-487a-a515-dc062bd3123a'::uuid AS team_id,
  (SELECT count(*) FROM public.access_grants WHERE team_id = '36d85765-d04c-487a-a515-dc062bd3123a' AND revoked_at IS NULL AND ends_at > now()) AS active_access_grants,
  (SELECT count(*) FROM public.campaign_leads WHERE team_id = '36d85765-d04c-487a-a515-dc062bd3123a') AS total_campaign_leads,
  (SELECT count(*) FROM public.mail_replies WHERE team_id = '36d85765-d04c-487a-a515-dc062bd3123a') AS total_mail_replies;
