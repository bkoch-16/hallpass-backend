declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string | null;
        emailVerified: boolean;
        role: import("@hallpass/types").UserRole;
        createdAt: Date;
        updatedAt: Date;
      };
    }
  }
}

export {};
