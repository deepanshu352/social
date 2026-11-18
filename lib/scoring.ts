import { prisma } from "./prisma";

/**
 * Rule-based lead score v0 (BRD §14). Writes the same columns the ML/LLM scorer will
 * use later, so nothing downstream changes when it is swapped out.
 */
const SOURCE_WEIGHT: Record<string, number> = {
  referral: 25, website: 18, landing_page: 18, google_ads: 15, whatsapp: 15, phone: 15,
  facebook: 10, instagram: 10, campaign: 10, api: 10, import: 5, manual: 8,
};

export async function rescoreLead(tenantId: string, leadId: string) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId } });
  if (!lead) return;
  const [activities, connected, quoteViews] = await Promise.all([
    prisma.activity.count({ where: { tenantId, leadId } }),
    prisma.callLog.count({ where: { tenantId, leadId, talkSeconds: { gt: 30 } } }),
    prisma.quotation.aggregate({ where: { tenantId, deal: { leadId } }, _sum: { viewCount: true } }),
  ]);
  let score = SOURCE_WEIGHT[lead.source] ?? 8;
  const budget = Number(lead.budget ?? 0n) / 100;
  score += budget >= 500000 ? 20 : budget >= 100000 ? 14 : budget >= 25000 ? 8 : budget > 0 ? 4 : 0;
  score += Math.min(15, activities * 2);
  score += Math.min(20, connected * 7);
  score += Math.min(15, (quoteViews._sum.viewCount ?? 0) * 5);
  if (lead.priority === "high") score += 5;
  if (lead.priority === "urgent") score += 10;
  const daysIdle = lead.lastActivityAt ? (Date.now() - lead.lastActivityAt.getTime()) / 86400_000 : 30;
  if (daysIdle > 14) score -= 10;
  if (lead.status === "lost" || lead.status === "unqualified") score = Math.min(score, 10);
  score = Math.max(0, Math.min(100, Math.round(score)));
  const scoreBand = lead.status === "lost" ? "lost" : score >= 60 ? "hot" : score >= 35 ? "warm" : "cold";
  await prisma.lead.update({ where: { id: leadId }, data: { score, scoreBand } });
  return { score, scoreBand };
}
