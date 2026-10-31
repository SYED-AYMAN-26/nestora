#!/usr/bin/env node
/**
 * Nestora demo seed.
 * All providers, resources, bookings, reviews and verification records created
 * here are FICTIONAL demonstration data and are flagged is_demo = 1.
 * Demo password for every account: Demo@1234 by default, override with DEMO_PASSWORD.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const dbPath = process.env.DATABASE_PATH
  ? path.resolve(root, process.env.DATABASE_PATH)
  : path.join(root, "data", "rentlink.db");

/**
 * Seeding is ALWAYS in place. Deleting the database file while a server holds it
 * open (WAL mode) leaves the two processes looking at different inodes, which
 * silently splits "the same database" into two. So --reset just means
 * "truncate every table and reseed", which is exactly what the table-clearing
 * block below already does.
 */
const DEFAULT_DEMO_PASSWORD = "Demo@1234";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || DEFAULT_DEMO_PASSWORD;
const ALLOW_DEMO_SEED = ["1", "true", "yes"].includes(String(process.env.ALLOW_DEMO_SEED ?? "").toLowerCase());

// Same policy as src/lib/env.ts: never silently publish a well-known admin
// password from a production deployment.
if (process.env.NODE_ENV === "production" && !ALLOW_DEMO_SEED) {
  console.error(
    [
      "Refusing to seed demo data into a production deployment.",
      "",
      "Every seeded account is fictional and shares one password, including an admin.",
      "If this really is a throwaway demo environment, opt in explicitly:",
      "",
      "    ALLOW_DEMO_SEED=1 npm run db:reset",
      "",
      "and set a non-default password:",
      "",
      "    ALLOW_DEMO_SEED=1 DEMO_PASSWORD='something-else' npm run db:reset",
    ].join("\n")
  );
  process.exit(2);
}
if (process.env.NODE_ENV === "production" && DEMO_PASSWORD === DEFAULT_DEMO_PASSWORD) {
  console.warn(
    "WARNING: seeding a production-flagged deployment with the documented demo password.\n" +
    "         Demo logins are blocked unless ALLOW_DEMO_SEED=1, so this is opt-in only."
  );
}
if (DEMO_PASSWORD === DEFAULT_DEMO_PASSWORD) {
  console.log(`(demo password: the documented default — set DEMO_PASSWORD to override)`);
}

const RESET = process.argv.includes("--reset");
if (RESET) console.log("(--reset: truncating and reseeding in place — the file is never deleted)");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(fs.readFileSync(path.join(root, "src/lib/schema.sql"), "utf8"));

// Clear tables so the seed is idempotent
const tables = [
  "booking_usage", "utilisation_snapshots", "waiting_list", "audit_logs", "rate_limits",
  "notifications", "messages", "recently_viewed", "favourites", "reviews", "dispute_messages",
  "disputes", "maintenance_records", "condition_reports", "extensions", "returns", "handovers",
  "deposits", "payments", "bookings", "resource_availability", "resource_images", "resources",
  "verification_requests", "provider_profiles", "sessions", "reports", "settings", "categories", "users",
];
for (const t of tables) db.exec(`DELETE FROM ${t};`);
// (The truncation above removes fixture accounts created by the E2E suite too, so
// the demo dataset never accumulates is_demo = 0 test rows.)

db.exec(`DELETE FROM sqlite_sequence;`);

// ---------------------------------------------------------------- helpers
function hash(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
  return `scrypt$16384$8$1$${salt}$${h}`;
}
const PASSWORD = DEMO_PASSWORD;
const PW_HASH = hash(PASSWORD);
const iso = (offsetDays = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};
const ts = (offsetDays = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString();
};

function insertUser(u) {
  const r = db.prepare(
    `INSERT INTO users (email, password_hash, full_name, phone, account_type, org_name, country, state, city, address,
      avatar_url, role, active_mode, is_demo, onboarded, bio)
     VALUES (@email,@password_hash,@full_name,@phone,@account_type,@org_name,@country,@state,@city,@address,@avatar_url,@role,@active_mode,1,1,@bio)`
  ).run({
    email: u.email, password_hash: PW_HASH, full_name: u.full_name, phone: u.phone ?? null,
    account_type: u.account_type, org_name: u.org_name ?? null, country: u.country ?? "India",
    state: u.state ?? null, city: u.city ?? null, address: u.address ?? null,
    avatar_url: u.avatar_url ?? null, role: u.role ?? "user", active_mode: u.active_mode ?? "buyer",
    bio: u.bio ?? null,
  });
  return Number(r.lastInsertRowid);
}

function insertProvider(userId, p) {
  const r = db.prepare(
    `INSERT INTO provider_profiles (user_id, storefront_slug, display_name, org_type, description, logo_url, website,
      contact_email, contact_phone, cancellation_policy, collection_policy, verification_status, verified_at, priority_policy, is_demo)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`
  ).run(
    userId, p.slug, p.display_name, p.org_type, p.description, p.logo_url ?? null, p.website ?? null,
    p.contact_email, p.contact_phone, p.cancellation_policy ?? DEFAULT_CANCEL, p.collection_policy ?? DEFAULT_COLLECT,
    p.verification_status, p.verification_status === "verified" ? ts(-30) : null,
    JSON.stringify(p.priority_policy ?? {}),
  );
  return Number(r.lastInsertRowid);
}

const DEFAULT_CANCEL =
  "Free cancellation up to 48 hours before the booking start date. Cancellations inside 48 hours are refunded at 50%. No refund for no-shows.";
const DEFAULT_COLLECT =
  "Collect from the provider's campus reception between 09:00 and 17:00 on weekdays. Bring a government photo ID and the booking code.";

function insertResource(providerId, r) {
  const res = db.prepare(
    `INSERT INTO resources (provider_id, title, category, subcategory, description, brand, model, condition,
      quantity_total, quantity_active, internal_usage_hours_month, location_city, location_state,
      price_hourly, price_daily, price_weekly, deposit, eligibility, training_required, supervision_required,
      usage_rules, cancellation_policy, min_hours, max_days, status, model_3d, capabilities, best_for,
      approval_mode, booking_limit_days, is_demo, created_at)
     VALUES (@provider_id,@title,@category,@subcategory,@description,@brand,@model,@condition,
      @quantity_total,@quantity_active,@internal_usage_hours_month,@location_city,@location_state,
      @price_hourly,@price_daily,@price_weekly,@deposit,@eligibility,@training_required,@supervision_required,
      @usage_rules,@cancellation_policy,@min_hours,@max_days,'active',@model_3d,@capabilities,@best_for,
      @approval_mode,@booking_limit_days,1,@created_at)`
  ).run({
    provider_id: providerId, title: r.title, category: r.category, subcategory: r.subcategory,
    description: r.description, brand: r.brand ?? null, model: r.model ?? null,
    condition: r.condition ?? "good", quantity_total: r.quantity_total ?? 1,
    quantity_active: r.quantity_active ?? 0, internal_usage_hours_month: r.internal_usage_hours_month ?? 0,
    location_city: r.location_city, location_state: r.location_state,
    price_hourly: r.price_hourly ?? 0, price_daily: r.price_daily ?? 0, price_weekly: r.price_weekly ?? 0,
    deposit: r.deposit ?? 0, eligibility: r.eligibility ?? null,
    training_required: r.training_required ? 1 : 0, supervision_required: r.supervision_required ? 1 : 0,
    usage_rules: r.usage_rules ?? null, cancellation_policy: DEFAULT_CANCEL,
    min_hours: r.min_hours ?? 1, max_days: r.max_days ?? 14, model_3d: r.model_3d ?? null,
    capabilities: JSON.stringify(r.capabilities ?? []), best_for: r.best_for ?? null,
    approval_mode: r.approval_mode ?? "manual", booking_limit_days: r.booking_limit_days ?? 14,
    created_at: ts(-45),
  });
  const id = Number(res.lastInsertRowid);
  (r.images ?? []).forEach((url, i) =>
    db.prepare(`INSERT INTO resource_images (resource_id, url, alt, sort_order) VALUES (?,?,?,?)`)
      .run(id, url, r.title, i)
  );
  return id;
}

// ---------------------------------------------------------------- users
const admin = insertUser({
  email: "admin@rentlink.demo", full_name: "Platform Administrator", phone: "+91 90000 00001",
  account_type: "other_institution", org_name: "Nestora Platform", state: "Tamil Nadu", city: "Chennai",
  role: "admin", active_mode: "provider", bio: "Nestora platform administrator (demo account).",
});

const P = {};
function providerUser(key, u, p) {
  const uid = insertUser({ ...u, active_mode: "provider" });
  const pid = insertProvider(uid, p);
  P[key] = { userId: uid, providerId: pid };
  return P[key];
}

providerUser("anna", {
  email: "provider@anna.demo", full_name: "Dr. Lakshmi Narayanan", org_name: "Anna Institute of Technology",
  phone: "+91 90000 00010", account_type: "college_university", state: "Tamil Nadu", city: "Chennai",
  address: "12 College Road, Guindy, Chennai 600025",
  bio: "Head of the Central Instrumentation Facility. We share lab equipment, cameras and media spaces with students and neighbouring institutions.",
}, {
  slug: "anna-institute-of-technology", display_name: "Anna Institute of Technology",
  org_type: "college_university",
  description: "A fictional engineering college in Chennai with a Central Instrumentation Facility. We list equipment that sits idle outside lab hours so students and nearby institutions can use it.",
  contact_email: "share@anna.demo", contact_phone: "+91 90000 00010", website: "https://anna.demo",
  verification_status: "verified",
  priority_policy: {
    eligible_account_types: ["college_university", "organisation", "community_organisation"],
    boost_academic: true, boost_underserved: true, fair_rotation: true, max_score: 100,
  },
});

providerUser("bharat", {
  email: "provider@bharat.demo", full_name: "Prof. Meera Iyer", org_name: "Bharat Media University",
  phone: "+91 90000 00011", account_type: "college_university", state: "Karnataka", city: "Bengaluru",
  address: "Media Campus, Yeshwanthpur, Bengaluru 560022",
  bio: "Film and media school sharing production kit and studios with community filmmakers.",
}, {
  slug: "bharat-media-university", display_name: "Bharat Media University",
  org_type: "college_university",
  description: "Fictional media university with a film production department. We rent out production equipment and sound-treated studios when not in class use.",
  contact_email: "equipment@bharat.demo", contact_phone: "+91 90000 00011",
  verification_status: "verified",
  priority_policy: { eligible_account_types: [], boost_academic: true, boost_underserved: true, fair_rotation: true, max_score: 100 },
});

providerUser("creators", {
  email: "provider@creators.demo", full_name: "Karthik Raman", org_name: "Chennai Creators Collective",
  phone: "+91 90000 00012", account_type: "company", state: "Tamil Nadu", city: "Chennai",
  address: "3rd Floor, T Nagar, Chennai 600017",
}, {
  slug: "chennai-creators-collective", display_name: "Chennai Creators Collective",
  org_type: "company",
  description: "A fictional independent production company that hires out surplus camera and audio gear between shoots.",
  contact_email: "hire@creators.demo", contact_phone: "+91 90000 00012",
  verification_status: "pending",
  priority_policy: { boost_academic: false, boost_underserved: true, fair_rotation: true, max_score: 100 },
});

providerUser("adyar", {
  email: "provider@adyar.demo", full_name: "Sundari Balan", org_name: "Adyar Community Makerspace",
  phone: "+91 90000 00013", account_type: "community_organisation", state: "Tamil Nadu", city: "Chennai",
  address: "Adyar Community Centre, Chennai 600020",
}, {
  slug: "adyar-community-makerspace", display_name: "Adyar Community Makerspace",
  org_type: "community_organisation",
  description: "A fictional neighbourhood makerspace with 3D printers, hand tools and a small workshop room, run by volunteers.",
  contact_email: "hello@adyar.demo", contact_phone: "+91 90000 00013",
  verification_status: "verified",
  priority_policy: { eligible_account_types: [], boost_academic: true, boost_underserved: true, fair_rotation: true, max_score: 100 },
});

providerUser("kumar", {
  email: "provider@individual.demo", full_name: "R. Kumar", phone: "+91 90000 00014",
  account_type: "individual", state: "Tamil Nadu", city: "Chennai", address: "Besant Nagar, Chennai",
  bio: "Freelance photographer sharing a second camera body and lenses between assignments.",
}, {
  slug: "kumar-camera-hire", display_name: "Kumar Camera Hire (individual)",
  org_type: "individual",
  description: "A fictional individual provider listing a spare camera body, lenses and a tripod.",
  contact_email: "kumar@individual.demo", contact_phone: "+91 90000 00014",
  verification_status: "not_submitted",
  priority_policy: {},
});

providerUser("sunrise", {
  email: "provider@sunrise.demo", full_name: "Anita Fernandes", org_name: "Sunrise Event Services",
  phone: "+91 90000 00015", account_type: "company", state: "Tamil Nadu", city: "Chennai",
}, {
  slug: "sunrise-event-services", display_name: "Sunrise Event Services",
  org_type: "company",
  description: "Fictional event services company sharing PA systems, projectors and stage lighting.",
  contact_email: "book@sunrise.demo", contact_phone: "+91 90000 00015",
  verification_status: "more_info",
  priority_policy: {},
});

const buyers = {};
buyers.riya = insertUser({
  email: "buyer@student.demo", full_name: "Riya Sharma", phone: "+91 90000 00020",
  account_type: "college_university", org_name: "Anna Institute of Technology",
  state: "Tamil Nadu", city: "Chennai", address: "Hostel Block C, Guindy",
  bio: "Final-year electronics student working on a robotics capstone.",
});
buyers.arjun = insertUser({
  email: "buyer@individual.demo", full_name: "Arjun Menon", phone: "+91 90000 00021",
  account_type: "individual", state: "Kerala", city: "Kochi",
  bio: "Independent filmmaker looking for affordable production gear.",
});
buyers.nithya = insertUser({
  email: "buyer@community.demo", full_name: "Nithya Devi", phone: "+91 90000 00022",
  account_type: "community_organisation", org_name: "Coastal Youth Collective",
  state: "Tamil Nadu", city: "Chennai",
});
buyers.vikram = insertUser({
  email: "buyer@company.demo", full_name: "Vikram Sethi", phone: "+91 90000 00023",
  account_type: "company", org_name: "Nexa Robotics Pvt Ltd",
  state: "Karnataka", city: "Bengaluru",
});

// ---------------------------------------------------------------- verification requests
const vr = db.prepare(
  `INSERT INTO verification_requests (provider_id, legal_name, registration_number, institution_type, contact_role,
    identity_doc_url, ownership_doc_url, extra_doc_url, statement, status, reviewer_id, reviewer_note, reviewed_at, created_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
);
vr.run(P.anna.providerId, "Anna Institute of Technology", "TN-ENG-1998-0421", "college_university", "Facility Head",
  "/api/files/demo/identity", "/api/files/demo/ownership", null,
  "We own the listed equipment and authorise the Central Instrumentation Facility to share it.", "approved",
  admin, "Registration certificate and ownership invoice verified against the institution's public record.", ts(-30), ts(-33));
vr.run(P.bharat.providerId, "Bharat Media University", "KA-UNI-2009-1188", "college_university", "Equipment Manager",
  "/api/files/demo/identity", "/api/files/demo/ownership", null,
  "Department of Film Production. Equipment inventory attached.", "approved",
  admin, "Verified with the university's equipment registry.", ts(-22), ts(-25));
vr.run(P.creators.providerId, "Chennai Creators Collective Pvt Ltd", "U74999TN2019PTC130772", "company", "Founder",
  "/api/files/demo/identity", "/api/files/demo/ownership", null,
  "GST and incorporation certificate submitted; purchase invoices for cameras attached.", "pending", null, null, null, ts(-4));
vr.run(P.adyar.providerId, "Adyar Community Makerspace Trust", "TN-TRUST-2016-0912", "community_organisation", "Trustee",
  "/api/files/demo/identity", "/api/files/demo/ownership", null,
  "Community trust running the makerspace. Tools purchased from trust funds.", "approved",
  admin, "Trust deed verified; workshop insurance certificate on file.", ts(-15), ts(-18));
vr.run(P.sunrise.providerId, "Sunrise Event Services", "U93000TN2021PTC145001", "company", "Operations Head",
  "/api/files/demo/identity", null, null,
  "We resell and hire AV equipment.", "more_info", admin,
  "Ownership/authorisation evidence for the listed PA systems is missing. Please upload purchase or lease documents.",
  ts(-6), ts(-9));

// ---------------------------------------------------------------- resources
const IMG = (n) => `/img/${n}.svg`;

// --- Anna Institute of Technology
const R = {};
R.cameraAnna = insertResource(P.anna.providerId, {
  title: "Canon EOS 90D DSLR Camera (body + 18-135mm lens)",
  category: "cameras-photography", subcategory: "DSLR Camera",
  description: "APS-C DSLR with the kit zoom lens, two batteries, charger and a padded shoulder bag. Used by our media elective during term; available during vacations and weekends. Sensor cleaned and shutter count logged at every inspection.",
  brand: "Canon", model: "EOS 90D", condition: "excellent",
  quantity_total: 20, quantity_active: 5, internal_usage_hours_month: 120,
  location_city: "Chennai", location_state: "Tamil Nadu",
  price_hourly: 180, price_daily: 900, price_weekly: 5200, deposit: 5000,
  eligibility: "Students and staff of recognised institutions, plus verified community media groups.",
  usage_rules: "Return with battery charged. Do not use in rain without a cover. Report any sensor error immediately.",
  model_3d: "camera", capabilities: ["photo_capture", "video_capture", "cinematic_video", "low_light_capture"],
  best_for: "Event photography, short films, product shoots",
  images: [IMG("camera"), IMG("door"), IMG("room")],
  priority_policy: {},
});
R.roboticsAnna = insertResource(P.anna.providerId, {
  title: "Arduino & Sensor Robotics Lab Kit (10 boards + 40 sensors)",
  category: "robotics-electronics", subcategory: "Robotics Kits",
  description: "A classroom robotics kit: 10 Arduino Uno R3 boards, breadboards, jumper sets, a mixed sensor pack (ultrasonic, IR, temperature, IMU) and two small motor driver shields. Ideal for a semester project team.",
  brand: "Arduino", model: "Uno R3 starter fleet", condition: "good",
  quantity_total: 6, quantity_active: 1, internal_usage_hours_month: 60,
  location_city: "Chennai", location_state: "Tamil Nadu",
  price_hourly: 90, price_daily: 450, price_weekly: 2600, deposit: 2000,
  eligibility: "Open to all verified accounts. Under-18s need a supervising adult.",
  training_required: 1,
  usage_rules: "Components must be returned sorted into the labelled trays. Missing parts are charged at replacement cost.",
  model_3d: "chip", capabilities: ["embedded_programming", "sensing", "motor_control", "soldering"],
  best_for: "Robotics projects, electronics labs, hackathons",
  images: [IMG("robotics"), IMG("chip")],
  booking_limit_days: 21,
});
R.labAnna = insertResource(P.anna.providerId, {
  title: "Optics Bench & Spectrometer Laboratory Space",
  category: "spaces-rooms", subcategory: "Lab Space",
  description: "A 24-seat optics lab with two optical benches, a UV-Vis spectrometer and a dark corner for alignment work. Booked by slot; a lab technician supervises first-time users.",
  condition: "good",
  quantity_total: 2, quantity_active: 1, internal_usage_hours_month: 80,
  location_city: "Chennai", location_state: "Tamil Nadu",
  price_hourly: 700, price_daily: 3500, price_weekly: 18000, deposit: 3000,
  eligibility: "Institutional accounts with a named supervisor.",
  supervision_required: 1,
  usage_rules: "Safety goggles mandatory. Laser equipment only with the technician present.",
  capabilities: ["precision_measurement", "spectroscopy", "enclosed_space"],
  best_for: "Physics practicals, spectroscopy projects",
  images: [IMG("flask"), IMG("door")],
  max_days: 7,
});
R.projectorAnna = insertResource(P.anna.providerId, {
  title: "Epson 3600 Lumen Full-HD Projector",
  category: "event-equipment", subcategory: "Projector",
  description: "Portable 1080p projector with HDMI and VGA inputs, remote and carry case. Used for classroom overflow during exams; idle most evenings.",
  brand: "Epson", model: "EB-FH06", condition: "good",
  quantity_total: 5, quantity_active: 2, internal_usage_hours_month: 40,
  location_city: "Chennai", location_state: "Tamil Nadu",
  price_hourly: 150, price_daily: 750, price_weekly: 4000, deposit: 3000,
  usage_rules: "Allow 60 seconds for lamp cooldown before packing.",
  model_3d: "projector", capabilities: ["projection", "audience_seating"],
  best_for: "Seminars, club screenings, workshops",
  images: [IMG("projector")],
});

// --- Bharat Media University
R.cameraBharat = insertResource(P.bharat.providerId, {
  title: "Sony A7 III Mirrorless Kit (2 bodies, 24-70mm f/4)",
  category: "cameras-photography", subcategory: "Mirrorless Camera",
  description: "Full-frame mirrorless kit used for student thesis films. Two bodies, one zoom lens, four batteries, dual charger and a hard case. Weekly rate includes one free sensor clean.",
  brand: "Sony", model: "A7 III", condition: "excellent",
  quantity_total: 4, quantity_active: 1, internal_usage_hours_month: 50,
  location_city: "Bengaluru", location_state: "Karnataka",
  price_hourly: 260, price_daily: 1400, price_weekly: 7800, deposit: 8000,
  eligibility: "Media students and verified production companies. Portfolio review for first-time hirers.",
  usage_rules: "Must be collected and returned in the hard case. No drone or crane mounting.",
  model_3d: "camera", capabilities: ["photo_capture", "video_capture", "cinematic_video", "low_light_capture"],
  best_for: "Thesis films, interviews, low-light shoots",
  images: [IMG("camera"), IMG("drone")],
});
R.studioBharat = insertResource(P.bharat.providerId, {
  title: "Sound-Treated Recording Studio (with engineer)",
  category: "spaces-rooms", subcategory: "Recording Studio",
  description: "12m² acoustically treated booth with a Neumann TLM 103, Focusrite interface, Pro Tools rig and a resident engineer. Booked in 3-hour blocks.",
  condition: "excellent",
  quantity_total: 1, quantity_active: 0, internal_usage_hours_month: 30,
  location_city: "Bengaluru", location_state: "Karnataka",
  price_hourly: 900, price_daily: 6000, price_weekly: 32000, deposit: 2000,
  eligibility: "Open to all verified accounts; engineer supervision included.",
  supervision_required: 1,
  model_3d: "microphone", capabilities: ["audio_recording", "audio_mixing", "acoustic_treatment", "enclosed_space"],
  best_for: "Podcasts, voice-over, music demos",
  images: [IMG("microphone"), IMG("room")],
  max_days: 5,
  min_hours: 1,
});
R.micBharat = insertResource(P.bharat.providerId, {
  title: "Rode Wireless GO II Dual Microphone Set",
  category: "audio-visual", subcategory: "Microphones",
  description: "Two-channel wireless lavalier kit with windshields, cables and a charging case. Popular with student documentary crews.",
  brand: "Rode", model: "Wireless GO II", condition: "good",
  quantity_total: 6, quantity_active: 2, internal_usage_hours_month: 35,
  location_city: "Bengaluru", location_state: "Karnataka",
  price_hourly: 90, price_daily: 450, price_weekly: 2400, deposit: 2500,
  usage_rules: "Do not expose to moisture. Return in the charging case.",
  model_3d: "microphone", capabilities: ["audio_recording"],
  best_for: "Interviews, documentaries, vlogs",
  images: [IMG("microphone")],
});
R.hallBharat = insertResource(P.bharat.providerId, {
  title: "Mini Seminar Hall (80 seats, AV included)",
  category: "spaces-rooms", subcategory: "Seminar Hall",
  description: "An 80-seat hall with fixed projection, PA system and stage lighting. Used for department seminars on weekdays; available to community groups on weekends.",
  condition: "good",
  quantity_total: 1, quantity_active: 0, internal_usage_hours_month: 20,
  location_city: "Bengaluru", location_state: "Karnataka",
  price_hourly: 800, price_daily: 4800, price_weekly: 24000, deposit: 4000,
  eligibility: "Verified organisations only.",
  usage_rules: "Event must end by 21:00. Cleaning fee applies if left untidy.",
  capabilities: ["audience_seating", "projection", "sound_reinforcement", "lighting_control"],
  best_for: "Seminars, screenings, community events",
  images: [IMG("door"), IMG("projector")],
  max_days: 3,
});

// --- Chennai Creators Collective (pending verification)
R.cameraCreators = insertResource(P.creators.providerId, {
  title: "Nikon D750 DSLR with 50mm f/1.8 lens",
  category: "cameras-photography", subcategory: "DSLR Camera",
  description: "Full-frame DSLR paired with a fast prime lens. Ideal for portraits and low-light event work. Comes with two batteries and a 64GB card.",
  brand: "Nikon", model: "D750", condition: "good",
  quantity_total: 3, quantity_active: 1, internal_usage_hours_month: 25,
  location_city: "Chennai", location_state: "Tamil Nadu",
  price_hourly: 200, price_daily: 1100, price_weekly: 6000, deposit: 6000,
  eligibility: "Photo ID required. Not yet verified by Nestora — expect additional identity checks.",
  usage_rules: "Card must be formatted by the hirer. No third-party sub-letting.",
  model_3d: "camera", capabilities: ["photo_capture", "video_capture", "low_light_capture"],
  best_for: "Portraits, events, low-light interiors",
  images: [IMG("camera")],
});

// --- Adyar Community Makerspace
R.printerAdyar = insertResource(P.adyar.providerId, {
  title: "Prusa i3 MK3S+ 3D Printer (PLA/PETG)",
  category: "3d-printing", subcategory: "3D Printer",
  description: "FDM printer with a 25×21×21cm build volume. Induction required for first-time users (30 minutes, free). Filament is charged separately at cost or bring your own.",
  brand: "Prusa", model: "i3 MK3S+", condition: "good",
  quantity_total: 4, quantity_active: 1, internal_usage_hours_month: 90,
  location_city: "Chennai", location_state: "Tamil Nadu",
  price_hourly: 120, price_daily: 600, price_weekly: 3200, deposit: 1500,
  eligibility: "Makerspace induction required. Under-16s with a guardian.",
  training_required: 1,
  usage_rules: "Only PLA/PETG. Clean the bed after use. Report failed prints to a volunteer.",
  model_3d: "printer", capabilities: ["additive_manufacturing", "rapid_prototyping"],
  best_for: "Prototypes, enclosures, project parts",
  images: [IMG("printer")],
  booking_limit_days: 10,
});
R.workshopAdyar = insertResource(P.adyar.providerId, {
  title: "Workshop Room with Hand & Power Tools",
  category: "tools-workshop", subcategory: "Power Tools",
  description: "A 40m² workshop with a drill press, bench grinder, soldering stations and a full hand-tool wall. A volunteer is on site during opening hours.",
  condition: "good",
  quantity_total: 1, quantity_active: 0, internal_usage_hours_month: 15,
  location_city: "Chennai", location_state: "Tamil Nadu",
  price_hourly: 250, price_daily: 1200, price_weekly: 6500, deposit: 2000,
  eligibility: "Induction required. Safety footwear mandatory.",
  supervision_required: 1, training_required: 1,
  usage_rules: "Eye protection at all times. No spray painting indoors.",
  model_3d: "drill", capabilities: ["soldering", "rapid_prototyping", "precision_measurement", "enclosed_space"],
  best_for: "Repairs, build sessions, weekend projects",
  images: [IMG("drill"), IMG("room")],
  max_days: 7,
});
R.laptopAdyar = insertResource(P.adyar.providerId, {
  title: "Refurbished ThinkPad Laptops (16 units, loaner pool)",
  category: "computing", subcategory: "Laptop",
  description: "A loaner pool of refurbished ThinkPad T480 laptops for students who lack hardware. Shipped with Ubuntu and Windows dual boot, charger and sleeve.",
  brand: "Lenovo", model: "ThinkPad T480", condition: "fair",
  quantity_total: 16, quantity_active: 3, internal_usage_hours_month: 200,
  location_city: "Chennai", location_state: "Tamil Nadu",
  price_hourly: 40, price_daily: 200, price_weekly: 1000, deposit: 2500,
  eligibility: "Students and learners; ID proof required.",
  usage_rules: "No operating-system reinstalls. Report hardware faults immediately.",
  model_3d: "laptop", capabilities: ["computing_general"],
  best_for: "Assignments, online classes, coding practice",
  images: [IMG("laptop")],
  booking_limit_days: 30,
  max_days: 30,
});

// --- Individual provider (unverified)
R.cameraKumar = insertResource(P.kumar.providerId, {
  title: "Fujifilm X-T3 with 35mm f/2 (individual owner)",
  category: "cameras-photography", subcategory: "Mirrorless Camera",
  description: "My second body, shared between my own assignments. Compact mirrorless with a 35mm prime, three batteries and a small shoulder bag.",
  brand: "Fujifilm", model: "X-T3", condition: "excellent",
  quantity_total: 1, quantity_active: 0, internal_usage_hours_month: 10,
  location_city: "Chennai", location_state: "Tamil Nadu",
  price_hourly: 170, price_daily: 950, price_weekly: 5000, deposit: 7000,
  eligibility: "Government photo ID and a short call before confirming. This provider is not yet verified by Nestora.",
  usage_rules: "Meet at Besant Nagar for handover. Late returns charged at the daily rate.",
  model_3d: "camera", capabilities: ["photo_capture", "video_capture", "cinematic_video"],
  best_for: "Street photography, travel, small shoots",
  images: [IMG("camera")],
  max_days: 10,
});

// --- Sunrise Event Services (more info required)
R.paSunrise = insertResource(P.sunrise.providerId, {
  title: "JBL EON 615 PA System (pair + mixer)",
  category: "event-equipment", subcategory: "PA System",
  description: "Two powered 15-inch speakers with stands, a 6-channel mixer and all cabling. Suitable for up to 150 guests indoors.",
  brand: "JBL", model: "EON 615", condition: "good",
  quantity_total: 2, quantity_active: 0, internal_usage_hours_month: 10,
  location_city: "Chennai", location_state: "Tamil Nadu",
  price_hourly: 300, price_daily: 1800, price_weekly: 9500, deposit: 4000,
  usage_rules: "Indoor use only. Cables must be coiled and returned in the case.",
  capabilities: ["sound_reinforcement", "audio_mixing"],
  best_for: "Small events, talks, community gatherings",
  images: [IMG("projector")],
});

// ---------------------------------------------------------------- bookings across the lifecycle
let seq = 0;
function booking(o) {
  seq += 1;
  const code = `RL-DEMO${String(seq).padStart(3, "0")}`;
  const days = Math.round((new Date(o.end) - new Date(o.start)) / 864e5) + 1;
  const subtotal = o.subtotal;
  const deposit = o.deposit ?? 0;
  const fees = Math.round(subtotal * 0.02 * 100) / 100;
  const r = db.prepare(
    `INSERT INTO bookings (code, resource_id, buyer_id, provider_id, start_date, end_date, days, purpose, units,
      rate_basis, subtotal, deposit, fees, total, status, provider_note, priority_score, priority_reason, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,'daily',?,?,?,?,?,?,?,?,?,?)`
  ).run(
    code, o.resourceId, o.buyerId, o.providerId, o.start, o.end, days, o.purpose ?? null, o.units ?? 1,
    Math.round((subtotal + fees) * 100) / 100, deposit, fees, Math.round((subtotal + fees + deposit) * 100) / 100,
    o.status, o.providerNote ?? null, o.priorityScore ?? 40, o.priorityReason ?? null, ts(o.createdOffset ?? -5), ts(o.createdOffset ?? -5)
  );
  return { id: Number(r.lastInsertRowid), code, total: Math.round((subtotal + fees + deposit) * 100) / 100, subtotal, fees, deposit };
}

// 1. Completed booking with full history (camera from Anna) — buyer Riya
const b1 = booking({
  resourceId: R.cameraAnna, buyerId: buyers.riya, providerId: P.anna.providerId,
  start: iso(-22), end: iso(-19), purpose: "Departmental tech-fest photography coverage",
  subtotal: 2700, deposit: 5000, status: "completed", createdOffset: -30,
  priorityScore: 75, priorityReason: "+30 eligible institutional member · +25 stated academic / project purpose · +20 first-time borrower",
});
db.prepare(`INSERT INTO payments (booking_id, kind, amount, mode, status, provider_order_id, meta, paid_at, created_at)
            VALUES (?,?,?,?,?,?,?,?,?)`)
  .run(b1.id, "rental", b1.subtotal + b1.fees, "demo", "paid", "demo_order_1", JSON.stringify({ note: "demo payment" }), ts(-27), ts(-27));
db.prepare(`INSERT INTO payments (booking_id, kind, amount, mode, status, paid_at, created_at) VALUES (?,?,?,?,?,?,?)`)
  .run(b1.id, "deposit", b1.deposit, "demo", "paid", ts(-27), ts(-27));
db.prepare(`INSERT INTO deposits (booking_id, amount, status, released_amount, note, updated_at) VALUES (?,?,?,?,?,?)`)
  .run(b1.id, b1.deposit, "released", b1.deposit, "Equipment returned in the recorded condition; demo deposit released.", ts(-18));
db.prepare(`INSERT INTO handovers (booking_id, provider_ready_at, provider_ready_note, initial_condition, checklist, provider_photos,
            buyer_confirmed_at, buyer_note, completed_at) VALUES (?,?,?,?,?,?,?,?,?)`)
  .run(b1.id, ts(-22), "Batteries charged, sensor cleaned, bag packed.",
    "excellent", JSON.stringify(["Body free of visible damage", "All accessories present", "Power-on test passed"]),
    JSON.stringify(["/img/camera.svg"]), ts(-22), "Condition matches the listing photos.", ts(-22));
db.prepare(`INSERT INTO returns (booking_id, buyer_requested_at, buyer_note, buyer_photos, provider_inspected_at,
            return_condition, checklist, provider_note, confirmed_at) VALUES (?,?,?,?,?,?,?,?,?)`)
  .run(b1.id, ts(-19), "Returned with charged battery.", JSON.stringify(["/img/camera.svg"]), ts(-19),
    "excellent", JSON.stringify(["Body free of visible damage", "All accessories present"]),
    "Everything checks out. Deposit released.", ts(-19));
db.prepare(`INSERT INTO condition_reports (booking_id, resource_id, stage, condition, checklist, photos, notes, reported_by, created_at)
            VALUES (?,?,?,?,?,?,?,?,?)`)
  .run(b1.id, R.cameraAnna, "initial", "excellent", JSON.stringify(["Power-on test passed"]), JSON.stringify(["/img/camera.svg"]),
    "Pre-handover inspection", P.anna.userId, ts(-22));
db.prepare(`INSERT INTO condition_reports (booking_id, resource_id, stage, condition, checklist, photos, notes, reported_by, created_at)
            VALUES (?,?,?,?,?,?,?,?,?)`)
  .run(b1.id, R.cameraAnna, "return", "excellent", JSON.stringify(["Power-on test passed"]), JSON.stringify(["/img/camera.svg"]),
    "Returned in the same condition", P.anna.userId, ts(-19));
db.prepare(`INSERT INTO reviews (booking_id, resource_id, provider_id, buyer_id, rating, body, condition_accuracy, created_at)
            VALUES (?,?,?,?,?,?,?,?)`)
  .run(b1.id, R.cameraAnna, P.anna.providerId, buyers.riya, 5,
    "Camera was exactly as described and the handover checklist made everything quick. The kit was spotless.", 5, ts(-18));
db.prepare(`UPDATE booking_usage SET completed_bookings = completed_bookings + 1, updated_at = ? WHERE user_id = ? AND resource_id = ?`)
  .run(ts(-18), buyers.riya, R.cameraAnna);
db.prepare(`INSERT INTO booking_usage (user_id, resource_id, completed_bookings) VALUES (?,?,1)
            ON CONFLICT(user_id, resource_id) DO NOTHING`).run(buyers.riya, R.cameraAnna);

// 2. Active rental right now (Anna camera) — Arjun, handover done, return pending
const b2 = booking({
  resourceId: R.cameraAnna, buyerId: buyers.arjun, providerId: P.anna.providerId,
  start: iso(-2), end: iso(2), purpose: "Short documentary shoot on coastal livelihoods",
  subtotal: 4500, deposit: 5000, status: "active", createdOffset: -9,
  priorityScore: 55, priorityReason: "+25 stated academic / project purpose · +20 first-time borrower · +10 fair rotation",
});
db.prepare(`INSERT INTO payments (booking_id, kind, amount, mode, status, paid_at, created_at) VALUES (?,?,?,?,?,?,?)`)
  .run(b2.id, "rental", b2.subtotal + b2.fees, "demo", "paid", ts(-7), ts(-7));
db.prepare(`INSERT INTO payments (booking_id, kind, amount, mode, status, paid_at, created_at) VALUES (?,?,?,?,?,?,?)`)
  .run(b2.id, "deposit", b2.deposit, "demo", "paid", ts(-7), ts(-7));
db.prepare(`INSERT INTO deposits (booking_id, amount, status, note) VALUES (?,?,?,?)`)
  .run(b2.id, b2.deposit, "held_demo", "Demo deposit recorded — no funds are actually held.");
db.prepare(`INSERT INTO handovers (booking_id, provider_ready_at, provider_ready_note, initial_condition, checklist, provider_photos,
            buyer_confirmed_at, buyer_note, completed_at) VALUES (?,?,?,?,?,?,?,?,?)`)
  .run(b2.id, ts(-2), "Ready at the media store, second floor.",
    "excellent", JSON.stringify(["Body free of visible damage", "All accessories present", "Power-on test passed"]),
    JSON.stringify(["/img/camera.svg"]), ts(-2), "Confirmed — one small scuff already noted by provider.", ts(-2));

// 3. Pending request awaiting provider decision (Anna robotics kit) — Nithya
const b3 = booking({
  resourceId: R.roboticsAnna, buyerId: buyers.nithya, providerId: P.anna.providerId,
  start: iso(6), end: iso(9), purpose: "Weekend robotics workshop for 25 college students",
  subtotal: 1800, deposit: 2000, status: "pending", createdOffset: -1,
  priorityScore: 55, priorityReason: "+25 stated academic / project purpose · +20 first-time borrower · +10 fair rotation",
  providerNote: null,
});

// 4. Rejected request (Bharat studio) — Vikram, with a reason
booking({
  resourceId: R.studioBharat, buyerId: buyers.vikram, providerId: P.bharat.providerId,
  start: iso(4), end: iso(4), purpose: "Corporate training voice-over",
  subtotal: 6000, deposit: 2000, status: "rejected", createdOffset: -6,
  providerNote: "The studio is booked for a student assessment that day. Please try the following week — the engineer is free on Tuesday and Thursday.",
});

// 5. Counteroffer (Bharat mini hall) — Arjun; provider proposed new dates
const b5 = booking({
  resourceId: R.hallBharat, buyerId: buyers.arjun, providerId: P.bharat.providerId,
  start: iso(10), end: iso(10), purpose: "Community screening of a short film",
  subtotal: 4800, deposit: 4000, status: "counteroffered", createdOffset: -3,
  providerNote: "The hall is used for exams on that date. I can offer the Sunday instead at the same daily rate.",
});
db.prepare(`UPDATE bookings SET counter_start = ?, counter_end = ?, counter_note = ? WHERE id = ?`)
  .run(iso(12), iso(12), "Exams occupy the hall on your requested date. Sunday the 12th is free all day.", b5.id);

// 6. Approved and paid, ready for handover (Bharat camera) — Riya
const b6 = booking({
  resourceId: R.cameraBharat, buyerId: buyers.riya, providerId: P.bharat.providerId,
  start: iso(3), end: iso(6), purpose: "Thesis film principal photography",
  subtotal: 5600, deposit: 8000, status: "ready_for_handover", createdOffset: -8,
  priorityScore: 80, priorityReason: "+30 eligible institutional member · +25 stated academic purpose · +20 first-time borrower · +5 fair rotation",
});
db.prepare(`INSERT INTO payments (booking_id, kind, amount, mode, status, paid_at, created_at) VALUES (?,?,?,?,?,?,?)`)
  .run(b6.id, "rental", b6.subtotal + b6.fees, "demo", "paid", ts(-5), ts(-5));
db.prepare(`INSERT INTO payments (booking_id, kind, amount, mode, status, paid_at, created_at) VALUES (?,?,?,?,?,?,?)`)
  .run(b6.id, "deposit", b6.deposit, "demo", "paid", ts(-5), ts(-5));
db.prepare(`INSERT INTO deposits (booking_id, amount, status, note) VALUES (?,?,?,?)`)
  .run(b6.id, b6.deposit, "held_demo", "Demo deposit recorded — no funds are actually held.");
db.prepare(`INSERT INTO handovers (booking_id, provider_ready_at, provider_ready_note, initial_condition, checklist, provider_photos)
            VALUES (?,?,?,?,?,?)`)
  .run(b6.id, ts(-1), "Kit packed in the hard case; batteries at 100%.", "excellent",
    JSON.stringify(["Body free of visible damage", "All accessories present", "Lenses clean"]),
    JSON.stringify(["/img/camera.svg"]));

// 7. Dispute example — completed booking (projector) with damage claim under review
const b7 = booking({
  resourceId: R.projectorAnna, buyerId: buyers.arjun, providerId: P.anna.providerId,
  start: iso(-16), end: iso(-14), purpose: "Outdoor community screening",
  subtotal: 1500, deposit: 3000, status: "disputed", createdOffset: -20,
});
db.prepare(`INSERT INTO payments (booking_id, kind, amount, mode, status, paid_at, created_at) VALUES (?,?,?,?,?,?,?)`)
  .run(b7.id, "rental", b7.subtotal + b7.fees, "demo", "paid", ts(-19), ts(-19));
db.prepare(`INSERT INTO payments (booking_id, kind, amount, mode, status, paid_at, created_at) VALUES (?,?,?,?,?,?,?)`)
  .run(b7.id, "deposit", b7.deposit, "demo", "paid", ts(-19), ts(-19));
db.prepare(`INSERT INTO deposits (booking_id, amount, status, note) VALUES (?,?,?,?)`)
  .run(b7.id, b7.deposit, "disputed", "Deposit status frozen pending admin review of the damage report.");
const dispId = Number(db.prepare(
  `INSERT INTO disputes (booking_id, raised_by, against, kind, claim_amount, description, evidence, status, created_at)
   VALUES (?,?,?,?,?,?,?,?,?)`
).run(b7.id, P.anna.userId, buyers.arjun, "damage", 1800,
  "The projector lens cover has a deep scratch and the HDMI port is loose. The unit was fine at handover, so I am requesting a partial deduction for servicing.",
  JSON.stringify(["/img/projector.svg"]), "under_review", ts(-13)).lastInsertRowid);
db.prepare(`INSERT INTO dispute_messages (dispute_id, user_id, body, attachments, created_at) VALUES (?,?,?,?,?)`)
  .run(dispId, P.anna.userId, "Photos attached show the scratch after return. Happy to share the service invoice.", JSON.stringify(["/img/projector.svg"]), ts(-13));
db.prepare(`INSERT INTO dispute_messages (dispute_id, user_id, body, created_at) VALUES (?,?,?,?)`)
  .run(dispId, buyers.arjun, "The scratch was already present when I collected it — I mentioned it at handover but it was not photographed. I am happy to share my own photos.", ts(-12));

// 8. Waiting-list entry: Bharat studio fully booked on the target date (capacity 1)
const blockedDate = iso(20);
booking({
  resourceId: R.studioBharat, buyerId: buyers.nithya, providerId: P.bharat.providerId,
  start: blockedDate, end: blockedDate, purpose: "Podcast pilot recording",
  subtotal: 6000, deposit: 2000, status: "approved", createdOffset: -2,
});
db.prepare(`INSERT INTO waiting_list (resource_id, user_id, start_date, end_date, units, status, created_at) VALUES (?,?,?,?,?,?,?)`)
  .run(R.studioBharat, buyers.vikram, blockedDate, blockedDate, 1, "waiting", ts(-1));

// 9. Extension request pending (Adyar 3D printer) — active booking with pending extension
const b9 = booking({
  resourceId: R.printerAdyar, buyerId: buyers.riya, providerId: P.adyar.providerId,
  start: iso(-1), end: iso(1), purpose: "Capstone enclosure prints",
  subtotal: 1800, deposit: 1500, status: "active", createdOffset: -6,
});
db.prepare(`INSERT INTO payments (booking_id, kind, amount, mode, status, paid_at, created_at) VALUES (?,?,?,?,?,?,?)`)
  .run(b9.id, "rental", b9.subtotal + b9.fees, "demo", "paid", ts(-5), ts(-5));
db.prepare(`INSERT INTO handovers (booking_id, provider_ready_at, initial_condition, checklist, provider_photos, buyer_confirmed_at, completed_at)
            VALUES (?,?,?,?,?,?,?)`)
  .run(b9.id, ts(-1), "good", JSON.stringify(["Power-on test passed", "Bed clean"]), JSON.stringify(["/img/printer.svg"]), ts(-1), ts(-1));
db.prepare(`INSERT INTO extensions (booking_id, requested_end, extra_days, extra_cost, status, note, created_at) VALUES (?,?,?,?,?,?,?)`)
  .run(b9.id, iso(3), 2, 1200, "pending", "Two more prints failed overnight; I need two extra days.", ts(0));

// 10. A second completed booking so utilisation charts have history (laptops)
const b10 = booking({
  resourceId: R.laptopAdyar, buyerId: buyers.nithya, providerId: P.adyar.providerId,
  start: iso(-40), end: iso(-26), purpose: "Community coding classes for 12 students",
  subtotal: 2800, deposit: 2500, status: "completed", createdOffset: -45,
});
db.prepare(`INSERT INTO payments (booking_id, kind, amount, mode, status, paid_at, created_at) VALUES (?,?,?,?,?,?,?)`)
  .run(b10.id, "rental", b10.subtotal + b10.fees, "demo", "paid", ts(-43), ts(-43));
db.prepare(`INSERT INTO deposits (booking_id, amount, status, released_amount, note) VALUES (?,?,?,?,?)`)
  .run(b10.id, b10.deposit, "released", b10.deposit, "Returned complete.");
db.prepare(`INSERT INTO reviews (booking_id, resource_id, provider_id, buyer_id, rating, body, condition_accuracy, created_at)
            VALUES (?,?,?,?,?,?,?,?)`)
  .run(b10.id, R.laptopAdyar, P.adyar.providerId, buyers.nithya, 4,
    "Laptops were old but worked for the classes. The makerspace volunteers helped us set them up.", 4, ts(-25));

// maintenance record (blocks dates for the camera)
db.prepare(`INSERT INTO maintenance_records (resource_id, start_date, end_date, kind, notes, cost, created_by, created_at)
            VALUES (?,?,?,?,?,?,?,?)`)
  .run(R.cameraAnna, iso(14), iso(15), "service", "Annual sensor clean and shutter service.", 1200, P.anna.userId, ts(-3));

// ---------------------------------------------------------------- favourites / notifications
db.prepare(`INSERT INTO favourites (user_id, resource_id) VALUES (?,?)`).run(buyers.riya, R.cameraBharat);
db.prepare(`INSERT INTO favourites (user_id, resource_id) VALUES (?,?)`).run(buyers.riya, R.printerAdyar);
db.prepare(`INSERT INTO recently_viewed (user_id, resource_id, viewed_at) VALUES (?,?,?)`).run(buyers.riya, R.cameraAnna, ts(0));
db.prepare(`INSERT INTO recently_viewed (user_id, resource_id, viewed_at) VALUES (?,?,?)`).run(buyers.riya, R.studioBharat, ts(-1));

function note(userId, kind, title, body, link, read = false) {
  db.prepare(`INSERT INTO notifications (user_id, kind, title, body, link, read_at, created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(userId, kind, title, body, link, read ? ts(-1) : null, ts(0));
}
note(P.anna.userId, "booking_request", "New booking request", `Nithya Devi requested the robotics lab kit (${b3.code}).`, `/provider/bookings/${b3.id}`);
note(buyers.riya, "booking_update", "Booking approved and paid", `Your Sony A7 III booking (${b6.code}) is ready for collection.`, `/bookings/${b6.id}`);
note(buyers.riya, "return_reminder", "Return reminder", "Your 3D printer booking is due back tomorrow.", `/bookings/${b9.id}`);
note(admin, "verification", "Verification pending review", "Chennai Creators Collective submitted verification documents.", "/admin/verifications", true);
note(buyers.arjun, "counteroffer", "Counteroffer received", "Bharat Media University proposed new dates for your hall booking.", `/bookings/${b5.id}`);

// ---------------------------------------------------------------- utilisation snapshots
function computeUtil(resourceId, windowDays = 60) {
  const res = db.prepare(`SELECT * FROM resources WHERE id = ?`).get(resourceId);
  const since = iso(-windowDays);
  const rows = db.prepare(
    `SELECT start_date, end_date, units FROM bookings WHERE resource_id = ? AND end_date >= ?
      AND status IN ('pending','approved','awaiting_payment','paid','ready_for_handover','active','return_requested','disputed')`
  ).all(resourceId, since);
  let booked = 0;
  for (const b of rows) {
    const s = b.start_date < since ? since : b.start_date;
    const d = Math.round((new Date(b.end_date) - new Date(s)) / 864e5) + 1;
    booked += Math.max(0, d) * (b.units || 1);
  }
  const total = res.quantity_total || 1;
  const availableDays = total * windowDays;
  const pct = availableDays ? Math.min(100, (booked / availableDays) * 100) : 0;
  const idle = Math.max(0, total - (res.quantity_active || 0));
  const state = pct >= 55 ? "frequently_used" : pct >= 12 ? "shared" : booked === 0 ? "idle" : "underused";
  db.prepare(`UPDATE resources SET utilisation_state = ? WHERE id = ?`).run(state, resourceId);
  db.prepare(
    `INSERT INTO utilisation_snapshots (resource_id, snapshot_date, booked_days, available_days, utilisation_pct, idle_units_estimate, basis)
     VALUES (?,?,?,?,?,?,'sample_demo')
     ON CONFLICT(resource_id, snapshot_date) DO UPDATE SET booked_days=excluded.booked_days,
       available_days=excluded.available_days, utilisation_pct=excluded.utilisation_pct, idle_units_estimate=excluded.idle_units_estimate`
  ).run(resourceId, iso(0), booked, availableDays, Math.round(pct * 10) / 10, idle);
  return { resourceId, pct: Math.round(pct * 10) / 10, state, idle };
}
// Utilisation snapshots are written inside computeUtil(); no separate mapping needed.
Object.values(R).forEach((id) => computeUtil(id));

// categories
db.exec(`DELETE FROM categories;`);
const cats = JSON.parse(fs.readFileSync(path.join(root, "src/lib/taxonomy.json"), "utf8"));
cats.forEach((c, i) =>
  db.prepare(`INSERT INTO categories (slug, name, icon, sort_order) VALUES (?,?,?,?)`).run(c.slug, c.name, c.icon, i)
);

// settings + audit
db.prepare(`INSERT INTO settings (key, value) VALUES ('demo_mode','true') ON CONFLICT(key) DO UPDATE SET value='true'`).run();
db.prepare(`INSERT INTO settings (key, value) VALUES ('seeded_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(new Date().toISOString());
db.prepare(
  `INSERT INTO audit_logs (actor_id, actor_email, action, entity, entity_id, detail, created_at)
   VALUES (?,?,?,?,?,?,?)`
).run(admin, "admin@rentlink.demo", "seed.demo_data", "system", "seed", JSON.stringify({ resources: Object.keys(R).length, users: 11 }), ts(0));

console.log("--------------------------------------------------------------");
console.log("Nestora demo database seeded");
console.log("  database :", dbPath);
console.log("  users    :", db.prepare("SELECT COUNT(*) c FROM users").get().c);
console.log("  providers:", db.prepare("SELECT COUNT(*) c FROM provider_profiles").get().c);
console.log("  resources:", db.prepare("SELECT COUNT(*) c FROM resources").get().c);
console.log("  bookings :", db.prepare("SELECT COUNT(*) c FROM bookings").get().c);
console.log(`  password : ${PASSWORD === DEFAULT_DEMO_PASSWORD ? "Demo@1234 (documented default)" : "(from DEMO_PASSWORD)"} — all demo accounts`);
console.log("  logins   : admin@rentlink.demo | provider@anna.demo | buyer@student.demo");
console.log("--------------------------------------------------------------");
db.close();
