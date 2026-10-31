import { all, one, Row } from "./db";
import type { SessionUser } from "./auth";

export type BookingCtx = {
  booking: Row;
  resource: Row;
  role: "buyer" | "provider" | "admin";
};

/**
 * Loads a booking and determines the caller's relationship to it.
 * Returns null when the caller has no legitimate access — this is the single
 * choke point for booking-level ownership checks.
 */
export async function loadBookingForUser(bookingId: number, user: SessionUser): Promise<BookingCtx | null> {
  const booking = await one<Row>(`SELECT * FROM bookings WHERE id = ?`, bookingId);
  if (!booking) return null;
  const resource = await one<Row>(`SELECT * FROM resources WHERE id = ?`, booking.resource_id);
  if (!resource) return null;
  if (user.role === "admin") return { booking, resource, role: "admin" };
  if (booking.buyer_id === user.id) return { booking, resource, role: "buyer" };
  if (user.provider && booking.provider_id === user.provider.id) return { booking, resource, role: "provider" };
  return null;
}

/** A provider may only touch resources they own. */
export async function ownedResource(resourceId: number, user: SessionUser): Promise<Row | null> {
  if (!user.provider) return null;
  const r = await one<Row>(`SELECT * FROM resources WHERE id = ? AND provider_id = ?`, resourceId, user.provider.id);
  return r ?? null;
}

export function isProviderOfBooking(booking: Row, user: SessionUser) {
  return Boolean(user.provider && booking.provider_id === user.provider.id);
}

export function canSeePrivateDocuments(user: SessionUser) {
  return user.role === "admin";
}

/** Pagination helper. */
export function pageParams(url: URL, defLimit = 24) {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || defLimit)));
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  return { limit, page, offset: (page - 1) * limit };
}

export async function providerOwnedBookingIds(providerId: number) {
  return await all<Row>(`SELECT id FROM bookings WHERE provider_id = ?`, providerId).map((r) => r.id);
}
