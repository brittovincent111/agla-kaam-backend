import { Injectable, Logger } from '@nestjs/common';

// Expo accepts up to 100 messages per request. The previous implementation
// sent one HTTP request per business inside a sequential loop, which at any
// real scale would have taken longer than the hour between runs.
const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const MAX_MESSAGES_PER_REQUEST = 100;

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface PushSendOutcome {
  // Tokens Expo told us no longer belong to an installed app. Kept so the
  // caller can clear them: a dead token is retried forever otherwise, and
  // every send is billed attention we never get back.
  invalidTokens: string[];
  sent: number;
  failed: number;
}

export interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  // `fault: 'developer'` marks an error caused by our own configuration
  // rather than the recipient's device — see PERMANENT_ERRORS.
  details?: { error?: string; fault?: string };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

// Which Expo error codes mean "this token is dead — stop sending to it".
//
// ONLY DeviceNotRegistered belongs here. It is tempting to add
// InvalidCredentials, but Expo returns that with `fault: 'developer'` when
// OUR FCM/APNs server key is missing or wrong — nothing is wrong with the
// user's device. Clearing tokens on that would wipe every push token in the
// database on the first cron run after a credentials misconfiguration, and
// every user would then have to reopen the app to re-register. Anything that
// is not a dead device (rate limits, transient Expo faults, bad credentials)
// leaves the token alone so tomorrow's run can retry.
const PERMANENT_ERRORS = new Set(['DeviceNotRegistered']);

export function collectInvalidTokens(
  messages: PushMessage[],
  tickets: ExpoTicket[],
): string[] {
  const invalid: string[] = [];
  tickets.forEach((ticket, index) => {
    if (
      ticket?.status === 'error' &&
      ticket.details?.error &&
      PERMANENT_ERRORS.has(ticket.details.error)
    ) {
      const token = messages[index]?.to;
      if (token) invalid.push(token);
    }
  });
  return invalid;
}

@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger(ExpoPushService.name);

  async send(messages: PushMessage[]): Promise<PushSendOutcome> {
    const outcome: PushSendOutcome = { invalidTokens: [], sent: 0, failed: 0 };
    if (!messages.length) return outcome;

    for (const batch of chunk(messages, MAX_MESSAGES_PER_REQUEST)) {
      try {
        const response = await fetch(EXPO_PUSH_ENDPOINT, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Accept-encoding': 'gzip, deflate',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(batch),
        });

        if (!response.ok) {
          outcome.failed += batch.length;
          this.logger.error(
            `Expo push rejected a batch of ${batch.length}: HTTP ${response.status}`,
          );
          continue;
        }

        const payload = (await response.json()) as { data?: ExpoTicket[] };
        const tickets = payload?.data ?? [];
        const invalid = collectInvalidTokens(batch, tickets);
        outcome.invalidTokens.push(...invalid);
        outcome.sent += tickets.filter((t) => t?.status === 'ok').length;
        outcome.failed += tickets.filter((t) => t?.status === 'error').length;
      } catch (err) {
        // A network blip must not abort the remaining batches.
        outcome.failed += batch.length;
        this.logger.error(
          `Expo push batch of ${batch.length} threw: ${(err as Error).message}`,
        );
      }
    }

    return outcome;
  }
}
