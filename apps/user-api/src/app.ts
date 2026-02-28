import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import { auth, toNodeHandler } from "@hallpass/auth";
import userRouter from "./routes/user";

const app = express();

app.set("trust proxy", 1);

app.use(helmet());
// TODO: configure CORS_ORIGIN env var per environment and pass to cors({ origin, credentials: true })
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many requests" },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many requests" },
});

app.use(limiter);
app.all("/api/auth/*splat", authLimiter, toNodeHandler(auth));

app.use("/api/users", userRouter);

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "user-api" });
});

app.use((_req, res) => {
  res.status(404).json({ message: "Not found" });
});

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  },
);

export default app;
