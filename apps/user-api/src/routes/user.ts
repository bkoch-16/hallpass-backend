import { Router, Request, Response } from "express";
import { prisma, Role } from "@hallpass/db";
import { requireAuth } from "../middleware/auth";
import {requireRole, requireSelfOrRole} from "../middleware/roleGuard";
import { validateParams, validateQuery } from "../middleware/validate";
import { batchQuerySchema, userIdSchema } from "../schemas/user";

const router = Router();

// batch must come before /:id
router.get(
    "/batch",
    requireAuth,
    validateQuery(batchQuerySchema),
    requireRole(Role.TEACHER, Role.ADMIN, Role.SUPER_ADMIN),
    async (req: Request, res: Response) => {
        const idList = (req.query.ids as string).split(",");

        const users = await prisma.user.findMany({
            where: {
                id: { in: idList },
            },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                createdAt: true,
            },
        });

        res.json(users);
    }
);

router.get(
    "/:id",
    requireAuth,
    validateParams(userIdSchema),
    requireSelfOrRole(Role.TEACHER, Role.ADMIN, Role.SUPER_ADMIN),
    async (req: Request, res: Response) => {
        const user = await prisma.user.findUnique({
            where: { id: req.params.id as string },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                createdAt: true,
            },
        });

        if (!user) {
            res.status(404).json({ message: "User not found" });
            return;
        }

        res.json(user);
    }
);

export default router;