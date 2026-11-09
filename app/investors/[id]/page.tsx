import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAuthFast } from "@/lib/auth";
import { loadContactDetail } from "@/lib/contact-queries";
import { isInvestorTag } from "@/lib/tags";
import { InvestorDetail } from "@/components/investor-detail";

export const metadata: Metadata = {
  title: "Investor Details",
};

export default async function InvestorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAuthFast();

  const data = await loadContactDetail(id);
  // Only investor-tagged contacts open here; others use /contacts/[id].
  if (!data || !data.contact.tags?.some((tag: string) => isInvestorTag(tag))) notFound();

  return <InvestorDetail {...data} />;
}
