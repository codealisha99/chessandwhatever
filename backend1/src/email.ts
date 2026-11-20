import { log } from "./logger.ts";
import { config } from "./config.ts";

export interface SentEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  resetUrl: string;
  timestamp: number;
}

export interface IEmailService {
  sendPasswordResetEmail(to: string, resetUrl: string): Promise<boolean>;
}

export class DevelopmentEmailService implements IEmailService {
  readonly sent: SentEmail[] = [];

  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<boolean> {
    const subject = "Reset your Gambit password";
    const text = `You requested a password reset for your Gambit account. Use the link below to set a new password:\n\n${resetUrl}\n\nThis link will expire in 15 minutes. If you did not request this, you can safely ignore this email.`;
    const html = `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
        <h2>Reset your Gambit password</h2>
        <p>You requested a password reset for your Gambit account.</p>
        <p><a href="${resetUrl}" style="display: inline-block; padding: 10px 20px; background-color: #e59934; color: #1a1a1a; text-decoration: none; border-radius: 6px; font-weight: bold;">Reset Password</a></p>
        <p>Or copy and paste this URL into your browser:</p>
        <p style="word-break: break-all; color: #666;">${resetUrl}</p>
        <p style="color: #999; font-size: 12px; margin-top: 30px;">This link will expire in 15 minutes. If you did not request this, you can safely ignore this email.</p>
      </div>
    `;
    const record: SentEmail = { to, subject, text, html, resetUrl, timestamp: Date.now() };
    this.sent.push(record);
    log.info(`[DEV EMAIL] Password reset email queued for ${to}`, { to });
    return true;
  }

  clear(): void {
    this.sent.length = 0;
  }
}

export class ProductionEmailService implements IEmailService {
  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<boolean> {
    // If external SMTP or provider like Resend / SendGrid is configured via environment
    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM ?? "Gambit <auth@gambit.chess>",
            to: [to],
            subject: "Reset your Gambit password",
            html: `<p>Reset your password by clicking here: <a href="${resetUrl}">${resetUrl}</a></p>`,
          }),
        });
        return res.ok;
      } catch (err) {
        log.error("Failed to send email via Resend", err);
        return false;
      }
    }
    log.warn("Production email provider not configured; falling back to dev logger");
    return devEmailService.sendPasswordResetEmail(to, resetUrl);
  }
}

export const devEmailService = new DevelopmentEmailService();
export const emailService: IEmailService = config.emailProvider === "production" ? new ProductionEmailService() : devEmailService;
