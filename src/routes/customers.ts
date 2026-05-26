import { Router } from "express";
import {
  loginCustomerHandler,
  meCustomerHandler,
  registerCustomerHandler,
  googleAuthCustomerHandler,
} from "../controllers/customers.controller.js";
import { requireCustomerAuth } from "../middleware/customerAuth.js";

export const customersRouter = Router();

customersRouter.post("/register", registerCustomerHandler);
customersRouter.get("/me", requireCustomerAuth, meCustomerHandler);
customersRouter.post("/login", loginCustomerHandler);
customersRouter.post("/google-auth", googleAuthCustomerHandler);
