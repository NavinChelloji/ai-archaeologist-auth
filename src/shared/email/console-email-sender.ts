import { Inject, Injectable } from "@nestjs/common";
import type { Logger } from "@aca/logger";
import { APP_LOGGER } from "../infra.module";
import type { EmailMessage, EmailSender } from "./email-sender";

/**
 * adr/0006-email-password-auth.md: no email provider is configured yet, so
 * verification and reset links are logged instead of sent — this stub is
 * what "delivers" them in local dev. Swap in a real provider by
 * implementing `EmailSender` and rebinding the `EMAIL_SENDER` token; nothing
 * in the verification/reset flow itself needs to change.
 */
@Injectable()
export class ConsoleEmailSender implements EmailSender {
  constructor(@Inject(APP_LOGGER) private readonly logger: Logger) {}

  async send(message: EmailMessage): Promise<void> {
    this.logger.warn(
      { to: message.to, subject: message.subject, stub: true },
      `EMAIL STUB (no provider configured) — would have sent: ${message.text}`
    );
  }
}
