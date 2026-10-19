import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
const xoxo = process.env.XOXO_SOURCE_ROOT;
if (!xoxo || !process.env.HOSTESS_SOURCE_ROOT)
  throw new Error("Set XOXO_SOURCE_ROOT and HOSTESS_SOURCE_ROOT to sibling checkouts");
for (const [key, db] of [
  ["CROSS_RECEIVER_DATABASE_URL", "xoxo_cross_test"],
  ["CROSS_SENDER_DATABASE_URL", "command_cross_test"],
]) {
  const url = new URL(process.env[key] ?? "http://invalid");
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.pathname !== "/" + db ||
    url.username !== "hostess_test"
  )
    throw new Error("Only isolated local hostess_test databases are permitted");
}
const env = {
  ...process.env,
  COMMAND_CENTER_SOURCE_ROOT: resolve("."),
  DATABASE_URL: process.env.CROSS_RECEIVER_DATABASE_URL,
};
for (const args of [
  [
    resolve(xoxo, "node_modules/prisma/build/index.js"),
    "migrate",
    "deploy",
    "--schema",
    resolve(xoxo, "prisma/schema.prisma"),
  ],
  [resolve(xoxo, "node_modules/tsx/dist/cli.mjs"), resolve("tests/service-cross.http.ts")],
]) {
  const result = spawnSync(process.execPath, args, { env, stdio: "inherit", windowsHide: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
