import { WebSocketServer } from "ws";
import jwt from "jsonwebtoken";
import pty from "node-pty";

const C3_HOST = "192.168.227.130";
const C3_USER = "c3cloud";
const JWT_SECRET = process.env.JWT_SECRET || "dev_jwt_secret";

export function initTerminalServer(server) {
  const wss = new WebSocketServer({
    server,
    path: "/api/cloud/terminal",
  });

  wss.on("connection", (ws, req) => {
    try {

      const url = new URL(req.url, "http://localhost");
      const token = url.searchParams.get("token");
      const container = url.searchParams.get("container");

      if (!token || !container) {
        ws.close();
        return;
      }

      // 🔐 JWT Verification
      const decoded = jwt.verify(token, JWT_SECRET);

      const safeUser = decoded.email
        .split("@")[0]
        .toLowerCase()
        .replace(/\./g, "");

      if (!container.startsWith(`c3-${safeUser}`)) {
        console.log("Container ownership validation failed");
        ws.close();
        return;
      }

      console.log("Opening terminal for:", container);

      // 🚀 Secure SSH → LXC exec
      const shell = pty.spawn(
        "ssh",
        [
          "-tt",
          "-i", "/home/cybercode/.ssh/id_ed25519",
          "-o", "BatchMode=yes",
          "-o", "IdentitiesOnly=yes",
          "-o", "PreferredAuthentications=publickey",
          "-o", "PasswordAuthentication=no",
          "-o", "StrictHostKeyChecking=no",
          "-o", "ConnectTimeout=5",
          `${C3_USER}@${C3_HOST}`,
          "lxc",
          "exec",
          container,
          "--",
          "su",
          "-",
          "c3user"
        ],
        {
          name: "xterm-color",
          cols: 120,
          rows: 30,
          cwd: "/home/cybercode",
          env: {
            ...process.env,
            HOME: "/home/cybercode"
          },
        }
      );

      let isClosed = false;

      // 📤 Send shell output to browser
      shell.onData((data) => {
        if (ws.readyState === 1) {
          ws.send(data);
        }
      });

      // 🔒 When SSH/LXC session exits
      shell.onExit(({ exitCode, signal }) => {
        console.log("PTY exited:", exitCode, signal);

        if (!isClosed && ws.readyState === 1) {
          ws.send("\r\n🔒 Session terminated\r\n");
          ws.close();
        }

        isClosed = true;
      });

      // 📥 Receive input from browser
      ws.on("message", (msg) => {
        shell.write(msg.toString());
      });

      ws.on("error", (err) => {
        console.log("WebSocket error:", err);
      });

      // ❌ Browser closed tab
      ws.on("close", () => {
        console.log("WebSocket closed by client");

        if (!isClosed) {
          try {
            shell.kill();
          } catch (e) {
            console.log("Shell already closed");
          }
        }

        isClosed = true;
      });

    } catch (err) {
      console.error("Terminal error:", err.message);
      ws.close();
    }
  });

  console.log("Secure WebTerminal ready.");
}