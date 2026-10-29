import type { Request, Response } from "express";
import z from "zod";
import { parseBody } from "../utils/validate.js";
import { signCustomerToken } from "../utils/jwt.js";
import {
  deleteCustomerAccount,
  getCustomerAuthFactors,
  getCustomerById,
  getJoinedRooms,
  googleAuthCustomer,
  loginCustomer,
  registerCustomer,
  reportCustomerLocation,
  updateCustomer,
} from "../services/customers.service.js";
import { revokeSessions } from "../services/session.service.js";
import { disconnectViewer, removeViewerFromRoom } from "../realtime/socket.js";
import { newPasswordSchema, verifyPassword } from "../utils/password.js";
import { firebaseAuth } from "../lib/firebaseAdmin.js";

/** A Google sign-in older than this can't authorise deleting the account. */
const REAUTH_WINDOW_SECONDS = 5 * 60;

const registerCustomerSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(254),
    password: newPasswordSchema,
    allowLocationAccess: z.boolean().optional().default(false),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })
  .refine(
    (v) => {
      if (!v.allowLocationAccess) return true;
      return typeof v.latitude === "number" && typeof v.longitude === "number";
    },
    {
      message:
        "latitude and longitude are required when allowLocationAccess is true",
      path: ["latitude"],
    },
  );

type RegisterCustomerDto = z.infer<typeof registerCustomerSchema>;

const loginCustomerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

type LoginCustomerDto = z.infer<typeof loginCustomerSchema>;

const googleAuthSchema = z
  .object({
    idToken: z.string().min(10).max(4096),
    allowLocationAccess: z.boolean().optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })
  .refine(
    (v) => {
      if (!v.allowLocationAccess) return true;
      return typeof v.latitude === "number" && typeof v.longitude === "number";
    },
    {
      message:
        "latitude and longitude are required when allowLocationAccess is true",
      path: ["latitude"],
    },
  );

type GoogleAuthDto = z.infer<typeof googleAuthSchema>;

function validationError(res: Response, error: z.ZodError) {
  return res.status(400).json({
    message: "Validation error",
    issues: error.issues.map((i) => ({ path: i.path, message: i.message })),
  });
}

export async function registerCustomerHandler(req: Request, res: Response) {
  const parsed = parseBody<RegisterCustomerDto>(req, registerCustomerSchema);
  if (!parsed.ok) {
    return validationError(res, parsed.error);
  }

  const result = await registerCustomer({
    fullName: parsed.data.fullName,
    email: parsed.data.email,
    password: parsed.data.password,
    allowLocationAccess: parsed.data.allowLocationAccess,
    latitude: parsed.data.latitude,
    longitude: parsed.data.longitude,
  });
  if (!result.ok) {
    return res.status(409).json({
      message: "Email already in use",
    });
  }

  const token = signCustomerToken(result.customer.id, result.tokenVersion);
  return res.json({
    token,
    cusomer: result.customer,
  });
}

export async function meCustomerHandler(req: Request, res: Response) {
  const customerId = req.customerId;
  if (!customerId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const customer = await getCustomerById(customerId);
  if (!customer) {
    return res.status(404).json({ message: "Customer not found" });
  }
  return res.json({ customer });
}

const updateCustomerSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  allowLocationAccess: z.boolean().optional(),
});

type UpdateCustomerDto = z.infer<typeof updateCustomerSchema>;

// ─── PATCH /api/customers/me ───────────────────────────────────────────────────
// Body: { fullName?, allowLocationAccess? }. Auth: requireCustomerAuth.

export async function updateCustomerHandler(req: Request, res: Response) {
  const customerId = req.customerId!;
  const parsed = parseBody<UpdateCustomerDto>(req, updateCustomerSchema);
  if (!parsed.ok) {
    return validationError(res, parsed.error);
  }

  const customer = await updateCustomer(customerId, parsed.data);
  return res.json({ customer, message: "Profile updated" });
}

// ─── PUT /api/customers/me/location ───────────────────────────────────────────
// The device's current position, for radius-based notifications.
// Body: { latitude, longitude }. Auth: requireCustomerAuth.

const reportLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export async function reportLocationHandler(req: Request, res: Response) {
  const parsed = parseBody(req, reportLocationSchema);
  if (!parsed.ok) {
    return validationError(res, parsed.error);
  }

  const stored = await reportCustomerLocation(req.customerId!, parsed.data);
  if (!stored) {
    return res.status(403).json({ message: "Location access is turned off for this account" });
  }
  return res.json({ message: "Location updated" });
}

// ─── GET /api/customers/me/rooms ──────────────────────────────────────────────
// Rooms the authenticated customer has joined. Auth: requireCustomerAuth.

export async function meRoomsHandler(req: Request, res: Response) {
  const customerId = req.customerId!;
  const rooms = await getJoinedRooms(customerId);
  return res.json({ rooms });
}

export async function loginCustomerHandler(req: Request, res: Response) {
  const parsed = parseBody<LoginCustomerDto>(req, loginCustomerSchema);
  if (!parsed.ok) {
    return validationError(res, parsed.error);
  }

  const result = await loginCustomer({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (!result.ok) {
    return res.status(401).json({ message: "Invalid email or password" });
  }

  const token = signCustomerToken(result.customer.id, result.tokenVersion);
  return res.json({
    token,
  });
}

export async function googleAuthCustomerHandler(req: Request, res: Response) {
  const parsed = parseBody<GoogleAuthDto>(req, googleAuthSchema);
  if (!parsed.ok) {
    return validationError(res, parsed.error);
  }

  let decodedToken;
  try {
    decodedToken = await firebaseAuth.verifyIdToken(parsed.data.idToken);
  } catch {
    return res.status(401).json({ message: "Invalid or expired Google token" });
  }

  // Only a Google-verified email may claim (or be linked to) an account;
  // other Firebase providers can assert any address they like.
  const { uid, email, name, email_verified: emailVerified, firebase } = decodedToken;
  if (!email || emailVerified !== true || firebase?.sign_in_provider !== "google.com") {
    return res.status(401).json({ message: "Invalid or expired Google token" });
  }

  const result = await googleAuthCustomer({
    firebaseUid: uid,
    email: email.toLowerCase(),
    fullName: name ?? email.split("@")[0],
  });

  const token = signCustomerToken(result.customer.id, result.tokenVersion);
  return res.json({ token, customer: result.customer });
}

// ─── POST /api/customers/me/logout-all ────────────────────────────────────────
// Invalidates every session of the account, including the one making the call.

export async function logoutAllHandler(req: Request, res: Response) {
  await revokeSessions("customer", req.customerId!);
  disconnectViewer(req.customerId!);
  return res.json({ message: "Signed out everywhere" });
}

// ─── DELETE /api/customers/me ─────────────────────────────────────────────────
// Permanently deletes the account and its data. The caller must prove it's
// really them again: their password, or — for Google-only accounts — an ID
// token from a Google sign-in performed in the last few minutes.

const deleteAccountSchema = z.object({
  password: z.string().min(1).max(200).optional(),
  idToken: z.string().min(10).max(4096).optional(),
});

export async function deleteAccountHandler(req: Request, res: Response) {
  const customerId = req.customerId!;
  const parsed = parseBody(req, deleteAccountSchema);
  if (!parsed.ok) {
    return validationError(res, parsed.error);
  }

  const factors = await getCustomerAuthFactors(customerId);
  if (!factors) {
    return res.status(404).json({ message: "Customer not found" });
  }

  let confirmed = false;
  if (factors.passwordHash) {
    confirmed =
      typeof parsed.data.password === "string" &&
      (await verifyPassword(parsed.data.password, factors.passwordHash));
  } else if (parsed.data.idToken && factors.firebaseUid) {
    try {
      const decoded = await firebaseAuth.verifyIdToken(parsed.data.idToken);
      const age = Date.now() / 1000 - decoded.auth_time;
      confirmed = decoded.uid === factors.firebaseUid && age >= 0 && age <= REAUTH_WINDOW_SECONDS;
    } catch {
      confirmed = false;
    }
  }
  if (!confirmed) {
    return res.status(403).json({ message: "Could not confirm your identity" });
  }

  const roomIds = await deleteCustomerAccount(customerId);
  for (const roomId of roomIds) {
    removeViewerFromRoom(customerId, roomId);
  }
  disconnectViewer(customerId);
  return res.json({ message: "Your account has been deleted" });
}
