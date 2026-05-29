/**
 * types/index.ts — Domain TypeScript interfaces for ShopRoom.
 *
 * These mirror the Prisma models but are expressed as plain interfaces so
 * they can be used in service layer return types, API response shapes, and
 * client-facing payloads without importing the generated Prisma client.
 */

// ─── GeoJSON ──────────────────────────────────────────────────────────────────

export interface GeoJsonPoint {
  type: "Point";
  /** [longitude, latitude] — GeoJSON coordinate order */
  coordinates: [number, number];
}

// ─── Shop ─────────────────────────────────────────────────────────────────────

export interface ShopRecord {
  id: string;
  ownerId: string;
  shopName: string;
  category: string;
  description: string | null;
  logoUrl: string | null;
  address: string;
  city: string;
  state: string;
  pincode: string;
  phoneNumber: string;
  latitude: number | null;
  longitude: number | null;
  /** GeoJSON Point representation of the shop's location. */
  coordinates: GeoJsonPoint | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Safe public-facing shop shape (no internal IDs exposed beyond shopId). */
export interface ShopPublic {
  shopId: string;
  shopName: string;
  category: string;
  description: string | null;
  logoUrl: string | null;
  address: string;
  city: string;
  state: string;
  pincode: string;
  phoneNumber: string;
  coordinates: GeoJsonPoint | null;
  createdAt: string; // ISO string
}

// ─── Room ─────────────────────────────────────────────────────────────────────

export interface RoomRecord {
  id: string;
  shopId: string;
  inviteCode: string;
  membersCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Membership ───────────────────────────────────────────────────────────────

export interface MembershipRecord {
  id: string;
  roomId: string;
  customerId: string;
  joinedAt: Date;
  notificationsEnabled: boolean;
}

// ─── Registration result ──────────────────────────────────────────────────────

/** Full result returned after successful payment verification + registration. */
export interface RegistrationResult {
  shopkeeperId: string;
  shopId: string;
  roomId: string;
  inviteCode: string;
  /** Convenience URL slug — frontend appends this to the base URL. */
  inviteLink: string;
}

// ─── Invite link preview ──────────────────────────────────────────────────────

/** Public data shown on the /join/:code page before a customer joins. */
export interface InvitePreview {
  shop: ShopPublic;
  membersCount: number;
  inviteCode: string;
}
