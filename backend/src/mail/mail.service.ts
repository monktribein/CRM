import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import type { EnvironmentVariables } from '../config/env.js';

/**
 * Sends transactional email when SMTP is configured. When it isn't, the
 * service reports `enabled = false` so callers can fall back honestly (for
 * example, returning a one-time invitation link to the administrator).
 * Message bodies — which may contain tokens — are never logged.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    const host = config.get('SMTP_HOST', { infer: true });
    this.from = config.get('MAIL_FROM', { infer: true }) ?? 'no-reply@localhost';
    this.transporter = host
      ? nodemailer.createTransport({
          host,
          port: config.get('SMTP_PORT', { infer: true }) ?? 587,
          secure: (config.get('SMTP_PORT', { infer: true }) ?? 587) === 465,
          auth: config.get('SMTP_USER', { infer: true })
            ? { user: config.get('SMTP_USER', { infer: true }), pass: config.get('SMTP_PASSWORD', { infer: true }) }
            : undefined,
        })
      : null;
  }

  get enabled() {
    return this.transporter !== null;
  }

  /** Returns true if the message was accepted by the SMTP server. */
  async send(template: string, to: string, subject: string, text: string): Promise<boolean> {
    if (!this.transporter) return false;
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, text });
      this.logger.log({ template }, 'Email sent');
      return true;
    } catch (err) {
      this.logger.error({ template, err: (err as Error).message }, 'Email delivery failed');
      return false;
    }
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
