import { Router, Request, Response } from "express";
import { prisma } from "@hallpass/db";

const router = Router();

// GET /users/:id - get single user
router.get("/:id", async (req: Request, res: Response) => {
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
});

export default router;