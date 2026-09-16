import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { HealthController } from './health.controller';
import { AuthModule } from './auth/auth.module';
import { BusinessesModule } from './businesses/businesses.module';
import { CustomersModule } from './customers/customers.module';
import { ServicePresetsModule } from './service-presets/service-presets.module';
import { ServicesModule } from './services/services.module';
import { RemindersModule } from './reminders/reminders.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { InvoicingModule } from './invoicing/invoicing.module';
import { QuotationsModule } from './quotations/quotations.module';
import { BillingItemsModule } from './billing-items/billing-items.module';
import { TeamMembersModule } from './team-members/team-members.module';
import { DocumentTemplatesModule } from './document-templates/document-templates.module';
import { AppFeedbackModule } from './app-feedback/app-feedback.module';
import { LegalModule } from './legal/legal.module';
import { AdminModule } from './admin/admin.module';
import { AmcModule } from './amc/amc.module';
import { InventoryModule } from './inventory/inventory.module';
import { PurchasesModule } from './purchases/purchases.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { ProformaInvoicesModule } from './proforma-invoices/proforma-invoices.module';
import { validate } from './env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env.NODE_ENV === 'production' ? '.env.production' : '.env',
      validate,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
      }),
    }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>(
            'JWT_EXPIRES_IN',
            '30d',
          ) as `${number}d`,
        },
      }),
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
    AuthModule,
    BusinessesModule,
    CustomersModule,
    ServicePresetsModule,
    ServicesModule,
    RemindersModule,
    SubscriptionsModule,
    InvoicingModule,
    QuotationsModule,
    BillingItemsModule,
    TeamMembersModule,
    DocumentTemplatesModule,
    AppFeedbackModule,
    LegalModule,
    AdminModule,
    AmcModule,
    InventoryModule,
    PurchasesModule,
    SuppliersModule,
    ProformaInvoicesModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
