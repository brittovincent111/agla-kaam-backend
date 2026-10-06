import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsUrl,
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

  // The address customers can reach, e.g. https://agla-kaam-api.velocrew.in
  // (no /api). Used to build the invoice pay links and service record links
  // sent on WhatsApp. Without it they use the host the request came in on.
  @IsOptional()
  @IsUrl({ require_tld: true, protocols: ['https'], require_protocol: true })
  PUBLIC_API_URL?: string;

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

  @IsOptional()
  @IsString()
  EMAIL_FROM?: string;

  @IsOptional()
  @IsString()
  SMTP_HOST?: string;

  @IsOptional()
  @IsString()
  SMTP_PORT?: string;

  @IsOptional()
  @IsString()
  SMTP_SECURE?: string;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASS?: string;

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

  // Optional: Sign in with Apple refresh-token exchange and revoke (see
  // AppleSignInService). Unset, both are skipped with a warning.
  @IsOptional()
  @IsString()
  APPLE_TEAM_ID?: string;

  @IsOptional()
  @IsString()
  APPLE_SIGNIN_KEY_ID?: string;

  @IsOptional()
  @IsString()
  APPLE_SIGNIN_PRIVATE_KEY?: string;

  @IsOptional()
  @IsString()
  GOOGLE_PLACES_API_KEY?: string;

  @IsOptional()
  @IsString()
  LEAD_FINDER_DAILY_LIMIT?: string;

  @IsOptional()
  @IsString()
  LEAD_FINDER_MONTHLY_LIMIT?: string;

  // WhatsApp Cloud API (marketing campaigns from the business number)
  @IsOptional()
  @IsString()
  WHATSAPP_ACCESS_TOKEN?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_PHONE_NUMBER_ID?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_WABA_ID?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_APP_SECRET?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_WEBHOOK_VERIFY_TOKEN?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_GRAPH_VERSION?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_GRAPH_BASE_URL?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_OVERRIDE_TO?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_DAILY_LIMIT?: string;

  @IsOptional()
  @IsString()
  GOOGLE_PLACES_BASE_URL?: string;

  @IsOptional()
  @IsString()
  LEAD_FINDER_FREE_MONTHLY?: string;

  // How far below the free amount searches stop (percent, default 20).
  @IsOptional()
  @IsString()
  LEAD_FINDER_SAFETY_GAP_PERCENT?: string;

  @IsOptional()
  @IsString()
  GOOGLE_PLACES_COST_PER_CALL_USD?: string;

  // Allow Google searches past the free monthly amount (billed).
  @IsOptional()
  @IsString()
  LEAD_FINDER_ALLOW_PAID?: string;

  // Monthly outreach budget in rupees (see outreach-budget.ts).
  @IsOptional()
  @IsString()
  OUTREACH_MONTHLY_BUDGET_INR?: string;

  @IsOptional()
  @IsString()
  OUTREACH_BUDGET_GAP_PERCENT?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_COST_PER_MESSAGE_INR?: string;

  // Outreach sends only inside these hours/days, India time (see send-window.ts).
  @IsOptional()
  @IsString()
  OUTREACH_SEND_HOURS?: string;

  @IsOptional()
  @IsString()
  OUTREACH_SEND_DAYS?: string;

  @IsOptional()
  @IsString()
  EMAIL_DAILY_LIMIT?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_RATE_PER_SECOND?: string;

  // AWS SES & Marketing Campaign Configuration
  @IsOptional()
  @IsString()
  AWS_SES_REGION?: string;

  @IsOptional()
  @IsString()
  AWS_SES_ACCESS_KEY_ID?: string;

  @IsOptional()
  @IsString()
  AWS_SES_SECRET_ACCESS_KEY?: string;

  @IsOptional()
  @IsString()
  SES_FROM_EMAIL?: string;

  @IsOptional()
  @IsString()
  SES_REPLY_TO_EMAIL?: string;

  @IsOptional()
  @IsString()
  SES_RATE_LIMIT_PER_SECOND?: string;

  @IsOptional()
  @IsString()
  SES_BATCH_SIZE?: string;

  @IsOptional()
  @IsString()
  SES_MAX_RETRIES?: string;

  @IsOptional()
  @IsString()
  SES_RETRY_DELAY_MS?: string;

  @IsOptional()
  @IsString()
  UNSUBSCRIBE_BASE_URL?: string;

  // Development/testing override: when set, all outgoing emails are redirected to this address
  @IsOptional()
  @IsString()
  EMAIL_OVERRIDE_TO?: string;

  // Active email provider: 'ses' (default) or 'smtp'
  @IsOptional()
  @IsString()
  EMAIL_PROVIDER?: string;

  // Expected AWS Account ID for cross-account sanity checks
  @IsOptional()
  @IsString()
  AWS_EXPECTED_ACCOUNT_ID?: string;
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
