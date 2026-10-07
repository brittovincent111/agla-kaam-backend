import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SendEmailCommand,
  SendEmailCommandInput,
  SESClient,
} from '@aws-sdk/client-ses';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';

export interface SendCampaignEmailOptions {
  to: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string;
  subject: string;
  html: string;
  text?: string;
  unsubscribeUrl?: string;
  configurationSetName?: string;
  // Send the text body alone, with no HTML part.
  textOnly?: boolean;
}

export interface SendEmailResult {
  messageId: string;
}

@Injectable()
export class SesService implements OnModuleInit {
  private readonly logger = new Logger(SesService.name);
  private readonly client: SESClient;
  private readonly region: string;
  private readonly defaultSender: string;

  constructor(private readonly configService: ConfigService) {
    this.region =
      this.configService.get<string>('AWS_SES_REGION') ||
      this.configService.get<string>('AWS_REGION') ||
      'ap-south-1';

    this.defaultSender =
      this.configService.get<string>('SES_FROM_EMAIL') ||
      'rajeev@aglakaam.app';

    const accessKeyId =
      this.configService.get<string>('AWS_SES_ACCESS_KEY_ID') ||
      this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey =
      this.configService.get<string>('AWS_SES_SECRET_ACCESS_KEY') ||
      this.configService.get<string>('AWS_SECRET_ACCESS_KEY');

    // If explicit AWS keys exist, use them. Otherwise, default to EC2 IAM role / default chain.
    const clientConfig: any = { region: this.region };
    if (accessKeyId && secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId,
        secretAccessKey,
      };
    }

    this.client = new SESClient(clientConfig);
  }

  /** Testing: every email goes to this address instead (EMAIL_OVERRIDE_TO). */
  getOverrideTo(): string | null {
    if (this.configService.get<string>('NODE_ENV') === 'production') {
      return null;
    }
    return this.configService.get<string>('EMAIL_OVERRIDE_TO')?.trim() || null;
  }

  async onModuleInit() {
    await this.logDiagnostics();
  }

  /**
   * Safe diagnostic reporting.
   * Reports AWS Account ID, IAM Principal ARN, Region, and Sender identity.
   * NEVER logs access keys, secrets, or passwords.
   */
  private async logDiagnostics(): Promise<void> {
    const expectedAccount =
      this.configService.get<string>('AWS_EXPECTED_ACCOUNT_ID') ||
      '447150580112';

    this.logger.log(`[SES Marketing] Initialized for region: ${this.region}`);
    this.logger.log(`[SES Marketing] Default Sender: ${this.defaultSender}`);
    this.logger.log(
      `[SES Marketing] Default Reply-To: ${this.configService.get<string>('SES_REPLY_TO_EMAIL') || 'support@aglakaam.app'}`,
    );

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
      this.logger.log(`[SES Marketing AWS] Account ID: ${identity.Account}`);
      this.logger.log(`[SES Marketing AWS] IAM Principal ARN: ${identity.Arn}`);

      if (identity.Account !== expectedAccount) {
        this.logger.warn(
          `[SES Marketing AWS MISMATCH] Active credentials belong to AWS Account "${identity.Account}" (${identity.Arn}), but your AWS Console root account is "${expectedAccount}". Verify identities in the matching account!`,
        );
      }
    } catch (err: any) {
      this.logger.warn(
        `[SES Marketing AWS] Could not verify caller identity: ${err.message}`,
      );
    }
  }

  getDefaultSender(): string {
    return this.defaultSender;
  }

  async sendEmail(options: SendCampaignEmailOptions): Promise<SendEmailResult> {
    const fromAddress = options.fromName
      ? `"${options.fromName.replace(/"/g, '')}" <${options.fromEmail || this.defaultSender}>`
      : options.fromEmail || this.defaultSender;

    // Plaintext fallback if none provided
    const textBody =
      options.text ||
      options.html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const overrideTo = this.configService.get<string>('EMAIL_OVERRIDE_TO');
    const destinationAddress = overrideTo || options.to;
    const emailSubject =
      overrideTo && overrideTo.toLowerCase() !== options.to.toLowerCase()
        ? `[For: ${options.to}] ${options.subject}`
        : options.subject;

    if (overrideTo) {
      this.logger.debug(
        `[EMAIL_OVERRIDE] Redirecting campaign email originally intended for "${options.to}" to "${destinationAddress}"`,
      );
    }

    const input: SendEmailCommandInput = {
      Source: fromAddress,
      Destination: {
        ToAddresses: [destinationAddress],
      },
      Message: {
        Subject: {
          Data: emailSubject,
          Charset: 'UTF-8',
        },
        Body: options.textOnly
          ? { Text: { Data: textBody, Charset: 'UTF-8' } }
          : {
              Html: {
                Data: options.html,
                Charset: 'UTF-8',
              },
              Text: {
                Data: textBody,
                Charset: 'UTF-8',
              },
            },
      },
    };

    if (options.replyTo) {
      input.ReplyToAddresses = [options.replyTo];
    }

    if (options.configurationSetName) {
      input.ConfigurationSetName = options.configurationSetName;
    }

    try {
      const command = new SendEmailCommand(input);
      const response = await this.client.send(command);

      const messageId = response.MessageId || `ses-${Date.now()}`;
      return { messageId };
    } catch (err: any) {
      this.logger.error(
        `SES sendEmail failed for recipient: ${options.to.replace(/(?<=.{2}).(?=.*@)/g, '*')}: ${err.message}`,
        err.stack,
      );
      throw err;
    }
  }
}
