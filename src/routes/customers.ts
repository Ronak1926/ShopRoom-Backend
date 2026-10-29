import { Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import {
  loginCustomerHandler,
  meCustomerHandler,
  meRoomsHandler,
  registerCustomerHandler,
  googleAuthCustomerHandler,
  updateCustomerHandler,
  reportLocationHandler,
} from "../controllers/customers.controller.js";
import {
  registerDeviceHandler,
  unregisterDeviceHandler,
} from "../controllers/customerDevice.controller.js";
import { requireCustomerAuth } from "../middleware/customerAuth.js";

/** Clients throttle themselves to one report per half hour; this is the server-side backstop. */
const locationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.customerId ?? ipKeyGenerator(req.ip ?? ""),
  message: { message: "Too many location updates." },
  standardHeaders: true,
  legacyHeaders: false,
});

export const customersRouter = Router();

customersRouter.post("/register", registerCustomerHandler);
customersRouter.get("/me", requireCustomerAuth, meCustomerHandler);
customersRouter.patch("/me", requireCustomerAuth, updateCustomerHandler);
customersRouter.get("/me/rooms", requireCustomerAuth, meRoomsHandler);
customersRouter.put("/me/location", requireCustomerAuth, locationLimiter, reportLocationHandler);
customersRouter.post("/me/devices", requireCustomerAuth, registerDeviceHandler);
customersRouter.delete("/me/devices", requireCustomerAuth, unregisterDeviceHandler);
customersRouter.post("/login", loginCustomerHandler);
customersRouter.post("/google-auth", googleAuthCustomerHandler);
