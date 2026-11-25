/**
 * services/shopMembers.service.ts — The shopkeeper's view of who is in their room.
 */

import { prisma } from "../database/prisma.js";
import type { Prisma } from "../generated/client.js";
import { escapeLike } from "../utils/like.js";

export interface MembersQuery {
  page: number;
  limit: number;
  /** Matches a member's name or email, ignoring case. */
  q?: string;
  /** Only members with notifications switched on (or off). */
  notifications?: "on" | "off";
}

export interface ShopMembersPage {
  members: {
    id: string;
    customerId: string;
    customerName: string;
    email: string;
    joinedAt: string;
    notificationsEnabled: boolean;
  }[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function listShopMembers(shopkeeperId: string, query: MembersQuery): Promise<ShopMembersPage> {
  const shop = await prisma.shop.findUnique({ where: { ownerId: shopkeeperId }, select: { room: { select: { id: true } } } });
  if (!shop?.room) return { members: [], total: 0, page: query.page, limit: query.limit, totalPages: 0 };

  const where: Prisma.MembershipWhereInput = { roomId: shop.room.id };
  if (query.notifications) where.notificationsEnabled = query.notifications === "on";
  if (query.q) {
    const needle = escapeLike(query.q);
    where.customer = {
      OR: [
        { fullName: { contains: needle, mode: "insensitive" } },
        { email: { contains: needle, mode: "insensitive" } },
      ],
    };
  }

  const [memberships, total] = await Promise.all([
    prisma.membership.findMany({
      where,
      orderBy: [{ joinedAt: "desc" }, { id: "asc" }],
      skip: query.page * query.limit,
      take: query.limit,
      select: {
        id: true,
        joinedAt: true,
        notificationsEnabled: true,
        customer: { select: { id: true, fullName: true, email: true } },
      },
    }),
    prisma.membership.count({ where }),
  ]);

  return {
    members: memberships.map((m) => ({
      id: m.id,
      customerId: m.customer.id,
      customerName: m.customer.fullName,
      email: m.customer.email,
      joinedAt: m.joinedAt.toISOString(),
      notificationsEnabled: m.notificationsEnabled,
    })),
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit),
  };
}
