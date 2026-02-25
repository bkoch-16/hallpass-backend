declare global {
    namespace Express {
        interface Request {
            user?: {
                id: string;
                email: string;
                name: string | null;
                emailVerified: boolean;
                role: import("@hallpass/db").Role;
                createdAt: Date;
                updatedAt: Date;
            };
        }
    }
}

export {};