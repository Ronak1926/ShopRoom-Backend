/**
 * services/securityEvent.service.ts — A record of the sensitive things that happen to an account:
 * sign-ins (and failed ones), password changes, signing out everywhere, data downloads,
 * two-step verification changes and account deletion.
 *
 * Two readers: the account owner (their own recent activity, so a sign-in they do not recognise
 * stands out) and whoever investigates an incident. Writing an event must never get in the way of
 * the action itself, so it is fire-and-forget and swallows its own failures.
 *
 * What is stored: the event, the account (as an id), the client address and browser, and a small
 * non-secret detail. Never a password, token, code or email address. Events go with the account when
 * it is deleted and are purged after a year (`dataRetention.service.ts`).
 */

import type { Request } from "express";
import type { AccountRole, SecurityEventType } from "../generated/client.js";
import { prisma } from "../database/prisma.js";
import { logger } from "../lib/logger.js";
import { describeUserAgent } from "../utils/describeUserAgent.js";

type Detail = Record<string, string | number | boolean>;

export interface SecurityEventInput {
  type: SecurityEventType;
  role: AccountRole;
  /** Null when no account is involved (a failed sign-in for an address that has none). */
  actorId?: string | null;
  detail?: Detail;
}

const MAX_USER_AGENT = 300;

export function recordSecurityEvent(req: Pick<Request, "ip" | "headers">, input: SecurityEventInput): void {
  const userAgent = req.headers["user-agent"];
  void prisma.securityEvent
    .create({
      data: {
        type: input.type,
        actorRole: input.role,
        actorId: input.actorId ?? null,
        ip: req.ip ? req.ip.slice(0, 64) : null,
        userAgent: typeof userAgent === "string" ? userAgent.slice(0, MAX_USER_AGENT) : null,
        detail: input.detail ?? undefined,
      },
    })
    .catch((err: unknown) => logger.warn("Security event could not be recorded", { type: input.type }, err));
}

export interface SecurityEventView {
  id: string;
  type: SecurityEventType;
  at: string;
  ip: string | null;
  device: string;
  detail: unknown;
}

/** The account owner's own most recent events, newest first. */
export async function listSecurityEvents(role: AccountRole, actorId: string, limit = 30): Promise<SecurityEventView[]> {
  const rows = await prisma.securityEvent.findMany({
    where: { actorRole: role, actorId },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 100),
    select: { id: true, type: true, createdAt: true, ip: true, userAgent: true, detail: true },
  });
  return rows.map((r) => ({ id: r.id, type: r.type, at: r.createdAt.toISOString(), ip: r.ip, device: describeUserAgent(r.userAgent), detail: r.detail }));
}

/** Removes everything recorded for an account (it is being deleted). */
export async function eraseSecurityEvents(role: AccountRole, actorId: string): Promise<void> {
  await prisma.securityEvent.deleteMany({ where: { actorRole: role, actorId } });
}
