import { config } from "dotenv";

config({ path: ".env" });

// Unit/integration tests never read a real .env; provide the minimal env the
// server env schema requires so module imports don't throw at load time.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.NEXTAUTH_SECRET ??= "test-secret";
