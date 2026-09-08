# Deployment — Render Free Web Service

Render runs one Node Web Service. It serves the built frontend, `/api`, and `/ws` from the same HTTPS origin, so the browser automatically uses secure `wss://` WebSockets and microphone access works on supported mobile browsers. API keys remain server-side Render environment variables.

## Render configuration

`render.yaml` defines the service:

```text
Build command: npm ci && npm run build
Start command: npm run start
```

## Required environment variables

Set these as Render environment variables — never in client code:

```text
DEEPGRAM_API_KEY=your_deepgram_api_key
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-5.6-luna
```

Render supplies `PORT` automatically. Locally, the application defaults to port `3001`.

## Deploy

In Render, create a **Blueprint** from the GitHub repository containing this `render.yaml`. Add the two API keys when prompted; `OPENAI_MODEL` is already set to `gpt-5.6-luna` in the Blueprint.

The final phone route is:

```text
https://<your-render-service>.onrender.com/session/<sessionId>/combined
```

The WebSocket remains same-origin and automatic:

```text
wss://<your-render-service>.onrender.com/ws?sessionId=<sessionId>&role=combined
```

## Updates

Push a code update to the connected repository. Render automatically rebuilds using `npm ci && npm run build` and restarts with `npm run start`.

> Render Free services can spin down when idle, so the first request after inactivity may take longer. Once running, the WebSocket remains on the same Web Service.
