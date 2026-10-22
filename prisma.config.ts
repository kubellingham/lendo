import "dotenv/config";
import { defineConfig } from "prisma/config";
import { cliDatabaseUrl } from "./scripts/database-url";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: cliDatabaseUrl(),
  },
});
