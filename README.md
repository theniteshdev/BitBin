# BitBin

A secure, modern cloud storage application with end-to-end encryption. Built with Firebase Auth, Firestore, and a lightweight Node.js server for file storage.

## Features

- **Secure Authentication** — Email/password sign-up and sign-in powered by Firebase Auth with RS256 ID token verification
- **File Upload & Download** — Drag-and-drop or browse uploads with progress tracking, stored locally on the server with per-user isolation
- **File Preview** — View images, PDFs, and text files directly in the browser
- **Secure Sharing** — Share files via encrypted links with access levels (view/edit) and optional expiry dates
- **Clean Interface** — Black-and-white macOS-inspired design with serif headings, scroll animations, and terminal-style visualizations

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JavaScript, CSS (no frameworks) |
| Backend | Pure Node.js HTTP server (TypeScript) |
| Auth | Firebase Authentication |
| Database | Firebase Firestore (user profiles, file metadata, shares) |
| File Storage | Local filesystem (server-side, per-user directories) |

## Quick Start

### Prerequisites

- Node.js 20+
- A Firebase project ([setup guide](FIREBASE_SETUP.md))

### Setup

```bash
# Clone the repository
git clone https://github.com/Deji-Tech/BitBin.git
cd BitBin

# Install dependencies
npm install

# Create your environment file
cp .env.example .env

# Edit .env with your Firebase project config
nano .env
```

### Run

```bash
npm run dev
```

The server starts at `http://localhost:4000`:

- `/` — Landing page
- `/auth` — Sign in / Sign up
- `/app` — File vault (requires authentication)

## Architecture

```
┌──────────┐        ┌──────────────┐        ┌─────────────┐
│ Browser  │ ◄────► │ Node.js      │ ◄────► │ Firebase    │
│          │  static│ Server       │ verify │ Auth        │
│  UI/JS   │  files │              │ tokens │ Firestore   │
│          │        │ File upload  │        │             │
│          │        │ download     │        └─────────────┘
│          │        │ (local FS)   │
└──────────┘        └──────────────┘
```

- The server verifies Firebase ID tokens using Google's public RSA keys
- Files are stored in `uploads/{userId}/` on the server
- File metadata and share records live in Firestore
- No Firebase Storage required — keeps costs at zero on the free tier

## Project Structure

```
BitBin/
├── client/                 # Frontend
│   ├── index.html          # Landing page
│   ├── auth.html           # Sign in / Sign up
│   ├── app.html            # File vault dashboard
│   ├── css/                # Stylesheets
│   └── js/                 # Client-side JavaScript
├── server/
│   └── app.ts              # HTTP server + API endpoints
├── FIREBASE_SETUP.md       # Firebase configuration guide
├── .env.example            # Environment template
├── package.json
└── tsconfig.json
```

## Environment Variables

| Variable | Description | Default |
|----------|------------|---------|
| `PORT` | Server port | `4000` |
| `HOST` | Server host | `localhost` |
| `CORS_ORIGIN` | Allowed CORS origin | `http://localhost:4000` |
| `FIREBASE_API_KEY` | Firebase API key | — |
| `FIREBASE_AUTH_DOMAIN` | Firebase auth domain | — |
| `FIREBASE_PROJECT_ID` | Firebase project ID | — |
| `FIREBASE_STORAGE_BUCKET` | Firebase storage bucket | — |
| `FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender | — |
| `FIREBASE_APP_ID` | Firebase app ID | — |
| `MAX_FILE_SIZE` | Max upload size in bytes | `52428800` (50MB) |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/firebase-config` | Returns Firebase config (public) |
| `POST` | `/api/files/upload` | Upload file(s) (multipart) |
| `GET` | `/api/files/download?id=` | Download file |
| `GET` | `/api/files/preview?id=` | Preview file (inline) |
| `DELETE` | `/api/files/delete?id=` | Delete file |

All file endpoints require a Firebase ID token in the `Authorization: Bearer <token>` header.

## Security

- Firebase ID tokens verified server-side via Google's public RSA keys
- Files isolated per user in separate directories
- Firestore security rules enforce user-level access control
- File type allowlist prevents dangerous uploads
- File size limits prevent abuse
- CORS restricted to configured origin

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## ⚖️ License

BitBin is released under the MIT License. See [LICENSE](./LICENSE) for details.
