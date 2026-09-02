import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    this.from = this.configService.get<string>('EMAIL_FROM') ?? '';
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST'),
      port: Number(this.configService.get<string>('SMTP_PORT') ?? 465),
      secure:
        (this.configService.get<string>('SMTP_SECURE') ?? 'true') === 'true',
      auth: {
        user: this.configService.get<string>('SMTP_USER'),
        pass: this.configService.get<string>('SMTP_PASS'),
      },
    });
  }

  async sendPasswordResetCode(to: string, code: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject: `${code} is your Agla Kaam password reset code`,
        text: `Your password reset code is ${code}. It expires in 15 minutes. If you didn't request this, you can ignore this email.`,
        html: `<p>Your password reset code is <strong style="font-size:20px;letter-spacing:2px">${code}</strong>.</p><p>It expires in 15 minutes. If you didn't request this, you can ignore this email.</p>`,
      });
    } catch (err) {
      // Swallowed here rather than thrown — AuthService always returns the
      // same generic "check your inbox" response regardless of whether the
      // account exists, so a delivery failure shouldn't reveal anything to
      // the caller either. It's still logged so real delivery problems are
      // visible operationally.
      this.logger.error(
        `Failed to send password reset email to ${to}`,
        err as Error,
      );
    }
  }
}
