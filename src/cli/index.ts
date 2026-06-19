import { Command } from "commander";
import { startServer } from "../server/index.js";

const program = new Command();

program
  .name("opencode-cc")
  .description("AI coding agent with OpenCode backend and Claude Code-style UI")
  .version("0.1.0");

program
  .command("serve")
  .description("Start the web server")
  .option("-p, --port <number>", "Server port", "4080")
  .option("-h, --host <string>", "Server host", "0.0.0.0")
  .option("--password <string>", "Set authentication password")
  .option("--no-password", "Disable authentication")
  .option("--opencode-path <path>", "Path to opencode binary")
  .option("--static-dir <path>", "Serve static files from directory")
  .action(async (opts) => {
    const hasPassword = typeof opts.password === "string";
    await startServer({
      port: parseInt(opts.port, 10),
      host: opts.host,
      password: hasPassword ? opts.password : undefined,
      noPassword: !hasPassword,
      opencodePath: opts.opencodePath,
      staticDir: opts.staticDir,
    });
  });

program
  .command("start")
  .description("Start in development mode (alias for serve)")
  .action(async () => {
    await startServer({ noPassword: true });
  });

program.parse();
