import "dotenv/config";
import express from "express";
import morgan from "morgan";
import { auth, toNodeHandler } from "@hallpass/auth";
import userRouter from "./routes/user";

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(morgan("dev"));
app.use(express.json());

app.all("/api/auth/*splat", toNodeHandler(auth));

app.use("/api/users", userRouter);

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "user-api" });
});

app.listen(PORT, () => {
  console.log(`user-api running on port ${PORT}`);
});
