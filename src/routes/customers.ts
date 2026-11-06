import { Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import {
  deleteAccountHandler,
  loginCustomerHandler,
  logoutAllHandler,
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
import { exportCustomerDataHandler } from "../controllers/dataExport.controller.js";
import { listCustomerSecurityEventsHandler } from "../controllers/securityEvents.controller.js";
import { mfaHandlers } from "../controllers/mfa.controller.js";
import { requireCustomerAuth } from "../middleware/customerAuth.js";
import {
  changePasswordHandler,
  forgotPasswordHandler,
  resetPasswordHandler,
} from "../controllers/accountPassword.controller.js";
import {
  accountDeletionLimiter,
  dataExportLimiter,
  mfaLoginAccountLimiter,
  mfaLoginIpLimiter,
  mfaManageLimiter,
  changePasswordLimiter,
  forgotPasswordAccountLimiter,
  forgotPasswordIpLimiter,
  googleAuthLimiter,
  loginAccountLimiter,
  loginIpLimiter,
  registerLimiter,
  resetPasswordLimiter,
} from "../middleware/rateLimiters.js";

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

customersRouter.post("/register", registerLimiter, registerCustomerHandler);
customersRouter.get("/me", requireCustomerAuth, meCustomerHandler);
customersRouter.patch("/me", requireCustomerAuth, updateCustomerHandler);
customersRouter.delete("/me", requireCustomerAuth, accountDeletionLimiter, deleteAccountHandler);
customersRouter.post("/me/logout-all", requireCustomerAuth, logoutAllHandler);
customersRouter.post("/me/export", requireCustomerAuth, dataExportLimiter, exportCustomerDataHandler);
customersRouter.get("/me/security-events", requireCustomerAuth, listCustomerSecurityEventsHandler);
const customerMfa = mfaHandlers("CUSTOMER");
customersRouter.get("/me/mfa", requireCustomerAuth, customerMfa.status);
customersRouter.post("/me/mfa/setup", requireCustomerAuth, mfaManageLimiter, customerMfa.setup);
customersRouter.post("/me/mfa/enable", requireCustomerAuth, mfaManageLimiter, customerMfa.enable);
customersRouter.post("/me/mfa/disable", requireCustomerAuth, mfaManageLimiter, customerMfa.disable);
customersRouter.post("/me/mfa/recovery-codes", requireCustomerAuth, mfaManageLimiter, customerMfa.recoveryCodes);
customersRouter.post("/login/mfa", mfaLoginIpLimiter, mfaLoginAccountLimiter, customerMfa.completeLogin);
customersRouter.get("/me/rooms", requireCustomerAuth, meRoomsHandler);
customersRouter.put("/me/location", requireCustomerAuth, locationLimiter, reportLocationHandler);
customersRouter.post("/me/devices", requireCustomerAuth, registerDeviceHandler);
customersRouter.delete("/me/devices", requireCustomerAuth, unregisterDeviceHandler);
customersRouter.post("/login", loginIpLimiter, loginAccountLimiter, loginCustomerHandler);
customersRouter.post("/google-auth", googleAuthLimiter, googleAuthCustomerHandler);
customersRouter.post("/forgot-password", forgotPasswordIpLimiter, forgotPasswordAccountLimiter, forgotPasswordHandler("CUSTOMER"));
customersRouter.post("/reset-password", resetPasswordLimiter, resetPasswordHandler("CUSTOMER"));
customersRouter.patch("/me/password", requireCustomerAuth, changePasswordLimiter, changePasswordHandler("CUSTOMER"));
