import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  validateSync,
} from 'class-validator';

// Every var the app actually reads via ConfigService somewhere — missing or
// empty here means a feature silently breaks at first use instead of on
// boot (e.g. JWTs signed with `undefined`, S3 calls with empty credentials).
// IsNotEmpty on top of IsString so a blank placeholder (`FOO=`) fails the
// same as a fully missing var — both are equally "not actually configured".
// Optional ones already have a safe in-code default elsewhere.
class EnvironmentVariables {
  @IsOptional()
  @IsIn(['development', 'production', 'test'])
  NODE_ENV?: string;

  @IsOptional()
  @IsString()
  PORT?: string;

  @IsString()
  @IsNotEmpty()
  MONGODB_URI: string;

  @IsString()
  @MinLength(32, {
    message:
      'JWT_SECRET must be at least 32 characters — generate a real random secret for this deployment.',
  })
  JWT_SECRET: string;

  @IsOptional()
  @IsString()
  JWT_EXPIRES_IN?: string;

  @IsOptional()
  @IsString()
  FREE_TIER_CUSTOMER_LIMIT?: string;

  @IsString()
  @IsNotEmpty()
  RAZORPAY_KEY_ID: string;

  @IsString()
  @IsNotEmpty()
  RAZORPAY_KEY_SECRET: string;

  @IsString()
  @IsNotEmpty()
  RAZORPAY_WEBHOOK_SECRET: string;

  @IsString()
  @IsNotEmpty()
  GOOGLE_WEB_CLIENT_ID: string;

  @IsString()
  @IsNotEmpty()
  AWS_REGION: string;

  @IsString()
  @IsNotEmpty()
  S3_BUCKET: string;

  @IsString()
  @IsNotEmpty()
  AWS_ACCESS_KEY_ID: string;

  @IsString()
  @IsNotEmpty()
  AWS_SECRET_ACCESS_KEY: string;

  @IsString()
  @IsNotEmpty()
  EMAIL_FROM: string;

  @IsString()
  @IsNotEmpty()
  SMTP_HOST: string;

  @IsOptional()
  @IsString()
  SMTP_PORT?: string;

  @IsOptional()
  @IsString()
  SMTP_SECURE?: string;

  @IsString()
  @IsNotEmpty()
  SMTP_USER: string;

  @IsString()
  @IsNotEmpty()
  SMTP_PASS: string;

  // Optional: Google Play purchase verification isn't required to boot —
  // only /subscriptions/verify-play-purchase needs it, and it doesn't exist
  // until the Play Console products are created and this service account
  // JSON is issued. Left unset, that one endpoint fails with a clear 500
  // instead of the whole app refusing to start.
  @IsOptional()
  @IsString()
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?: string;

  @IsOptional()
  @IsString()
  GOOGLE_PLAY_PACKAGE_NAME?: string;

  // Optional: defaults to 'com.aglakaam.app' in code. Only override if the
  // iOS bundle identifier ever diverges from the Android package name.
  @IsOptional()
  @IsString()
  APPLE_BUNDLE_ID?: string;

  // Optional: Apple in-app purchase verification isn't required to boot —
  // only /subscriptions/verify-apple-purchase needs it, and it doesn't
  // exist until App Store Connect subscription products + this API key
  // are created. Left unset, that one endpoint fails with a clear 500.
  @IsOptional()
  @IsString()
  APPLE_IAP_KEY_ID?: string;

  @IsOptional()
  @IsString()
  APPLE_IAP_ISSUER_ID?: string;

  @IsOptional()
  @IsString()
  APPLE_IAP_PRIVATE_KEY?: string;

  // 'production' (default) or 'sandbox' — sandbox is only for
  // TestFlight/Xcode-signed test purchases, which don't exist on the
  // production App Store Server API host.
  @IsOptional()
  @IsIn(['production', 'sandbox'])
  APPLE_IAP_ENVIRONMENT?: string;
}

// Wired into ConfigModule.forRoot({ validate }) — throwing here aborts
// Nest's bootstrap with a readable list of what's missing, instead of the
// app starting "successfully" and failing opaquely at first use.
export function validate(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const details = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .join('\n  - ');
    throw new Error(`Invalid environment configuration:\n  - ${details}`);
  }

  return validated;
}
