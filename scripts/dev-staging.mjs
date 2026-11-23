process.loadEnvFile(".env.staging.local");
if (!process.env.KESTREL_ALLOW_DEMO) process.env.KESTREL_ALLOW_DEMO = "true";
process.argv = [process.argv[0], "next", "dev", "-p", "3333"];
await import("../node_modules/next/dist/bin/next");

