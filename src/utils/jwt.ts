import jwt from "jsonwebtoken";

export type CustomerJwtPayload = {
  sub: string;
  type: "customer";
};

export function signCustomerToken(customerId: string) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not defined");
  }
  const payload: CustomerJwtPayload = { sub: customerId, type: "customer" };
  return jwt.sign(payload, secret, { expiresIn: "7d" });
}

export function verifyCustomerToken(token: string): CustomerJwtPayload {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set");
  }

  const payload = jwt.verify(token, secret);
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid token payload");
  }

  const sub = (payload as any).sub;
  console.log("Token payload:", payload);
  console.log("Extracted sub:", sub);
  const type = (payload as any).type;

  if (typeof sub !== "string" || type !== "customer") {
    throw new Error("Invalid token payload");
  }

  return { sub, type };
}
