import "dotenv/config";

import express from "express";
import cors from "cors";

import { customersRouter } from "./routes/customers.js";
import { connectDatabase } from "./database/prisma.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/customers", customersRouter);

connectDatabase().then(() => {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server started on port ${port}`);
  });
});
