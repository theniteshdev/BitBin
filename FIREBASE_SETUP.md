# Firebase Setup for BitBin

## What We Use
- **Firebase Auth** — Email/password authentication
- **Firestore** — User profiles, file metadata, share records
- **Server storage** — Actual files stored locally on the server (not Firebase Storage)

## Step 1 — Enable Email/Password Auth
1. Firebase Console → **Authentication** → **Sign-in method**
2. Click **Email/Password** → toggle **Enable** → **Save**
3. Go to **Settings** tab → **Authorized domains** → add `localhost`

## Step 2 — Create Firestore Database
1. Firebase Console → **Firestore Database** → **Create database**
2. Choose location (closest to you)
3. Select **Start in production mode**
4. Click **Enable**

## Step 3 — Apply Firestore Rules
1. Firestore → **Rules** tab
2. Replace all rules with:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /users/{userId} {
      // Users can read/write their own profile
      allow read, write: if request.auth != null && request.auth.uid == userId;

      // File metadata - only the owner can manage
      match /files/{fileId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }

      // Share records - only the owner can manage
      match /shares/{shareId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }

    // Deny everything else
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

3. Click **Publish**

## Step 4 — (Optional) Set up Firestore Indexes
The app may need composite indexes. When you first query, Firestore will show an error with a direct link to create the index. Click the link.

Required indexes (auto-created on first use):
- `users/{uid}/files` ordered by `uploadedAt desc`
- `users/{uid}/shares` ordered by `createdAt desc`
- `users/{uid}/shares` where `fileId == X`

## Step 5 — Test
1. Run `npm run dev`
2. Open `http://localhost:4000`
3. Click "Get started" → Sign up with email/password
4. You should be redirected to the app dashboard
5. Upload a file → it saves to `uploads/{userId}/` on the server
6. Metadata saves to Firestore

## How It Works

```
Browser                          Server                    Firebase
  │                                │                          │
  ├─ Sign up / Sign in ──────────►│                          │
  │                                ├─ (pass through) ────────►│ Auth
  │                                │                          │
  │◄─ Redirect to /app ──────────│◄─ onAuthStateChanged ────│
  │                                │                          │
  ├─ Upload file ────────────────►│                          │
  │  (multipart + ID token)        ├─ Verify token ──────────►│
  │                                ├─ Save to uploads/{uid}/  │
  │                                │                          │
  ├─ Save file metadata ──────────│─────────────────────────►│ Firestore
  │                                │                          │
  │◄─ File list from Firestore ───│◄─────────────────────────│
  │                                │                          │
```

## File Storage Location
Files are stored in `uploads/{userId}/` on the server disk. Each file is named `{originalName}_{fileId}.{ext}`.

This means:
- Files survive server restarts
- Files are isolated per user
- No Firebase Storage costs
- You need to manage disk space yourself
- For production deployment, consider using a volume or cloud storage
