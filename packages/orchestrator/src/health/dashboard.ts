import http from "node:http";
import type { HealthSnapshot } from "@poker-bot/shared";
import type { HealthMonitor } from "./monitor";

interface DashboardConfig {
  enabled: boolean;
  port: number;
  authToken?: string;
}

export class HealthDashboardServer {
  private server?: http.Server;
  private readonly listeners = new Set<http.ServerResponse>();

  constructor(
    private readonly config: DashboardConfig,
    private readonly monitor: HealthMonitor,
    private readonly logger: Pick<Console, "info" | "warn"> = console
  ) {}

  async start(): Promise<void> {
    if (!this.config.enabled || this.server) {
      return;
    }
    this.server = http.createServer((req, res) => {
      if (!this.authorize(req)) {
        res.statusCode = 401;
        res.end("unauthorized");
        return;
      }
      if (req.url?.startsWith("/events")) {
        this.handleSSE(res);
        return;
      }
      if (req.url?.startsWith("/health")) {
        const snapshot = this.monitor.getLatestSnapshot();
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(snapshot ?? {}));
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html");
      res.end(this.renderHtml());
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.config.port, resolve);
      this.server!.on("error", reject);
    });
    this.logger.info?.(`Health dashboard listening on port ${this.config.port}`);
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }
    for (const res of this.listeners) {
      res.end();
    }
    this.listeners.clear();
    await new Promise<void>((resolve, reject) => {
      this.server!.close(err => (err ? reject(err) : resolve()));
    });
    this.server = undefined;
  }

  handleSnapshot(snapshot: HealthSnapshot): void {
    for (const res of this.listeners) {
      res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    }
  }

  private authorize(req: http.IncomingMessage): boolean {
    if (!this.config.authToken) {
      return true;
    }
    const header = req.headers.authorization;
    if (!header) {
      return false;
    }
    return header === `Bearer ${this.config.authToken}`;
  }

  private handleSSE(res: http.ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "Cache-Control": "no-cache"
    });
    this.listeners.add(res);
    const snapshot = this.monitor.getLatestSnapshot();
    if (snapshot) {
      res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    }
    res.on("close", () => {
      this.listeners.delete(res);
    });
  }

  private renderHtml(): string {
    return `<!DOCTYPE html>
<html>
  <head>
    <title>Health Dashboard</title>
    <style>
      body { font-family: sans-serif; padding: 1rem; background: #0f172a; color: #e2e8f0; }
      .status { margin-bottom: 1rem; padding: 1rem; border-radius: 8px; }
      .healthy { background: #14532d; }
      .degraded { background: #92400e; }
      .failed { background: #7f1d1d; }
    </style>
  </head>
  <body>
    <h1>Health Dashboard</h1>
    <div id="overall"></div>
    <div id="components"></div>
    <script>
      const es = new EventSource('/events');
      es.onmessage = event => {
        const snapshot = JSON.parse(event.data);
        document.getElementById('overall').innerHTML = '<strong>Overall:</strong> ' + snapshot.overall;
        const container = document.getElementById('components');
        container.innerHTML = '';
        (snapshot.statuses || []).forEach(status => {
          const div = document.createElement('div');
          div.className = 'status ' + status.state;
          div.innerHTML = '<strong>' + status.component + '</strong><br/>State: ' + status.state + '<br/>' + (status.details || '');
          container.appendChild(div);
        });
      };
    </script>
  </body>
</html>`;
  }
}
