import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

const port = Number(process.env.PLAYWRIGHT_N0_PORT ?? 3200);
rmSync(path.join(process.cwd(), ".next", "cache"), { recursive: true, force: true });
rmSync(path.join(process.cwd(), ".next", "dev", "cache"), { recursive: true, force: true });

const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "dev", "-H", "127.0.0.1", "-p", String(port)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    SUPABASE_URL: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    TAVILY_API_KEY: "",
    OPENROUTER_API_KEY: "",
    REDDIT_CLIENT_ID: "",
    REDDIT_CLIENT_SECRET: "",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
    TURNSTILE_SECRET_KEY: "",
    VERCEL_ENV: "",
  },
  stdio: "inherit",
});

function stop() {
  if (!child.killed) child.kill("SIGTERM");
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
