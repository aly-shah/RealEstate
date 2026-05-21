import type { Role } from "@prisma/client";
import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: Role;
      companyId: string | null;
    };
  }

  interface User {
    id: string;
    role: Role;
    companyId: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    companyId: string | null;
  }
}
