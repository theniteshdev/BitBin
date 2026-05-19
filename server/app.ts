import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync, createReadStream, statSync, unlinkSync, readdirSync } from "node:fs";
import { join, extname, dirname, basename } from "node:path";
import { createVerify, createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { get } from "node:https";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

// ─── Environment Config ─────────────────────────────────────────────────────

function loadEnv(): Record<string, string> {
  const envPath = join(rootDir, ".env");
  const env: Record<string, string> = {};
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [key, ...rest] = trimmed.split("=");
      env[key.trim()] = rest.join("=").trim();
    }
  }
  return {
    PORT: env.PORT || "4000",
    HOST: env.HOST || "localhost",
    CORS_ORIGIN: env.CORS_ORIGIN || "http://localhost:4000",
    FIREBASE_PROJECT_ID: env.FIREBASE_PROJECT_ID || "",
    FIREBASE_API_KEY: env.FIREBASE_API_KEY || "",
    FIREBASE_AUTH_DOMAIN: env.FIREBASE_AUTH_DOMAIN || "",
    FIREBASE_STORAGE_BUCKET: env.FIREBASE_STORAGE_BUCKET || "",
    FIREBASE_MESSAGING_SENDER_ID: env.FIREBASE_MESSAGING_SENDER_ID || "",
    FIREBASE_APP_ID: env.FIREBASE_APP_ID || "",
    FIREBASE_MEASUREMENT_ID: env.FIREBASE_MEASUREMENT_ID || "",
    MAX_FILE_SIZE: env.MAX_FILE_SIZE || "52428800",
    UPLOAD_DIR: env.UPLOAD_DIR || "./uploads",
  };
}

const config = loadEnv();
const uploadDir = join(rootDir, config.UPLOAD_DIR);

function ensureDirs(): void {
  if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });
}

// ─── Firebase Token Verification (RS256 JWT) ────────────────────────────────

let googleKeysCache: Record<string, string> = {};
let googleKeysExpiry = 0;

function base64UrlDecode(str: string): string {
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

async function fetchGoogleKeys(): Promise<Record<string, string>> {
  const now = Date.now();
  if (now < googleKeysExpiry && Object.keys(googleKeysCache).length > 0) {
    return googleKeysCache;
  }

  return new Promise((resolve, reject) => {
    get("https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com", (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          googleKeysCache = JSON.parse(data);
          const cacheControl = res.headers["cache-control"] || "";
          const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
          const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1]) : 3600;
          googleKeysExpiry = now + (maxAge - 60) * 1000;
          resolve(googleKeysCache);
        } catch {
          reject(new Error("Failed to parse Google keys"));
        }
      });
    }).on("error", reject);
  });
}

function pemFromX509(cert: string): string {
  if (cert.includes("BEGIN CERTIFICATE")) return cert;
  return `-----BEGIN CERTIFICATE-----\n${cert}\n-----END CERTIFICATE-----`;
}

interface DecodedToken {
  header: Record<string, string>;
  payload: FirebaseTokenPayload;
  signature: string;
}

interface FirebaseTokenPayload {
  iss: string;
  aud: string;
  auth_time: number;
  user_id: string;
  sub: string;
  iat: number;
  exp: number;
  email?: string;
  email_verified?: boolean;
  firebase: {
    identities: Record<string, string[]>;
    sign_in_provider: string;
  };
}

function decodeToken(token: string): DecodedToken {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token format");
  return {
    header: JSON.parse(base64UrlDecode(parts[0])),
    payload: JSON.parse(base64UrlDecode(parts[1])),
    signature: parts[2],
  };
}

async function verifyFirebaseToken(token: string): Promise<FirebaseTokenPayload | null> {
  try {
    const decoded = decodeToken(token);
    const { payload } = decoded;

    // Check expiration
    if (payload.exp * 1000 < Date.now()) return null;

    // Verify issuer
    const expectedIss = `https://securetoken.google.com/${config.FIREBASE_PROJECT_ID}`;
    if (payload.iss !== expectedIss) return null;

    // Verify audience
    if (payload.aud !== config.FIREBASE_PROJECT_ID) return null;

    // Verify signature
    const keys = await fetchGoogleKeys();
    const kid = decoded.header.kid;
    const certPem = keys[kid];
    if (!certPem) return null;

    const signingInput = `${token.split(".")[0]}.${token.split(".")[1]}`;
    const signatureBuffer = Buffer.from(decoded.signature, "base64");
    const pem = pemFromX509(certPem);

    const verifier = createVerify("SHA256");
    verifier.update(signingInput);
    const isValid = verifier.verify(pem, signatureBuffer);

    if (!isValid) return null;

    return payload;
  } catch {
    return null;
  }
}

function extractToken(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

// ─── Multipart Parser ───────────────────────────────────────────────────────

function splitBuffer(buf: Buffer, delimiter: Buffer): Buffer[] {
  const result: Buffer[] = [];
  let start = 0;
  while (start < buf.length) {
    const idx = buf.indexOf(delimiter, start);
    if (idx === -1) {
      result.push(buf.slice(start));
      break;
    }
    result.push(buf.slice(start, idx));
    start = idx + delimiter.length;
  }
  return result;
}

interface MultipartFile {
  field: string;
  filename: string;
  mimeType: string;
  data: Buffer;
}

function parseMultipart(body: Buffer, contentType: string): { fields: Record<string, string>; files: MultipartFile[] } {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!boundaryMatch) return { fields: {}, files: [] };
  const boundary = (boundaryMatch[1] || boundaryMatch[2]).trim();
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const parts = splitBuffer(body, boundaryBuffer);
  const fields: Record<string, string> = {};
  const files: MultipartFile[] = [];

  for (const part of parts.slice(1, -1)) {
    const headerEndIdx = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEndIdx === -1) continue;
    const headers = part.slice(0, headerEndIdx).toString("utf-8");
    const dataStart = headerEndIdx + 4;
    const data = part.slice(dataStart, part.length - 2);

    const nameMatch = headers.match(/name="([^"]+)"/);
    const filenameMatch = headers.match(/filename="([^"]+)"/);
    const typeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/);

    if (filenameMatch && nameMatch) {
      files.push({
        field: nameMatch[1],
        filename: filenameMatch[1],
        mimeType: typeMatch ? typeMatch[1].trim() : "application/octet-stream",
        data,
      });
    } else if (nameMatch) {
      fields[nameMatch[1]] = data.toString("utf-8").trim();
    }
  }

  return { fields, files };
}

// ─── Request Parsing ────────────────────────────────────────────────────────

function getBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

// ─── Response Helpers ───────────────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".zip": "application/zip",
};

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body).toString(),
  });
  res.end(body);
}

// ─── CORS ───────────────────────────────────────────────────────────────────

function addCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", config.CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// ─── File Operations ────────────────────────────────────────────────────────

function userDir(userId: string): string {
  const dir = join(uploadDir, userId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

const ALLOWED_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml",
  "application/pdf", "text/plain", "text/csv", "text/html",
  "application/json", "application/javascript", "text/css",
  "application/zip", "application/x-zip-compressed",
  "video/mp4", "video/webm",
  "audio/mpeg", "audio/wav", "audio/ogg",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

async function handleUpload(req: IncomingMessage, res: ServerResponse, userId: string): Promise<void> {
  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("multipart/")) {
    return sendJson(res, 400, { error: "Multipart form data required" });
  }

  const body = await getBody(req);
  const maxFileSize = parseInt(config.MAX_FILE_SIZE);
  const { files } = parseMultipart(body, contentType);

  if (files.length === 0) {
    return sendJson(res, 400, { error: "No files uploaded" });
  }

  const uDir = userDir(userId);
  const uploaded: Array<{ id: string; originalName: string; mimeType: string; size: number }> = [];

  for (const file of files) {
    if (file.data.length > maxFileSize) {
      return sendJson(res, 413, { error: `File ${file.filename} exceeds size limit` });
    }

    if (!ALLOWED_TYPES.has(file.mimeType)) {
      return sendJson(res, 400, { error: `File type ${file.mimeType} not allowed` });
    }

    const fileId = randomBytes(16).toString("hex");
    const safeName = sanitizeFilename(basename(file.filename, extname(file.filename)));
    const fileExt = extname(file.filename);
    const storedName = `${safeName}_${fileId}${fileExt}`;
    const filePath = join(uDir, storedName);

    writeFileSync(filePath, file.data);

    uploaded.push({
      id: fileId,
      originalName: file.filename,
      mimeType: file.mimeType,
      size: file.data.length,
    });
  }

  sendJson(res, 201, { message: "Uploaded", files: uploaded });
}

function handleDownload(req: IncomingMessage, res: ServerResponse, userId: string, fileId: string, inline: boolean): void {
  const uDir = userDir(userId);
  const files = readdirSync(uDir);
  const matched = files.find((f) => f.includes(fileId));

  if (!matched) {
    return sendJson(res, 404, { error: "File not found" });
  }

  const filePath = join(uDir, matched);
  if (!existsSync(filePath)) {
    return sendJson(res, 404, { error: "File not found" });
  }

  try {
    const stats = statSync(filePath);
    const mimeType = getMimeType(filePath);
    const headers: Record<string, string> = {
      "Content-Type": mimeType,
      "Content-Length": stats.size.toString(),
    };

    if (!inline) {
      const originalName = matched.split(`_${fileId}`)[0] || matched;
      headers["Content-Disposition"] = `attachment; filename="${encodeURIComponent(originalName)}"`;
    }

    res.writeHead(200, headers);
    createReadStream(filePath).pipe(res);
  } catch {
    sendJson(res, 500, { error: "Failed to read file" });
  }
}

function handleDelete(userId: string, fileId: string): { message: string } {
  const uDir = userDir(userId);
  const files = readdirSync(uDir);
  const matched = files.find((f) => f.includes(fileId));

  if (matched) {
    const filePath = join(uDir, matched);
    if (existsSync(filePath)) unlinkSync(filePath);
  }

  return { message: "Deleted" };
}

// ─── Auth Middleware ────────────────────────────────────────────────────────

async function requireAuth(req: IncomingMessage, res: ServerResponse): Promise<string | null> {
  const token = extractToken(req);
  if (!token) {
    sendJson(res, 401, { error: "Authentication required" });
    return null;
  }

  const payload = await verifyFirebaseToken(token);
  if (!payload) {
    sendJson(res, 401, { error: "Invalid or expired token" });
    return null;
  }

  return payload.user_id;
}

// ─── Router ─────────────────────────────────────────────────────────────────

async function routeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url || "/";
  const method = req.method || "GET";
  const pathname = url.split("?")[0];

  if (method === "OPTIONS") {
    addCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  addCors(res);

  // Firebase config
  if (pathname === "/api/firebase-config" && method === "GET") {
    return sendJson(res, 200, {
      apiKey: config.FIREBASE_API_KEY,
      authDomain: config.FIREBASE_AUTH_DOMAIN,
      projectId: config.FIREBASE_PROJECT_ID,
      storageBucket: config.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: config.FIREBASE_MESSAGING_SENDER_ID,
      appId: config.FIREBASE_APP_ID,
      measurementId: config.FIREBASE_MEASUREMENT_ID,
    });
  }

  // File upload
  if (pathname === "/api/files/upload" && method === "POST") {
    const userId = await requireAuth(req, res);
    if (!userId) return;
    return handleUpload(req, res, userId);
  }

  // File download
  if (pathname === "/api/files/download" && method === "GET") {
    const userId = await requireAuth(req, res);
    if (!userId) return;
    const params = new URLSearchParams(url.split("?")[1] || "");
    const fileId = params.get("id");
    if (!fileId) return sendJson(res, 400, { error: "File ID required" });
    return handleDownload(req, res, userId, fileId, false);
  }

  // File preview
  if (pathname === "/api/files/preview" && method === "GET") {
    const userId = await requireAuth(req, res);
    if (!userId) return;
    const params = new URLSearchParams(url.split("?")[1] || "");
    const fileId = params.get("id");
    if (!fileId) return sendJson(res, 400, { error: "File ID required" });
    return handleDownload(req, res, userId, fileId, true);
  }

  // File delete
  if (pathname === "/api/files/delete" && method === "DELETE") {
    const userId = await requireAuth(req, res);
    if (!userId) return;
    const params = new URLSearchParams(url.split("?")[1] || "");
    const fileId = params.get("id");
    if (!fileId) return sendJson(res, 400, { error: "File ID required" });
    return sendJson(res, 200, handleDelete(userId, fileId));
  }

  // Static files
  const clientDir = join(rootDir, "client");
  let filePath: string;

  if (pathname === "/") filePath = join(clientDir, "index.html");
  else if (pathname === "/auth") filePath = join(clientDir, "auth.html");
  else if (pathname === "/app") filePath = join(clientDir, "app.html");
  else filePath = join(clientDir, pathname);

  if (!filePath.startsWith(clientDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!existsSync(filePath)) {
    const indexFile = join(clientDir, "index.html");
    if (existsSync(indexFile)) {
      const stats = statSync(indexFile);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": stats.size.toString() });
      createReadStream(indexFile).pipe(res);
      return;
    }
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const mimeType = getMimeType(filePath);
  const stats = statSync(filePath);
  const cacheControl = mimeType.includes("javascript") || mimeType.includes("css") || mimeType.includes("html")
    ? "no-cache, no-store, must-revalidate"
    : "public, max-age=3600";
  res.writeHead(200, {
    "Content-Type": mimeType,
    "Content-Length": stats.size.toString(),
    "Cache-Control": cacheControl,
  });
  createReadStream(filePath).pipe(res);
}

// ─── Server Start ───────────────────────────────────────────────────────────

ensureDirs();

const server = createServer(async (req, res) => {
  try {
    await routeRequest(req, res);
  } catch (err) {
    console.error("Unhandled error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal server error");
    }
  }
});

const port = parseInt(config.PORT);
const host = config.HOST;

server.listen(port, host, () => {
  console.log(`BitBin running at http://${host}:${port}`);
  console.log(`Landing: http://${host}:${port}/`);
  console.log(`Auth:    http://${host}:${port}/auth`);
  console.log(`App:     http://${host}:${port}/app`);
});

server.on("error", (err: Error & { code?: string }) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use`);
  } else {
    console.error("Server error:", err.message);
  }
  process.exit(1);
});
