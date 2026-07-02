-- Migration 025: notifications table
-- Creates a notifications table for in-app alerts sent to managers.
-- Irreversible: none — this is a net-new table. Rolling back means DROP TABLE notifications.

CREATE TABLE notifications (
  id         bigserial    PRIMARY KEY,
  profile_id uuid         NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  season_id  int          REFERENCES seasons(id) ON DELETE CASCADE,
  type       text         NOT NULL CHECK (type IN ('round_scored', 'chronicle_post', 'deadline_approaching')),
  message    text         NOT NULL,
  read       boolean      NOT NULL DEFAULT false,
  created_at timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Managers can read their own notifications
CREATE POLICY "own read" ON notifications
  FOR SELECT
  USING (auth.uid() = profile_id);

-- Managers can mark their own notifications as read
CREATE POLICY "own update" ON notifications
  FOR UPDATE
  USING (auth.uid() = profile_id);

-- Only admins can write notifications
CREATE POLICY "admin insert" ON notifications
  FOR INSERT
  WITH CHECK (is_admin());

GRANT SELECT, INSERT, UPDATE ON notifications TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE notifications_id_seq TO authenticated;
