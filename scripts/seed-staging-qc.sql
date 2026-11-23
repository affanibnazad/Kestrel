-- scripts/seed-staging-qc.sql
-- Seed sample data for STAGING test user: staging-test@kestrelleads.com (team 36d85765-d04c-487a-a515-dc062bd3123a)

-- 1. Free Access Grant (30 days of free Pro access)
INSERT INTO public.access_grants (id, team_id, code, plan, starts_at, ends_at, claimed_by)
VALUES (
  'c0000000-0000-0000-0000-000000000001',
  '36d85765-d04c-487a-a515-dc062bd3123a',
  'QC-FREE-ACCESS-2026',
  'pro',
  now(),
  now() + interval '30 days',
  '6e25520a-5a9a-4b30-8f80-bc0b149f22ad'
) ON CONFLICT (id) DO UPDATE SET ends_at = now() + interval '30 days', revoked_at = null;

-- 2. 2 Reply Threads with real conversation history
INSERT INTO public.campaign_leads (id, campaign_id, team_id, to_email, lead_name, status, first_sent_at, steps)
VALUES 
  ('e0000000-0000-0000-0000-000000000001', 'df0facc8-0394-470b-998d-a812eb927ef0', '36d85765-d04c-487a-a515-dc062bd3123a', 'sarah.connor@cyberdyne.test', 'Sarah Connor', 'replied', now() - interval '2 days', '[{"day": 0, "subject": "Video production for Cyberdyne", "body": "Hi Sarah, quick question regarding video production."}]'::jsonb),
  ('e0000000-0000-0000-0000-000000000002', '78fac201-1d39-4411-851f-c0aa8acce1fb', '36d85765-d04c-487a-a515-dc062bd3123a', 'marcus.wright@resistance.test', 'Marcus Wright', 'replied', now() - interval '1 day', '[{"day": 0, "subject": "Content strategy for Q4", "body": "Hey Marcus, loved your recent release."}]'::jsonb)
ON CONFLICT (id) DO UPDATE SET first_sent_at = excluded.first_sent_at;

-- Mail replies (real text)
INSERT INTO public.mail_replies (id, team_id, mailbox_id, campaign_id, campaign_lead_id, kind, from_email, lead_email, subject, snippet, body, received_at, handled, ai_label)
VALUES 
  ('f0000000-0000-0000-0000-000000000001', '36d85765-d04c-487a-a515-dc062bd3123a', '11fd90e3-31e1-4115-a522-46b8a46f306d', 'df0facc8-0394-470b-998d-a812eb927ef0', 'e0000000-0000-0000-0000-000000000001', 'reply', 'sarah.connor@cyberdyne.test', 'sarah.connor@cyberdyne.test', 'Re: Video production for Cyberdyne', 'Yes, we are currently reviewing video production proposals for next month. Can you send over a deck and pricing?', 'Yes, we are currently reviewing video production proposals for next month. Can you send over a deck and pricing?

Best,
Sarah Connor
Cyberdyne Systems', now() - interval '1 day', false, 'interested'),
  ('f0000000-0000-0000-0000-000000000002', '36d85765-d04c-487a-a515-dc062bd3123a', '11fd90e3-31e1-4115-a522-46b8a46f306d', '78fac201-1d39-4411-851f-c0aa8acce1fb', 'e0000000-0000-0000-0000-000000000002', 'reply', 'marcus.wright@resistance.test', 'marcus.wright@resistance.test', 'Re: Content strategy for Q4', 'Thanks for reaching out. Let us set up a call next Tuesday at 2pm GMT.', 'Thanks for reaching out. Let us set up a call next Tuesday at 2pm GMT.

Cheers,
Marcus', now() - interval '4 hours', false, 'meeting')
ON CONFLICT (id) DO UPDATE SET snippet = excluded.snippet, body = excluded.body;
