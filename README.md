# Inkly

Inkly is a handwritten notes marketplace for medical courses with:

- account signup and login
- course, year and subject browsing
- in-app note previews and secure reading
- developer uploads
- Razorpay checkout and payment verification

## Publish Checklist

1. Keep local-only files out of the published repo:
   - `razorpay-config.json`
   - `data.json`
   - `uploads/`
   - `tmp/`
2. Create your production Razorpay config from [razorpay-config.example.json](</C:/Users/jiten/OneDrive/Documents/first app/razorpay-config.example.json>) or set environment variables:
   - `RAZORPAY_KEY_ID`
   - `RAZORPAY_KEY_SECRET`
3. Set your production admin account email:
   - `ADMIN_EMAIL=you@example.com`
4. Choose a persistent storage location for runtime files:
   - `STORAGE_DIR=/absolute/path/for/data`
   - this folder will hold `data.json`, `uploads/`, and rendered preview pages
5. Start the app with:

```bash
node server.js
```

6. For production, set:

```bash
NODE_ENV=production
PORT=3000
```

7. Make sure the app is served behind HTTPS in production so secure cookies work correctly.

## Docker Publish

You can also publish with Docker:

```bash
docker build -t inkly .
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e ADMIN_EMAIL=you@example.com \
  -e STORAGE_DIR=/app/storage \
  -e RAZORPAY_KEY_ID=your_key_id \
  -e RAZORPAY_KEY_SECRET=your_key_secret \
  -v inkly-storage:/app/storage \
  inkly
```

The named volume keeps your users, uploads, rendered PDF previews, and payment/order records across restarts.

## Render Publish

This repo now includes [render.yaml](</C:/Users/jiten/OneDrive/Documents/first app/render.yaml>) for a Docker-based Render deploy with:

- a web service health check at `/health`
- a persistent disk mounted at `/app/storage`
- secret prompts for `ADMIN_EMAIL`, `RAZORPAY_KEY_ID`, and `RAZORPAY_KEY_SECRET`

Recommended steps:

1. Push this project to GitHub.
2. In Render, create a new Blueprint and select the repo.
3. When prompted, enter:
   - `ADMIN_EMAIL`
   - `RAZORPAY_KEY_ID`
   - `RAZORPAY_KEY_SECRET`
4. Deploy the Blueprint.

Render's default web-service port is `10000`, and the included Blueprint already sets `PORT` to match that.

## Routes

- `GET /health` for a simple deployment health check
- `GET /api/me` session bootstrap
- `GET /api/notes` note catalog
- `POST /api/payments/razorpay/order` Razorpay order creation
- `POST /api/payments/razorpay/verify` Razorpay payment verification
- `GET /api/admin/dashboard` developer metrics

## Notes

- Uploaded PDFs are rendered as exact page images from the source PDF so the published note appearance stays unchanged.
- Payment fulfillment happens only after Razorpay signature verification on the server.
- In production, the first signup is no longer auto-promoted to developer/admin unless it matches `ADMIN_EMAIL`.
