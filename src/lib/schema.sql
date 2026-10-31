-- Nestora — relational schema (SQLite)
-- Every core domain object from the specification has a real table.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  account_type TEXT NOT NULL,             -- college_university | company | organisation | community_organisation | individual | other_institution
  org_name TEXT,
  country TEXT, state TEXT, city TEXT, address TEXT,
  avatar_url TEXT,
  bio TEXT,
  role TEXT NOT NULL DEFAULT 'user',       -- user | admin
  active_mode TEXT NOT NULL DEFAULT 'buyer', -- buyer | provider  (UI mode switch)
  is_demo INTEGER NOT NULL DEFAULT 0,
  onboarded INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                     -- hash of the session token
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_agent TEXT,
  ip TEXT
);

CREATE TABLE IF NOT EXISTS provider_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  storefront_slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  org_type TEXT NOT NULL,
  description TEXT,
  logo_url TEXT,
  website TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  cancellation_policy TEXT,
  collection_policy TEXT,
  verification_status TEXT NOT NULL DEFAULT 'not_submitted', -- not_submitted | pending | verified | rejected | more_info
  verification_note TEXT,
  verified_at TEXT,
  rating_cached REAL NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  priority_policy TEXT NOT NULL DEFAULT '{}',   -- JSON: fair-allocation rules
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS verification_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  legal_name TEXT NOT NULL,
  registration_number TEXT,
  institution_type TEXT,
  contact_role TEXT,
  identity_doc_url TEXT,
  ownership_doc_url TEXT,
  extra_doc_url TEXT,
  statement TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | more_info
  reviewer_id INTEGER REFERENCES users(id),
  reviewer_note TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  parent_slug TEXT,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  subcategory TEXT,
  description TEXT NOT NULL,
  brand TEXT, model TEXT,
  condition TEXT NOT NULL DEFAULT 'good',  -- new | excellent | good | fair
  quantity_total INTEGER NOT NULL DEFAULT 1,
  quantity_active INTEGER NOT NULL DEFAULT 0,       -- provider-declared in-use units
  internal_usage_hours_month INTEGER NOT NULL DEFAULT 0,
  location_city TEXT, location_state TEXT,
  lat REAL, lng REAL,
  price_hourly REAL NOT NULL DEFAULT 0,
  price_daily REAL NOT NULL DEFAULT 0,
  price_weekly REAL NOT NULL DEFAULT 0,
  deposit REAL NOT NULL DEFAULT 0,
  eligibility TEXT,
  training_required INTEGER NOT NULL DEFAULT 0,
  supervision_required INTEGER NOT NULL DEFAULT 0,
  usage_rules TEXT,
  cancellation_policy TEXT,
  min_hours INTEGER NOT NULL DEFAULT 1,
  max_days INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'active',  -- draft | active | paused | archived
  model_3d TEXT,                          -- key of the procedural 3D model, if any
  capabilities TEXT NOT NULL DEFAULT '[]',-- JSON array of capability tags
  best_for TEXT,
  approval_mode TEXT NOT NULL DEFAULT 'manual',  -- manual | auto (still subject to eligibility)
  booking_limit_days INTEGER NOT NULL DEFAULT 14, -- max concurrent advance days per buyer
  utilisation_state TEXT DEFAULT NULL,    -- frequently_used | underused | idle | unknown (derived nightly/jit)
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_resources_provider ON resources(provider_id);
CREATE INDEX IF NOT EXISTS idx_resources_category ON resources(category);

CREATE TABLE IF NOT EXISTS resource_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  alt TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS resource_availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  date TEXT NOT NULL,                    -- YYYY-MM-DD
  status TEXT NOT NULL DEFAULT 'available', -- available | blocked | maintenance
  note TEXT,
  UNIQUE(resource_id, date)
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  resource_id INTEGER NOT NULL REFERENCES resources(id),
  buyer_id INTEGER NOT NULL REFERENCES users(id),
  provider_id INTEGER NOT NULL REFERENCES provider_profiles(id),
  start_date TEXT NOT NULL,              -- YYYY-MM-DD
  end_date TEXT NOT NULL,
  days INTEGER NOT NULL,
  purpose TEXT,
  units INTEGER NOT NULL DEFAULT 1,
  rate_basis TEXT NOT NULL DEFAULT 'daily', -- hourly | daily | weekly
  subtotal REAL NOT NULL,
  deposit REAL NOT NULL,
  fees REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  -- pending | approved | rejected | counteroffered | awaiting_payment | paid
  -- | ready_for_handover | active | return_requested | completed
  -- | cancelled | expired | disputed
  provider_note TEXT,
  counter_start TEXT, counter_end TEXT, counter_note TEXT,
  priority_score REAL NOT NULL DEFAULT 0,
  priority_reason TEXT,
  -- Immutable price snapshot captured at booking creation (JSON: rate, days, units,
  -- subtotal, fees, deposit, total). Payments are verified against THIS, never
  -- against a provider's prices as they are today.
  price_snapshot TEXT,
  price_pinned_at TEXT,
  waiting_list_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bookings_resource ON bookings(resource_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_bookings_buyer ON bookings(buyer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_provider ON bookings(provider_id);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'rental',    -- rental | deposit | extension | refund
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  mode TEXT NOT NULL DEFAULT 'demo',      -- demo | razorpay
  status TEXT NOT NULL DEFAULT 'pending', -- pending | created | paid | failed | refunded | partially_refunded
  provider_order_id TEXT,
  provider_payment_id TEXT,
  signature_valid INTEGER,
  meta TEXT,
  -- Set only when Razorpay reports the payment as captured (never for authorized).
  captured_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);

-- One row per gateway order / payment id. Partial indexes so the many demo-mode
-- rows (NULL provider ids) never collide, while a real order or payment id can
-- only ever appear once — this is the database-level guard against reuse.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_order_unique
  ON payments(provider_order_id) WHERE provider_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_payment_unique
  ON payments(provider_payment_id) WHERE provider_payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'held_demo', -- held_demo | released | partially_released | deducted | disputed
  released_amount REAL NOT NULL DEFAULT 0,
  deducted_amount REAL NOT NULL DEFAULT 0,
  note TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS handovers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  provider_ready_at TEXT, provider_ready_note TEXT,
  initial_condition TEXT,
  checklist TEXT NOT NULL DEFAULT '[]',   -- JSON
  provider_photos TEXT NOT NULL DEFAULT '[]',
  buyer_confirmed_at TEXT,
  buyer_note TEXT,
  buyer_photos TEXT NOT NULL DEFAULT '[]',
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  buyer_requested_at TEXT,
  buyer_note TEXT,
  buyer_photos TEXT NOT NULL DEFAULT '[]',
  provider_inspected_at TEXT,
  return_condition TEXT,
  checklist TEXT NOT NULL DEFAULT '[]',
  provider_photos TEXT NOT NULL DEFAULT '[]',
  provider_note TEXT,
  confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS extensions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  requested_end TEXT NOT NULL,
  extra_days INTEGER NOT NULL,
  extra_cost REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  note TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS condition_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  resource_id INTEGER NOT NULL REFERENCES resources(id),
  stage TEXT NOT NULL,                    -- initial | return | damage | maintenance
  condition TEXT,
  checklist TEXT NOT NULL DEFAULT '[]',
  photos TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  reported_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS maintenance_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL, end_date TEXT,
  kind TEXT NOT NULL DEFAULT 'service',   -- service | repair | inspection
  notes TEXT,
  cost REAL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS disputes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  raised_by INTEGER NOT NULL REFERENCES users(id),
  against INTEGER REFERENCES users(id),
  kind TEXT NOT NULL,                     -- damage | missing | late_return | other
  claim_amount REAL DEFAULT 0,
  description TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open',    -- open | evidence_requested | under_review | resolved | rejected | closed
  decision TEXT,
  deduction_amount REAL DEFAULT 0,
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dispute_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dispute_id INTEGER NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  resource_id INTEGER NOT NULL REFERENCES resources(id),
  provider_id INTEGER NOT NULL REFERENCES provider_profiles(id),
  buyer_id INTEGER NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL,
  body TEXT,
  condition_accuracy INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS favourites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, resource_id)
);

CREATE TABLE IF NOT EXISTS recently_viewed (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, resource_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS waiting_list (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'waiting', -- waiting | offered | converted | expired | cancelled
  offered_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS utilisation_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  snapshot_date TEXT NOT NULL,
  booked_days INTEGER NOT NULL DEFAULT 0,
  available_days INTEGER NOT NULL DEFAULT 0,
  utilisation_pct REAL NOT NULL DEFAULT 0,
  idle_units_estimate REAL NOT NULL DEFAULT 0,
  basis TEXT NOT NULL DEFAULT 'records',   -- records | sample_demo
  UNIQUE(resource_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER REFERENCES users(id),
  actor_email TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  detail TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  resource_id INTEGER REFERENCES resources(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'open',    -- open | dismissed | actioned
  handled_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS booking_usage (
  user_id INTEGER NOT NULL,
  resource_id INTEGER NOT NULL,
  completed_bookings INTEGER NOT NULL DEFAULT 0,
  cancelled_bookings INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, resource_id)
);
