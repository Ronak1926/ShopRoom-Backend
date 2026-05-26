import type { Request, Response } from "express";
import z from "zod";
import { parseBody } from "../utils/validate.js";
import { signCustomerToken } from "../utils/jwt.js";
import {
  getCustomerById,
  googleAuthCustomer,
  loginCustomer,
  registerCustomer,
} from "../services/customers.service.js";
import { firebaseAuth } from "../lib/firebaseAdmin.js";

const registerCustomerSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(8).max(200),
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
    idToken: z.string().min(10),
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

  const token = signCustomerToken(result.customer.id);
  return res.json({
    token,
    cusomer: result.customer,
  });
}

export async function meCustomerHandler(req: Request, res: Response) {
  const customerId = req.customerId;
  console.log("Customer ID from request:", customerId);
  if (!customerId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const customer = await getCustomerById(customerId);
  if (!customer) {
    return res.status(404).json({ message: "Customer not found" });
  }
  return res.json({ customer });
}

export async function loginCustomerHandler(req: Request, res: Response) {
  const parsed = parseBody<LoginCustomerDto>(req, loginCustomerSchema);
  console.log("Parsed login data:", parsed);
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

  const token = signCustomerToken(result.customer.id);
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

  const { uid, email, name } = decodedToken;
  if (!email) {
    return res.status(400).json({ message: "Google account has no email" });
  }

  const result = await googleAuthCustomer({
    firebaseUid: uid,
    email,
    fullName: name ?? email.split("@")[0],
  });

  const token = signCustomerToken(result.customer.id);
  return res.json({ token, customer: result.customer });
}
