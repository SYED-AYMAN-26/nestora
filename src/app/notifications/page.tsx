import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { all, Row } from "@/lib/db";
import { externalChannels } from "@/lib/audit";
import { Badge, Card, EmptyState, InfoNote, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { MarkAllRead } from "./MarkAllRead";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications" };

const KIND_LABEL: Record<string, string> = {
  booking_request: "Booking request",
  booking_update: "Booking update",
  counteroffer: "Counteroffer",
  payment: "Payment",
  handover: "Handover",
  return: "Return",
  collection_reminder: "Collection reminder",
  return_reminder: "Return reminder",
  overdue: "Overdue",
  extension: "Extension",
  dispute: "Dispute",
  verification: "Verification",
  review: "Review",
  message: "Message",
  report: "Report",
  listing: "Listing",
};

export default async function NotificationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/notifications");
  const items = await all<Row>(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100`, user.id);
  const channels = externalChannels();
  const unread = items.filter((i) => !i.read_at).length;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Notification centre"
        sub="Booking requests, approvals, payment updates, handover and return reminders, extensions and dispute activity."
        right={<MarkAllRead disabled={unread === 0} />}
      />

      <div className="mb-4">
        <InfoNote tone="info" title="Delivery channels">
          In-app notifications are always active. Email is <strong>{channels.email ? "configured" : "not configured"}</strong> and
          WhatsApp is <strong>{channels.whatsapp ? "configured" : "not configured"}</strong> on this deployment — when not
          configured, no external message is sent and we say so rather than implying delivery.
        </InfoNote>
      </div>

      {items.length === 0 ? (
        <EmptyState title="Nothing yet" body="Notifications appear here as your bookings move through the lifecycle." />
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <Card key={n.id} className={`p-3.5 ${n.read_at ? "opacity-70" : "border-electric/25"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={n.read_at ? "neutral" : "info"}>{KIND_LABEL[n.kind] ?? n.kind}</Badge>
                    <p className="text-[13px] font-medium text-ink">{n.title}</p>
                  </div>
                  {n.body && <p className="mt-1 text-[12.5px] text-ink-dim">{n.body}</p>}
                </div>
                <span className="shrink-0 text-[11px] text-ink-faint">{fmtDateTime(n.created_at)}</span>
              </div>
              {n.link && (
                <Link href={n.link} className="mt-1.5 inline-block text-[11.5px] text-electric hover:underline">Open →</Link>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
