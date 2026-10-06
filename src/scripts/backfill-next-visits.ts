/* eslint-disable no-console */
/**
 * One-time repair: book the next visit for customers whose reminder was lost.
 *
 * Until the completion sheet, "Mark complete" closed a job without booking
 * its next visit, and Home, Services and the 8 AM reminder only list OPEN
 * jobs — so every customer finished that way silently dropped out of the
 * reminder cycle. For each customer + service type, this looks at the latest
 * completed job; if it was meant to repeat and nothing is booked after it,
 * it books the missing visit on the date that job said it was due. A date
 * already past is kept, so the customer shows as overdue — exactly the one
 * to call.
 *
 * Dry run by default (prints what it would do). Add --apply to write.
 *
 *   node dist/scripts/backfill-next-visits.js            # report only
 *   node dist/scripts/backfill-next-visits.js --apply    # book the visits
 *
 * Reads MONGODB_URI from the environment (source .env.production first).
 * Safe to run twice: a customer with an open job for that service is skipped.
 */
import mongoose from 'mongoose';

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(uri);
  const services = mongoose.connection.collection('services');

  // Latest completed job per business + customer + service type.
  const latest = await services
    .aggregate([
      {
        $match: {
          status: 'completed',
          amcId: { $exists: false },
          callbackOf: { $exists: false },
          nextServiceInterval: { $nin: ['none', null] },
          nextServiceDate: { $ne: null },
        },
      },
      { $sort: { completedAt: -1, serviceDate: -1 } },
      {
        $group: {
          _id: {
            businessId: { $toString: '$businessId' },
            customerId: { $toString: '$customerId' },
            type: { $toLower: '$serviceType' },
          },
          job: { $first: '$$ROOT' },
        },
      },
    ])
    .toArray();

  let booked = 0;
  let alreadyBooked = 0;
  const perBusiness = new Map<string, number>();

  for (const { _id, job } of latest) {
    const ids = (v: unknown) => {
      const s = String(v);
      return mongoose.Types.ObjectId.isValid(s)
        ? [s, new mongoose.Types.ObjectId(s)]
        : [s];
    };
    // Anything open (or a later job) for this customer and service: fine.
    const open = await services.findOne(
      {
        businessId: { $in: ids(job.businessId) },
        customerId: { $in: ids(job.customerId) },
        serviceType: job.serviceType,
        _id: { $ne: job._id },
        $or: [{ status: 'pending' }, { serviceDate: { $gt: job.serviceDate } }],
      },
      { collation: { locale: 'en', strength: 2 } },
    );
    if (open) {
      alreadyBooked++;
      continue;
    }

    booked++;
    perBusiness.set(_id.businessId, (perBusiness.get(_id.businessId) ?? 0) + 1);
    if (!apply) continue;

    const created = await services.insertOne({
      businessId: job.businessId,
      customerId: job.customerId,
      serviceType: job.serviceType,
      status: 'pending',
      serviceDate: job.nextServiceDate,
      warrantyPeriod:
        job.warrantyPeriod === 'custom'
          ? 'none'
          : (job.warrantyPeriod ?? 'none'),
      warrantyExpiry: null,
      nextServiceInterval:
        job.nextServiceInterval === 'custom' ? 'none' : job.nextServiceInterval,
      nextServiceDate: job.nextServiceDate,
      // Due, not booked: the customer has not agreed to the date.
      booked: false,
      suggestedTechnicianId: job.assignedTechnicianId
        ? String(job.assignedTechnicianId)
        : undefined,
      notes: 'Next visit due, from a job completed earlier.',
      revisitCount: 0,
      hasBeforePhoto: false,
      hasAfterPhoto: false,
      hasSignature: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await services.updateOne(
      { _id: job._id },
      { $set: { nextVisitId: created.insertedId } },
    );
  }

  console.log(
    apply
      ? 'APPLIED'
      : 'DRY RUN — nothing written. Re-run with --apply to book them.',
  );
  console.log(`Customers checked (by service type): ${latest.length}`);
  console.log(`Already had a next visit: ${alreadyBooked}`);
  console.log(
    `${apply ? 'Booked' : 'Would book'} missing next visits: ${booked}`,
  );
  for (const [biz, n] of [...perBusiness.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)) {
    console.log(`  business ${biz}: ${n}`);
  }
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
