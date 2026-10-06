/**
 * One-time backfill for Business.emailVerified.
 *
 * Google/Apple sign-in now links to an existing account by email only when
 * that account's email is verified. Every account created before the flag
 * existed reads as unverified, so until this runs a returning user who first
 * signed up by email and later taps "Sign in with Google" would get a second,
 * empty account (and the first would lose its email). Run it right before or
 * right after the backend that adds the flag goes live — before is safe too,
 * as it only writes the new field.
 *
 * Marked verified: accounts with an email that were created through a path
 * that proved it —
 *  - googleId: created/linked by Google sign-in, with Google's address;
 *  - appleId: same, with Apple's;
 *  - passwordHash: only ever set by email registration, which requires the
 *    emailed signup code (AuthService.registerWithEmail), or by a password
 *    reset/change on such an account. There is no phone-only registration
 *    that sets a password, so this needs no narrowing.
 *
 * Known gap: before this release the profile let an owner change the email
 * with no proof, and nothing recorded when that happened, so an account that
 * did so is marked verified here too. There is no data to tell those apart.
 *
 *   node dist/scripts/backfill-email-verified.js           # dry run: counts only
 *   node dist/scripts/backfill-email-verified.js --apply   # write the change
 */
import mongoose from 'mongoose';

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Set MONGODB_URI');
  await mongoose.connect(uri);
  const businesses = mongoose.connection.collection('businesses');

  const provenAccounts = {
    emailVerified: { $ne: true },
    email: { $exists: true, $nin: [null, ''] },
    $or: [
      { googleId: { $exists: true, $nin: [null, ''] } },
      { appleId: { $exists: true, $nin: [null, ''] } },
      { passwordHash: { $exists: true, $nin: [null, ''] } },
    ],
  };
  const unproven = {
    emailVerified: { $ne: true },
    email: { $exists: true, $nin: [null, ''] },
    $nor: provenAccounts.$or,
  };
  const [provenCount, unprovenCount] = await Promise.all([
    businesses.countDocuments(provenAccounts),
    businesses.countDocuments(unproven),
  ]);
  console.log(`Accounts with a proven email → verified: ${provenCount}`);
  console.log(
    `Accounts with an email but no proof (left unverified): ${unprovenCount}`,
  );

  if (apply) {
    const result = await businesses.updateMany(provenAccounts, {
      $set: { emailVerified: true },
    });
    console.log(`Marked ${result.modifiedCount} verified.`);
  } else {
    console.log('Dry run — nothing changed. Run again with --apply to write.');
  }
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
