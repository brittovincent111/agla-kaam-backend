import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SendEmailCommand, SESClient } from '@aws-sdk/client-ses';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private readonly sesClient?: SESClient;
  private readonly transporter?: nodemailer.Transporter;
  private readonly from: string;
  private readonly useSes: boolean;
  private readonly region: string;

  constructor(private readonly configService: ConfigService) {
    this.from =
      this.configService.get<string>('EMAIL_FROM') ||
      '"Agla Kaam" <no-reply@aglakaam.app>';

    this.region =
      this.configService.get<string>('AWS_SES_REGION') ||
      this.configService.get<string>('AWS_REGION') ||
      'ap-south-1';

    // 1. Initialize Amazon SES client
    const accessKeyId =
      this.configService.get<string>('AWS_SES_ACCESS_KEY_ID') ||
      this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey =
      this.configService.get<string>('AWS_SES_SECRET_ACCESS_KEY') ||
      this.configService.get<string>('AWS_SECRET_ACCESS_KEY');

    const clientConfig: any = { region: this.region };
    if (accessKeyId && secretAccessKey) {
      clientConfig.credentials = { accessKeyId, secretAccessKey };
    }
    this.sesClient = new SESClient(clientConfig);

    // 2. Initialize optional SMTP fallback if explicitly configured
    const smtpHost = this.configService.get<string>('SMTP_HOST');
    const smtpUser = this.configService.get<string>('SMTP_USER');

    if (smtpHost && smtpUser) {
      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number(this.configService.get<string>('SMTP_PORT') ?? 465),
        secure:
          (this.configService.get<string>('SMTP_SECURE') ?? 'true') === 'true',
        auth: {
          user: smtpUser,
          pass: this.configService.get<string>('SMTP_PASS'),
        },
      });
    }

    // 3. Provider selection: default to Amazon SES unless explicitly set to 'smtp'
    const configuredProvider = (
      this.configService.get<string>('EMAIL_PROVIDER') || 'ses'
    ).toLowerCase();
    this.useSes = configuredProvider !== 'smtp';
  }

  async onModuleInit() {
    await this.logDiagnostics();
  }

  /**
   * Safe diagnostic reporting.
   * Reports AWS Account ID, IAM Principal ARN, Region, and Provider.
   * NEVER logs access keys, secrets, or passwords.
   */
  private async logDiagnostics(): Promise<void> {
    const emailProvider = this.useSes ? 'Amazon SES' : 'SMTP';
    const expectedAccount =
      this.configService.get<string>('AWS_EXPECTED_ACCOUNT_ID') ||
      '447150580112';

    this.logger.log(`[Email Config] Primary Provider: ${emailProvider}`);
    this.logger.log(`[Email Config] AWS Region: ${this.region}`);
    this.logger.log(`[Email Config] Sender: ${this.from}`);
    if (this.transporter) {
      this.logger.log(
        `[Email Config] SMTP Fallback: Enabled (${this.configService.get<string>('SMTP_HOST')})`,
      );
    }

    const isProd = this.configService.get<string>('NODE_ENV') === 'production';
    const overrideTo = isProd ? undefined : this.configService.get<string>('EMAIL_OVERRIDE_TO');
    if (overrideTo) {
      this.logger.log(
        `[Email Config] Safety Override Active: all outgoing emails redirect to -> ${overrideTo}`,
      );
    }

    if (this.useSes) {
      const accessKeyId =
        this.configService.get<string>('AWS_SES_ACCESS_KEY_ID') ||
        this.configService.get<string>('AWS_ACCESS_KEY_ID');
      const secretAccessKey =
        this.configService.get<string>('AWS_SES_SECRET_ACCESS_KEY') ||
        this.configService.get<string>('AWS_SECRET_ACCESS_KEY');

      const clientConfig: any = { region: this.region };
      if (accessKeyId && secretAccessKey) {
        clientConfig.credentials = { accessKeyId, secretAccessKey };
      }

      try {
        const sts = new STSClient(clientConfig);
        const identity = await sts.send(new GetCallerIdentityCommand({}));
        this.logger.log(`[AWS Identity] Account ID: ${identity.Account}`);
        this.logger.log(`[AWS Identity] IAM Principal ARN: ${identity.Arn}`);

        if (identity.Account !== expectedAccount) {
          this.logger.warn(
            `[AWS ACCOUNT MISMATCH WARNING] Active credentials belong to AWS Account "${identity.Account}" (${identity.Arn}), but your AWS Console root account is "${expectedAccount}". Any SES identities or IAM policies created in account "${expectedAccount}" will NOT work with these credentials until they are updated to match!`,
          );
        }
      } catch (err: any) {
        this.logger.warn(
          `[AWS Identity] Could not verify AWS STS caller identity: ${err.message}`,
        );
      }
    }
  }

  private async dispatch(
    to: string,
    subject: string,
    text: string,
    html: string,
  ): Promise<void> {
    const isProd = this.configService.get<string>('NODE_ENV') === 'production';
    const overrideTo = isProd ? undefined : this.configService.get<string>('EMAIL_OVERRIDE_TO');
    const destinationAddress = overrideTo || to;
    const emailSubject =
      overrideTo && overrideTo.toLowerCase() !== to.toLowerCase()
        ? `[For: ${to}] ${subject}`
        : subject;

    if (overrideTo) {
      this.logger.debug(
        `[EMAIL_OVERRIDE] Redirecting transactional email originally intended for "${to}" to "${destinationAddress}"`,
      );
    }

    if (this.useSes && this.sesClient) {
      const fromAddress = this.from.includes('<')
        ? this.from
        : `"Agla Kaam" <${this.from}>`;

      try {
        await this.sesClient.send(
          new SendEmailCommand({
            Source: fromAddress,
            Destination: { ToAddresses: [destinationAddress] },
            Message: {
              Subject: { Data: emailSubject, Charset: 'UTF-8' },
              Body: {
                Html: { Data: html, Charset: 'UTF-8' },
                Text: { Data: text, Charset: 'UTF-8' },
              },
            },
          }),
        );
        return;
      } catch (err: any) {
        this.logger.error(
          `Failed to send email to ${destinationAddress} via Amazon SES: ${err.message}`,
        );

        // Resilient fallback to SMTP if available
        if (this.transporter) {
          const smtpFrom =
            this.configService.get<string>('SMTP_FROM') ||
            this.configService.get<string>('SMTP_USER') ||
            this.from;
          const smtpFromAddress = smtpFrom.includes('<')
            ? smtpFrom
            : `"Agla Kaam" <${smtpFrom}>`;

          this.logger.warn(
            `Falling back to configured SMTP transport for recipient ${destinationAddress}...`,
          );
          await this.transporter.sendMail({
            from: smtpFromAddress,
            to: destinationAddress,
            subject: emailSubject,
            text,
            html,
          });
          return;
        }

        throw err;
      }
    } else if (this.transporter) {
      const smtpFrom =
        this.configService.get<string>('SMTP_FROM') ||
        this.configService.get<string>('SMTP_USER') ||
        this.from;
      const smtpFromAddress = smtpFrom.includes('<')
        ? smtpFrom
        : `"Agla Kaam" <${smtpFrom}>`;

      await this.transporter.sendMail({
        from: smtpFromAddress,
        to: destinationAddress,
        subject: emailSubject,
        text,
        html,
      });
    } else {
      this.logger.warn(
        `No email transport available to send email to ${destinationAddress}`,
      );
    }
  }

  /** A plain-text note to us (the admin), e.g. a lead asking to be called. */
  async sendPlain(to: string, subject: string, text: string): Promise<void> {
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    await this.dispatch(to, subject, text, `<div style="font-family:sans-serif;white-space:pre-wrap">${escaped}</div>`);
  }

  async sendSignupVerificationOtp(to: string, code: string): Promise<void> {
    try {
      await this.dispatch(
        to,
        `${code} is your Agla Kaam email verification code`,
        `Your email verification code for Agla Kaam is ${code}. It expires in 15 minutes.`,
        `<p>Welcome to Agla Kaam!</p><p>Your email verification code is <strong style="font-size:24px;letter-spacing:3px;color:#2563eb">${code}</strong>.</p><p>It expires in 15 minutes. Enter this code in the app to complete your account setup.</p>`,
      );
      this.logger.log(`Verification OTP sent successfully to ${to}`);
    } catch (err: any) {
      this.logger.error(
        `Failed to send signup verification email to ${to}: ${err.message}`,
        err.stack,
      );
    }
  }

  async sendPasswordResetCode(to: string, code: string): Promise<void> {
    try {
      await this.dispatch(
        to,
        `${code} is your Agla Kaam password reset code`,
        `Your password reset code is ${code}. It expires in 15 minutes. If you didn't request this, you can ignore this email.`,
        `<p>Your password reset code is <strong style="font-size:20px;letter-spacing:2px">${code}</strong>.</p><p>It expires in 15 minutes. If you didn't request this, you can ignore this email.</p>`,
      );
      this.logger.log(`Password reset code sent successfully to ${to}`);
    } catch (err: any) {
      this.logger.error(
        `Failed to send password reset email to ${to}: ${err.message}`,
        err.stack,
      );
    }
  }
}
