export const ACCOUNT_TYPES = [
  { value: "college_university", label: "College or University", group: "Institutional" },
  { value: "company", label: "Company or Business", group: "Institutional" },
  { value: "organisation", label: "Organisation", group: "Institutional" },
  { value: "community_organisation", label: "Community Organisation", group: "Community" },
  { value: "individual", label: "Individual or Home User", group: "Individual" },
  { value: "other_institution", label: "Other Institution", group: "Institutional" },
] as const;

export const accountTypeLabel = (v?: string | null) =>
  ACCOUNT_TYPES.find((a) => a.value === v)?.label ?? (v || "Unknown");

export const VERIFICATION_STATUSES = [
  "not_submitted", "pending", "verified", "rejected", "more_info",
] as const;

export const VERIFICATION_LABEL: Record<string, string> = {
  not_submitted: "Not submitted",
  pending: "Pending review",
  verified: "Verified",
  rejected: "Rejected",
  more_info: "More information required",
};

export const CONDITIONS = [
  { value: "new", label: "New" },
  { value: "excellent", label: "Excellent" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
] as const;

import taxonomy from "./taxonomy.json";

export type CategoryDef = { slug: string; name: string; icon: string; subcategories: string[] };

export const CATEGORIES: CategoryDef[] = taxonomy as CategoryDef[];

export const categoryName = (slug?: string | null) =>
  CATEGORIES.find((c) => c.slug === slug)?.name ?? (slug || "Uncategorised");

export const SUBCATEGORIES: Record<string, string[]> = Object.fromEntries(
  CATEGORIES.map((c) => [c.slug, c.subcategories])
);

export const BOOKING_STATUS_LABEL: Record<string, string> = {
  pending: "Awaiting provider approval",
  approved: "Approved — payment pending",
  counteroffered: "Counteroffer received",
  rejected: "Rejected",
  awaiting_payment: "Awaiting payment",
  paid: "Paid — awaiting handover",
  ready_for_handover: "Ready for collection",
  active: "Active rental",
  return_requested: "Return requested",
  completed: "Completed",
  cancelled: "Cancelled",
  expired: "Expired",
  disputed: "In dispute",
};

export const DISPUTE_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  evidence_requested: "Evidence requested",
  under_review: "Under review",
  resolved: "Resolved",
  rejected: "Rejected",
  closed: "Closed",
};

export const CHECKLIST_ITEMS = [
  "Body / main unit free of visible damage",
  "All accessories present as listed",
  "Power-on / functional test passed",
  "Lenses / glass clean and unscratched",
  "Battery and charger included",
  "Carry case / protective packaging included",
  "Serial number matches listing",
];

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
export const ALLOWED_DOC_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export const DEMO_BANNER = "DEMO DATA — these records are fictional and seeded for demonstration.";

/**
 * Capability taxonomy — the backbone of capability matching (spec 9).
 * Each resource advertises capability tags; buyer intents map to tags, so we
 * match on what a thing can DO rather than on its product name.
 */
export const CAPABILITIES: Record<string, { label: string; group: string }> = {
  photo_capture: { label: "High-resolution photo capture", group: "Capture" },
  video_capture: { label: "Video recording", group: "Capture" },
  cinematic_video: { label: "Cinematic / short-film video", group: "Capture" },
  low_light_capture: { label: "Low-light capture", group: "Capture" },
  audio_recording: { label: "Audio recording", group: "Audio" },
  audio_mixing: { label: "Audio mixing / routing", group: "Audio" },
  sound_reinforcement: { label: "Sound reinforcement / PA", group: "Audio" },
  lighting_control: { label: "Controlled lighting", group: "Lighting" },
  stable_framing: { label: "Stable framing / support", group: "Support" },
  projection: { label: "Image projection", group: "Presentation" },
  computing_general: { label: "General-purpose computing", group: "Computing" },
  gpu_compute: { label: "GPU / accelerated compute", group: "Computing" },
  embedded_programming: { label: "Embedded programming", group: "Electronics" },
  sensing: { label: "Sensor data acquisition", group: "Electronics" },
  motor_control: { label: "Motor / actuator control", group: "Electronics" },
  rapid_prototyping: { label: "Rapid prototyping / fabrication", group: "Fabrication" },
  additive_manufacturing: { label: "Additive manufacturing", group: "Fabrication" },
  precision_measurement: { label: "Precision measurement", group: "Lab" },
  microscopy: { label: "Magnified inspection", group: "Lab" },
  spectroscopy: { label: "Optical spectroscopy", group: "Lab" },
  soldering: { label: "Soldering / electronics assembly", group: "Fabrication" },
  enclosed_space: { label: "Enclosed working space", group: "Space" },
  audience_seating: { label: "Audience seating", group: "Space" },
  acoustic_treatment: { label: "Acoustic-treated room", group: "Space" },
  vehicle_transport: { label: "Transport of people or goods", group: "Logistics" },
  transit: { label: "Getting to locations / travel", group: "Logistics" },
};

/** Keyword -> capability mapping used by the rule-based intent engine. */
export const INTENT_KEYWORDS: { keywords: string[]; capabilities: string[]; categories: string[]; label: string }[] = [
  {
    label: "short film / video production",
    keywords: ["short film", "film", "movie", "video", "shoot", "documentary", "reel", "vlog", "youtube", "cinematic"],
    capabilities: ["video_capture", "cinematic_video", "audio_recording", "lighting_control", "stable_framing", "acoustic_treatment"],
    categories: ["cameras-photography", "audio-visual", "spaces-rooms"],
  },
  {
    label: "photography",
    keywords: ["photo", "photograph", "photoshoot", "portrait", "product shot", "camera"],
    capabilities: ["photo_capture", "stable_framing", "lighting_control"],
    categories: ["cameras-photography"],
  },
  {
    label: "robotics project",
    keywords: ["robot", "robotics", "arduino", "sensor", "microcontroller", "embedded", "automation", "drone build"],
    capabilities: ["embedded_programming", "sensing", "motor_control", "soldering", "rapid_prototyping"],
    categories: ["robotics-electronics", "3d-printing", "tools-workshop"],
  },
  {
    label: "3D printing / fabrication",
    keywords: ["3d print", "3d printer", "printing", "prototype", "fabrication", "laser cut", "cnc", "model"],
    capabilities: ["additive_manufacturing", "rapid_prototyping"],
    categories: ["3d-printing"],
  },
  {
    label: "laboratory / research work",
    keywords: ["lab", "laboratory", "experiment", "spectrometer", "microscope", "sample", "chemistry", "research"],
    capabilities: ["precision_measurement", "microscopy", "spectroscopy"],
    categories: ["lab-equipment", "spaces-rooms"],
  },
  {
    label: "presentation or event",
    keywords: ["event", "seminar", "presentation", "conference", "workshop", "talk", "projector", "stage", "auditorium", "hall"],
    capabilities: ["projection", "sound_reinforcement", "audience_seating", "lighting_control"],
    categories: ["event-equipment", "spaces-rooms", "audio-visual"],
  },
  {
    label: "recording music / podcast",
    keywords: ["podcast", "music", "recording studio", "singing", "audio recording", "mix", "song", "voice over", "voiceover"],
    capabilities: ["audio_recording", "audio_mixing", "acoustic_treatment", "enclosed_space"],
    categories: ["audio-visual", "spaces-rooms"],
  },
  {
    label: "computing / software work",
    keywords: ["laptop", "computer", "coding", "hackathon", "software", "gpu", "render", "editing", "design"],
    capabilities: ["computing_general", "gpu_compute"],
    categories: ["computing"],
  },
  {
    label: "transport / logistics",
    keywords: ["van", "transport", "travel", "trip", "pickup", "vehicle", "bus"],
    capabilities: ["vehicle_transport", "transit"],
    categories: ["vehicles-transport"],
  },
  {
    label: "workshop / making",
    keywords: ["tool", "workshop", "weld", "solder", "drill", "build", "repair"],
    capabilities: ["soldering", "rapid_prototyping", "precision_measurement"],
    categories: ["tools-workshop", "robotics-electronics"],
  },
];
