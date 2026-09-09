import { isPhoneNumber, registerDecorator, ValidationOptions } from 'class-validator';

// Accepts a phone number for any country this product is sold in.
//
// The DTO previously used `@IsPhoneNumber('IN')`, which rejects every
// non-Indian number. That silently blocked the entire Gulf market: the app
// offers +971/+966/+974/+968/+965/+973 in its country picker, Settings sells
// those markets with their own currency, VAT and TRN labels, and subscription
// pricing exists for each — but the API refused to store a single customer
// for any of them.
//
// Two forms are allowed:
//   1. E.164 for any country ("+971501234567") — what the app now sends.
//   2. A bare Indian national number ("9876543210") — kept for older clients
//      and contact-picker imports that never carried a country code, and for
//      the rows already stored in that shape.
export function IsSupportedPhoneNumber(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isSupportedPhoneNumber',
      target: object.constructor,
      propertyName,
      options: {
        message:
          'phone must be a valid phone number, including its country code (e.g. +971501234567)',
        ...validationOptions,
      },
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string' || !value.trim()) return false;
          // No region: requires a country code and validates against it.
          if (isPhoneNumber(value)) return true;
          // Back-compat: a bare national number, assumed Indian.
          return isPhoneNumber(value, 'IN');
        },
      },
    });
  };
}
