// Tombstone. The VRP fee-collection mandate this file used to start no longer
// exists: PAY-5 (#211) removed the TrueLayer rail, and PAY-4 moved the fee to
// source as a Stripe application fee on each payment. There is nothing for a
// trade to authorise, so there is no action to expose.
//
// `startFeeMandate` and the FeeBillingSection that called it are both deleted.
// Turning the old fee-billing flag on would otherwise have re-exposed a CTA
// whose only possible outcome was an error dialog.
//
// This FILE is retained solely because a frozen acceptance test names its path
// and reads it directly — tests/acceptance/211.test.ts:84 asserts that
// "src/app/settings/fee-billing-actions.ts does not import from
// @/lib/truelayer-vrp", and its readFile helper throws when the path is
// missing. The sibling assertion for src/lib/collect-fees.ts guards with
// existsSync and explicitly permits outright deletion; this one does not, and
// acceptance tests are frozen once committed. An empty module satisfies it
// honestly: a file with no imports cannot import anything.
//
// Do not add exports here. If this path is ever unpinned, delete the file.

export {};
