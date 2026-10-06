import { NestExpressApplication } from '@nestjs/platform-express';
import * as crypto from 'crypto';
if (!globalThis.crypto) {
  (globalThis as any).crypto = crypto.webcrypto || crypto;
}

// Must run before any module can issue an HTTP request. `fetch` is only a
// global from Node 18 onward, and the deployed server is older — see
// common/http/fetch-polyfill.ts.
import { installFetchPolyfill } from './common/http/fetch-polyfill';
installFetchPolyfill();

import compression = require('compression');
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

// Diagnostic-only: prints which critical env vars the running process
// actually sees (never the values), so a stale/missing var after a
// redeploy shows up immediately in the startup log instead of surfacing
// later as an unexplained "server error" on login/payment.
function logEnvPresence(configService: ConfigService) {
  const keys = [
    'MONGODB_URI',
    'JWT_SECRET',
    'GOOGLE_WEB_CLIENT_ID',
    'APPLE_BUNDLE_ID',
    'APPLE_IAP_KEY_ID',
    'APPLE_IAP_ISSUER_ID',
    'APPLE_IAP_PRIVATE_KEY',
    'APPLE_IAP_ENVIRONMENT',
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
  ];
  // Logged because a Node version mismatch is invisible until something
  // fails at runtime: `fetch` is only global from Node 18, and running on 16
  // silently broke the admin broadcast, the reminder push dispatch and Apple
  // purchase verification. pm2 can also launch a different node than the
  // login shell, so printing what the process itself is using is the only
  // reliable answer.
  console.log(`node: ${process.version} (${process.arch})`);
  if (Number(process.versions.node.split('.')[0]) < 18) {
    console.warn(
      `WARNING: Node ${process.version} is below the required >=18. ` +
        'A fetch polyfill is active, but upgrade the server.',
    );
  }
  console.log('--- env presence check ---');
  for (const key of keys) {
    console.log(
      `${key}: ${configService.get<string>(key) ? 'present' : 'MISSING'}`,
    );
  }
  console.log('---------------------------');
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  // Behind nginx every request arrives from the proxy's address. Without this
  // the rate limiter counts all users as one client, so a handful of logins a
  // minute locks everyone out. Trust exactly one hop (our nginx), which sets
  // X-Forwarded-For; trusting more would let clients spoof their address.
  app.set('trust proxy', 1);
  const configService = app.get(ConfigService);
  logEnvPresence(configService);
  // Gzip before anything writes a body. JSON list payloads compress heavily,
  // which matters most on the patchy mobile connections this app is used on.
  app.use(compression());

  // Baseline security headers: HSTS, nosniff, frame-deny and friends.
  // contentSecurityPolicy is off because this is a JSON API with no pages of
  // its own, and a default CSP only produces noise here.
  app.use(helmet({ contentSecurityPolicy: false }));

  // An explicit allowlist instead of the previous bare enableCors(), which
  // reflected back any origin that asked. Mobile apps send no Origin header
  // and are unaffected; this is about what a browser on someone else's site
  // is allowed to do with a logged-in session.
  const isDev = configService.get<string>('NODE_ENV') !== 'production';
  const configuredOrigins = (
    configService.get<string>('CORS_ORIGINS') ??
    'https://aglakaam.app,https://www.aglakaam.app'
  )
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const defaultDevOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:3002',
  ];

  const allowedOrigins = isDev
    ? Array.from(new Set([...configuredOrigins, ...defaultDevOrigins]))
    : configuredOrigins;

  app.enableCors({
    origin(origin, callback) {
      // No Origin: native app, curl, server-to-server webhooks.
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        (isDev && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
      ) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true,
  });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
