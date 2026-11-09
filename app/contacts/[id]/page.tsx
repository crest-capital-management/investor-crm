import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAuthFast } from "@/lib/auth";
import { loadContactDetail } from "@/lib/contact-queries";
import { ContactDetail } from "@/components/contact-detail";

export const metadata: Metadata = {
  title: "Contact Details",
};

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAuthFast();

  const data = await loadContactDetail(id);
  if (!data) notFound();

  return <ContactDetail {...data} />;
}
