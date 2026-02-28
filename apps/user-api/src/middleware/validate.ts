import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";

export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res
        .status(400)
        .json({ message: "Invalid query", errors: result.error.flatten() });
      return;
    }
    next();
  };
}

export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res
        .status(400)
        .json({ message: "Invalid body", errors: result.error.flatten() });
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateParams(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      res
        .status(400)
        .json({ message: "Invalid params", errors: result.error.flatten() });
      return;
    }
    req.params = result.data as Record<string, string>;
    next();
  };
}
