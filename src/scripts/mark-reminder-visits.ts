/**
 * One-time tidy-up for "booked vs reminder".
 *
 * Before visits could be booked, every open job counted as an appointment —
 * including the ones logged months ahead only so the customer would be
 * reminded. Those now belong in "Not booked": off technicians' Today lists
 * and morning push, and reminded with "Shall we book a visit?" rather than
 * a confirmation.
 *
 * Gives every open job from before that an answer:
 *  - dated today or tomorrow → booked (technicians' next two days stay as
 *    they are);
 *  - overdue, or later than tomorrow → not booked (a reminder nobody has
 *    agreed to yet).
 *
 *   node dist/scripts/mark-reminder-visits.js           # dry run: counts only
 *   node dist/scripts/mark-reminder-visits.js --apply   # write the change
 */
import mongoose from 'mongoose';

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Set MONGODB_URI');
  await mongoose.connect(uri);
  const services = mongoose.connection.collection('services');

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const afterTomorrow = new Date(today);
  afterTomorrow.setDate(afterTomorrow.getDate() + 2);

  // AMC visits are booked on their schedule by default (a business can turn
  // that off in Settings), so they are counted and marked on their own.
  const amcOpen = {
    status: 'pending',
    booked: { $exists: false },
    amcId: { $exists: true, $ne: null },
  };
  const unanswered = {
    status: 'pending',
    booked: { $exists: false },
    amcId: { $in: [null] },
  };
  const near = {
    ...unanswered,
    serviceDate: { $gte: today, $lt: afterTomorrow },
  };
  const rest = {
    ...unanswered,
    $or: [
      { serviceDate: { $lt: today } },
      { serviceDate: { $gte: afterTomorrow } },
    ],
  };
  const [amcCount, nearCount, restCount] = await Promise.all([
    services.countDocuments(amcOpen),
    services.countDocuments(near),
    services.countDocuments(rest),
  ]);
  console.log(`Open AMC visits → booked (on their schedule): ${amcCount}`);
  console.log(`Open jobs today or tomorrow → booked: ${nearCount}`);
  console.log(`Open jobs overdue or later → not booked: ${restCount}`);

  if (apply) {
    const [m, a, b] = await Promise.all([
      services.updateMany(amcOpen, { $set: { booked: true } }),
      services.updateMany(near, { $set: { booked: true } }),
      services.updateMany(rest, { $set: { booked: false } }),
    ]);
    console.log(
      `Marked ${m.modifiedCount + a.modifiedCount} booked (${m.modifiedCount} AMC), ${b.modifiedCount} not booked.`,
    );
  } else {
    console.log('Dry run — nothing changed. Run again with --apply to write.');
  }
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
