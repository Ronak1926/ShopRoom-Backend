import { Router } from "express";
import {
  loginCustomerHandler,
  meCustomerHandler,
  meRoomsHandler,
  registerCustomerHandler,
  googleAuthCustomerHandler,
  updateCustomerHandler,
} from "../controllers/customers.controller.js";
import {
  registerDeviceHandler,
  unregisterDeviceHandler,
} from "../controllers/customerDevice.controller.js";
import { requireCustomerAuth } from "../middleware/customerAuth.js";

export const customersRouter = Router();

customersRouter.post("/register", registerCustomerHandler);
customersRouter.get("/me", requireCustomerAuth, meCustomerHandler);
customersRouter.patch("/me", requireCustomerAuth, updateCustomerHandler);
customersRouter.get("/me/rooms", requireCustomerAuth, meRoomsHandler);
customersRouter.post("/me/devices", requireCustomerAuth, registerDeviceHandler);
customersRouter.delete("/me/devices", requireCustomerAuth, unregisterDeviceHandler);
customersRouter.post("/login", loginCustomerHandler);
customersRouter.post("/google-auth", googleAuthCustomerHandler);
