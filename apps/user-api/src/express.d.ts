declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        email: string;
        name: string | null;
        emailVerified: boolean;
        role: import("@hallpass/types").UserRole;
        schoolId: number | null;
        createdAt: Date;
        updatedAt: Date;
      };
    }
  }
}

export {};
