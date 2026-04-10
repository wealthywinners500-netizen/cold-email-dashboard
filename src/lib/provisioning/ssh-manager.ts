import { NodeSSH } from 'node-ssh';

// ============================================
// Custom Error Classes
// ============================================

export class SSHConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SSHConnectionError';
  }
}

export class SSHCommandError extends Error {
  constructor(
    message: string,
    public stdout: string = '',
    public stderr: string = '',
    public code: number = -1
  ) {
    super(message);
    this.name = 'SSHCommandError';
  }
}

export class SSHTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SSHTimeoutError';
  }
}

// ============================================
// Type Definitions
// ============================================

export interface SSHAuthConfig {
  password?: string;
  privateKey?: string;
}

export interface ExecOptions {
  timeout?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

// ============================================
// SSHManager Class
// ============================================

export class SSHManager {
  private ssh: NodeSSH | null = null;
  private host: string = '';
  private port: number = 22;
  private username: string = '';
  private authConfig: SSHAuthConfig | null = null;
  private isConnectedFlag: boolean = false;
  private keepaliveIntervalHandle: NodeJS.Timeout | null = null;
  private missedKeepalives: number = 0;
  private maxMissedKeepalives: number = 3;
  private log: (msg: string) => void;

  constructor(log?: (msg: string) => void) {
    this.log = log || (() => {});
  }

  /**
   * Lazy initialize the NodeSSH client
   */
  private initializeSSH(): NodeSSH {
    if (!this.ssh) {
      this.ssh = new NodeSSH();
    }
    return this.ssh;
  }

  /**
   * Connect with retry logic and keepalive
   * Attempts: 3 with exponential backoff (2s, 4s, 8s)
   * Connection timeout: 30s
   * Keepalive: every 5s, max 3 missed keepalives
   */
  async connect(
    host: string,
    port: number,
    username: string,
    auth: SSHAuthConfig
  ): Promise<void> {
    const maxRetries = 3;
    const backoffMs = [2000, 4000, 8000];
    const connectionTimeout = 30000;

    this.host = host;
    this.port = port;
    this.username = username;
    this.authConfig = auth;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        this.log(
          `[SSH] Connecting to ${username}@${host}:${port} (attempt ${attempt + 1}/${maxRetries})`
        );

        const client = this.initializeSSH();

        const connectConfig: any = {
          host,
          port,
          username,
          readyTimeout: connectionTimeout,
        };

        if (auth.privateKey) {
          connectConfig.privateKey = auth.privateKey;
        } else if (auth.password) {
          connectConfig.password = auth.password;
        }

        await client.connect(connectConfig);

        this.isConnectedFlag = true;
        this.missedKeepalives = 0;
        this.log(`[SSH] Connected to ${username}@${host}:${port}`);

        // Start keepalive interval
        this.startKeepalive();

        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.log(
          `[SSH] Connection attempt ${attempt + 1} failed: ${lastError.message}`
        );

        if (attempt < maxRetries - 1) {
          const waitMs = backoffMs[attempt];
          this.log(`[SSH] Retrying in ${waitMs}ms...`);
          await this.sleep(waitMs);
        }
      }
    }

    throw new SSHConnectionError(
      `Failed to connect after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`
    );
  }

  /**
   * Start keepalive pings every 5 seconds
   * Disconnect if 3 keepalives are missed
   */
  private startKeepalive(): void {
    this.stopKeepalive();

    this.keepaliveIntervalHandle = setInterval(() => {
      if (!this.ssh || !this.isConnectedFlag) {
        return;
      }

      try {
        // Use a simple echo command to keep connection alive
        this.ssh.execCommand('echo "keepalive"').then(() => {
          // Only reset on SUCCESS (fixes race condition where reset ran before promise resolved)
          this.missedKeepalives = 0;
        }).catch(() => {
          this.missedKeepalives++;
          this.log(
            `[SSH] Keepalive missed (${this.missedKeepalives}/${this.maxMissedKeepalives})`
          );

          if (this.missedKeepalives >= this.maxMissedKeepalives) {
            this.log(
              `[SSH] Max missed keepalives reached, closing connection`
            );
            this.disconnect().catch(() => {});
          }
        });
      } catch {
        this.missedKeepalives++;
      }
    }, 5000);
  }

  /**
   * Stop keepalive interval
   */
  private stopKeepalive(): void {
    if (this.keepaliveIntervalHandle) {
      clearInterval(this.keepaliveIntervalHandle);
      this.keepaliveIntervalHandle = null;
    }
  }

  /**
   * Safely disconnect
   */
  async disconnect(): Promise<void> {
    this.stopKeepalive();

    if (this.ssh && this.isConnectedFlag) {
      try {
        this.log(`[SSH] Disconnecting from ${this.username}@${this.host}:${this.port}`);
        await this.ssh.dispose();
        this.isConnectedFlag = false;
        this.ssh = null;
        this.log(`[SSH] Disconnected`);
      } catch (error) {
        this.log(
          `[SSH] Error during disconnect: ${error instanceof Error ? error.message : String(error)}`
        );
        this.isConnectedFlag = false;
        this.ssh = null;
      }
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.isConnectedFlag;
  }

  /**
   * Execute command and return result
   * Default timeout: 60s
   */
  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    // Auto-reconnect if connection was dropped (e.g., idle timeout during DNS propagation wait)
    if ((!this.ssh || !this.isConnectedFlag) && this.authConfig && this.host) {
      this.log(`[SSH] Connection lost — auto-reconnecting to ${this.username}@${this.host}:${this.port}...`);
      // Reset state for fresh connection
      this.ssh = null;
      this.isConnectedFlag = false;
      await this.connect(this.host, this.port, this.username, this.authConfig);
    }

    if (!this.ssh || !this.isConnectedFlag) {
      throw new SSHConnectionError('Not connected');
    }

    const timeout = options?.timeout ?? 60000;

    this.log(`[SSH] Executing: ${command}`);

    try {
      const result = await Promise.race([
        this.ssh.execCommand(command),
        this.createTimeoutPromise(timeout),
      ]);

      if (typeof result === 'symbol') {
        // Timeout occurred
        throw new SSHTimeoutError(
          `Command timed out after ${timeout}ms: ${command}`
        );
      }

      const { stdout, stderr, code } = result;
      const finalCode = code || 0;

      if (finalCode !== 0) {
        // Log stdout/stderr on failure so we can diagnose exit codes without re-running
        const stderrSnippet = (stderr || '').trim().slice(0, 500);
        const stdoutSnippet = (stdout || '').trim().slice(0, 500);
        this.log(`[SSH] Command failed with code ${finalCode}`);
        if (stderrSnippet) this.log(`[SSH] STDERR: ${stderrSnippet}`);
        if (stdoutSnippet) this.log(`[SSH] STDOUT: ${stdoutSnippet}`);
        throw new SSHCommandError(
          `Command failed with exit code ${finalCode}: ${command}`,
          stdout || '',
          stderr || '',
          finalCode
        );
      }

      this.log(`[SSH] Command succeeded`);
      return {
        stdout: stdout || '',
        stderr: stderr || '',
        code: finalCode,
      };
    } catch (error) {
      if (error instanceof SSHTimeoutError || error instanceof SSHCommandError) {
        throw error;
      }

      if (error instanceof Error) {
        throw new SSHCommandError(
          `Command execution failed: ${error.message}`,
          '',
          error.message,
          -1
        );
      }

      throw new SSHCommandError(
        `Command execution failed: ${command}`,
        '',
        String(error),
        -1
      );
    }
  }

  /**
   * Execute command with real-time streaming
   * Useful for long-running commands like HestiaCP installation
   */
  async execStream(
    command: string,
    onStdout?: (chunk: string) => void,
    onStderr?: (chunk: string) => void
  ): Promise<number> {
    // Auto-reconnect if connection was dropped
    if ((!this.ssh || !this.isConnectedFlag) && this.authConfig && this.host) {
      this.log(`[SSH] Connection lost — auto-reconnecting to ${this.username}@${this.host}:${this.port}...`);
      this.ssh = null;
      this.isConnectedFlag = false;
      await this.connect(this.host, this.port, this.username, this.authConfig);
    }

    if (!this.ssh || !this.isConnectedFlag) {
      throw new SSHConnectionError('Not connected');
    }

    this.log(`[SSH] Executing (streaming): ${command}`);

    return new Promise((resolve, reject) => {
      this.ssh!.execCommand(command, {
        onChannel: (channel: any) => {
          channel.on('close', (code: number) => {
            this.log(`[SSH] Streaming command exited with code ${code}`);
            resolve(code || 0);
          });

          channel.on('data', (chunk: Buffer) => {
            const data = chunk.toString('utf8');
            this.log(`[SSH] STDOUT: ${data.substring(0, 100)}`);
            onStdout?.(data);
          });

          channel.stderr?.on('data', (chunk: Buffer) => {
            const data = chunk.toString('utf8');
            this.log(`[SSH] STDERR: ${data.substring(0, 100)}`);
            onStderr?.(data);
          });
        },
      }).catch((error: any) => {
        this.log(`[SSH] Stream error: ${error.message}`);
        reject(
          new SSHCommandError(
            `Stream execution failed: ${error.message}`,
            '',
            error.message,
            -1
          )
        );
      });
    });
  }

  /**
   * Upload file via SFTP
   */
  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    if (!this.ssh || !this.isConnectedFlag) {
      throw new SSHConnectionError('Not connected');
    }

    this.log(`[SSH] Uploading ${localPath} to ${remotePath}`);

    try {
      await this.ssh.putFile(localPath, remotePath);
      this.log(`[SSH] Upload successful`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      this.log(`[SSH] Upload failed: ${message}`);
      throw new SSHCommandError(
        `File upload failed: ${message}`,
        '',
        message,
        -1
      );
    }
  }

  /**
   * Download file via SFTP
   */
  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    if (!this.ssh || !this.isConnectedFlag) {
      throw new SSHConnectionError('Not connected');
    }

    this.log(`[SSH] Downloading ${remotePath} to ${localPath}`);

    try {
      await this.ssh.getFile(localPath, remotePath);
      this.log(`[SSH] Download successful`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      this.log(`[SSH] Download failed: ${message}`);
      throw new SSHCommandError(
        `File download failed: ${message}`,
        '',
        message,
        -1
      );
    }
  }

  /**
   * Helper: sleep for ms
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Helper: create timeout promise
   */
  private createTimeoutPromise(ms: number): Promise<symbol> {
    return new Promise((resolve) => {
      setTimeout(() => resolve(Symbol('timeout')), ms);
    });
  }
}

// ============================================
// Connection Pool
// ============================================

interface PooledConnection {
  manager: SSHManager;
  lastUsed: number;
  expiresAt: number;
}

export class SSHConnectionPool {
  private static instance: SSHConnectionPool;
  private connections: Map<string, PooledConnection> = new Map();
  private readonly expirationTime = 5 * 60 * 1000; // 5 minutes
  private cleanupIntervalHandle: NodeJS.Timeout | null = null;
  private log: (msg: string) => void;

  private constructor(log?: (msg: string) => void) {
    this.log = log || (() => {});
    this.startCleanupInterval();
  }

  /**
   * Get singleton instance
   */
  static getInstance(log?: (msg: string) => void): SSHConnectionPool {
    if (!SSHConnectionPool.instance) {
      SSHConnectionPool.instance = new SSHConnectionPool(log);
    }
    return SSHConnectionPool.instance;
  }

  /**
   * Get or create connection
   */
  async getConnection(
    host: string,
    port: number,
    username: string,
    auth: SSHAuthConfig,
    log?: (msg: string) => void
  ): Promise<SSHManager> {
    const key = this.getKey(host, port, username);
    const now = Date.now();

    // Check if we have a valid pooled connection
    const pooled = this.connections.get(key);
    if (pooled && pooled.expiresAt > now && pooled.manager.isConnected()) {
      this.log(`[Pool] Reusing connection for ${key}`);
      pooled.lastUsed = now;
      return pooled.manager;
    }

    // Remove expired connection
    if (pooled) {
      this.log(`[Pool] Removing expired connection for ${key}`);
      await pooled.manager.disconnect();
      this.connections.delete(key);
    }

    // Create new connection
    this.log(`[Pool] Creating new connection for ${key}`);
    const manager = new SSHManager(log);
    await manager.connect(host, port, username, auth);

    // Store in pool
    this.connections.set(key, {
      manager,
      lastUsed: now,
      expiresAt: now + this.expirationTime,
    });

    return manager;
  }

  /**
   * Release connection (mark for reuse)
   */
  releaseConnection(host: string, port?: number, username?: string): void {
    const key = this.getKey(host, port, username);
    const pooled = this.connections.get(key);
    if (pooled) {
      pooled.lastUsed = Date.now();
      pooled.expiresAt = Date.now() + this.expirationTime;
      this.log(`[Pool] Released connection for ${key}`);
    }
  }

  /**
   * Close all pooled connections
   */
  async closeAll(): Promise<void> {
    this.log(`[Pool] Closing all connections (${this.connections.size} total)`);

    const promises = Array.from(this.connections.values()).map((pooled) =>
      pooled.manager.disconnect().catch(() => {})
    );

    await Promise.all(promises);
    this.connections.clear();

    if (this.cleanupIntervalHandle) {
      clearInterval(this.cleanupIntervalHandle);
      this.cleanupIntervalHandle = null;
    }

    this.log(`[Pool] All connections closed`);
  }

  /**
   * Start cleanup interval to remove expired connections
   */
  private startCleanupInterval(): void {
    this.cleanupIntervalHandle = setInterval(() => {
      const now = Date.now();
      const toDelete: string[] = [];

      Array.from(this.connections.entries()).forEach(([key, pooled]) => {
        if (pooled.expiresAt <= now) {
          toDelete.push(key);
          pooled.manager.disconnect().catch(() => {});
        }
      });

      if (toDelete.length > 0) {
        this.log(
          `[Pool] Cleaned up ${toDelete.length} expired connections`
        );
        toDelete.forEach((key) => this.connections.delete(key));
      }
    }, 30000); // Run cleanup every 30 seconds
  }

  /**
   * Generate connection key
   */
  private getKey(
    host: string,
    port?: number,
    username?: string
  ): string {
    return `${host}:${port || 22}:${username || 'root'}`;
  }
}
