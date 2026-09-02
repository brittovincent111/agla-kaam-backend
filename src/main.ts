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
  console.log('--- env presence check ---');
  for (const key of keys) {
    console.log(
      `${key}: ${configService.get<string>(key) ? 'present' : 'MISSING'}`,
    );
  }
  console.log('---------------------------');
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  logEnvPresence(app.get(ConfigService));
  app.enableCors();
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
