/**
 * One-time clean-up for WhatsApp Business auto-replies counted as replies.
 *
 * Before the webhook learned to spot them (whatsapp-campaigns/auto-reply.ts),
 * a business's own automatic greeting ("Thank you for contacting us… how can
 * we help you?") counted as a reply, and the assistant often read it as
 * interest. This finds leads whose every incoming message looks automatic —
 * no button tapped, nothing typed by a person — and puts them back to
 * CONTACTED, with the greeting kept in the inbox tagged as an auto-reply.
 *
 * Only REPLIED and INTERESTED leads are touched; anything an admin moved on
 * (installed, not interested, …) is left alone, and so is any lead with even
 * one message that looks human.
 *
 *   node dist/scripts/fix-whatsapp-auto-replies.js           # dry run: lists them
 *   node dist/scripts/fix-whatsapp-auto-replies.js --apply   # write the change
 */
import mongoose, { Types } from 'mongoose';
import { looksLikeAutoReply } from '../whatsapp-campaigns/auto-reply';

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Set MONGODB_URI');
  await mongoose.connect(uri);
  const db = mongoose.connection;
  const leads = db.collection('leads');
  const messages = db.collection('whatsappmessages');
  const recipients = db.collection('whatsapprecipients');
  const campaigns = db.collection('whatsappcampaigns');

  const candidates = await leads
    .find({
      whatsappRepliedAt: { $exists: true },
      status: { $in: ['REPLIED', 'INTERESTED'] },
    })
    .project({ businessName: 1, status: 1 })
    .toArray();

  const fixed: {
    leadId: Types.ObjectId;
    messageIds: Types.ObjectId[];
    at: Date;
  }[] = [];
  for (const lead of candidates) {
    const inbound = await messages
      .find({ leadId: lead._id, direction: 'in' })
      .sort({ at: 1 })
      .toArray();
    if (!inbound.length) continue;
    const ours = await recipients
      .find({ leadId: lead._id, sentAt: { $exists: true } })
      .project({ sentAt: 1, deliveredAt: 1 })
      .toArray();
    const allAuto = inbound.every((m) => {
      if (m.type === 'button' || m.type === 'interactive') return false;
      const before = ours
        .map((r) => (r.deliveredAt ?? r.sentAt) as Date)
        .filter((t) => t <= m.at)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      return looksLikeAutoReply(
        m.text ?? '',
        before ? (m.at.getTime() - before.getTime()) / 1000 : null,
      );
    });
    if (!allAuto) continue;
    console.log(
      `${lead.status.padEnd(10)} ${lead.businessName ?? lead._id}  ←  "${String(inbound[0].text).slice(0, 70)}"`,
    );
    fixed.push({
      leadId: lead._id,
      messageIds: inbound.map((m) => m._id),
      at: inbound[0].at,
    });
  }
  console.log(
    `\nLeads counted as replied only because of an auto-reply: ${fixed.length} of ${candidates.length}`,
  );

  if (apply && fixed.length) {
    const touchedCampaigns = new Set<string>();
    for (const f of fixed) {
      await messages.updateMany(
        { _id: { $in: f.messageIds } },
        { $set: { autoReply: true, handled: true } },
      );
      await leads.updateOne(
        { _id: f.leadId },
        {
          $set: { status: 'CONTACTED', whatsappAutoReplyAt: f.at },
          $unset: { whatsappRepliedAt: '' },
        },
      );
      const rs = await recipients
        .find({ leadId: f.leadId, repliedAt: { $exists: true } })
        .toArray();
      for (const r of rs) touchedCampaigns.add(String(r.campaignId));
      await recipients.updateMany(
        { leadId: f.leadId, repliedAt: { $exists: true } },
        { $unset: { repliedAt: '', replyText: '' } },
      );
    }
    // Same count the webhook keeps (WhatsappQueueService.syncCounters).
    for (const id of touchedCampaigns) {
      const campaignId = new Types.ObjectId(id);
      const repliedCount = await recipients.countDocuments({
        campaignId,
        repliedAt: { $exists: true },
      });
      await campaigns.updateOne(
        { _id: campaignId },
        { $set: { repliedCount } },
      );
    }
    console.log(
      `Applied. Campaign reply counts refreshed: ${touchedCampaigns.size}`,
    );
  } else if (!apply) {
    console.log('Dry run — nothing written. Add --apply to fix them.');
  }
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
